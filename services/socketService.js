/*
 * ============================================================================
 *  IVSERS Backend - services/socketService.js
 *
 *  Wraps Socket.IO so the rest of the backend can broadcast live events
 *  (new alerts, telemetry updates, bus status changes) without importing
 *  Socket.IO directly everywhere. Dashboard clients authenticate with the
 *  same JWT used for the REST API, passed as a handshake auth token, and
 *  are placed in role-appropriate rooms so future features (e.g. per-fleet
 *  or per-depot scoping) can target broadcasts without a protocol change.
 * ============================================================================
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const User = require('../models/User');
const Bus = require('../models/Bus');

let io = null;

function init(httpServer) {
  const allowedOrigins = (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((o) => o.trim());
  allowedOrigins.push('http://localhost:5500', 'http://127.0.0.1:5500');

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      socket.user = null;
      return next();
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      logger.warn(`Socket auth token rejected: ${err.message}`);
      socket.user = null;
      return next();
    }
    try {
      const user = await User.findById(decoded.userId);
      socket.user = user && user.status === 'active' ? user : null;
      socket.tokenExpiresAt = decoded.exp ? decoded.exp * 1000 : null;
    } catch (err) {
      return next(err);
    }
    next();
  });

  io.on('connection', (socket) => {
    if (!socket.user) return;

    socket.join(accountRoom(socket.user._id));
    if (socket.user.organization) {
      socket.join(userDataRoom(socket.user._id, socket.user.organization));
    }
    if (socket.user.role === 'super_admin') {
      socket.join('role:super_admin');
    } else if (socket.user.role === 'fleet_manager' && socket.user.organization) {
      socket.join(fleetOrganizationRoom(socket.user.organization));
    } else if (socket.user.organization
      && ['police', 'hospital', 'rtsa', 'fire_brigade'].includes(socket.user.role)) {
      socket.join(responseOrganizationRoom(socket.user.organization));
    } else if ((socket.user.role === 'driver' || socket.user.role === 'bus_owner')
      && socket.user.organization) {
      Bus.find({
        [socket.user.role === 'driver' ? 'driver' : 'owner']: socket.user._id,
        organization: socket.user.organization,
      })
        .select('_id')
        .lean()
        .then((buses) => buses.forEach((bus) => socket.join(vehicleRoom(bus._id))))
        .catch((err) => logger.error(`Socket vehicle-room lookup failed for ${socket.user._id}: ${err.message}`));
    }
    const expiresIn = socket.tokenExpiresAt - Date.now();
    const expiryTimer = Number.isFinite(expiresIn) && expiresIn > 0
      ? setTimeout(() => socket.disconnect(true), expiresIn)
      : null;

    logger.info(`Socket connected: ${socket.id} (role=${socket.user.role})`);

    socket.on('disconnect', (reason) => {
      if (expiryTimer) clearTimeout(expiryTimer);
      logger.info(`Socket disconnected: ${socket.id} (${reason})`);
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.IO has not been initialized - call init(httpServer) first');
  }
  return io;
}

function broadcastAlert(alert) {
  if (!io) return;
  const rooms = ['role:super_admin'];
  if (alert.organization) {
    rooms.push(fleetOrganizationRoom(alert.organization), responseOrganizationRoom(alert.organization));
  }
  const busId = alert.bus && (alert.bus._id || alert.bus);
  if (!busId) {
    io.to(rooms).emit('new_alert', alert);
    return;
  }
  Bus.findById(busId)
    .select('driver owner organization')
    .lean()
    .then((bus) => {
      rooms.push(vehicleRoom(busId));
      if (bus && bus.organization && bus.driver) {
        rooms.push(userDataRoom(bus.driver, bus.organization));
      }
      if (bus && bus.organization && bus.owner) {
        rooms.push(userDataRoom(bus.owner, bus.organization));
      }
      io.to(rooms.filter(Boolean)).emit('new_alert', alert);
    })
    .catch((err) => logger.error(`Alert socket routing failed for bus ${busId}: ${err.message}`));
}

function broadcastTelemetry(vehicleId, payload, bus) {
  if (!io) return;
  const rooms = ['role:super_admin', vehicleRoom(bus && bus._id)];
  if (bus && bus.organization) rooms.push(fleetOrganizationRoom(bus.organization));
  if (bus && bus.organization && bus.driver) {
    rooms.push(userDataRoom(bus.driver._id || bus.driver, bus.organization));
  }
  if (bus && bus.organization && bus.owner) {
    rooms.push(userDataRoom(bus.owner._id || bus.owner, bus.organization));
  }
  io.to(rooms.filter(Boolean)).emit('telemetry_update', { vehicleId, ...payload });
}

function broadcastBusUpdate(bus) {
  if (!io || !bus) return;
  const rooms = ['role:super_admin', vehicleRoom(bus._id)];
  if (bus.organization) rooms.push(fleetOrganizationRoom(bus.organization));
  if (bus.organization && bus.driver) {
    rooms.push(userDataRoom(bus.driver._id || bus.driver, bus.organization));
  }
  if (bus.organization && bus.owner) {
    rooms.push(userDataRoom(bus.owner._id || bus.owner, bus.organization));
  }
  io.to(rooms.filter(Boolean)).emit('bus_update', bus);
  if (bus.organization) {
    io.to(responseOrganizationRoom(bus.organization)).emit('bus_update', {
      _id: bus._id,
      vehicleId: bus.vehicleId,
      registrationNumber: bus.registrationNumber,
      make: bus.make,
      model: bus.model,
      route: bus.route,
      status: bus.status,
      organization: bus.organization,
      hardware: {
        gps: bus.hardware && bus.hardware.gps,
        lastHeartbeat: bus.hardware && bus.hardware.lastHeartbeat,
        hazardState: bus.hardware && bus.hardware.hazardState,
      },
    });
  }
}

function fleetOrganizationRoom(organization) {
  return `fleet:${encodeURIComponent(String(organization || '').trim())}`;
}

function responseOrganizationRoom(organization) {
  return `response:${encodeURIComponent(String(organization || '').trim())}`;
}

function vehicleRoom(vehicleId) {
  return vehicleId ? `vehicle:${vehicleId}` : null;
}

function userDataRoom(userId, organization) {
  return `user:${userId}:${encodeURIComponent(String(organization).trim())}`;
}

function accountRoom(userId) {
  return `account:${userId}`;
}

function disconnectUser(userId) {
  if (io) io.in(accountRoom(userId)).disconnectSockets(true);
}

module.exports = {
  init,
  getIO,
  broadcastAlert,
  broadcastTelemetry,
  broadcastBusUpdate,
  disconnectUser,
};
