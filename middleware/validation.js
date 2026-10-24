/*
 * ============================================================================
 *  IVSERS Backend - middleware/validation.js
 *
 *  Shared express-validator rule sets and the error-collection middleware
 *  that turns validation failures into a consistent 400 JSON response.
 * ============================================================================
 */

const { body, validationResult } = require('express-validator');

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

const loginRules = [
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

const accountCreateRules = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('phone').optional({ values: 'falsy' }).isString().trim(),
  body('organization').if(body('role').not().equals('super_admin'))
    .trim().notEmpty().withMessage('Organization is required for this role'),
  body('role').isIn([
    'super_admin', 'fleet_manager', 'driver', 'bus_owner',
    'police', 'hospital', 'rtsa', 'fire_brigade',
  ]).withMessage('Select a valid role'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/)
    .withMessage('Password must contain an uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain a lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain a number'),
];

const accountStatusRules = [
  body('status').isIn(['active', 'suspended']).withMessage('Status must be active or suspended'),
];

const accountUpdateRules = [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('email').optional().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('phone').optional({ values: 'falsy' }).isString().trim(),
  body('organization').optional().if(body('role').not().equals('super_admin'))
    .trim().notEmpty().withMessage('Organization is required for this role'),
  body('role').optional().isIn([
    'super_admin', 'fleet_manager', 'driver', 'bus_owner',
    'police', 'hospital', 'rtsa', 'fire_brigade',
  ]).withMessage('Select a valid role'),
];

const busCreateRules = [
  body('vehicleId').trim().notEmpty().withMessage('vehicleId is required'),
  body('capacity').optional().isInt({ min: 1 }),
  body('maxLoadKg').optional().isFloat({ min: 0 }),
  body('year').optional().isInt({ min: 1900, max: 2100 }),
  body('owner').optional({ values: 'falsy' }).isMongoId().withMessage('owner must be a valid account ID'),
  body('driver').optional({ values: 'falsy' }).isMongoId().withMessage('driver must be a valid account ID'),
];

const busUpdateRules = [
  body('capacity').optional().isInt({ min: 1 }),
  body('maxLoadKg').optional().isFloat({ min: 0 }),
  body('year').optional().isInt({ min: 1900, max: 2100 }),
  body('owner').optional({ values: 'falsy' }).isMongoId().withMessage('owner must be a valid account ID'),
  body('driver').optional({ values: 'falsy' }).isMongoId().withMessage('driver must be a valid account ID'),
];

const telemetryIngestRules = [
  body('deviceId').trim().notEmpty().withMessage('deviceId is required'),
  body('type').trim().notEmpty().withMessage('type is required'),
  body('fields').isArray().withMessage('fields must be an array'),
];

module.exports = {
  handleValidationErrors,
  loginRules,
  accountCreateRules,
  accountStatusRules,
  accountUpdateRules,
  busCreateRules,
  busUpdateRules,
  telemetryIngestRules,
};
