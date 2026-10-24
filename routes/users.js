/*
 * ============================================================================
 *  IVSERS Backend - routes/users.js
 * ============================================================================
 */

const express = require('express');
const router = express.Router();

const userController = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/auth');
const {
  accountCreateRules,
  accountUpdateRules,
  accountStatusRules,
  handleValidationErrors,
} = require('../middleware/validation');
const asyncHandler = require('../utils/asyncHandler');

router.use(authenticate);

router.get(
  '/assignable',
  authorize('super_admin', 'fleet_manager'),
  asyncHandler(userController.listAssignableAccounts)
);
router.get('/', authorize('super_admin'), asyncHandler(userController.listAccounts));
router.post(
  '/',
  authorize('super_admin'),
  accountCreateRules,
  handleValidationErrors,
  asyncHandler(userController.createAccount)
);
router.patch(
  '/:id',
  authorize('super_admin'),
  accountUpdateRules,
  handleValidationErrors,
  asyncHandler(userController.updateAccount)
);
router.patch(
  '/:id/status',
  authorize('super_admin'),
  accountStatusRules,
  handleValidationErrors,
  asyncHandler(userController.updateAccountStatus)
);
router.delete('/:id', authorize('super_admin'), asyncHandler(userController.deleteAccount));

module.exports = router;
