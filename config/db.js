/*
 * ============================================================================
 *  IVSERS Backend - config/db.js
 *
 *  Establishes the Mongoose connection with a bounded retry loop, so a
 *  backend container that starts before MongoDB is ready (a common race in
 *  `docker-compose up`) recovers on its own instead of crash-looping.
 * ============================================================================
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  mongoose.set('strictQuery', true);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 8000,
      });
      logger.info(`MongoDB connected (${mongoose.connection.host}/${mongoose.connection.name})`);
      break;
    } catch (err) {
      logger.error(`MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt === MAX_RETRIES) {
        throw new Error(`Could not connect to MongoDB after ${MAX_RETRIES} attempts: ${err.message}`);
      }
      await sleep(RETRY_DELAY_MS);
    }
  }

  mongoose.connection.on('error', (err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
}

module.exports = { connectDB };
