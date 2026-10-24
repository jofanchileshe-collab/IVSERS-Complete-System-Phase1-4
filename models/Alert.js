/*
 * ============================================================================
 *  IVSERS Backend - models/Alert.js
 *
 *  One document per confirmed hazard event raised by a vehicle's
 *  raiseAlert() call in the Mega firmware and relayed through the ESP32
 *  Cloud Bridge's ALERT-type message. Severity is derived server-side from
 *  the hazard type so the dashboard can sort/filter without trusting a
 *  client-supplied severity value.
 * ============================================================================
 */

const mongoose = require('mongoose');

const SEVERITY_BY_TYPE = {
  FIRE: 'CRITICAL',
  FIRE_MANUAL: 'CRITICAL',
  ACCIDENT: 'CRITICAL',
  PANIC: 'HIGH',
  OVERLOAD: 'MEDIUM',
  LOW_SUPPRESSION: 'MEDIUM',
};

function deriveSeverity(type) {
  return SEVERITY_BY_TYPE[type] || 'LOW';
}

const AlertSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    bus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bus',
      default: null,
    },
    organization: {
      type: String,
      trim: true,
    },

    type: {
      type: String,
      required: true,
      enum: [
        'FIRE',
        'FIRE_MANUAL',
        'OVERLOAD',
        'ACCIDENT',
        'PANIC',
        'LOW_SUPPRESSION',
      ],
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    },
    details: {
      type: String,
      default: '',
    },

    location: {
      latitude: Number,
      longitude: Number,
      googleMapsUrl: String,
    },

    status: {
      type: String,
      enum: ['pending', 'acknowledged', 'resolved', 'false_alarm'],
      default: 'pending',
    },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    acknowledgedAt: Date,
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: Date,
    resolutionNotes: String,
  },
  { timestamps: true }
);

AlertSchema.pre('validate', function setSeverity(next) {
  if (!this.severity) {
    this.severity = deriveSeverity(this.type);
  }
  next();
});

AlertSchema.index({ createdAt: -1 });
AlertSchema.index({ status: 1 });
AlertSchema.index({ organization: 1, createdAt: -1 });

module.exports = mongoose.model('Alert', AlertSchema);
module.exports.deriveSeverity = deriveSeverity;
