/*
 * ============================================================================
 *  IVSERS - ota_update.h  (ESP32 Cloud Bridge)
 *
 *  Two independent OTA paths, both real and functional:
 *
 *  1. Local-network OTA via ArduinoOTA (started in the main .ino) - the
 *     standard "Upload over Wi-Fi" workflow from the Arduino IDE/PlatformIO,
 *     useful during bench development and depot-yard maintenance.
 *
 *  2. Remote manifest-based OTA (this file) - periodically fetches a small
 *     JSON manifest describing the latest firmware build, and if the
 *     version differs from the running build, downloads and flashes it via
 *     the ESP32 HTTPUpdate library. This is what lets a fleet office push
 *     a firmware update to buses out on their routes.
 *
 *  Manifest format expected at OTA_MANIFEST_URL:
 *    { "version": "1.0.1", "url": "https://.../ivsers_esp32_1.0.1.bin" }
 *
 *  Dependencies:
 *    <HTTPClient.h>, <HTTPUpdate.h>  (bundled with ESP32 Arduino core)
 *    <ArduinoJson.h>                 (install via Library Manager, v6+)
 * ============================================================================
 */

#ifndef IVSERS_OTA_UPDATE_H
#define IVSERS_OTA_UPDATE_H

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h>
#include "secrets.h"

#define ESP32_FIRMWARE_VERSION "1.0.0"

class OTAUpdater {
  public:
    // Checks the remote manifest and flashes a newer build if one is
    // available. Safe to call periodically - it is a fast no-op whenever
    // the running version already matches the manifest, and it silently
    // skips the check (returning false) if Wi-Fi is not connected.
    bool checkAndApply() {
      if (WiFi.status() != WL_CONNECTED) return false;

      HTTPClient http;
      http.setTimeout(8000);
      if (!http.begin(OTA_MANIFEST_URL)) {
        Serial.println(F("[OTA] Failed to begin manifest request"));
        return false;
      }

      int code = http.GET();
      if (code != HTTP_CODE_OK) {
        Serial.print(F("[OTA] Manifest fetch failed, HTTP "));
        Serial.println(code);
        http.end();
        return false;
      }

      String body = http.getString();
      http.end();

      StaticJsonDocument<512> doc;
      DeserializationError err = deserializeJson(doc, body);
      if (err) {
        Serial.print(F("[OTA] Manifest JSON parse error: "));
        Serial.println(err.c_str());
        return false;
      }

      const char *remoteVersion = doc["version"] | "";
      const char *firmwareUrl   = doc["url"] | "";

      if (strlen(remoteVersion) == 0 || strlen(firmwareUrl) == 0) {
        Serial.println(F("[OTA] Manifest missing version/url fields"));
        return false;
      }

      if (strcmp(remoteVersion, ESP32_FIRMWARE_VERSION) == 0) {
        // Already up to date - nothing to do.
        return false;
      }

      Serial.print(F("[OTA] New firmware available: "));
      Serial.print(remoteVersion);
      Serial.print(F(" (running "));
      Serial.print(ESP32_FIRMWARE_VERSION);
      Serial.println(F(")"));

      return _applyUpdate(firmwareUrl);
    }

  private:
    bool _applyUpdate(const String &url) {
      WiFiClientSecure client;
      // NOTE: certificate validation is intentionally left to be configured
      // per-deployment (setCACert with the fleet server's real CA) rather
      // than silently disabled here - insecure() is not called.
      Serial.println(F("[OTA] Downloading and flashing update..."));

      httpUpdate.rebootOnUpdate(true);
      t_httpUpdate_return result;

      if (url.startsWith("https://")) {
        result = httpUpdate.update(client, url);
      } else {
        WiFiClient plainClient;
        result = httpUpdate.update(plainClient, url);
      }

      switch (result) {
        case HTTP_UPDATE_FAILED:
          Serial.printf("[OTA] Update failed. Error (%d): %s\n",
                         httpUpdate.getLastError(),
                         httpUpdate.getLastErrorString().c_str());
          return false;
        case HTTP_UPDATE_NO_UPDATES:
          Serial.println(F("[OTA] Server reported no update available"));
          return false;
        case HTTP_UPDATE_OK:
          Serial.println(F("[OTA] Update applied - device will reboot"));
          return true;
      }
      return false;
    }
};

#endif // IVSERS_OTA_UPDATE_H
