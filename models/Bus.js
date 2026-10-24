/*
 * ============================================================================
 *  IVSERS Backend - models/Bus.js
 *
 *  One document per fleet vehicle. `vehicleId` is the human-readable ID
 *  burned into the firmware (config.h VEHICLE_ID on the Mega / DEFAULT_
 *  DEVICE_ID on the ESP32) and is the join key used by the telemetry
 *  ingestion endpoints - it is intentionally a plain unique string rather
 *  than requiring the device to know its own Mongo ObjectId.
 *
 *  "hardware.*" fields are updated in near-real-time by
 *  controllers/telemetryController.js as data arrives from the ESP32
 *  Cloud Bridge, and mirror the exact fields the firmware sends:
 *    FIRE   -> hardware.sensors.flame(Engine|Cabin|Electric) / smoke(Engine|Cabin) / temp(Engine|Electric)
 *    LOAD   -> hardware.sensors.loadKg
 *    IMU    -> hardware.sensors.accelG / roll / pitch
 *    TANK   -> hardware.suppression.tankPercent / pressureUnits
 *    STATUS -> hardware.lastHeartbeat / hardware.hazardState / gps
 * ============================================================================
 */

const mongoose = require('mongoose');

const BusSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    registrationNumber: {
      type: String,
      trim: true,
    },
    make: String,
    model: String,
    year: Number,
    capacity: Number,
    maxLoadKg: {
      type: Number,
      default: 3500,
    },

    route: String,
    depot: String,

    organization: {
      type: String,
      trim: true,
      maxlength: 160,
    },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    status: {
      type: String,
      enum: ['active', 'maintenance', 'offline', 'decommissioned'],
      default: 'active',
    },

    hardware: {
      firmwareVersion: { type: String, default: 'unknown' },
      lastHeartbeat: Date,

      gps: {
        latitude: Number,
        longitude: Number,
        lastUpdate: Date,
      },

      sensors: {
        flameEngine: Number,
        flameCabin: Number,
        flameElectric: Number,
        smokeEngine: Number,
        smokeCabin: Number,
        tempEngine: Number,
        tempElectric: Number,
        loadKg: Number,
        accelG: Number,
        roll: Number,
        pitch: Number,
      },

      suppression: {
        tankPercent: Number,
        pressureUnits: Number,
      },

      hazardState: {
        fireEngine: { type: Boolean, default: false },
        fireCabin: { type: Boolean, default: false },
        fireElectric: { type: Boolean, default: false },
        overload: { type: Boolean, default: false },
        accident: { type: Boolean, default: false },
        panic: { type: Boolean, default: false },
      },
    },

    // Extension point: future modules (CAN-bus / TPMS / OBD-II / driver
    // monitoring, see the corresponding firmware headers) can populate this
    // without a schema migration, since consumers should not assume every
    // key is present until the matching firmware feature flag is enabled.
    extensions: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

BusSchema.index({ status: 1 });
BusSchema.index({ 'hardware.lastHeartbeat': -1 });
BusSchema.index({ organization: 1, vehicleId: 1 });
BusSchema.index({ owner: 1 });
BusSchema.index({ driver: 1 });

module.exports = mongoose.model('Bus', BusSchema);
