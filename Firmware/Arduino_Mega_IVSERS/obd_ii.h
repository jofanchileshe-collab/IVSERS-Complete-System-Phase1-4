/*
 * ============================================================================
 *  IVSERS - obd_ii.h  (FUTURE EXTENSION - DISABLED BY DEFAULT)
 *
 *  Engine diagnostics via an ELM327-compatible OBD-II adapter (AT command
 *  set over UART). Intended to supply engine RPM, coolant temperature, and
 *  fault codes to the fire-risk fusion logic and the fleet dashboard.
 *
 *  This module is NOT part of the diploma-build bill of materials.
 *
 *  To activate:
 *    1. Fit a UART ELM327 OBD-II adapter wired to the vehicle's OBD-II port
 *       and to a spare Mega hardware serial port.
 *    2. Set IVSERS_ENABLE_OBDII to 1 in config.h.
 *    3. Implement the AT-command / PID-request handling in the method
 *       bodies below (ATZ reset, ATL1/ATH0 setup, then standard Mode 01
 *       PID requests such as 010C for RPM, 0105 for coolant temperature).
 * ============================================================================
 */

#ifndef IVSERS_OBD_II_H
#define IVSERS_OBD_II_H

#include <Arduino.h>
#include "config.h"

struct EngineData {
  int   rpm;
  int   speedKph;
  int   coolantTempC;
  int   fuelPercent;
  bool  dataValid;
};

class OBDII {
  public:
    bool begin(HardwareSerial * /*port*/, long /*baud*/ = 9600) {
      _ready = false;
#if IVSERS_ENABLE_OBDII
      Serial.println(F("[OBD-II] IVSERS_ENABLE_OBDII is set but no adapter "
                        "driver is implemented yet - reporting no data."));
#endif
      return _ready;
    }

    // Refreshes cached engine data. No-op while disabled.
    void update() {
      if (!_ready) return;
      // Real ATZ/PID request-response cycle goes here once hardware is fitted.
    }

    const EngineData &data() const { return _data; }
    bool isConnected() const { return _ready; }

  private:
    bool _ready = false;
    EngineData _data = { 0, 0, 0, 0, false };
};

#endif // IVSERS_OBD_II_H
