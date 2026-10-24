/*
 * ============================================================================
 *  IVSERS Backend - middleware/deviceAuth.js
 *
 *  Authenticates telemetry/alert ingestion requests from the ESP32 Cloud
 *  Bridge, which sends a shared secret in the X-API-Key header (see
 *  Firmware/ESP32_Cloud_Bridge/secrets.h -> BACKEND_API_KEY).
 *
 *  This is a single shared secret across the fleet for the diploma-build
 *  scope. The documented, straightforward hardening path for a larger
 *  fleet is to move to a per-device key stored as a hash on the Bus
 *  document (mirroring how User passwords are hashed) and looked up by
 *  the deviceId in the payload - the ingestion controllers already read
 *  deviceId from the body, so that upgrade does not require an API
 *  contract change, only a lookup change here.
 * ============================================================================
 */

function deviceAuth(req, res, next) {
  const providedKey = req.header('X-API-Key');
  const expectedKey = process.env.DEVICE_API_KEY;

  if (!expectedKey) {
    // Fail closed: refuse to accept device traffic if the server itself
    // has not been configured with a key, rather than silently accepting
    // unauthenticated ingestion.
    return res.status(500).json({ success: false, error: 'Device authentication is not configured' });
  }

  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing device API key' });
  }

  next();
}

module.exports = { deviceAuth };
