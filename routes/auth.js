/*
 * ============================================================================
 *  IVSERS Backend - routes/auth.js
 * ============================================================================
 */

const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { authenticate, authorize } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const {
  accountCreateRules,
  loginRules,
  handleValidationErrors,
} = require('../middleware/validation');
const asyncHandler = require('../utils/asyncHandler');

router.post(
  '/register',
  authenticate,
  authorize('super_admin'),
  authLimiter,
  accountCreateRules,
  handleValidationErrors,
  asyncHandler(authController.register)
);
router.post('/login', authLimiter, loginRules, handleValidationErrors, asyncHandler(authController.login));
router.get('/me', authenticate, asyncHandler(authController.me));

module.exports = router;
