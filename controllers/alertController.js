/*
 * ============================================================================
 *  IVSERS Backend - controllers/alertController.js
 *
 *  Handles both directions of alert lifecycle:
 *    - Ingestion of a confirmed hazard from a vehicle (via MQTT or the
 *      HTTPS fallback route), which creates an Alert document and updates
 *      the owning Bus's live hazard-state flags.
 *    - Dashboard-side lifecycle actions (list/acknowledge/resolve) used by
 *      human operators.
 *
 *  KNOWN LIMITATION (documented, not silently patched over): the current
 *  Mega firmware (Phase 1) raises an OVERLOAD alert when the load first
 *  exceeds threshold, but only logs an "OVERLOAD_CLEAR" event to its local
 *  SD card - it does not currently transmit a clear event to the cloud.
 *  Dashboards should therefore treat `hardware.hazardState.overload`
 *  as advisory and compute current overload status from the live
 *  `hardware.sensors.loadKg` vs `maxLoadKg` telemetry stream instead of
 *  trusting the flag alone. Adding a cloud-transmitted clear event is a
 *  straightforward one-line addition to detectOverload() in a future
 *  firmware revision.
 * ============================================================================
 */

const Alert = require('../models/Alert');
const Bus = require('../models/Bus');
const socketService = require('../services/socketService');
const telemetryController = require('./telemetryController');
const logger = require('../utils/logger');
const { alertFilterForUser, combineFilters } = require('../utils/accessScope');

const ZONE_KEYWORDS = [
  { keyword: 'engine', flag: 'fireEngine' },
  { keyword: 'cabin', flag: 'fireCabin' },
  { keyword: 'electric', flag: 'fireElectric' },
];

function applyHazardStateForAlert(type, details) {
  const flags = {};
  const lowerDetails = (details || '').toLowerCase();

  if (type === 'FIRE_MANUAL') {
    flags.fireEngine = true;
    flags.fireCabin = true;
    flags.fireElectric = true;
  } else if (type === 'FIRE') {
    const matched = ZONE_KEYWORDS.filter((z) => lowerDetails.includes(z.keyword));
    if (matched.length > 0) {
      matched.forEach((z) => { flags[z.flag] = true; });
    } else {
      // Zone could not be determined from the details text - flag all
      // three so the dashboard still surfaces the alert prominently
      // rather than silently under-reporting it.
      flags.fireEngine = true;
      flags.fireCabin = true;
      flags.fireElectric = true;
    }
  } else if (type === 'OVERLOAD') {
    flags.overload = true;
  } else if (type === 'ACCIDENT') {
    flags.accident = true;
  } else if (type === 'PANIC') {
    flags.panic = true;
  }
  // LOW_SUPPRESSION intentionally does not set a hazardState flag - it is
  // a maintenance-priority warning, not an active-hazard indicator.

  return flags;
}

/**
 * Creates an Alert from a device-originated payload.
 * `payload.fields` = [hazardType, details, gpsRaw] per the ESP32 bridge's
 * ALERT-type message encoding.
 */
async function ingestAlertFromDevice(deviceId, payload) {
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const [hazardType, details = '', gpsRaw = ''] = fields;

  if (!hazardType) {
    logger.warn(`Malformed alert payload ignored: ${JSON.stringify(payload)}`);
    return null;
  }

  const bus = await telemetryController.findOrCreateBus(deviceId.toUpperCase());
  const gps = telemetryController.parseGps(gpsRaw);

  const alert = await Alert.create({
    vehicleId: deviceId.toUpperCase(),
    bus: bus._id,
    organization: bus.organization,
    type: hazardType,
    details,
    location: gps
      ? {
          latitude: gps.latitude,
          longitude: gps.longitude,
          googleMapsUrl: `https://maps.google.com/?q=${gps.latitude},${gps.longitude}`,
        }
      : undefined,
  });

  const hazardFlags = applyHazardStateForAlert(hazardType, details);
  const flagUpdate = {};
  Object.entries(hazardFlags).forEach(([key, value]) => {
    flagUpdate[`hardware.hazardState.${key}`] = value;
  });

  const updatedBus = await Bus.findByIdAndUpdate(bus._id, { $set: flagUpdate }, { new: true });

  logger.warn(`ALERT [${hazardType}] from ${deviceId}: ${details}`);
  socketService.broadcastAlert(alert);
  socketService.broadcastBusUpdate(updatedBus);

  return alert;
}

// ---------------------------------------------------------------------------
// Dashboard-facing REST handlers
// ---------------------------------------------------------------------------

async function listAlerts(req, res) {
  const { status, type, vehicleId, limit = 50, page = 1 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (vehicleId) filter.vehicleId = vehicleId.toUpperCase();
  const scopedFilter = combineFilters(filter, await alertFilterForUser(req.user));

  const pageSize = Math.min(parseInt(limit, 10) || 50, 200);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);

  const [alerts, total] = await Promise.all([
    Alert.find(scopedFilter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .populate('bus', 'vehicleId registrationNumber'),
    Alert.countDocuments(scopedFilter),
  ]);

  res.json({
    success: true,
    data: alerts,
    pagination: { total, page: pageNum, pageSize, pages: Math.ceil(total / pageSize) },
  });
}

async function getAlert(req, res) {
  const alert = await Alert.findOne(
    combineFilters({ _id: req.params.id }, await alertFilterForUser(req.user))
  ).populate('bus', 'vehicleId registrationNumber');
  if (!alert) {
    return res.status(404).json({ success: false, error: 'Alert not found' });
  }
  res.json({ success: true, data: alert });
}

async function acknowledgeAlert(req, res) {
  const alert = await Alert.findOneAndUpdate(
    combineFilters({ _id: req.params.id }, await alertFilterForUser(req.user)),
    {
      status: 'acknowledged',
      acknowledgedBy: req.user._id,
      acknowledgedAt: new Date(),
    },
    { new: true }
  );
  if (!alert) {
    return res.status(404).json({ success: false, error: 'Alert not found' });
  }
  socketService.broadcastAlert(alert);
  res.json({ success: true, data: alert });
}

async function resolveAlert(req, res) {
  const { resolutionNotes = '', falseAlarm = false } = req.body;

  const alert = await Alert.findOneAndUpdate(
    combineFilters({ _id: req.params.id }, await alertFilterForUser(req.user)),
    {
      status: falseAlarm ? 'false_alarm' : 'resolved',
      resolvedBy: req.user._id,
      resolvedAt: new Date(),
      resolutionNotes,
    },
    { new: true }
  );
  if (!alert) {
    return res.status(404).json({ success: false, error: 'Alert not found' });
  }
  socketService.broadcastAlert(alert);
  res.json({ success: true, data: alert });
}

module.exports = {
  ingestAlertFromDevice,
  listAlerts,
  getAlert,
  acknowledgeAlert,
  resolveAlert,
};
