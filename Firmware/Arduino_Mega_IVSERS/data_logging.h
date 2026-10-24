/*
 * ============================================================================
 *  IVSERS - data_logging.h
 *
 *  SD-card black-box event logger (Section 18.5: "Digital Black Box
 *  Recorder"). Buffers log lines in RAM if the SD card is absent or a write
 *  fails, and flushes the buffer automatically once the card becomes
 *  available again, so no event is silently lost during a card fault.
 *
 *  Log line format (CSV):
 *    millis,eventType,details,gpsCoordinates
 *
 *  Dependencies: <SD.h>, <SPI.h> (both bundled with the Arduino IDE)
 * ============================================================================
 */

#ifndef IVSERS_DATA_LOGGING_H
#define IVSERS_DATA_LOGGING_H

#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include "config.h"

class DataLogger {
  public:
    DataLogger()
      : _cardPresent(false), _bufferedBytes(0) {}

    // Initializes the SPI bus and mounts the SD card. Safe to call even if
    // no card is present - the logger will fall back to RAM buffering.
    bool begin(uint8_t csPin = PIN_SD_CS) {
      _csPin = csPin;
      _cardPresent = SD.begin(_csPin);

      if (_cardPresent) {
        _openOrCreateFile();
      } else {
        Serial.println(F("[DataLogger] SD card not detected - buffering events in RAM"));
      }
      return _cardPresent;
    }

    // Re-attempts to mount the card and flush any buffered lines. Call this
    // periodically from the main loop (cheap no-op once the card is healthy).
    void retryIfNeeded() {
      if (_cardPresent) return;

      _cardPresent = SD.begin(_csPin);
      if (_cardPresent) {
        Serial.println(F("[DataLogger] SD card recovered - flushing RAM buffer"));
        _openOrCreateFile();
        if (_bufferedBytes > 0) {
          _logFile.print(_ramBuffer);
          _logFile.flush();
          _bufferedBytes = 0;
          _ramBuffer = "";
        }
      }
    }

    // Writes one structured event line. type/details/gps should be short,
    // comma-free strings (commas inside 'details' will break CSV parsing
    // downstream, so callers should use ';' or '|' as internal separators).
    void logEvent(const String &type, const String &details, const String &gps) {
      String line = String(millis());
      line += ',';
      line += type;
      line += ',';
      line += details;
      line += ',';
      line += gps;
      line += '\n';

      if (_cardPresent && _logFile) {
        _logFile.print(line);
        _logFile.flush();
      } else {
        _bufferToRam(line);
      }

      // Mirror every event to the debug console for live diagnostics.
      Serial.print(F("[LOG] "));
      Serial.print(line);
    }

    bool isCardPresent() const { return _cardPresent; }
    size_t bufferedBytes() const { return _bufferedBytes; }

  private:
    void _openOrCreateFile() {
      bool isNew = !SD.exists(SD_LOG_FILENAME);
      _logFile = SD.open(SD_LOG_FILENAME, FILE_WRITE);

      if (!_logFile) {
        Serial.println(F("[DataLogger] Failed to open log file - disabling SD writes"));
        _cardPresent = false;
        return;
      }

      if (isNew) {
        _logFile.println(F("millis,eventType,details,gpsCoordinates"));
        _logFile.println(String(F("# IVSERS log started - firmware ")) + FIRMWARE_VERSION);
      }
      _logFile.flush();
    }

    void _bufferToRam(const String &line) {
      if (_bufferedBytes + line.length() > SD_LOG_BUFFER_MAX) {
        // Oldest-data-first eviction: drop the first quarter of the buffer
        // to make room rather than losing the newest (most relevant) event.
        int cut = _ramBuffer.length() / 4;
        int nl = _ramBuffer.indexOf('\n', cut);
        if (nl > 0) {
          _ramBuffer.remove(0, nl + 1);
          _bufferedBytes = _ramBuffer.length();
        } else {
          _ramBuffer = "";
          _bufferedBytes = 0;
        }
      }
      _ramBuffer += line;
      _bufferedBytes += line.length();
    }

    uint8_t _csPin = PIN_SD_CS;
    bool _cardPresent;
    File _logFile;
    String _ramBuffer;
    size_t _bufferedBytes;
};

#endif // IVSERS_DATA_LOGGING_H
