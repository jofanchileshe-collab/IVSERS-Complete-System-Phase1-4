/*
 * ============================================================================
 *  IVSERS Backend - middleware/auth.js
 *
 *  JWT authentication for human users (dashboard/API clients). Device
 *  ingestion (ESP32 Cloud Bridge) uses a separate shared-secret scheme -
 *  see middleware/deviceAuth.js - since a device cannot practically hold a
 *  per-session login token in the field.
 * ============================================================================
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Verifies the Bearer token on the Authorization header, loads the
 * corresponding user, and attaches it to req.user. Rejects with 401 if the
 * token is missing, malformed, expired, or refers to a suspended/deleted
 * account.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const message = err.name === 'TokenExpiredError'
        ? 'Session expired, please log in again'
        : 'Invalid authentication token';
      return res.status(401).json({ success: false, error: message });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Account no longer exists' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Account is suspended' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Restricts a route to one or more roles. Must run after authenticate().
 * Usage: router.post('/x', authenticate, authorize('fleet_manager', 'super_admin'), handler)
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
