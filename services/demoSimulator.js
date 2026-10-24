/*
 * ============================================================================
 *  IVSERS Backend - services/demoSimulator.js
 *
 *  In-memory vehicle simulation for demonstrations. This service is
 *  deliberately isolated from MongoDB models and the real-device ingest path.
 * ============================================================================
 */

const UPDATE_INTERVAL_MS = 3000;
const BASE_FLEET = [
  { vehicleId: 'DEMO-ONLY-01', town: 'Lusaka', route: 'Lusaka Central Loop', latitude: -15.4167, longitude: 28.2833, status: 'MOVING', speedKph: 38, loadKg: 2140, maxLoadKg: 3500, engineTempC: 79, accelG: 0.2 },
  { vehicleId: 'DEMO-ZM-002', town: 'Ndola', route: 'Ndola–Kitwe Service', latitude: -12.9587, longitude: 28.6366, status: 'WARNING', speedKph: 24, loadKg: 3980, maxLoadKg: 3500, engineTempC: 84, accelG: 0.3 },
  { vehicleId: 'DEMO-ZM-003', town: 'Kitwe', route: 'Kitwe Town Route', latitude: -12.8024, longitude: 28.2132, status: 'CRITICAL', speedKph: 17, loadKg: 2420, maxLoadKg: 3500, engineTempC: 112, accelG: 0.4 },
  { vehicleId: 'DEMO-ZM-004', town: 'Livingstone', route: 'Livingstone–Mosi-oa-Tunya', latitude: -17.8419, longitude: 25.8543, status: 'OFFLINE', speedKph: 0, loadKg: 1860, maxLoadKg: 3500, engineTempC: 77, accelG: 0.1 },
  { vehicleId: 'DEMO-ZM-005', town: 'Chipata', route: 'Chipata East Route', latitude: -13.6309, longitude: 32.646, status: 'ACCIDENT', speedKph: 0, loadKg: 2710, maxLoadKg: 3500, engineTempC: 82, accelG: 3.4 },
  { vehicleId: 'DEMO-ZM-006', town: 'Solwezi', route: 'Solwezi–Kansanshi', latitude: -12.1833, longitude: 26.4, status: 'MOVING', speedKph: 42, loadKg: 2310, maxLoadKg: 3500, engineTempC: 81, accelG: 0.2 },
  { vehicleId: 'DEMO-ZM-007', town: 'Kabwe', route: 'Kabwe Central Route', latitude: -14.4469, longitude: 28.4464, status: 'MOVING', speedKph: 31, loadKg: 1980, maxLoadKg: 3500, engineTempC: 78, accelG: 0.2 },
  { vehicleId: 'DEMO-ZM-008', town: 'Choma', route: 'Choma–Kalomo Service', latitude: -16.8089, longitude: 26.9875, status: 'MOVING', speedKph: 35, loadKg: 2070, maxLoadKg: 3500, engineTempC: 80, accelG: 0.2 },
];

let timer = null;
let tickCount = 0;
let alertCount = 0;

function createFleet() {
  const updatedAt = new Date().toISOString();
  return BASE_FLEET.map((vehicle) => ({ ...vehicle, source: 'SIMULATED', updatedAt }));
}

function createInitialAlerts() {
  const now = Date.now();
  return [
    { vehicleId: 'DEMO-ZM-002', type: 'OVERLOAD', severity: 'HIGH', details: 'Simulated load is above the 3500 kg limit.', createdAt: new Date(now - 90000).toISOString() },
    { vehicleId: 'DEMO-ZM-003', type: 'HIGH_TEMPERATURE', severity: 'CRITICAL', details: 'Simulated engine temperature is 112 °C.', createdAt: new Date(now - 60000).toISOString() },
    { vehicleId: 'DEMO-ZM-005', type: 'ACCIDENT', severity: 'CRITICAL', details: 'Simulated impact detected near Chipata.', createdAt: new Date(now - 30000).toISOString() },
  ].map((alert, index) => ({
    ...alert,
    id: `SIMULATED-ALERT-SEED-${index + 1}`,
    source: 'SIMULATED',
    status: 'pending',
  }));
}

const state = {
  simulationActive: false,
  vehicles: createFleet(),
  alerts: createInitialAlerts(),
};

function snapshot() {
  const result = JSON.parse(JSON.stringify(state));
  // Keep the original single-vehicle field for older clients while the demo UI uses vehicles.
  result.vehicle = result.vehicles.find((vehicle) => vehicle.vehicleId === 'DEMO-ONLY-01');
  return result;
}

function updateVehicle(vehicleId, changes) {
  const index = state.vehicles.findIndex((vehicle) => vehicle.vehicleId === vehicleId);
  if (index < 0) return null;
  state.vehicles[index] = { ...state.vehicles[index], ...changes, updatedAt: new Date().toISOString() };
  return state.vehicles[index];
}

function tick() {
  if (!state.simulationActive) return;
  tickCount += 1;
  const now = new Date().toISOString();

  state.vehicles = state.vehicles.map((vehicle, index) => {
    if (vehicle.status !== 'MOVING') return vehicle;
    const drift = Math.sin((tickCount + index) / 3) * 0.012;
    return {
      ...vehicle,
      latitude: BASE_FLEET[index].latitude + drift,
      longitude: BASE_FLEET[index].longitude + Math.cos((tickCount + index) / 3) * 0.014,
      speedKph: 25 + ((tickCount + index * 3) % 6) * 4,
      loadKg: 1750 + ((tickCount * 37 + index * 173) % 1200),
      engineTempC: 74 + ((tickCount + index * 2) % 15),
      updatedAt: now,
    };
  });
}

function start() {
  if (!timer) {
    state.simulationActive = true;
    state.vehicles = state.vehicles.map((vehicle) => (
      vehicle.status === 'STOPPED' ? { ...vehicle, status: 'MOVING' } : vehicle
    ));
    tick();
    timer = setInterval(tick, UPDATE_INTERVAL_MS);
  }
  return snapshot();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  state.simulationActive = false;
  state.vehicles = state.vehicles.map((vehicle) => (
    vehicle.status === 'MOVING'
      ? { ...vehicle, status: 'STOPPED', speedKph: 0, updatedAt: new Date().toISOString() }
      : vehicle
  ));
  return snapshot();
}

function triggerScenario(scenario) {
  if (!state.simulationActive) {
    const error = new Error('Start the simulation before triggering an alert.');
    error.status = 409;
    throw error;
  }

  const scenarios = {
    overload: {
      vehicleId: 'DEMO-ONLY-01', status: 'WARNING', type: 'OVERLOAD', severity: 'HIGH',
      loadKg: 4120, engineTempC: 88, speedKph: 16,
      details: 'Simulated load 4120 kg exceeds the 3500 kg limit.',
    },
    temperature: {
      vehicleId: 'DEMO-ZM-006', status: 'CRITICAL', type: 'HIGH_TEMPERATURE', severity: 'CRITICAL',
      loadKg: 2310, engineTempC: 116, speedKph: 12,
      details: 'Simulated engine temperature reached 116 °C near Solwezi.',
    },
    accident: {
      vehicleId: 'DEMO-ZM-007', status: 'ACCIDENT', type: 'ACCIDENT', severity: 'CRITICAL',
      loadKg: 1980, engineTempC: 78, speedKph: 0, accelG: 3.6,
      details: 'Simulated impact detected near Kabwe; emergency response may be required.',
    },
  };
  const event = scenarios[scenario];
  if (!event) throw new Error('Unknown demo alert scenario.');

  const vehicle = updateVehicle(event.vehicleId, event);
  alertCount += 1;
  state.alerts.unshift({
    id: `SIMULATED-ALERT-${alertCount}`,
    vehicleId: event.vehicleId,
    source: 'SIMULATED',
    type: event.type,
    severity: event.severity,
    details: event.details,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  return snapshot();
}

function triggerOverload() {
  return triggerScenario('overload');
}

function triggerTemperature() {
  return triggerScenario('temperature');
}

function triggerAccident() {
  return triggerScenario('accident');
}

function clearAlerts() {
  state.alerts = [];
  state.vehicles = state.vehicles.map((vehicle) => {
    if (!['WARNING', 'CRITICAL', 'ACCIDENT'].includes(vehicle.status)) return vehicle;
    const baseline = BASE_FLEET.find((entry) => entry.vehicleId === vehicle.vehicleId);
    const wasInMotion = state.simulationActive;
    return {
      ...vehicle,
      status: wasInMotion ? 'MOVING' : 'STOPPED',
      speedKph: wasInMotion ? 28 : 0,
      loadKg: baseline.loadKg < baseline.maxLoadKg ? baseline.loadKg : 2500,
      engineTempC: baseline.engineTempC < 100 ? baseline.engineTempC : 80,
      accelG: 0.2,
      updatedAt: new Date().toISOString(),
    };
  });
  return snapshot();
}

function getState() {
  return snapshot();
}

function reset() {
  if (timer) clearInterval(timer);
  timer = null;
  tickCount = 0;
  alertCount = 0;
  state.simulationActive = false;
  state.vehicles = createFleet();
  state.alerts = createInitialAlerts();
  return snapshot();
}

module.exports = {
  getState,
  start,
  stop,
  triggerOverload,
  triggerTemperature,
  triggerAccident,
  clearAlerts,
  reset,
  UPDATE_INTERVAL_MS,
};
