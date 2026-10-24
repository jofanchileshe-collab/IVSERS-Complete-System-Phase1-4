/*
 * ============================================================================
 *  IVSERS Backend - services/mqttService.js
 *
 *  Subscribes to the fleet-wide telemetry/alert/status topics published by
 *  every ESP32 Cloud Bridge (see Firmware/ESP32_Cloud_Bridge/secrets.h for
 *  the topic layout) and routes each message to the shared ingestion
 *  controllers, which then broadcast to dashboards over Socket.IO. This is
 *  the PRIMARY real-time path; routes/telemetry.js and the alert ingestion
 *  route are the HTTPS fallback the ESP32 firmware uses when MQTT publish
 *  fails, so both paths converge on the same controller functions.
 * ============================================================================
 */

const mqtt = require('mqtt');
const logger = require('../utils/logger');
const telemetryController = require('../controllers/telemetryController');
const alertController = require('../controllers/alertController');

const TOPIC_TELEMETRY = 'ivsers/+/telemetry';
const TOPIC_ALERT = 'ivsers/+/alert';
const TOPIC_STATUS = 'ivsers/+/status';

let client = null;

function connect() {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    logger.warn('MQTT_BROKER_URL not set - MQTT ingestion disabled (HTTPS fallback route still active)');
    return null;
  }

  client = mqtt.connect(brokerUrl, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clientId: `ivsers-backend-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    logger.info(`MQTT connected to ${brokerUrl}`);
    client.subscribe([TOPIC_TELEMETRY, TOPIC_ALERT, TOPIC_STATUS], (err) => {
      if (err) {
        logger.error(`MQTT subscribe failed: ${err.message}`);
      } else {
        logger.info(`MQTT subscribed: ${TOPIC_TELEMETRY}, ${TOPIC_ALERT}, ${TOPIC_STATUS}`);
      }
    });
  });

  client.on('reconnect', () => logger.warn('MQTT reconnecting...'));
  client.on('close', () => logger.warn('MQTT connection closed'));
  client.on('error', (err) => logger.error(`MQTT error: ${err.message}`));

  client.on('message', handleMessage);

  return client;
}

async function handleMessage(topic, payloadBuffer) {
  try {
    const parts = topic.split('/'); // ['ivsers', deviceId, category]
    if (parts.length !== 3) {
      logger.warn(`Ignoring MQTT message on unexpected topic shape: ${topic}`);
      return;
    }
    const [, deviceId, category] = parts;

    let payload;
    try {
      payload = JSON.parse(payloadBuffer.toString());
    } catch (err) {
      logger.warn(`Ignoring non-JSON MQTT payload on ${topic}: ${err.message}`);
      return;
    }

    switch (category) {
      case 'telemetry':
        await telemetryController.ingestTelemetry(deviceId, payload);
        break;
      case 'alert':
        await alertController.ingestAlertFromDevice(deviceId, payload);
        break;
      case 'status':
        await telemetryController.ingestBridgeStatus(deviceId, payload);
        break;
      default:
        logger.warn(`Unhandled MQTT topic category "${category}" on ${topic}`);
    }
  } catch (err) {
    // A single malformed/unexpected message must never crash the
    // subscriber loop - log and continue processing subsequent messages.
    logger.error(`Error handling MQTT message on ${topic}: ${err.stack || err.message}`);
  }
}

function disconnect() {
  if (client) {
    client.end();
    client = null;
  }
}

module.exports = { connect, disconnect };
