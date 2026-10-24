/*
 * ============================================================================
 *  IVSERS - wifi_manager.h  (ESP32 Cloud Bridge)
 *
 *  Manages Wi-Fi station connectivity with non-blocking exponential-backoff
 *  reconnection, and falls back to a SoftAP configuration portal when no
 *  known network is reachable - letting a technician provision real Wi-Fi
 *  credentials over a phone browser instead of a factory credential ever
 *  being baked into firmware.
 *
 *  Dependencies (all bundled with the ESP32 Arduino core):
 *    <WiFi.h>, <WebServer.h>, <Preferences.h>
 * ============================================================================
 */

#ifndef IVSERS_WIFI_MANAGER_H
#define IVSERS_WIFI_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include "secrets.h"

class WiFiManager {
  public:
    enum class State { CONNECTING, CONNECTED, PORTAL_ACTIVE, DISCONNECTED };

    // Loads stored credentials (if any) and starts the connection attempt.
    void begin() {
      _prefs.begin("ivsers-wifi", false);
      _ssid = _prefs.getString("ssid", DEFAULT_WIFI_SSID);
      _password = _prefs.getString("password", DEFAULT_WIFI_PASSWORD);

      WiFi.mode(WIFI_STA);
      WiFi.setAutoReconnect(false); // we manage reconnection ourselves
      _attemptConnect();
    }

    // Call every loop() iteration. Non-blocking; returns immediately.
    void update() {
      if (_portalActive) {
        _server.handleClient();
        return;
      }

      if (WiFi.status() == WL_CONNECTED) {
        if (_state != State::CONNECTED) {
          _state = State::CONNECTED;
          _consecutiveFailures = 0;
          Serial.print(F("[WiFiManager] Connected. IP: "));
          Serial.println(WiFi.localIP());
        }
        return;
      }

      // Not connected - retry with exponential backoff, then fall back to
      // the SoftAP config portal after repeated failures so the device
      // never bricks itself waiting silently for a network that won't
      // appear (e.g. after a fleet-wide Wi-Fi password change).
      if (_state != State::CONNECTING && millis() - _lastAttemptMs >= _currentBackoffMs()) {
        _attemptConnect();
      } else if (_state == State::CONNECTING && millis() - _lastAttemptMs > 8000) {
        _consecutiveFailures++;
        _state = State::DISCONNECTED;
        Serial.print(F("[WiFiManager] Connection attempt failed (#"));
        Serial.print(_consecutiveFailures);
        Serial.println(F(")"));

        if (_consecutiveFailures >= 5) {
          _startConfigPortal();
        }
      }
    }

    bool isConnected() const { return WiFi.status() == WL_CONNECTED; }
    bool isPortalActive() const { return _portalActive; }
    State state() const { return _state; }

  private:
    void _attemptConnect() {
      Serial.print(F("[WiFiManager] Connecting to "));
      Serial.println(_ssid);
      WiFi.begin(_ssid.c_str(), _password.c_str());
      _state = State::CONNECTING;
      _lastAttemptMs = millis();
    }

    unsigned long _currentBackoffMs() const {
      // 2s, 4s, 8s, 16s, capped at 30s.
      unsigned long backoff = 2000UL << min<uint8_t>(_consecutiveFailures, 4);
      return min(backoff, 30000UL);
    }

    // Starts a SoftAP + captive configuration web form so a technician can
    // enter real fleet Wi-Fi credentials from a phone, which are then
    // persisted to NVS (flash) via Preferences and used on next boot.
    void _startConfigPortal() {
      Serial.println(F("[WiFiManager] Starting SoftAP configuration portal"));
      _portalActive = true;
      _state = State::PORTAL_ACTIVE;

      WiFi.mode(WIFI_AP);
      String apName = String("IVSERS-Setup-") + DEFAULT_DEVICE_ID;
      WiFi.softAP(apName.c_str(), "ivsers-setup");

      _server.on("/", HTTP_GET, [this]() { _handleRoot(); });
      _server.on("/save", HTTP_POST, [this]() { _handleSave(); });
      _server.begin();

      Serial.print(F("[WiFiManager] Portal SSID: "));
      Serial.println(apName);
      Serial.print(F("[WiFiManager] Portal IP: "));
      Serial.println(WiFi.softAPIP());
    }

    void _handleRoot() {
      String html = F(
        "<!DOCTYPE html><html><head><meta name='viewport' "
        "content='width=device-width,initial-scale=1'>"
        "<title>IVSERS Wi-Fi Setup</title>"
        "<style>body{font-family:sans-serif;max-width:420px;margin:40px auto;"
        "padding:0 16px}input{width:100%;padding:10px;margin:6px 0 16px;"
        "box-sizing:border-box}button{width:100%;padding:12px;background:#c0392b;"
        "color:#fff;border:none;border-radius:4px;font-size:16px}</style></head>"
        "<body><h2>IVSERS Fleet Wi-Fi Setup</h2>"
        "<form method='POST' action='/save'>"
        "<label>Network name (SSID)</label>"
        "<input name='ssid' required>"
        "<label>Password</label>"
        "<input name='password' type='password'>"
        "<button type='submit'>Save &amp; Reboot</button>"
        "</form></body></html>"
      );
      _server.send(200, "text/html", html);
    }

    void _handleSave() {
      if (_server.hasArg("ssid")) {
        String newSsid = _server.arg("ssid");
        String newPassword = _server.arg("password");

        _prefs.putString("ssid", newSsid);
        _prefs.putString("password", newPassword);

        _server.send(200, "text/html",
          "<html><body><h3>Saved. Rebooting IVSERS bridge...</h3></body></html>");

        Serial.println(F("[WiFiManager] New credentials saved - rebooting"));
        delay(1500);
        ESP.restart();
      } else {
        _server.send(400, "text/plain", "Missing ssid field");
      }
    }

    Preferences _prefs;
    WebServer _server{80};
    String _ssid;
    String _password;
    State _state = State::DISCONNECTED;
    bool _portalActive = false;
    uint8_t _consecutiveFailures = 0;
    unsigned long _lastAttemptMs = 0;
};

#endif // IVSERS_WIFI_MANAGER_H
