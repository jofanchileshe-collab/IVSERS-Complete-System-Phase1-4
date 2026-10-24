/*
 * ============================================================================
 *  IVSERS Backend - routes/demo.js
 *
 *  Public demonstration endpoints backed only by the in-memory simulator.
 *  These handlers never access the real Bus or Alert collections.
 * ============================================================================
 */

const express = require('express');
const demoSimulator = require('../services/demoSimulator');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ success: true, data: demoSimulator.getState() });
});

router.post('/start', (req, res) => {
  res.json({ success: true, data: demoSimulator.start() });
});

router.post('/stop', (req, res) => {
  res.json({ success: true, data: demoSimulator.stop() });
});

router.post('/alert', (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: demoSimulator.triggerOverload() });
  } catch (error) {
    next(error);
  }
});

router.post('/alert/temperature', (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: demoSimulator.triggerTemperature() });
  } catch (error) {
    next(error);
  }
});

router.post('/alert/accident', (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: demoSimulator.triggerAccident() });
  } catch (error) {
    next(error);
  }
});

router.post('/alerts/clear', (req, res) => {
  res.json({ success: true, data: demoSimulator.clearAlerts() });
});

module.exports = router;
