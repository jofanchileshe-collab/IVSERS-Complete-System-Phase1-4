/*
 * ============================================================================
 *  IVSERS Backend - middleware/errorHandler.js
 *
 *  Centralized error handler. Normalizes Mongoose validation/cast errors
 *  and duplicate-key errors into consistent 4xx JSON responses, and never
 *  leaks stack traces to the client in production.
 * ============================================================================
 */

const logger = require('../utils/logger');

function notFound(req, res) {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error(`${req.method} ${req.originalUrl} -> ${err.stack || err.message}`);

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: Object.values(err.errors).map((e) => e.message),
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, error: `Invalid ${err.path}: ${err.value}` });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(409).json({ success: false, error: `Duplicate value for ${field}` });
  }

  const status = err.statusCode || err.status || 500;
  const message = status === 500 && process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  res.status(status).json({ success: false, error: message });
}

module.exports = { notFound, errorHandler };
