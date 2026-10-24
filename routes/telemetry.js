/*
 * ============================================================================
 *  IVSERS Backend - routes/telemetry.js
 *
 *  HTTPS fallback ingestion path for non-alert telemetry (FIRE/LOAD/IMU/
 *  TANK/STATUS frames). In normal operation these arrive via MQTT
 *  (services/mqttService.js); this route exists for completeness and for
 *  deployments where MQTT egress is blocked on the vehicle's network but
 *  outbound HTTPS is not.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();

const telemetryController = require('../controllers/telemetryController');
const { deviceAuth } = require('../middleware/deviceAuth');
const { telemetryIngestRules, handleValidationErrors } = require('../middleware/validation');
const asyncHandler = require('../utils/asyncHandler');

router.post(
  '/ingest',
  deviceAuth,
  telemetryIngestRules,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { deviceId, type, fields } = req.body;
    const bus = await telemetryController.ingestTelemetry(deviceId, { type, fields });
    res.status(202).json({ success: true, data: bus });
  })
);

module.exports = router;
