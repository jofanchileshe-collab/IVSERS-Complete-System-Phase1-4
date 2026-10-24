/*
 * ============================================================================
 *  IVSERS - Integrated Vehicle Safety and Emergency Response System
 *  IVSERS_MultiHazard.ino
 *
 *  Target hardware : Arduino Mega 2560
 *  Author          : Abraham Chileshe
 *  Institution     : Zambia Air Services Training Institute
 *                    School of Aircraft Maintenance Engineering
 *  Supervisor      : Eng. F. Kafwani
 *  Firmware version: see config.h -> FIRMWARE_VERSION
 *
 *  OVERVIEW
 *  --------
 *  Non-blocking control loop that fuses three hazard-detection subsystems
 *  (fire, passenger/cargo overload, accident/rollover) on a single
 *  microcontroller, drives zonal fire suppression and automated safety
 *  actuators, and reports every confirmed hazard over a dual-channel
 *  telemetry path (SIM800L GSM SMS + ESP32 Wi-Fi cloud bridge), with a
 *  GPS-derived Google Maps link attached to every alert.
 *
 *  REQUIRED LIBRARIES (install via Arduino IDE Library Manager)
 *    - TinyGPS++            by Mikal Hart
 *    - HX711                by Bogdan Necula / Olav Kallhovd ("HX711 Arduino Library")
 *    - MPU6050               by Electronic Cats / jrowberg (I2Cdevlib)
 *    - DHT sensor library    by Adafruit  (plus "Adafruit Unified Sensor")
 *    - SD / SPI / Wire       bundled with the Arduino IDE
 *
 *  WIRING
 *    See config.h for the full pin map and Appendix C of the project report
 *    for the physical zone layout (engine bay / passenger cabin / electrical
 *    panel).
 * ============================================================================
 */

#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <avr/wdt.h>
#include <TinyGPS++.h>
#include <HX711.h>
#include <MPU6050.h>
#include <DHT.h>

#include "config.h"
#include "data_logging.h"
#include "can_bus.h"
#include "voice_communication.h"
#include "tpms.h"
#include "obd_ii.h"
#include "driver_monitoring.h"

// ---------------------------------------------------------------------------
// GLOBAL OBJECTS
// ---------------------------------------------------------------------------
TinyGPSPlus gps;
HX711 scale;
MPU6050 imu;
DHT dhtEngine(PIN_DHT_ENGINE, DHT_TYPE);
DHT dhtElectric(PIN_DHT_ELECTRIC, DHT_TYPE);

DataLogger dataLogger;
VoiceCommunication voiceComm;
TPMS tpms;
OBDII obdii;
DriverMonitor driverMonitor;

// Serial port aliases (Mega hardware UARTs)
#define gpsSerial   Serial1
#define gsmSerial   Serial2
#define esp32Serial Serial3

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
struct HazardState {
  bool fireEngine    = false;
  bool fireCabin     = false;
  bool fireElectric  = false;
  bool overload      = false;
  bool accident      = false;
  bool panic         = false;
} hazard;

bool alarmAcknowledged = false;
String currentGPS = "location-unavailable";

unsigned long lastDisplayMs   = 0;
unsigned long lastHeartbeatMs = 0;
unsigned long lastDataLogMs   = 0;
unsigned long lastCanPollMs   = 0;

unsigned long accidentPendingSince = 0;
bool accidentPending = false;

// ===========================================================================
// SETUP
// ===========================================================================
void setup() {
  Serial.begin(DEBUG_BAUDRATE);
  gpsSerial.begin(GPS_BAUDRATE);
  gsmSerial.begin(GSM_BAUDRATE);
  esp32Serial.begin(ESP32_BAUDRATE);

  configurePins();
  initializeSensors();
  initializeExtensionModules();

  dataLogger.begin(PIN_SD_CS);
  dataLogger.logEvent(F("BOOT"), String(F("Firmware ")) + FIRMWARE_VERSION, currentGPS);

  esp32Serial.println(F("IVSERS|STATUS|STARTUP|OK"));
  sendSMS(EMERGENCY_PHONE, F("IVSERS system startup - vehicle safety system online."));

  runSelfTest();
  voiceComm.playMessage(1);

  wdt_enable(WATCHDOG_TIMEOUT);

  Serial.println(F("========================================"));
  Serial.print(F("IVSERS ready. Vehicle: "));
  Serial.println(VEHICLE_ID);
  Serial.println(F("========================================"));
}

// ===========================================================================
// MAIN LOOP (non-blocking)
// ===========================================================================
void loop() {
  wdt_reset();

  readGPS();
  dataLogger.retryIfNeeded();

  if (millis() - lastCanPollMs >= INTERVAL_CAN_POLL_MS) {
    lastCanPollMs = millis();
    pollExtensionModules();
  }

  readTankAndPressure();

  // ---- Driver controls (edge-triggered, checked every loop pass) ----
  if (digitalRead(PIN_ESTOP) == LOW) {
    handleEmergencyStop();
    return; // Skip the rest of this pass; E-STOP takes full priority.
  }

  if (digitalRead(PIN_RESET) == LOW) {
    handleSystemReset();
    return;
  }

  if (digitalRead(PIN_MANUAL_FIRE) == LOW) {
    handleManualFireOverride();
    return;
  }

  if (digitalRead(PIN_PANIC) == LOW && !hazard.panic) {
    handlePanicButton();
    return;
  }

  if (digitalRead(PIN_ACKNOWLEDGE) == LOW && !alarmAcknowledged) {
    alarmAcknowledged = true;
    Serial.println(F("Alarm acknowledged by driver."));
    dataLogger.logEvent(F("ACKNOWLEDGE"), F("Driver acknowledged active alert"), currentGPS);
  }

  // ---- Hazard detection subsystems ----
  detectFire();
  detectOverload();
  detectAccident();
  monitorSuppressionHealth();

  // ---- Periodic housekeeping ----
  if (millis() - lastDisplayMs >= INTERVAL_DISPLAY_MS) {
    lastDisplayMs = millis();
    printStatusToConsole();
  }

  if (millis() - lastHeartbeatMs >= INTERVAL_HEARTBEAT_MS) {
    lastHeartbeatMs = millis();
    sendHeartbeat();
  }

  if (millis() - lastDataLogMs >= INTERVAL_DATALOG_MS) {
    lastDataLogMs = millis();
    logPeriodicSnapshot();
  }
}

// ===========================================================================
// INITIALIZATION HELPERS
// ===========================================================================
void configurePins() {
  pinMode(PIN_RELAY_ENGINE, OUTPUT);
  pinMode(PIN_RELAY_CABIN, OUTPUT);
  pinMode(PIN_RELAY_ELECTRIC, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_OVERLOAD, OUTPUT);

  pinMode(PIN_DOOR_UNLOCK, OUTPUT);
  pinMode(PIN_ENGINE_SHUTDOWN, OUTPUT);
  pinMode(PIN_FUEL_SHUTOFF, OUTPUT);
  pinMode(PIN_HAZARD_LIGHTS, OUTPUT);

  pinMode(PIN_MANUAL_FIRE, INPUT_PULLUP);
  pinMode(PIN_ESTOP, INPUT_PULLUP);
  pinMode(PIN_RESET, INPUT_PULLUP);
  pinMode(PIN_ACKNOWLEDGE, INPUT_PULLUP);
  pinMode(PIN_PANIC, INPUT_PULLUP);

  // All actuators start de-energized / safe.
  digitalWrite(PIN_RELAY_ENGINE, LOW);
  digitalWrite(PIN_RELAY_CABIN, LOW);
  digitalWrite(PIN_RELAY_ELECTRIC, LOW);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_OVERLOAD, LOW);
  digitalWrite(PIN_DOOR_UNLOCK, LOW);
  digitalWrite(PIN_ENGINE_SHUTDOWN, LOW);
  digitalWrite(PIN_FUEL_SHUTOFF, LOW);
  digitalWrite(PIN_HAZARD_LIGHTS, LOW);
}

void initializeSensors() {
  dhtEngine.begin();
  dhtElectric.begin();

  scale.begin(PIN_HX711_DOUT, PIN_HX711_SCK);
  scale.set_scale(LOAD_CELL_CALIBRATION);
  scale.tare(20); // Zero the scale against an unloaded vehicle - 20 samples

  Wire.begin();
  imu.initialize();
  if (!imu.testConnection()) {
    Serial.println(F("[WARN] MPU6050 not responding - accident detection degraded."));
    dataLogger.logEvent(F("SENSOR_FAULT"), F("MPU6050 not responding at boot"), currentGPS);
  }
}

void initializeExtensionModules() {
  // All of these are safe no-ops unless their feature flag is enabled in
  // config.h and a real driver has been implemented in the corresponding
  // header - see the header-level documentation for activation steps.
  initializeCAN(PIN_SD_CS); // stub call signature retained for future wiring
  voiceComm.begin();
  tpms.begin();
  obdii.begin(&Serial3, GSM_BAUDRATE);
  driverMonitor.begin();
}

// ===========================================================================
// FIRE DETECTION (multi-sensor fusion, one relay per zone)
// ===========================================================================
void detectFire() {
  int flameEngine   = analogRead(PIN_FLAME_ENGINE);
  int flameCabin    = analogRead(PIN_FLAME_CABIN);
  int flameElectric = analogRead(PIN_FLAME_ELECTRIC);
  int smokeEngine   = analogRead(PIN_SMOKE_ENGINE);
  int smokeCabin    = analogRead(PIN_SMOKE_CABIN);

  float tempEngine   = dhtEngine.readTemperature();
  float tempElectric = dhtElectric.readTemperature();
  bool  engineTempValid   = !isnan(tempEngine);
  bool  electricTempValid = !isnan(tempElectric);

  // Sensor fusion: a zone only confirms fire when its available sensors
  // agree, which is the false-positive mitigation strategy documented in
  // Chapter 2.2 / 16.1 of the project report.
  bool engineFire = (flameEngine < FLAME_THRESHOLD) &&
                     (smokeEngine > SMOKE_THRESHOLD) &&
                     (engineTempValid && tempEngine > TEMP_THRESHOLD_C);

  bool cabinFire = (flameCabin < FLAME_THRESHOLD) &&
                    (smokeCabin > SMOKE_THRESHOLD);

  bool electricFire = (flameElectric < FLAME_THRESHOLD) &&
                       (electricTempValid && tempElectric > TEMP_THRESHOLD_C);

  if (engineFire && !hazard.fireEngine) {
    hazard.fireEngine = true;
    digitalWrite(PIN_RELAY_ENGINE, HIGH);
    activateEmergencySafety();
    raiseAlert(F("FIRE"), F("Engine bay"));
    voiceComm.playMessage(2);
  }

  if (cabinFire && !hazard.fireCabin) {
    hazard.fireCabin = true;
    digitalWrite(PIN_RELAY_CABIN, HIGH);
    activateEmergencySafety();
    raiseAlert(F("FIRE"), F("Passenger cabin"));
    voiceComm.playMessage(3);
  }

  if (electricFire && !hazard.fireElectric) {
    hazard.fireElectric = true;
    digitalWrite(PIN_RELAY_ELECTRIC, HIGH);
    activateEmergencySafety();
    raiseAlert(F("FIRE"), F("Electrical panel"));
    voiceComm.playMessage(4);
  }

  // Stream raw values to the ESP32 bridge for the live dashboard, regardless
  // of confirmed-fire state, so operators can see trending sensor data.
  esp32Serial.print(F("IVSERS|FIRE|"));
  esp32Serial.print(flameEngine);   esp32Serial.print('|');
  esp32Serial.print(flameCabin);    esp32Serial.print('|');
  esp32Serial.print(flameElectric); esp32Serial.print('|');
  esp32Serial.print(smokeEngine);   esp32Serial.print('|');
  esp32Serial.print(smokeCabin);    esp32Serial.print('|');
  esp32Serial.print(engineTempValid ? tempEngine : -999.0f);   esp32Serial.print('|');
  esp32Serial.println(electricTempValid ? tempElectric : -999.0f);
}

// ===========================================================================
// EMERGENCY SAFETY ACTIONS (Section 18.7)
// ===========================================================================
void activateEmergencySafety() {
  digitalWrite(PIN_DOOR_UNLOCK, HIGH);
  digitalWrite(PIN_HAZARD_LIGHTS, HIGH);
  digitalWrite(PIN_ENGINE_SHUTDOWN, HIGH);
  digitalWrite(PIN_FUEL_SHUTOFF, HIGH);
  voiceComm.playMessage(5);
  dataLogger.logEvent(F("SAFETY"), F("Automated emergency safety actuators engaged"), currentGPS);
}

// ===========================================================================
// OVERLOAD DETECTION
// ===========================================================================
void detectOverload() {
  if (!scale.is_ready()) {
    return; // Skip this cycle rather than blocking on a stalled HX711.
  }

  float loadKg = scale.get_units(LOAD_SAMPLES_AVERAGED);
  if (loadKg < 0) loadKg = 0; // Guard against small negative noise near zero.

  if (loadKg > LOAD_THRESHOLD_KG && !hazard.overload) {
    hazard.overload = true;
    digitalWrite(PIN_BUZZER, HIGH);
    digitalWrite(PIN_LED_OVERLOAD, HIGH);
    raiseAlert(F("OVERLOAD"), String(loadKg, 1) + " kg (rated " + String(LOAD_THRESHOLD_KG, 0) + " kg)");
    voiceComm.playMessage(6);
  } else if (loadKg <= LOAD_THRESHOLD_KG && hazard.overload) {
    hazard.overload = false;
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(PIN_LED_OVERLOAD, LOW);
    dataLogger.logEvent(F("OVERLOAD_CLEAR"), String(loadKg, 1) + " kg", currentGPS);
  }

  esp32Serial.print(F("IVSERS|LOAD|"));
  esp32Serial.println(loadKg, 1);
}

// ===========================================================================
// ACCIDENT / ROLLOVER DETECTION
// ===========================================================================
void detectAccident() {
  int16_t ax, ay, az, gx, gy, gz;
  imu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);

  // MPU6050 default sensitivity: +/-2g range -> 16384 LSB/g
  float accelX = ax / 16384.0f;
  float accelY = ay / 16384.0f;
  float accelZ = az / 16384.0f;
  float totalAccelG = sqrt(sq(accelX) + sq(accelY) + sq(accelZ));

  float roll  = atan2(accelY, accelZ) * 180.0f / PI;
  float pitch = atan2(-accelX, sqrt(sq(accelY) + sq(accelZ))) * 180.0f / PI;

  bool collisionSignature = (totalAccelG > ACCEL_THRESHOLD_G);
  bool rolloverSignature  = (fabs(roll) > TILT_THRESHOLD_DEG) || (fabs(pitch) > TILT_THRESHOLD_DEG);

  if ((collisionSignature || rolloverSignature) && !accidentPending && !hazard.accident) {
    accidentPending = true;
    accidentPendingSince = millis();
  }

  if (accidentPending) {
    bool stillTriggering = collisionSignature || rolloverSignature;
    if (!stillTriggering) {
      accidentPending = false; // Transient spike (pothole/hard brake) - ignore.
    } else if (millis() - accidentPendingSince >= ACCIDENT_DEBOUNCE_MS) {
      hazard.accident = true;
      accidentPending = false;
      activateEmergencySafety();
      String details = String(F("Collision:")) + (collisionSignature ? F("Y") : F("N")) +
                        F(" Rollover:") + (rolloverSignature ? F("Y") : F("N")) +
                        F(" G-force:") + String(totalAccelG, 2);
      raiseAlert(F("ACCIDENT"), details);
      voiceComm.playMessage(7);
    }
  }

  esp32Serial.print(F("IVSERS|IMU|"));
  esp32Serial.print(totalAccelG, 2); esp32Serial.print('|');
  esp32Serial.print(roll, 1);        esp32Serial.print('|');
  esp32Serial.println(pitch, 1);
}

// ===========================================================================
// SUPPRESSION TANK / PUMP PRESSURE MONITORING (Section 18.3)
// ===========================================================================
void readTankAndPressure() {
  static unsigned long lastLowTankAlertMs = 0;

  int rawTank = analogRead(PIN_TANK_LEVEL);
  int tankPercent = map(rawTank, 0, 1023, 0, 100);

  int rawPressure = analogRead(PIN_PRESSURE);
  int pressureUnits = map(rawPressure, 0, 1023, 0, 20);

  if (tankPercent <= TANK_LOW_PERCENT && millis() - lastLowTankAlertMs > INTERVAL_HEARTBEAT_MS) {
    lastLowTankAlertMs = millis();
    raiseAlert(F("LOW_SUPPRESSION"), String(F("Tank level ")) + tankPercent + "%");
  }

  esp32Serial.print(F("IVSERS|TANK|"));
  esp32Serial.print(tankPercent); esp32Serial.print('|');
  esp32Serial.println(pressureUnits);
}

void monitorSuppressionHealth() {
  int rawTank = analogRead(PIN_TANK_LEVEL);
  int tankPercent = map(rawTank, 0, 1023, 0, 100);

  if (tankPercent <= TANK_CRITICAL_PERCENT) {
    // Brief audible chirp - distinct from the sustained overload buzzer -
    // without blocking the main loop with a delay().
    static unsigned long lastChirpMs = 0;
    static bool chirpOn = false;
    if (millis() - lastChirpMs > 150) {
      lastChirpMs = millis();
      chirpOn = !chirpOn;
      digitalWrite(PIN_BUZZER, chirpOn ? HIGH : LOW);
    }
  }
}

// ===========================================================================
// PANIC BUTTON
// ===========================================================================
void handlePanicButton() {
  hazard.panic = true;
  activateEmergencySafety();
  raiseAlert(F("PANIC"), F("Panic button activated by driver"));
  voiceComm.playMessage(8);

  // Non-blocking visual/audible burst using millis()-based pacing rather
  // than delay(), so the watchdog and sensor loop are not stalled.
  unsigned long start = millis();
  bool state = false;
  unsigned long lastToggle = 0;
  while (millis() - start < 2000) {
    wdt_reset();
    if (millis() - lastToggle > 200) {
      lastToggle = millis();
      state = !state;
      digitalWrite(PIN_HAZARD_LIGHTS, state);
      digitalWrite(PIN_BUZZER, state);
    }
  }
  digitalWrite(PIN_BUZZER, LOW);
  hazard.panic = false;
}

// ===========================================================================
// MANUAL FIRE OVERRIDE (guarded driver push button)
// ===========================================================================
void handleManualFireOverride() {
  Serial.println(F("MANUAL FIRE OVERRIDE - activating all suppression zones."));
  digitalWrite(PIN_RELAY_ENGINE, HIGH);
  digitalWrite(PIN_RELAY_CABIN, HIGH);
  digitalWrite(PIN_RELAY_ELECTRIC, HIGH);
  hazard.fireEngine = hazard.fireCabin = hazard.fireElectric = true;
  activateEmergencySafety();
  raiseAlert(F("FIRE_MANUAL"), F("Driver-initiated manual override"));
  voiceComm.playMessage(11);
}

// ===========================================================================
// EMERGENCY STOP (maintenance) - fully de-energizes suppression outputs
// ===========================================================================
void handleEmergencyStop() {
  Serial.println(F("E-STOP ACTIVE - system disabled for maintenance."));
  dataLogger.logEvent(F("ESTOP"), F("Emergency stop engaged"), currentGPS);

  digitalWrite(PIN_RELAY_ENGINE, LOW);
  digitalWrite(PIN_RELAY_CABIN, LOW);
  digitalWrite(PIN_RELAY_ELECTRIC, LOW);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_OVERLOAD, LOW);

  // Wait here (watchdog still serviced) until the switch is released -
  // this is the one place a blocking wait is appropriate, since E-STOP is
  // an explicit "halt everything" maintenance action.
  while (digitalRead(PIN_ESTOP) == LOW) {
    wdt_reset();
    delay(50);
  }

  Serial.println(F("E-STOP released - reinitializing system."));
  handleSystemReset();
}

// ===========================================================================
// SYSTEM RESET
// ===========================================================================
void handleSystemReset() {
  hazard = HazardState();
  alarmAcknowledged = false;
  accidentPending = false;

  digitalWrite(PIN_RELAY_ENGINE, LOW);
  digitalWrite(PIN_RELAY_CABIN, LOW);
  digitalWrite(PIN_RELAY_ELECTRIC, LOW);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_OVERLOAD, LOW);
  digitalWrite(PIN_DOOR_UNLOCK, LOW);
  digitalWrite(PIN_ENGINE_SHUTDOWN, LOW);
  digitalWrite(PIN_FUEL_SHUTOFF, LOW);
  digitalWrite(PIN_HAZARD_LIGHTS, LOW);

  dataLogger.logEvent(F("RESET"), F("System reset to standby"), currentGPS);
  sendSMS(EMERGENCY_PHONE, F("IVSERS system reset - all zones returned to standby."));
  voiceComm.playMessage(10);
}

// ===========================================================================
// GPS
// ===========================================================================
void readGPS() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }
  if (gps.location.isValid() && gps.location.isUpdated()) {
    currentGPS = String(gps.location.lat(), 6) + "," + String(gps.location.lng(), 6);
  }
}

// ===========================================================================
// EXTENSION MODULE POLLING (all safe no-ops until enabled in config.h)
// ===========================================================================
void pollExtensionModules() {
  CANMessage msg;
  while (readCANMessage(&msg)) {
    // Future: route wheel-speed / door-status frames into hazard logic.
  }
  tpms.update();
  obdii.update();
  driverMonitor.update();

  if (driverMonitor.needsAlert()) {
    dataLogger.logEvent(F("DRIVER_ALERT"), F("Fatigue/distraction flagged"), currentGPS);
  }
}

// ===========================================================================
// TELEMETRY: unified alert dispatch (GSM SMS + ESP32 Wi-Fi cloud bridge)
// ===========================================================================
void raiseAlert(const String &type, const String &details) {
  String mapsLink = String(GOOGLE_MAPS_PREFIX) + currentGPS;

  String smsBody = String(F("IVSERS ALERT\n"));
  smsBody += "Vehicle: " + String(VEHICLE_ID) + "\n";
  smsBody += "Hazard: " + type + "\n";
  smsBody += "Details: " + details + "\n";
  smsBody += "Location: " + mapsLink + "\n";
  smsBody += "Respond immediately.";
  sendSMS(EMERGENCY_PHONE, smsBody);

  // Pipe-delimited payload for the ESP32 cloud bridge -> backend ingestion.
  esp32Serial.print(F("IVSERS|ALERT|"));
  esp32Serial.print(type);
  esp32Serial.print('|');
  esp32Serial.print(details);
  esp32Serial.print('|');
  esp32Serial.println(currentGPS);

  dataLogger.logEvent(type, details, currentGPS);
  voiceComm.sendVoiceToCloud(type + "|" + details);

  Serial.println(F("=== ALERT DISPATCHED ==="));
  Serial.println(smsBody);
  Serial.println(F("========================"));
}

void sendSMS(const String &phone, const String &message) {
  gsmSerial.println(F("AT+CMGF=1")); // Text mode
  delay(150);
  gsmSerial.print(F("AT+CMGS=\""));
  gsmSerial.print(phone);
  gsmSerial.println(F("\""));
  delay(150);
  gsmSerial.print(message);
  gsmSerial.write(26); // Ctrl+Z terminates and sends the SMS body
}

void sendHeartbeat() {
  String status = F("IVSERS|STATUS|");
  if (hazard.fireEngine || hazard.fireCabin || hazard.fireElectric) status += F("FIRE");
  else if (hazard.overload)  status += F("OVERLOAD");
  else if (hazard.accident)  status += F("ACCIDENT");
  else if (hazard.panic)     status += F("PANIC");
  else                       status += F("NORMAL");

  status += "|" + currentGPS;
  esp32Serial.println(status);
  dataLogger.logEvent(F("HEARTBEAT"), status, currentGPS);
}

void logPeriodicSnapshot() {
  float loadKg = scale.is_ready() ? scale.get_units(LOAD_SAMPLES_AVERAGED) : -1.0f;

  String snapshot = String(F("fireE:")) + hazard.fireEngine +
                     F(",fireC:") + hazard.fireCabin +
                     F(",fireP:") + hazard.fireElectric +
                     F(",overload:") + hazard.overload +
                     F(",accident:") + hazard.accident +
                     F(",loadKg:") + String(loadKg, 1);

  dataLogger.logEvent(F("SNAPSHOT"), snapshot, currentGPS);
}

// ===========================================================================
// SELF-TEST (runs once at boot - Section 18.8 "Automatic Self-Test")
// ===========================================================================
void runSelfTest() {
  Serial.println(F("Running startup self-test..."));

  int f1 = analogRead(PIN_FLAME_ENGINE);
  int f2 = analogRead(PIN_FLAME_CABIN);
  int f3 = analogRead(PIN_FLAME_ELECTRIC);
  Serial.print(F("Flame sensors (engine/cabin/electric): "));
  Serial.print(f1); Serial.print('/'); Serial.print(f2); Serial.print('/'); Serial.println(f3);

  float t1 = dhtEngine.readTemperature();
  float t2 = dhtElectric.readTemperature();
  Serial.print(F("Temperature sensors (engine/electric): "));
  Serial.print(isnan(t1) ? -999.0f : t1); Serial.print(F("C / "));
  Serial.print(isnan(t2) ? -999.0f : t2); Serial.println(F("C"));

  Serial.print(F("Load cell zero reading: "));
  Serial.println(scale.is_ready() ? scale.get_units(5) : -1.0f);

  Serial.print(F("MPU6050 connection: "));
  Serial.println(imu.testConnection() ? F("OK") : F("FAULT"));

  // Momentarily exercise each relay/actuator so a technician can visually
  // and audibly confirm wiring during commissioning, without leaving any
  // output energized afterward.
  const uint8_t testPins[] = {
    PIN_RELAY_ENGINE, PIN_RELAY_CABIN, PIN_RELAY_ELECTRIC,
    PIN_DOOR_UNLOCK, PIN_ENGINE_SHUTDOWN, PIN_FUEL_SHUTOFF, PIN_HAZARD_LIGHTS
  };
  for (uint8_t i = 0; i < sizeof(testPins); i++) {
    digitalWrite(testPins[i], HIGH);
    delay(200);
    digitalWrite(testPins[i], LOW);
  }

  Serial.println(F("Self-test complete. System status: HEALTHY"));
  dataLogger.logEvent(F("SELF_TEST"), F("Startup self-test complete - HEALTHY"), currentGPS);
}

// ===========================================================================
// CONSOLE STATUS (debug UART only - no effect on telemetry)
// ===========================================================================
void printStatusToConsole() {
  Serial.print(F("Status: "));
  if (hazard.fireEngine || hazard.fireCabin || hazard.fireElectric) {
    Serial.print(F("FIRE"));
    if (hazard.fireEngine)   Serial.print(F(" [engine]"));
    if (hazard.fireCabin)    Serial.print(F(" [cabin]"));
    if (hazard.fireElectric) Serial.print(F(" [electric]"));
  } else if (hazard.overload) {
    Serial.print(F("OVERLOAD"));
  } else if (hazard.accident) {
    Serial.print(F("ACCIDENT"));
  } else {
    Serial.print(F("NORMAL"));
  }
  Serial.print(F(" | GPS: "));
  Serial.println(currentGPS);
}
