/*
 * ============================================================================
 *  IVSERS - voice_communication.h  (FUTURE EXTENSION - DISABLED BY DEFAULT)
 *
 *  Provides pre-recorded voice evacuation announcements (Section 18.6:
 *  "Voice Evacuation Alarm") over an onboard audio module, e.g. a DFPlayer
 *  Mini MP3 module driving a cabin speaker.
 *
 *  This module is NOT part of the diploma-build bill of materials. It is
 *  provided as a stable interface so the core hazard-detection logic in
 *  IVSERS_MultiHazard.ino can call voiceComm.playMessage(id) unconditionally
 *  without caring whether a physical audio module is fitted.
 *
 *  To activate:
 *    1. Fit a DFPlayer Mini (or similar UART MP3 module) with an SD card of
 *       numbered voice-prompt files (0001.mp3, 0002.mp3, ...).
 *    2. Install the "DFRobotDFPlayerMini" library.
 *    3. Wire the module to a spare hardware serial port.
 *    4. Set IVSERS_ENABLE_VOICE to 1 in config.h and implement begin()/
 *       playMessage() using the DFPlayer API.
 * ============================================================================
 */

#ifndef IVSERS_VOICE_COMMUNICATION_H
#define IVSERS_VOICE_COMMUNICATION_H

#include <Arduino.h>
#include "config.h"

// Message ID reference (to be recorded onto the audio module's SD card):
//   1  = System startup / ready
//   2  = "Fire detected in the engine compartment, please evacuate"
//   3  = "Fire detected in the passenger cabin, please evacuate"
//   4  = "Fire detected in the electrical panel, please evacuate"
//   5  = "Emergency safety systems activated"
//   6  = "Vehicle overload detected, please wait for boarding clearance"
//   7  = "Accident detected, emergency services notified"
//   8  = "Panic alert activated"
//   10 = "System reset complete"
//   11 = "Manual fire suppression activated by driver"

class VoiceCommunication {
  public:
    // Initializes the audio module. Returns false (and stays silent) when
    // IVSERS_ENABLE_VOICE is 0, which is the default/diploma-build state.
    bool begin() {
      _ready = false;
#if IVSERS_ENABLE_VOICE
      // Real DFPlayer initialization goes here once hardware is fitted:
      //   _ready = _dfPlayer.begin(voiceSerial);
      Serial.println(F("[VoiceComm] IVSERS_ENABLE_VOICE is set but no driver "
                        "is implemented yet - remaining silent."));
#endif
      return _ready;
    }

    // Plays a numbered voice prompt. Silently ignored (returns false) while
    // the module is disabled or not ready - callers do not need to guard.
    bool playMessage(uint8_t messageId) {
      if (!_ready) return false;
#if IVSERS_ENABLE_VOICE
      // Real playback call goes here, e.g. _dfPlayer.play(messageId);
      (void)messageId;
#endif
      return false;
    }

    // Forwards an emergency event summary to a cloud voice/notification
    // relay. In the diploma build this is a documented no-op; the ESP32
    // cloud bridge already forwards the same hazard payload over Wi-Fi/GSM,
    // so no functionality is lost by leaving this disabled.
    bool sendVoiceToCloud(const String & /*payload*/) {
      return false;
    }

    bool isReady() const { return _ready; }

  private:
    bool _ready = false;
};

#endif // IVSERS_VOICE_COMMUNICATION_H
