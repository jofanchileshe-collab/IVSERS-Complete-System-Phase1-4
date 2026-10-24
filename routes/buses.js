/*
 * ============================================================================
 *  IVSERS Backend - routes/buses.js
 * ============================================================================
 */

const express = require('express');
const router = express.Router();

const busController = require('../controllers/busController');
const { authenticate, authorize } = require('../middleware/auth');
const {
  busCreateRules,
  busUpdateRules,
  handleValidationErrors,
} = require('../middleware/validation');
const asyncHandler = require('../utils/asyncHandler');

router.use(authenticate);

router.get('/', asyncHandler(busController.listBuses));
router.get('/vehicle/:vehicleId', asyncHandler(busController.getBusByVehicleId));
router.get('/:id', asyncHandler(busController.getBus));

router.post(
  '/',
  authorize('fleet_manager', 'super_admin'),
  busCreateRules,
  handleValidationErrors,
  asyncHandler(busController.createBus)
);

router.patch(
  '/:id',
  authorize('fleet_manager', 'super_admin'),
  busUpdateRules,
  handleValidationErrors,
  asyncHandler(busController.updateBus)
);
router.delete('/:id', authorize('fleet_manager', 'super_admin'), asyncHandler(busController.deleteBus));

module.exports = router;
