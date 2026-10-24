const express = require('express');
const http = require('http');

jest.mock('../models/Bus', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));
jest.mock('../models/Alert', () => ({
  create: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

const demoSimulator = require('../services/demoSimulator');
const demoRoutes = require('../routes/demo');
const app = express();

app.use(express.json());
app.use('/api/demo', demoRoutes);
app.use((error, req, res, next) => {
  res.status(error.status || 500).json({ success: false, error: error.message });
});

let server;
let baseUrl;

function call(path, method = 'GET') {
  return fetch(`${baseUrl}/api/demo${path}`, { method }).then(async (response) => ({
    status: response.status,
    body: await response.json(),
  }));
}

describe('demo simulation API', () => {
  beforeEach((done) => {
    demoSimulator.reset();
    server = http.createServer(app).listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterEach((done) => {
    demoSimulator.reset();
    server.close(done);
  });

  afterAll(() => {
    demoSimulator.reset();
  });

  test('starts the seven-plus-bus Zambia fleet without touching real models', async () => {
    const response = await call('/start', 'POST');

    expect(response.status).toBe(200);
    expect(response.body.data.simulationActive).toBe(true);
    expect(response.body.data.vehicles.length).toBeGreaterThanOrEqual(7);
    expect(response.body.data.vehicle.vehicleId).toBe('DEMO-ONLY-01');
    expect(response.body.data.vehicle.source).toBe('SIMULATED');
    expect(response.body.data.vehicle.loadKg).toBeGreaterThan(0);
    expect(response.body.data.vehicle.engineTempC).toBeGreaterThan(0);
    expect(response.body.data.vehicles.every((vehicle) => vehicle.source === 'SIMULATED')).toBe(true);
    expect(new Set(response.body.data.vehicles.map((vehicle) => vehicle.vehicleId)).size)
      .toBe(response.body.data.vehicles.length);
    expect(Array.from(new Set(response.body.data.vehicles.map((vehicle) => vehicle.town)))).toEqual(
      expect.arrayContaining(['Lusaka', 'Ndola', 'Kitwe', 'Livingstone', 'Chipata', 'Solwezi', 'Kabwe'])
    );
    expect(Array.from(new Set(response.body.data.vehicles.map((vehicle) => vehicle.status)))).toEqual(
      expect.arrayContaining(['MOVING', 'WARNING', 'CRITICAL', 'OFFLINE', 'ACCIDENT'])
    );
    expect(require('../models/Bus').create).not.toHaveBeenCalled();
    expect(require('../models/Alert').create).not.toHaveBeenCalled();
  });

  test('requires a running simulation before creating a warning', async () => {
    const response = await call('/alert', 'POST');

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toMatch(/start the simulation/i);
  });

  test('creates a clearly simulated overload alert in the demo state only', async () => {
    await call('/start', 'POST');
    const response = await call('/alert', 'POST');

    expect(response.status).toBe(201);
    expect(response.body.data.vehicle.status).toBe('WARNING');
    expect(response.body.data.vehicle.loadKg).toBeGreaterThan(
      response.body.data.vehicle.maxLoadKg
    );
    expect(response.body.data.alerts[0]).toMatchObject({
      vehicleId: 'DEMO-ONLY-01',
      source: 'SIMULATED',
      type: 'OVERLOAD',
    });
    expect(require('../models/Bus').findOne).not.toHaveBeenCalled();
    expect(require('../models/Alert').create).not.toHaveBeenCalled();
  });

  test('clears simulated alerts and restores triggered vehicle readings', async () => {
    await call('/start', 'POST');
    await call('/alert', 'POST');
    const response = await call('/alerts/clear', 'POST');

    expect(response.status).toBe(200);
    expect(response.body.data.alerts).toHaveLength(0);
    expect(response.body.data.vehicles.find((vehicle) => vehicle.vehicleId === 'DEMO-ONLY-01'))
      .toMatchObject({ source: 'SIMULATED', status: 'MOVING', loadKg: 2140 });
    expect(require('../models/Bus').create).not.toHaveBeenCalled();
    expect(require('../models/Alert').create).not.toHaveBeenCalled();
  });

  test('stops the simulation and keeps demo data separate', async () => {
    await call('/start', 'POST');
    const response = await call('/stop', 'POST');

    expect(response.status).toBe(200);
    expect(response.body.data.simulationActive).toBe(false);
    expect(response.body.data.vehicle.status).toBe('STOPPED');
    expect(response.body.data.vehicle.source).toBe('SIMULATED');
  });

  test('updates generated readings on the simulation interval', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      demoSimulator.start();
      const firstUpdate = demoSimulator.getState().vehicle.updatedAt;

      jest.advanceTimersByTime(demoSimulator.UPDATE_INTERVAL_MS);

      expect(demoSimulator.getState().vehicle.updatedAt).not.toBe(firstUpdate);
    } finally {
      demoSimulator.reset();
      jest.useRealTimers();
    }
  });
});
