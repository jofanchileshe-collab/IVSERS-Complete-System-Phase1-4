/*
 * ============================================================================
 *  IVSERS Backend - routes/alerts.js
 *
 *  POST /ingest is unauthenticated-by-JWT but protected by the device
 *  shared-secret (deviceAuth) - this is the HTTPS fallback path the ESP32
 *  bridge uses when its MQTT publish fails (see
 *  Firmware/ESP32_Cloud_Bridge/secrets.h -> BACKEND_ALERT_PATH). Every
 *  other route here is dashboard-facing and requires a JWT.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();

const alertController = require('../controllers/alertController');
const { authenticate, authorize } = require('../middleware/auth');
const { deviceAuth } = require('../middleware/deviceAuth');
const asyncHandler = require('../utils/asyncHandler');

router.post(
  '/ingest',
  deviceAuth,
  asyncHandler(async (req, res) => {
    const { deviceId, fields } = req.body;
    if (!deviceId || !Array.isArray(fields)) {
      return res.status(400).json({ success: false, error: 'deviceId and fields[] are required' });
    }
    // Payload shape matches the ESP32 bridge's ALERT-type MQTT message:
    // fields = [hazardType, details, gpsRaw]. See handleMegaLine() in
    // Firmware/ESP32_Cloud_Bridge/ESP32_Cloud_Bridge.ino.
    const alert = await alertController.ingestAlertFromDevice(deviceId, { fields });
    res.status(201).json({ success: true, data: alert });
  })
);

router.use(authenticate);

router.get('/', asyncHandler(alertController.listAlerts));
router.get('/:id', asyncHandler(alertController.getAlert));
router.patch(
  '/:id/acknowledge',
  authorize('super_admin', 'fleet_manager', 'driver', 'bus_owner', 'police', 'hospital', 'rtsa', 'fire_brigade'),
  asyncHandler(alertController.acknowledgeAlert)
);
router.patch(
  '/:id/resolve',
  authorize('fleet_manager', 'super_admin'),
  asyncHandler(alertController.resolveAlert)
);

module.exports = router;
