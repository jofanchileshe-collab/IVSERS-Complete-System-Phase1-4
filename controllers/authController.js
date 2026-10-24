/*
 * ============================================================================
 *  IVSERS Backend - controllers/authController.js
 *
 *  Registration is restricted to authenticated super administrators. New
 *  accounts receive no session token; they must sign in with their own
 *  credentials after an administrator creates them.
 * ============================================================================
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');

function signToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

async function register(req, res) {
  const { name, email, password, phone, role, organization } = req.body;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ success: false, error: 'An account with this email already exists' });
  }

  const user = await User.create({
    name,
    email,
    password,
    phone,
    organization,
    role,
  });

  res.status(201).json({ success: true, data: { user: user.toSafeObject() } });
}

async function login(req, res) {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ success: false, error: 'Account is suspended' });
  }

  const matches = await user.comparePassword(password);
  if (!matches) {
    return res.status(401).json({ success: false, error: 'Invalid email or password' });
  }

  user.lastLoginAt = new Date();
  await user.save();

  const token = signToken(user);
  res.json({ success: true, data: { user: user.toSafeObject(), token } });
}

async function me(req, res) {
  res.json({ success: true, data: req.user.toSafeObject() });
}

module.exports = { register, login, me };
