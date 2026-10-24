/*
 * ============================================================================
 *  IVSERS - driver_monitoring.h  (FUTURE EXTENSION - DISABLED BY DEFAULT)
 *
 *  Driver fatigue / distraction monitoring. Real, credible implementations
 *  of this feature use a dashboard-facing camera and an onboard vision
 *  model (e.g. an ESP32-CAM or Raspberry Pi running eye-aspect-ratio /
 *  PERCLOS detection) - NOT a bare analog "eye sensor" pin, which is not a
 *  real class of automotive sensor. This stub is deliberately left
 *  unimplemented at the algorithm level rather than faked with analogRead()
 *  values pretending to be eye tracking.
 *
 *  This module is NOT part of the diploma-build bill of materials and is a
 *  Section 18 roadmap item, not a Section 18.11 priority feature.
 *
 *  To activate:
 *    1. Fit a camera module (ESP32-CAM or equivalent) running a fatigue-
 *       detection model, communicating results to the Mega over UART/I2C
 *       as a simple status byte (e.g. 0=alert, 1=fatigued, 2=distracted).
 *    2. Fit a seatbelt-buckle switch and steering-wheel touch/torque sensor
 *       for the supporting "hands on wheel" / "belt on" signals.
 *    3. Set IVSERS_ENABLE_DRIVER_MONITOR to 1 in config.h and implement
 *       update() to read the real status byte from the camera module.
 * ============================================================================
 */

#ifndef IVSERS_DRIVER_MONITORING_H
#define IVSERS_DRIVER_MONITORING_H

#include <Arduino.h>
#include "config.h"

struct DriverState {
  bool fatigued;
  bool distracted;
  bool seatBeltOn;
  bool handsOnWheel;
  bool dataValid;   // false until a real camera-module status byte arrives
};

class DriverMonitor {
  public:
    bool begin() {
      _ready = false;
#if IVSERS_ENABLE_DRIVER_MONITOR
      Serial.println(F("[DriverMonitor] IVSERS_ENABLE_DRIVER_MONITOR is set "
                        "but no camera-module driver is implemented yet."));
#endif
      return _ready;
    }

    // Polls the camera/seatbelt/steering inputs. No-op while disabled.
    void update() {
      if (!_ready) return;
      // Real status-byte read from the camera module goes here.
    }

    const DriverState &state() const { return _state; }
    bool needsAlert() const {
      return _state.dataValid && (_state.fatigued || _state.distracted);
    }

  private:
    bool _ready = false;
    DriverState _state = { false, false, true, true, false };
};

#endif // IVSERS_DRIVER_MONITORING_H
