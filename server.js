/*
 * ============================================================================
 *  IVSERS Backend - server.js
 *
 *  IVSERS - Integrated Vehicle Safety and Emergency Response System
 *  Zambia Air Services Training Institute - School of Aircraft Maintenance
 *  Engineering. Author: Abraham Chileshe. Supervisor: Eng. F. Kafwani.
 *
 *  Boot sequence: load env -> connect MongoDB -> start HTTP server ->
 *  attach Socket.IO -> connect MQTT subscriber -> ready.
 * ============================================================================
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { connectDB } = require('./config/db');
const logger = require('./utils/logger');
const socketService = require('./services/socketService');
const mqttService = require('./services/mqttService');
const { generalLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const busRoutes = require('./routes/buses');
const alertRoutes = require('./routes/alerts');
const telemetryRoutes = require('./routes/telemetry');
const demoRoutes = require('./routes/demo');
const userRoutes = require('./routes/users');

const app = express();
const httpServer = http.createServer(app);
const corsOrigins = (process.env.CORS_ORIGIN || '*').split(',').map((o) => o.trim());
const liveServerOrigins = ['http://localhost:5500', 'http://127.0.0.1:5500'];

app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: [...new Set([...corsOrigins, ...liveServerOrigins])],
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api', generalLimiter);

// ---------------------------------------------------------------------------
// Health check (used by Docker HEALTHCHECK and load balancers)
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'OK',
    uptimeSeconds: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/buses', busRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/users', userRoutes);

app.use(notFound);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await connectDB();
    socketService.init(httpServer);
    mqttService.connect();

    httpServer.listen(PORT, () => {
      logger.info('========================================');
      logger.info('IVSERS backend running');
      logger.info(`HTTP:      http://localhost:${PORT}`);
      logger.info(`WebSocket: ws://localhost:${PORT}`);
      logger.info(`Env:       ${process.env.NODE_ENV || 'development'}`);
      logger.info('========================================');
    });
  } catch (err) {
    logger.error(`Fatal startup error: ${err.stack || err.message}`);
    process.exit(1);
  }
}

start();

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  logger.info(`${signal} received - shutting down gracefully`);
  mqttService.disconnect();
  httpServer.close(() => {
    const mongoose = require('mongoose');
    mongoose.connection.close(false).then(() => {
      logger.info('Shutdown complete');
      process.exit(0);
    });
  });

  // Force-exit if graceful shutdown hangs.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, httpServer };
