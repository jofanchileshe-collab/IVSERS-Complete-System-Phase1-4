/*
 * ============================================================================
 *  IVSERS - Integrated Vehicle Safety and Emergency Response System
 *  config.h
 *
 *  Central configuration: pin map, thresholds, credentials, feature flags.
 *  Zambia Air Services Training Institute - School of Aircraft Maintenance
 *  Engineering. Author: Abraham Chileshe. Supervisor: Eng. F. Kafwani.
 *
 *  Target: Arduino Mega 2560 (ATmega2560)
 *
 *  Edit this file to match your physical wiring loom before flashing.
 *  Every value here is referenced by name elsewhere in the firmware -
 *  do not rename a macro without updating every file that uses it.
 * ============================================================================
 */

#ifndef IVSERS_CONFIG_H
#define IVSERS_CONFIG_H

#include <Arduino.h>

// ---------------------------------------------------------------------------
// VEHICLE / DEPLOYMENT IDENTITY
// ---------------------------------------------------------------------------
#define VEHICLE_ID           "IVSERS-001"          // Unique fleet identifier
#define VEHICLE_TYPE         "Public Service Bus"
#define FIRMWARE_VERSION     "1.0.0"
#define FIRMWARE_BUILD_DATE  __DATE__ " " __TIME__

// ---------------------------------------------------------------------------
// FEATURE FLAGS
// Core features are always compiled in. Extension modules (Chapter 17 /
// Section 18.11 "future roadmap" items) are OFF by default because they
// require hardware that is not part of the diploma-build BOM. Flip to 1
// only after the corresponding module and physical sensor are installed.
// ---------------------------------------------------------------------------
#define IVSERS_ENABLE_CANBUS            0   // Requires MCP2515 CAN transceiver
#define IVSERS_ENABLE_VOICE             0   // Requires DFPlayer/audio module
#define IVSERS_ENABLE_TPMS              0   // Requires wireless TPMS receiver
#define IVSERS_ENABLE_OBDII             0   // Requires ELM327 OBD-II adapter
#define IVSERS_ENABLE_DRIVER_MONITOR    0   // Requires camera/eye-tracking HW
#define IVSERS_ENABLE_SD_LOGGING        1   // Requires SD card module (fitted)

// ---------------------------------------------------------------------------
// SERIAL / BAUD RATES
// Mega 2560 has 4 hardware UARTs: Serial (USB/debug), Serial1, Serial2, Serial3
// ---------------------------------------------------------------------------
#define DEBUG_BAUDRATE        115200   // Serial  - USB debug console
#define GPS_BAUDRATE          9600     // Serial1 - NEO-6M GPS
#define GSM_BAUDRATE          9600     // Serial2 - SIM800L GSM/GPRS
#define ESP32_BAUDRATE        115200   // Serial3 - ESP32 cloud bridge link

// ---------------------------------------------------------------------------
// FIRE DETECTION - ANALOG SENSOR PINS (3 zones: engine, cabin, electrical)
// ---------------------------------------------------------------------------
#define PIN_FLAME_ENGINE      A0
#define PIN_FLAME_CABIN       A1
#define PIN_FLAME_ELECTRIC    A2
#define PIN_SMOKE_ENGINE      A3
#define PIN_SMOKE_CABIN       A4
// Electrical panel zone intentionally has no smoke sensor in the diploma BOM
// (flame + temperature only, per Chapter 7.2 / 8.1) - avoid false readings.

// DHT22 temperature/humidity sensors (digital, one-wire protocol)
#define PIN_DHT_ENGINE        6
#define PIN_DHT_ELECTRIC      7
#define DHT_TYPE              DHT22

// Fire suppression relay outputs (one isolated relay channel per zone)
#define PIN_RELAY_ENGINE      8
#define PIN_RELAY_CABIN       9
#define PIN_RELAY_ELECTRIC    10

// Suppression tank / pump health (analog)
#define PIN_TANK_LEVEL        A5
#define PIN_PRESSURE          A6

// ---------------------------------------------------------------------------
// OVERLOAD DETECTION - HX711 + LOAD CELL ARRAY
// ---------------------------------------------------------------------------
#define PIN_HX711_DOUT        22
#define PIN_HX711_SCK         23
#define PIN_BUZZER            24
#define PIN_LED_OVERLOAD      25

// ---------------------------------------------------------------------------
// ACCIDENT DETECTION - MPU6050 IMU (I2C, fixed pins on Mega: SDA=20, SCL=21)
// ---------------------------------------------------------------------------
#define PIN_IMU_INTERRUPT     2

// ---------------------------------------------------------------------------
// DRIVER CONTROLS
// ---------------------------------------------------------------------------
#define PIN_MANUAL_FIRE       11   // Guarded manual suppression trigger
#define PIN_ESTOP             12   // Maintenance emergency stop
#define PIN_RESET             13   // System reset / alarm clear
#define PIN_ACKNOWLEDGE       26   // Driver acknowledges an active alert
#define PIN_PANIC             27   // Panic / assistance request button

// ---------------------------------------------------------------------------
// AUTOMATED EMERGENCY RESPONSE ACTUATORS (Section 18.7 priority features)
// ---------------------------------------------------------------------------
#define PIN_DOOR_UNLOCK        40
#define PIN_ENGINE_SHUTDOWN    41
#define PIN_FUEL_SHUTOFF       42
#define PIN_HAZARD_LIGHTS      43

// ---------------------------------------------------------------------------
// DRIVER INFORMATION DISPLAY (optional 16x2 / 20x4 I2C LCD, Section 18.6)
// Set to 1 once the LCD is wired to the shared I2C bus (SDA=20, SCL=21).
// ---------------------------------------------------------------------------
#define IVSERS_ENABLE_LCD      0
#define LCD_I2C_ADDRESS        0x27
#define LCD_COLUMNS             20
#define LCD_ROWS                 4

// ---------------------------------------------------------------------------
// SD CARD BLACK-BOX LOGGER (Section 18.5)
// ---------------------------------------------------------------------------
#define PIN_SD_CS              53   // Mega hardware SPI: MOSI=51 MISO=50 SCK=52
#define SD_LOG_FILENAME        "ivsers.log"
#define SD_LOG_BUFFER_MAX      2048 // Bytes buffered in RAM if SD write fails

// ---------------------------------------------------------------------------
// COMMUNICATION CREDENTIALS
// Replace placeholders with real fleet-office and emergency contact numbers
// before deployment. Numbers must be in international format.
// ---------------------------------------------------------------------------
#define EMERGENCY_PHONE        "+260000000000"
#define FLEET_MANAGER_PHONE    "+260000000001"
#define GOOGLE_MAPS_PREFIX     "https://maps.google.com/?q="

// ---------------------------------------------------------------------------
// DETECTION THRESHOLDS - calibrate against real sensors before deployment.
// Analog sensor values below are raw 10-bit ADC counts (0-1023) unless noted.
// ---------------------------------------------------------------------------
// Fire fusion thresholds
#define FLAME_THRESHOLD        400     // Below this = flame detected (IR sensors pull LOW on detection)
#define SMOKE_THRESHOLD        300     // Above this = smoke/gas present
#define TEMP_THRESHOLD_C       55.0f   // Degrees Celsius

// Overload thresholds
#define LOAD_THRESHOLD_KG      3500.0f // Rated vehicle passenger/cargo capacity
#define LOAD_CELL_CALIBRATION  2280.0f // HX711 scale factor - calibrate with known reference weight
#define LOAD_SAMPLES_AVERAGED  10      // Rolling-average sample count

// Accident thresholds
#define ACCEL_THRESHOLD_G      3.5f    // Sudden deceleration / impact, in g
#define TILT_THRESHOLD_DEG     45.0f   // Rollover angle, degrees
#define ACCIDENT_DEBOUNCE_MS   500UL   // Sustained reading required before confirming

// Suppression tank / pressure thresholds (percent / arbitrary sensor units)
#define TANK_LOW_PERCENT        20
#define TANK_CRITICAL_PERCENT   10

// ---------------------------------------------------------------------------
// TIMING INTERVALS (milliseconds)
// ---------------------------------------------------------------------------
#define INTERVAL_DISPLAY_MS     500UL
#define INTERVAL_HEARTBEAT_MS   30000UL
#define INTERVAL_DATALOG_MS     60000UL
#define INTERVAL_CAN_POLL_MS    100UL
#define WATCHDOG_TIMEOUT        WDTO_4S

#endif // IVSERS_CONFIG_H
