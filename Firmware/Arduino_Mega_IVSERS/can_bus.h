/*
 * ============================================================================
 *  IVSERS - can_bus.h  (FUTURE EXTENSION - DISABLED BY DEFAULT)
 *
 *  Chapter 17.2 of the project report describes integrating IVSERS with the
 *  vehicle's CAN-bus network (e.g. via an MCP2515 transceiver) so the system
 *  can read wheel-speed/door-status signals and broadcast fuel-cutoff /
 *  hazard-light control frames directly onto the bus.
 *
 *  This module is NOT part of the diploma-build bill of materials (Chapter
 *  13) and is provided only as a clean, compiling integration point so a
 *  later revision can enable it without restructuring the main firmware.
 *
 *  To activate:
 *    1. Fit an MCP2515 CAN transceiver module and wire CS/INT per config.h.
 *    2. Install the "arduino-mcp2515" or "CAN_BUS_Shield" library.
 *    3. Set IVSERS_ENABLE_CANBUS to 1 in config.h.
 *    4. Replace the stub bodies below with real mcp2515 register calls.
 *
 *  Until then, every function below is a safe no-op so IVSERS_MultiHazard.ino
 *  compiles and runs identically whether or not this header is included.
 * ============================================================================
 */

#ifndef IVSERS_CAN_BUS_H
#define IVSERS_CAN_BUS_H

#include <Arduino.h>
#include "config.h"

struct CANMessage {
  uint32_t id;
  uint8_t  data[8];
  uint8_t  length;
};

#if IVSERS_ENABLE_CANBUS
  // -------------------------------------------------------------------------
  // Real implementation goes here once hardware is fitted. Left intentionally
  // unimplemented (compile error) rather than faked, so nobody accidentally
  // ships a build that silently pretends to talk to a CAN bus that isn't
  // physically connected.
  // -------------------------------------------------------------------------
  #error "IVSERS_ENABLE_CANBUS is set but the CAN-bus driver has not been " \
         "implemented yet. Fit the MCP2515 module, install its library, " \
         "and implement initializeCAN()/readCANMessage() before enabling."
#else

inline bool initializeCAN(uint8_t /*csPin*/) {
  // No CAN transceiver fitted - module intentionally disabled.
  return false;
}

inline bool readCANMessage(CANMessage * /*outMsg*/) {
  // Never returns data while disabled; caller must guard on the return value.
  return false;
}

inline bool sendCANMessage(const CANMessage & /*msg*/) {
  return false;
}

#endif // IVSERS_ENABLE_CANBUS

#endif // IVSERS_CAN_BUS_H
