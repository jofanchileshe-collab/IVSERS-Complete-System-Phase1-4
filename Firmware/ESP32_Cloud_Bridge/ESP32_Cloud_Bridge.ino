/*
 * ============================================================================
 *  IVSERS - ESP32_Cloud_Bridge.ino
 *
 *  Role: receives the pipe-delimited hazard/telemetry stream from the
 *  Arduino Mega over UART2, and relays it to the fleet backend over Wi-Fi
 *  via MQTT (primary) with an HTTPS REST fallback for alert-class messages,
 *  buffering to flash (LittleFS) when neither transport is reachable so no
 *  event is lost during a coverage gap - matching the "Connectivity
 *  Redundancy" requirement in Chapter 11.3 of the project report.
 *
 *  Target hardware: ESP32 dual-core dev board (e.g. ESP32-WROOM-32)
 *
 *  Wiring to Arduino Mega:
 *    Mega Serial3 TX (pin 14) -> ESP32 RX2 (GPIO16)
 *    Mega Serial3 RX (pin 15) -> ESP32 TX2 (GPIO17)
 *    Common ground between both boards is mandatory.
 *
 *  REQUIRED LIBRARIES (install via Arduino IDE Library Manager)
 *    - PubSubClient      by Nick O'Leary
 *    - ArduinoJson        by Benoit Blanchon (v6+)
 *    - ESP32 board package (provides WiFi, HTTPClient, HTTPUpdate, LittleFS,
 *      Preferences, WebServer, ArduinoOTA)
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <ArduinoOTA.h>
#include <Preferences.h>

#include "secrets.h"
#include "wifi_manager.h"
#include "ota_update.h"
#include "voice_comm.h"

#define MEGA_SERIAL Serial2   // UART2: RX=GPIO16, TX=GPIO17
#define MEGA_BAUDRATE 115200

#define OFFLINE_BUFFER_FILE "/buffer.jsonl"
#define OFFLINE_BUFFER_MAX_BYTES (64UL * 1024UL)   // 64 KB cap on LittleFS usage
#define OTA_CHECK_INTERVAL_MS (6UL * 60UL * 60UL * 1000UL) // every 6 hours

WiFiManager wifiManager;
OTAUpdater otaUpdater;
VoiceCloudBridge voiceBridge;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
Preferences prefs;

String deviceId;
String mqttClientId;
unsigned long lastOtaCheckMs = 0;
unsigned long lastMqttReconnectAttemptMs = 0;
unsigned long lastBufferFlushMs = 0;

// ===========================================================================
// SETUP
// ===========================================================================
void setup() {
  Serial.begin(115200);
  MEGA_SERIAL.begin(MEGA_BAUDRATE);

  prefs.begin("ivsers-device", false);
  deviceId = prefs.getString("deviceId", DEFAULT_DEVICE_ID);
  mqttClientId = String(MQTT_CLIENT_ID_PREFIX) + deviceId;

  Serial.println(F("========================================"));
  Serial.println(F("IVSERS ESP32 Cloud Bridge starting"));
  Serial.print(F("Device ID: "));
  Serial.println(deviceId);
  Serial.print(F("Firmware:  "));
  Serial.println(ESP32_FIRMWARE_VERSION);
  Serial.println(F("========================================"));

  if (!LittleFS.begin(true)) {
    Serial.println(F("[FS] LittleFS mount failed - offline buffering disabled this session"));
  }

  wifiManager.begin();

  mqttClient.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(1024);

  voiceBridge.begin();

  setupOTA();
}

// ===========================================================================
// MAIN LOOP
// ===========================================================================
void loop() {
  wifiManager.update();
  ArduinoOTA.handle();

  if (wifiManager.isPortalActive()) {
    // Configuration portal is serving the setup page - defer all cloud/
    // telemetry activity until a technician finishes provisioning Wi-Fi.
    return;
  }

  if (wifiManager.isConnected()) {
    maintainMqttConnection();
    mqttClient.loop();

    if (millis() - lastBufferFlushMs > 15000) {
      lastBufferFlushMs = millis();
      flushOfflineBuffer();
    }

    if (millis() - lastOtaCheckMs > OTA_CHECK_INTERVAL_MS) {
      lastOtaCheckMs = millis();
      otaUpdater.checkAndApply();
    }
  }

  voiceBridge.update();
  processMegaSerial();
}

// ===========================================================================
// OTA (local network - ArduinoOTA)
// ===========================================================================
void setupOTA() {
  ArduinoOTA.setHostname(("ivsers-" + deviceId).c_str());
  ArduinoOTA.onStart([]() {
    Serial.println(F("[OTA-Local] Update starting"));
  });
  ArduinoOTA.onEnd([]() {
    Serial.println(F("[OTA-Local] Update complete"));
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[OTA-Local] Error [%u]\n", error);
  });
  ArduinoOTA.begin();
}

// ===========================================================================
// MQTT
// ===========================================================================
void maintainMqttConnection() {
  if (mqttClient.connected()) return;
  if (millis() - lastMqttReconnectAttemptMs < 5000) return;

  lastMqttReconnectAttemptMs = millis();
  Serial.print(F("[MQTT] Connecting... "));

  bool connected;
  if (strlen(MQTT_USERNAME) > 0) {
    connected = mqttClient.connect(mqttClientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD);
  } else {
    connected = mqttClient.connect(mqttClientId.c_str());
  }

  if (connected) {
    Serial.println(F("connected"));
    char topic[96];
    snprintf(topic, sizeof(topic), MQTT_TOPIC_COMMAND, deviceId.c_str());
    mqttClient.subscribe(topic);
    publishStatus("ONLINE");
  } else {
    Serial.print(F("failed, rc="));
    Serial.println(mqttClient.state());
  }
}

// Downlink: forwards backend/dashboard commands straight to the Mega over
// UART. The Mega firmware currently only reacts to physical button inputs,
// so this is the integration point for remote-reset/remote-silence style
// features once the Mega side is extended to parse an inbound command line.
void onMqttMessage(char *topic, byte *payload, unsigned int length) {
  String message;
  message.reserve(length);
  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];

  Serial.print(F("[MQTT] Command received: "));
  Serial.println(message);

  MEGA_SERIAL.print(F("CMD|"));
  MEGA_SERIAL.println(message);
}

void publishStatus(const String &status) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = deviceId;
  doc["status"] = status;
  doc["firmware"] = ESP32_FIRMWARE_VERSION;
  doc["rssi"] = WiFi.RSSI();
  doc["uptimeMs"] = millis();

  char topic[96];
  snprintf(topic, sizeof(topic), MQTT_TOPIC_STATUS, deviceId.c_str());
  publishJson(topic, doc, /*isAlert=*/false);
}

// ===========================================================================
// MEGA SERIAL INGEST + PROTOCOL PARSING
// ===========================================================================
void processMegaSerial() {
  static String lineBuffer;

  while (MEGA_SERIAL.available() > 0) {
    char c = MEGA_SERIAL.read();
    if (c == '\n') {
      lineBuffer.trim();
      if (lineBuffer.length() > 0) {
        handleMegaLine(lineBuffer);
      }
      lineBuffer = "";
    } else if (c != '\r') {
      lineBuffer += c;
      if (lineBuffer.length() > 256) lineBuffer = ""; // guard against garbage/noise
    }
  }
}

void handleMegaLine(const String &line) {
  // Expected format: IVSERS|<TYPE>|field1|field2|...
  if (!line.startsWith("IVSERS|")) return;

  int firstPipe = line.indexOf('|');
  int secondPipe = line.indexOf('|', firstPipe + 1);
  String type = (secondPipe > 0) ? line.substring(firstPipe + 1, secondPipe)
                                  : line.substring(firstPipe + 1);
  String rest = (secondPipe > 0) ? line.substring(secondPipe + 1) : "";

  StaticJsonDocument<384> doc;
  doc["deviceId"] = deviceId;
  doc["type"] = type;
  doc["receivedAtMs"] = millis();

  JsonArray fields = doc.createNestedArray("fields");
  int start = 0;
  while (start <= (int)rest.length()) {
    int pipe = rest.indexOf('|', start);
    String field = (pipe == -1) ? rest.substring(start) : rest.substring(start, pipe);
    fields.add(field);
    if (pipe == -1) break;
    start = pipe + 1;
  }

  bool isAlert = (type == "ALERT");

  char topic[96];
  snprintf(topic, sizeof(topic),
           isAlert ? MQTT_TOPIC_ALERT : MQTT_TOPIC_TELEMETRY,
           deviceId.c_str());

  publishJson(topic, doc, isAlert);
}

// ===========================================================================
// PUBLISH: MQTT primary, HTTPS fallback for alerts, flash buffer if both fail
// ===========================================================================
void publishJson(const char *topic, JsonDocument &doc, bool isAlert) {
  char payload[512];
  size_t len = serializeJson(doc, payload, sizeof(payload));

  bool delivered = false;

  if (mqttClient.connected()) {
    delivered = mqttClient.publish(topic, (const uint8_t *)payload, len, false);
  }

  if (!delivered && isAlert && wifiManager.isConnected()) {
    // Alerts are safety-critical - always attempt the HTTPS fallback path
    // immediately rather than waiting for the next buffer-flush cycle.
    delivered = httpPostJson(BACKEND_ALERT_PATH, payload);
  }

  if (!delivered) {
    bufferOffline(payload);
  }
}

bool httpPostJson(const char *path, const char *jsonPayload) {
  HTTPClient http;
  String url = String(BACKEND_BASE_URL) + path;
  if (!http.begin(url)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", BACKEND_API_KEY);
  http.setTimeout(6000);

  int code = http.POST((uint8_t *)jsonPayload, strlen(jsonPayload));
  http.end();

  if (code >= 200 && code < 300) return true;

  Serial.print(F("[HTTP] POST fallback failed, code "));
  Serial.println(code);
  return false;
}

// ===========================================================================
// OFFLINE BUFFERING (LittleFS ring file)
// ===========================================================================
void bufferOffline(const char *jsonPayload) {
  File f = LittleFS.open(OFFLINE_BUFFER_FILE, FILE_APPEND);
  if (!f) {
    Serial.println(F("[Buffer] Failed to open offline buffer file"));
    return;
  }

  if (f.size() > OFFLINE_BUFFER_MAX_BYTES) {
    f.close();
    _trimOfflineBuffer();
    f = LittleFS.open(OFFLINE_BUFFER_FILE, FILE_APPEND);
    if (!f) return;
  }

  f.println(jsonPayload);
  f.close();
}

void _trimOfflineBuffer() {
  // Drops the oldest half of the buffer to make room, preserving the most
  // recent (most operationally relevant) events rather than the oldest.
  File f = LittleFS.open(OFFLINE_BUFFER_FILE, FILE_READ);
  if (!f) return;

  String content = f.readString();
  f.close();

  int midpoint = content.length() / 2;
  int newlineAfterMid = content.indexOf('\n', midpoint);
  String trimmed = (newlineAfterMid > 0) ? content.substring(newlineAfterMid + 1) : "";

  File out = LittleFS.open(OFFLINE_BUFFER_FILE, FILE_WRITE);
  if (out) {
    out.print(trimmed);
    out.close();
  }
}

void flushOfflineBuffer() {
  if (!mqttClient.connected() || !LittleFS.exists(OFFLINE_BUFFER_FILE)) return;

  File f = LittleFS.open(OFFLINE_BUFFER_FILE, FILE_READ);
  if (!f || f.size() == 0) {
    if (f) f.close();
    return;
  }

  Serial.print(F("[Buffer] Flushing offline buffer, bytes: "));
  Serial.println(f.size());

  String remaining;
  bool anyFailed = false;

  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    if (!anyFailed && mqttClient.connected()) {
      char topic[96];
      snprintf(topic, sizeof(topic), MQTT_TOPIC_TELEMETRY, deviceId.c_str());
      bool ok = mqttClient.publish(topic, line.c_str());
      if (!ok) {
        anyFailed = true;
        remaining += line + "\n";
      }
    } else {
      remaining += line + "\n";
    }
  }
  f.close();

  // Rewrite the buffer file with only the lines that still failed to send.
  LittleFS.remove(OFFLINE_BUFFER_FILE);
  if (remaining.length() > 0) {
    File out = LittleFS.open(OFFLINE_BUFFER_FILE, FILE_WRITE);
    if (out) {
      out.print(remaining);
      out.close();
    }
  } else {
    Serial.println(F("[Buffer] Offline buffer fully flushed"));
  }
}
