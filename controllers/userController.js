/*
 * ============================================================================
 *  IVSERS Backend - controllers/userController.js
 *
 *  Staff account management and organization-scoped vehicle assignments.
 * ============================================================================
 */

const User = require('../models/User');
const Bus = require('../models/Bus');
const Alert = require('../models/Alert');
const socketService = require('../services/socketService');

async function listAccounts(req, res) {
  const accounts = await User.find({})
    .select('-password -__v')
    .sort({ organization: 1, name: 1 });
  res.json({ success: true, data: accounts.map((account) => account.toSafeObject()) });
}

async function createAccount(req, res) {
  const { name, email, phone, organization, role, password } = req.body;
  const normalizedEmail = email.toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ success: false, error: 'An account with this email already exists' });
  }

  const account = await User.create({
    name,
    email: normalizedEmail,
    phone,
    organization: String(organization || '').trim(),
    role,
    password,
  });
  res.status(201).json({ success: true, data: account.toSafeObject() });
}

async function updateAccount(req, res) {
  const account = await User.findById(req.params.id);
  if (!account) {
    return res.status(404).json({ success: false, error: 'Account not found' });
  }

  const { name, email, phone, organization, role } = req.body;
  if (email !== undefined) {
    const normalizedEmail = email.toLowerCase();
    const duplicate = await User.findOne({ email: normalizedEmail, _id: { $ne: account._id } });
    if (duplicate) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists' });
    }
    account.email = normalizedEmail;
  }

  const isSelf = String(req.user._id) === String(account._id);
  if (isSelf && (role !== undefined || organization !== undefined)) {
    return res.status(400).json({
      success: false,
      error: 'You cannot change your own role or organization',
    });
  }

  if ((role !== undefined && role !== account.role)
    || (organization !== undefined && organization !== account.organization)) {
    const assignedBuses = await Bus.countDocuments({
      $or: [{ driver: account._id }, { owner: account._id }],
    });
    if (assignedBuses > 0) {
      return res.status(409).json({
        success: false,
        error: 'Remove this account from assigned vehicles before changing its role or organization',
      });
    }
  }

  if (name !== undefined) account.name = name;
  if (phone !== undefined) account.phone = phone;
  if (organization !== undefined) account.organization = String(organization || '').trim();
  if (role !== undefined) account.role = role;

  try {
    await account.save();
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists' });
    }
    throw err;
  }

  res.json({ success: true, data: account.toSafeObject() });
}

async function deleteAccount(req, res) {
  const account = await User.findById(req.params.id);
  if (!account) {
    return res.status(404).json({ success: false, error: 'Account not found' });
  }
  if (String(req.user._id) === String(account._id)) {
    return res.status(400).json({ success: false, error: 'You cannot delete your own account' });
  }
  if (account.role === 'super_admin') {
    const activeAdmins = await User.countDocuments({ role: 'super_admin', status: 'active' });
    if (account.status === 'active' && activeAdmins <= 1) {
      return res.status(409).json({ success: false, error: 'The last active super administrator cannot be deleted' });
    }
  }

  const assignedBusIds = await Bus.find({ driver: account._id }).distinct('_id');
  const busFieldsToClear = {};
  if (account.role === 'driver') busFieldsToClear.driver = null;
  if (account.role === 'bus_owner') busFieldsToClear.owner = null;

  await Promise.all([
    Object.keys(busFieldsToClear).length
      ? Bus.updateMany(
        { $or: [{ driver: account._id }, { owner: account._id }] },
        { $set: busFieldsToClear }
      )
      : Promise.resolve(),
    Alert.updateMany(
      { $or: [{ acknowledgedBy: account._id }, { resolvedBy: account._id }] },
      { $set: { acknowledgedBy: null, resolvedBy: null } }
    ),
    assignedBusIds.length
      ? User.updateMany({ assignedBus: { $in: assignedBusIds } }, { $set: { assignedBus: null } })
      : Promise.resolve(),
  ]);

  await User.deleteOne({ _id: account._id });
  socketService.disconnectUser(account._id);
  res.json({ success: true, data: { _id: account._id } });
}

async function listAssignableAccounts(req, res) {
  const { role, organization } = req.query;
  if (!['driver', 'bus_owner'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Select driver or bus_owner as the account role' });
  }

  const scopeOrganization = req.user.role === 'super_admin'
    ? String(organization || '').trim()
    : String(req.user.organization || '').trim();
  if (!scopeOrganization) {
    return res.status(400).json({ success: false, error: 'Organization is required to list assignable accounts' });
  }

  const accounts = await User.find({
    role,
    organization: scopeOrganization,
    status: 'active',
  })
    .select('name email phone role organization assignedBus')
    .sort({ name: 1 });
  res.json({
    success: true,
    data: accounts
      .filter((account) => role !== 'driver' || !account.assignedBus)
      .map((account) => ({
        _id: account._id,
        name: account.name,
        email: account.email,
        phone: account.phone,
        role: account.role,
        organization: account.organization,
      })),
  });
}

async function updateAccountStatus(req, res) {
  if (String(req.user._id) === req.params.id) {
    return res.status(400).json({ success: false, error: 'You cannot change your own account status' });
  }

  const account = await User.findByIdAndUpdate(
    req.params.id,
    { $set: { status: req.body.status } },
    { new: true, runValidators: true }
  ).select('-password -__v');
  if (!account) {
    return res.status(404).json({ success: false, error: 'Account not found' });
  }
  if (account.status === 'suspended') socketService.disconnectUser(account._id);
  res.json({ success: true, data: account.toSafeObject() });
}

module.exports = {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  listAssignableAccounts,
  updateAccountStatus,
};
