/*
 * ============================================================================
 *  IVSERS Backend - controllers/telemetryController.js
 *
 *  Applies incoming telemetry frames (originally the Mega's pipe-delimited
 *  protocol, parsed into { deviceId, type, fields } JSON by the ESP32
 *  Cloud Bridge) to the corresponding Bus document, and broadcasts the
 *  update to connected dashboards over Socket.IO.
 *
 *  Shared by both ingestion paths:
 *    - services/mqttService.js   (primary path, real-time via MQTT)
 *    - routes/telemetry.js       (HTTPS fallback path, POST /api/telemetry/ingest)
 *  so the two transports can never drift into different update logic.
 * ============================================================================
 */

const Bus = require('../models/Bus');
const socketService = require('../services/socketService');
const logger = require('../utils/logger');

function toFloat(value, fallback = null) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseGps(raw) {
  if (!raw || raw === 'location-unavailable') return null;
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const latitude = toFloat(parts[0]);
  const longitude = toFloat(parts[1]);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

// Finds the Bus for a deviceId, auto-creating a minimal placeholder record
// if the device has not been registered through the fleet-management UI
// yet - this keeps telemetry from a freshly-flashed unit from being
// silently dropped, while still being visibly flagged (status:'unregistered')
// so a fleet manager notices and completes proper registration.
async function findOrCreateBus(vehicleId) {
  let bus = await Bus.findOne({ vehicleId });
  if (!bus) {
    bus = await Bus.create({
      vehicleId,
      status: 'active',
      registrationNumber: null,
    });
    logger.warn(`Auto-created placeholder Bus record for unregistered device: ${vehicleId}`);
  }
  return bus;
}

/**
 * Applies one telemetry frame. `payload` is { type, fields } as produced by
 * the ESP32 bridge's handleMegaLine() JSON encoding.
 */
async function ingestTelemetry(deviceId, payload) {
  const { type, fields } = payload;
  if (!deviceId || !type || !Array.isArray(fields)) {
    logger.warn(`Malformed telemetry payload ignored: ${JSON.stringify(payload)}`);
    return null;
  }

  const bus = await findOrCreateBus(deviceId.toUpperCase());
  const update = { 'hardware.lastHeartbeat': new Date() };

  switch (type) {
    case 'FIRE': {
      const [flameEngine, flameCabin, flameElectric, smokeEngine, smokeCabin, tempEngine, tempElectric] = fields;
      Object.assign(update, {
        'hardware.sensors.flameEngine': toFloat(flameEngine),
        'hardware.sensors.flameCabin': toFloat(flameCabin),
        'hardware.sensors.flameElectric': toFloat(flameElectric),
        'hardware.sensors.smokeEngine': toFloat(smokeEngine),
        'hardware.sensors.smokeCabin': toFloat(smokeCabin),
        'hardware.sensors.tempEngine': toFloat(tempEngine),
        'hardware.sensors.tempElectric': toFloat(tempElectric),
      });
      break;
    }
    case 'LOAD': {
      const [loadKg] = fields;
      update['hardware.sensors.loadKg'] = toFloat(loadKg);
      break;
    }
    case 'IMU': {
      const [accelG, roll, pitch] = fields;
      Object.assign(update, {
        'hardware.sensors.accelG': toFloat(accelG),
        'hardware.sensors.roll': toFloat(roll),
        'hardware.sensors.pitch': toFloat(pitch),
      });
      break;
    }
    case 'TANK': {
      const [tankPercent, pressureUnits] = fields;
      Object.assign(update, {
        'hardware.suppression.tankPercent': toFloat(tankPercent),
        'hardware.suppression.pressureUnits': toFloat(pressureUnits),
      });
      break;
    }
    case 'STATUS': {
      const [stateWord, gpsRaw] = fields;
      if (stateWord === 'STARTUP') {
        logger.info(`Vehicle ${deviceId} reported startup`);
      } else {
        const gps = parseGps(gpsRaw);
        if (gps) {
          update['hardware.gps.latitude'] = gps.latitude;
          update['hardware.gps.longitude'] = gps.longitude;
          update['hardware.gps.lastUpdate'] = new Date();
        }
      }
      break;
    }
    default:
      // Unknown/future telemetry type (e.g. from an as-yet-unactivated
      // extension module) - store it under `extensions` rather than
      // discarding it, so no data is lost as new firmware features land.
      update[`extensions.${type}`] = fields;
      break;
  }

  const updatedBus = await Bus.findByIdAndUpdate(bus._id, { $set: update }, { new: true });
  socketService.broadcastTelemetry(deviceId, { type, fields }, updatedBus);
  socketService.broadcastBusUpdate(updatedBus);
  return updatedBus;
}

/**
 * Applies an ESP32 cloud-bridge health/status payload (distinct from the
 * Mega's vehicle-hazard STATUS telemetry above) - published by the bridge
 * itself to MQTT_TOPIC_STATUS on connect.
 */
async function ingestBridgeStatus(deviceId, payload) {
  if (!deviceId) return null;
  const bus = await findOrCreateBus(deviceId.toUpperCase());

  const update = {
    'hardware.lastHeartbeat': new Date(),
  };
  if (payload.firmware) update['hardware.firmwareVersion'] = payload.firmware;

  const updatedBus = await Bus.findByIdAndUpdate(bus._id, { $set: update }, { new: true });
  socketService.broadcastBusUpdate(updatedBus);
  return updatedBus;
}

module.exports = { ingestTelemetry, ingestBridgeStatus, findOrCreateBus, parseGps };
