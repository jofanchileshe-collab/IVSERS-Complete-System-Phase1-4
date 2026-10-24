/*
 * ============================================================================
 *  IVSERS Backend - middleware/rateLimit.js
 *
 *  Two limiters: a generous general-purpose API limiter, and a much
 *  stricter one on authentication endpoints to slow down credential-
 *  stuffing / brute-force attempts.
 * ============================================================================
 */

const rateLimit = require('express-rate-limit');

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000;

const generalLimiter = rateLimit({
  windowMs,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, error: 'Too many authentication attempts, please try again later.' },
});

module.exports = { generalLimiter, authLimiter };
