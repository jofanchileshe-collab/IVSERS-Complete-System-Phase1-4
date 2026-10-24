/*
 * ============================================================================
 *  IVSERS - secrets.h  (ESP32 Cloud Bridge)
 *
 *  Wi-Fi, MQTT, and backend API credentials.
 *
 *  SECURITY NOTE
 *  -------------
 *  This file should be added to .gitignore in any real deployment and
 *  never committed with real credentials - only this placeholder template
 *  should live in version control. Copy it to a local, untracked copy per
 *  device/fleet before flashing, or better, provision credentials at
 *  runtime via the SoftAP configuration portal in wifi_manager.h so no
 *  secret ever needs to be baked into firmware at all.
 * ============================================================================
 */

#ifndef IVSERS_SECRETS_H
#define IVSERS_SECRETS_H

// ---------------------------------------------------------------------------
// Wi-Fi - used only as a fallback default. The SoftAP config portal
// (wifi_manager.h) lets a technician set real credentials without
// reflashing, and those are what actually get used once configured.
// ---------------------------------------------------------------------------
#define DEFAULT_WIFI_SSID       "IVSERS-FLEET-WIFI"
#define DEFAULT_WIFI_PASSWORD   "CHANGE_ME_BEFORE_DEPLOYMENT"

// ---------------------------------------------------------------------------
// MQTT broker (e.g. self-hosted Mosquitto - see docker-compose.yml)
// ---------------------------------------------------------------------------
#define MQTT_BROKER_HOST        "mqtt.ivsers.local"
#define MQTT_BROKER_PORT        1883
#define MQTT_USERNAME            "ivsers_device"
#define MQTT_PASSWORD            "CHANGE_ME_BEFORE_DEPLOYMENT"
#define MQTT_CLIENT_ID_PREFIX    "ivsers-esp32-"

// MQTT topic layout - {vehicleId} is substituted at runtime.
#define MQTT_TOPIC_TELEMETRY     "ivsers/%s/telemetry"
#define MQTT_TOPIC_ALERT         "ivsers/%s/alert"
#define MQTT_TOPIC_STATUS        "ivsers/%s/status"
#define MQTT_TOPIC_COMMAND       "ivsers/%s/command"   // Downlink (subscribed)

// ---------------------------------------------------------------------------
// Backend REST API (HTTP fallback path when MQTT is unreachable)
// ---------------------------------------------------------------------------
#define BACKEND_BASE_URL         "https://api.ivsers.example.com"
#define BACKEND_TELEMETRY_PATH   "/api/telemetry/ingest"
#define BACKEND_ALERT_PATH       "/api/alerts/ingest"
#define BACKEND_API_KEY          "CHANGE_ME_DEVICE_API_KEY"

// ---------------------------------------------------------------------------
// OTA firmware update manifest endpoint (see ota_update.h)
// ---------------------------------------------------------------------------
#define OTA_MANIFEST_URL         "https://api.ivsers.example.com/api/firmware/esp32/latest.json"

// ---------------------------------------------------------------------------
// Device identity - overridden at runtime from Preferences (NVS) once the
// unit has been provisioned; these are only the compile-time defaults.
// ---------------------------------------------------------------------------
#define DEFAULT_DEVICE_ID        "IVSERS-001"

#endif // IVSERS_SECRETS_H
