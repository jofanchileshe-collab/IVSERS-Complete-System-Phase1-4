/*
 * ============================================================================
 *  IVSERS Backend - controllers/busController.js
 *
 *  CRUD + live-status retrieval for fleet vehicles. Creation/update is
 *  restricted to fleet_manager/super_admin roles at the route level
 *  (see routes/buses.js); read access is open to any authenticated user
 *  so a driver's own dashboard view can still function.
 * ============================================================================
 */

const Bus = require('../models/Bus');
const User = require('../models/User');
const { busFilterForUser, combineFilters } = require('../utils/accessScope');

async function listBuses(req, res) {
  const { status, route, depot } = req.query;
  const filter = status ? { status } : { status: { $ne: 'decommissioned' } };
  if (status) filter.status = status;
  if (route) filter.route = route;
  if (depot) filter.depot = depot;

  const limitedRole = ['police', 'hospital', 'rtsa', 'fire_brigade'].includes(req.user.role);
  let query = Bus.find(combineFilters(filter, busFilterForUser(req.user)));
  if (limitedRole) {
    query = query.select(
      'vehicleId registrationNumber make model route status organization hardware.gps hardware.lastHeartbeat hardware.hazardState'
    );
  }
  if (!limitedRole) query = query.populate('driver', 'name phone').populate('owner', 'name phone');
  const buses = await query.sort({ vehicleId: 1 });
  res.json({ success: true, data: buses });
}

async function getBus(req, res) {
  const limitedRole = ['police', 'hospital', 'rtsa', 'fire_brigade'].includes(req.user.role);
  let query = Bus.findOne(combineFilters(
    { _id: req.params.id },
    busFilterForUser(req.user)
  ));
  if (limitedRole) {
    query = query.select(
      'vehicleId registrationNumber make model route status organization hardware.gps hardware.lastHeartbeat hardware.hazardState'
    );
  }
  if (!limitedRole) query = query.populate('driver', 'name phone').populate('owner', 'name phone');
  const bus = await query;
  if (!bus) {
    return res.status(404).json({ success: false, error: 'Bus not found' });
  }
  res.json({ success: true, data: bus });
}

async function getBusByVehicleId(req, res) {
  const limitedRole = ['police', 'hospital', 'rtsa', 'fire_brigade'].includes(req.user.role);
  const filter = combineFilters(
    { vehicleId: req.params.vehicleId.toUpperCase() },
    busFilterForUser(req.user)
  );
  let query = Bus.findOne(filter);
  if (limitedRole) {
    query = query.select(
      'vehicleId registrationNumber make model route status organization hardware.gps hardware.lastHeartbeat hardware.hazardState'
    );
  }
  if (!limitedRole) query = query.populate('driver', 'name phone').populate('owner', 'name phone');
  const bus = await query;
  if (!bus) {
    return res.status(404).json({ success: false, error: 'Bus not found' });
  }
  res.json({ success: true, data: bus });
}

async function createBus(req, res) {
  const {
    vehicleId, registrationNumber, make, model, year, capacity,
    maxLoadKg, route, depot, owner, driver,
  } = req.body;
  const organization = req.user.role === 'super_admin'
    ? String(req.body.organization || '').trim()
    : String(req.user.organization || '').trim();

  if (!organization) {
    return res.status(400).json({ success: false, error: 'Organization is required to register a vehicle' });
  }

  const existing = await Bus.findOne({ vehicleId: vehicleId.toUpperCase() });
  if (existing) {
    return res.status(409).json({ success: false, error: 'A bus with this vehicleId already exists' });
  }

  const ownerAccount = await findAssignableAccount(owner, 'bus_owner', organization);
  if (owner && !ownerAccount) {
    return res.status(400).json({ success: false, error: 'Selected owner must be an active account in this organization' });
  }
  const driverAccount = await findAssignableAccount(driver, 'driver', organization);
  if (driver && !driverAccount) {
    return res.status(400).json({ success: false, error: 'Selected driver must be an active account in this organization' });
  }
  if (driverAccount && driverAccount.assignedBus) {
    return res.status(409).json({ success: false, error: 'Selected driver is already assigned to a vehicle' });
  }

  let bus;
  try {
    bus = await Bus.create({
      vehicleId: vehicleId.trim().toUpperCase(),
      registrationNumber,
      make,
      model,
      year,
      capacity,
      maxLoadKg,
      route,
      depot,
      organization,
      owner: ownerAccount ? ownerAccount._id : null,
      driver: driverAccount ? driverAccount._id : null,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, error: 'A bus with this vehicleId already exists' });
    }
    throw err;
  }
  if (driverAccount) {
    driverAccount.assignedBus = bus._id;
    await driverAccount.save();
  }

  const populatedBus = await Bus.findById(bus._id)
    .populate('driver', 'name phone')
    .populate('owner', 'name phone');
  res.status(201).json({ success: true, data: populatedBus });
}

async function updateBus(req, res) {
  const scope = combineFilters({ _id: req.params.id }, busFilterForUser(req.user));
  const existingBus = await Bus.findOne(scope);
  if (!existingBus) {
    return res.status(404).json({ success: false, error: 'Bus not found' });
  }

  const allowedFields = [
    'registrationNumber', 'make', 'model', 'year', 'capacity',
    'maxLoadKg', 'route', 'depot', 'driver', 'owner', 'status',
  ];
  const update = {};
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) update[field] = req.body[field];
  });

  const organization = existingBus.organization || req.user.organization;
  let nextDriver = existingBus.driver ? String(existingBus.driver) : null;
  if (update.driver) {
    const account = await findAssignableAccount(update.driver, 'driver', organization);
    if (!account) {
      return res.status(400).json({ success: false, error: 'Selected driver must be an active account in this organization' });
    }
    if (account.assignedBus && String(account.assignedBus) !== String(existingBus._id)) {
      return res.status(409).json({ success: false, error: 'Selected driver is already assigned to another vehicle' });
    }
    nextDriver = String(account._id);
  } else if (Object.prototype.hasOwnProperty.call(update, 'driver')) {
    update.driver = null;
    nextDriver = null;
  }
  if (update.owner) {
    const account = await findAssignableAccount(update.owner, 'bus_owner', organization);
    if (!account) {
      return res.status(400).json({ success: false, error: 'Selected owner must be an active account in this organization' });
    }
  } else if (Object.prototype.hasOwnProperty.call(update, 'owner')) {
    update.owner = null;
  }

  const bus = await Bus.findOneAndUpdate(scope, { $set: update }, { new: true, runValidators: true })
    .populate('driver', 'name phone')
    .populate('owner', 'name phone');
  if (!bus) {
    return res.status(404).json({ success: false, error: 'Bus not found' });
  }
  if (existingBus.driver && String(existingBus.driver) !== nextDriver) {
    await User.updateOne({ _id: existingBus.driver, assignedBus: existingBus._id }, { $set: { assignedBus: null } });
  }
  if (nextDriver) {
    await User.updateOne({ _id: nextDriver }, { $set: { assignedBus: bus._id } });
  }
  res.json({ success: true, data: bus });
}

async function deleteBus(req, res) {
  const scope = combineFilters({ _id: req.params.id }, busFilterForUser(req.user));
  const existingBus = await Bus.findOne(scope);
  if (!existingBus) {
    return res.status(404).json({ success: false, error: 'Bus not found' });
  }
  const bus = await Bus.findOneAndUpdate(
    scope,
    { $set: { status: 'decommissioned', driver: null, owner: null } },
    { new: true }
  );
  if (!bus) {
    return res.status(404).json({ success: false, error: 'Bus not found' });
  }
  if (existingBus.driver) {
    await User.updateOne(
      { _id: existingBus.driver, assignedBus: existingBus._id },
      { $set: { assignedBus: null } }
    );
  }
  // Soft-delete only: a decommissioned bus retains its historical alert
  // and telemetry trail for audit/reporting purposes rather than being
  // hard-deleted from the fleet register.
  res.json({ success: true, data: bus });
}

async function findAssignableAccount(accountId, role, organization) {
  if (!accountId) return null;
  return User.findOne({
    _id: accountId,
    role,
    organization,
    status: 'active',
  }).select('_id assignedBus');
}

module.exports = { listBuses, getBus, getBusByVehicleId, createBus, updateBus, deleteBus };
