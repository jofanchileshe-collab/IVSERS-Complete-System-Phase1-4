/*
 * ============================================================================
 *  IVSERS - voice_comm.h  (ESP32 Cloud Bridge)  (FUTURE EXTENSION - DISABLED)
 *
 *  Text-based hazard alerts are already relayed to the cloud in real time by
 *  the main .ino via MQTT/HTTP - that functionality is live today. This
 *  header covers a genuinely separate, larger feature: two-way *audio*
 *  between the vehicle cabin and a control-room operator (e.g. an I2S
 *  microphone/speaker on the ESP32 streaming Opus/PCM frames to a WebRTC or
 *  SIP endpoint on the backend).
 *
 *  That is a substantial addition (I2S audio capture, codec, jitter
 *  buffering, and a signaling channel to the backend's WebRTC/SIP stack)
 *  and is deliberately NOT implemented here - it is out of scope for the
 *  diploma build and is left as a documented, disabled extension point so
 *  a later revision can add it without restructuring the cloud bridge.
 *
 *  To activate:
 *    1. Fit an I2S MEMS microphone (e.g. INMP441) and an I2S DAC/amplifier
 *       (e.g. MAX98357A) to the ESP32's I2S pins.
 *    2. Implement audio capture/playback using the ESP32 I2S driver.
 *    3. Implement a signaling + media transport to the backend (e.g. a
 *       lightweight WebSocket carrying Opus frames, terminated by the
 *       backend's WebRTC gateway).
 *    4. Set IVSERS_ENABLE_VOICE_BRIDGE to 1 below and replace the stub
 *       bodies with real I2S/streaming code.
 * ============================================================================
 */

#ifndef IVSERS_VOICE_COMM_H
#define IVSERS_VOICE_COMM_H

#include <Arduino.h>

#define IVSERS_ENABLE_VOICE_BRIDGE 0

class VoiceCloudBridge {
  public:
    bool begin() {
      _ready = false;
#if IVSERS_ENABLE_VOICE_BRIDGE
      Serial.println(F("[VoiceBridge] IVSERS_ENABLE_VOICE_BRIDGE is set but "
                        "I2S audio streaming has not been implemented yet."));
#endif
      return _ready;
    }

    // Called from loop() once wired up; no-op while disabled.
    void update() {
      if (!_ready) return;
    }

    bool isActive() const { return _ready; }

  private:
    bool _ready = false;
};

#endif // IVSERS_VOICE_COMM_H
