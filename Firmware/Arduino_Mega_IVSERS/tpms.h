/*
 * ============================================================================
 *  IVSERS - tpms.h  (FUTURE EXTENSION - DISABLED BY DEFAULT)
 *
 *  Tire Pressure Monitoring System integration hook. Real automotive TPMS
 *  is almost always a wireless (RF, ~433MHz) sensor-per-wheel system with a
 *  dedicated receiver module (e.g. an aftermarket TPMS receiver exposing
 *  data over UART), NOT a simple I2C peripheral - so this stub is written
 *  against a generic UART receiver interface rather than pretending to
 *  bit-bang wheel sensors over I2C.
 *
 *  This module is NOT part of the diploma-build bill of materials.
 *
 *  To activate:
 *    1. Fit a UART-output wireless TPMS receiver kit (4-6 wheel sensors +
 *       base receiver).
 *    2. Install/write a parser for that receiver's serial protocol (varies
 *       by manufacturer - consult the receiver's datasheet).
 *    3. Wire the receiver to a spare hardware serial port.
 *    4. Set IVSERS_ENABLE_TPMS to 1 in config.h and implement begin()/update().
 * ============================================================================
 */

#ifndef IVSERS_TPMS_H
#define IVSERS_TPMS_H

#include <Arduino.h>
#include "config.h"

struct TireReading {
  float pressureKPa;
  float temperatureC;
  bool  lowPressure;
  bool  highPressure;
  bool  dataValid;   // false until a real reading has been received
};

class TPMS {
  public:
    TPMS() {
      for (uint8_t i = 0; i < 4; i++) {
        _tires[i] = { 0.0f, 0.0f, false, false, false };
      }
    }

    bool begin() {
      _ready = false;
#if IVSERS_ENABLE_TPMS
      Serial.println(F("[TPMS] IVSERS_ENABLE_TPMS is set but no receiver "
                        "driver is implemented yet - reporting no data."));
#endif
      return _ready;
    }

    // Polls the receiver for new frames. No-op while disabled.
    void update() {
      if (!_ready) return;
      // Real UART frame parsing goes here once a receiver is fitted.
    }

    const TireReading &tire(uint8_t index) const {
      static const TireReading invalid = { 0, 0, false, false, false };
      if (index >= 4) return invalid;
      return _tires[index];
    }

    bool hasFault() const {
      if (!_ready) return false;
      for (uint8_t i = 0; i < 4; i++) {
        if (_tires[i].dataValid && (_tires[i].lowPressure || _tires[i].highPressure)) {
          return true;
        }
      }
      return false;
    }

    bool isReady() const { return _ready; }

  private:
    bool _ready = false;
    TireReading _tires[4];
};

#endif // IVSERS_TPMS_H
