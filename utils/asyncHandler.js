/*
 * ============================================================================
 *  IVSERS Backend - utils/asyncHandler.js
 *
 *  Wraps an async Express route handler so a rejected promise is forwarded
 *  to next(err) automatically, letting the centralized error handler in
 *  middleware/errorHandler.js deal with it instead of every route needing
 *  its own try/catch block.
 * ============================================================================
 */

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
