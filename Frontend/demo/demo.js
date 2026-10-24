(function () {
  const DEMO_SESSION_KEY = 'ivsers_demo_session';
  const REFRESH_INTERVAL_MS = 3000;
  const config = window.IVSERS_CONFIG || { apiBase: '' };
  const elements = {
    state: document.getElementById('simulation-state'),
    start: document.getElementById('start-simulation'),
    stop: document.getElementById('stop-simulation'),
    overload: document.getElementById('trigger-overload'),
    temperature: document.getElementById('trigger-temperature'),
    accident: document.getElementById('trigger-accident'),
    clear: document.getElementById('clear-alerts'),
    exit: document.getElementById('exit-demo'),
    error: document.getElementById('demo-error'),
    fleetCount: document.getElementById('fleet-count'),
    fleetBody: document.getElementById('vehicle-list'),
    alertCount: document.getElementById('alert-count'),
    noAlerts: document.getElementById('no-alerts'),
    alertFeed: document.getElementById('alert-feed'),
    persona: document.getElementById('demo-persona'),
    personaDescription: document.getElementById('persona-description'),
    map: document.getElementById('fleet-map'),
  };
  const markers = new Map();
  let map = null;
  let mapHasFitted = false;
  let simulationActive = false;

  if (sessionStorage.getItem(DEMO_SESSION_KEY) !== 'active') {
    window.location.replace('../demo-login.html');
    return;
  }

  initMap();
  elements.start.addEventListener('click', () => runAction('/start'));
  elements.stop.addEventListener('click', () => runAction('/stop'));
  elements.overload.addEventListener('click', () => runAction('/alert'));
  elements.temperature.addEventListener('click', () => runAction('/alert/temperature'));
  elements.accident.addEventListener('click', () => runAction('/alert/accident'));
  elements.clear.addEventListener('click', () => runAction('/alerts/clear'));
  elements.persona.addEventListener('change', renderPersona);
  elements.exit.addEventListener('click', () => {
    sessionStorage.removeItem(DEMO_SESSION_KEY);
    window.location.href = '../login.html';
  });

  refresh().catch(showError);
  renderPersona();
  window.setInterval(() => refresh().catch(showError), REFRESH_INTERVAL_MS);

  function initMap() {
    if (typeof L === 'undefined') {
      elements.map.textContent = 'Map tiles are unavailable. The table still shows each simulated town and telemetry.';
      return;
    }

    map = L.map(elements.map, { scrollWheelZoom: false }).setView([-14.2, 28.3], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
  }

  async function request(path, options = {}) {
    const response = await fetch(`${config.apiBase}/api/demo${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Demo server returned an invalid response (HTTP ${response.status}).`);
    }
    if (!response.ok || !body || !body.success) {
      throw new Error((body && body.error) || `Demo request failed (HTTP ${response.status})`);
    }
    return body.data;
  }

  function renderPersona() {
    const descriptions = {
      super_admin: 'System-wide oversight preview. This persona is simulated and has no administrative privileges.',
      fleet_manager: 'Fleet operations preview: vehicle readings and generated warnings.',
      driver: 'Assigned-vehicle preview. The simulated fleet is shown; no real driver assignment is made.',
      bus_owner: 'Owned-vehicle preview. The simulated fleet is shown; no real ownership is assigned.',
      police: 'Incident response preview with simulated location and warning details.',
      hospital: 'Incident response preview with simulated location and warning details.',
      rtsa: 'Vehicle oversight preview with simulated vehicle status and location.',
      fire_brigade: 'Hazard response preview with simulated vehicle status and warning details.',
    };
    elements.personaDescription.textContent = descriptions[elements.persona.value];
  }

  async function refresh() {
    render(await request(''));
    elements.error.hidden = true;
  }

  async function runAction(path) {
    setControlsDisabled(true);
    try {
      render(await request(path, { method: 'POST' }));
      elements.error.hidden = true;
    } catch (error) {
      showError(error);
    } finally {
      setControlsDisabled(false);
    }
  }

  function render(data) {
    const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
    const alerts = Array.isArray(data.alerts) ? data.alerts : [];
    simulationActive = Boolean(data.simulationActive);
    renderSimulationState();
    renderFleet(vehicles);
    renderMap(vehicles);
    renderAlerts(alerts);
  }

  function renderSimulationState() {
    elements.state.textContent = simulationActive ? 'Running' : 'Stopped';
    elements.state.classList.toggle('badge--safe', simulationActive);
    elements.state.classList.toggle('badge--neutral', !simulationActive);
    elements.start.disabled = simulationActive;
    elements.stop.disabled = !simulationActive;
    elements.overload.disabled = !simulationActive;
    elements.temperature.disabled = !simulationActive;
    elements.accident.disabled = !simulationActive;
    elements.clear.disabled = false;
  }

  function renderFleet(vehicles) {
    elements.fleetCount.textContent = `${vehicles.length} simulated buses`;
    elements.fleetBody.replaceChildren();

    vehicles.forEach((vehicle) => {
      const row = document.createElement('tr');
      row.className = `fleet-row status-row-${vehicle.status.toLowerCase()}`;
      row.tabIndex = 0;
      row.setAttribute('aria-label', `${vehicle.vehicleId}, ${vehicle.town}, ${statusLabel(vehicle.status)}`);
      row.addEventListener('click', () => focusVehicle(vehicle));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          focusVehicle(vehicle);
        }
      });

      const vehicleCell = document.createElement('td');
      vehicleCell.innerHTML = `<span class="vehicle-primary">${escapeHtml(vehicle.vehicleId)}</span><span class="vehicle-town">${escapeHtml(vehicle.town)} · SIMULATED DATA</span>`;
      row.appendChild(vehicleCell);
      appendCell(row, vehicle.route);

      const statusCell = document.createElement('td');
      const status = document.createElement('span');
      status.className = `status-chip status-${vehicle.status.toLowerCase()}`;
      status.textContent = statusLabel(vehicle.status);
      statusCell.appendChild(status);
      row.appendChild(statusCell);

      appendCell(row, `${Math.round(vehicle.speedKph)} km/h`);
      const loadCell = document.createElement('td');
      loadCell.textContent = `${Math.round(vehicle.loadKg)} / ${Math.round(vehicle.maxLoadKg)} kg`;
      if (vehicle.loadKg > vehicle.maxLoadKg) loadCell.classList.add('reading-warning');
      row.appendChild(loadCell);

      const tempCell = document.createElement('td');
      tempCell.textContent = `${Math.round(vehicle.engineTempC)} °C`;
      if (vehicle.engineTempC >= 100) tempCell.classList.add('reading-critical');
      row.appendChild(tempCell);

      const sourceCell = document.createElement('td');
      sourceCell.className = 'source-simulated';
      sourceCell.textContent = 'SIMULATED DATA';
      row.appendChild(sourceCell);
      elements.fleetBody.appendChild(row);
    });
  }

  function appendCell(row, text) {
    const cell = document.createElement('td');
    cell.textContent = text;
    row.appendChild(cell);
  }

  function renderMap(vehicles) {
    if (!map) return;
    const activeIds = new Set();

    vehicles.forEach((vehicle) => {
      activeIds.add(vehicle.vehicleId);
      const color = statusColor(vehicle.status);
      const markerIcon = L.divIcon({
        className: 'simulated-marker',
        html: `<span class="simulated-marker-dot" style="--marker-color:${color}"></span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const popup = `<strong>${escapeHtml(vehicle.vehicleId)}</strong><br>${escapeHtml(vehicle.town)} · SIMULATED DATA<br>${escapeHtml(vehicle.route)}<br>GPS: ${vehicle.latitude.toFixed(4)}, ${vehicle.longitude.toFixed(4)}<br>Status: ${escapeHtml(statusLabel(vehicle.status))}<br>Speed: ${Math.round(vehicle.speedKph)} km/h · Load: ${Math.round(vehicle.loadKg)} / ${Math.round(vehicle.maxLoadKg)} kg<br>Engine: ${Math.round(vehicle.engineTempC)} °C`;
      let marker = markers.get(vehicle.vehicleId);
      if (marker) {
        marker.setLatLng([vehicle.latitude, vehicle.longitude]);
        marker.setIcon(markerIcon);
        marker.setPopupContent(popup);
      } else {
        marker = L.marker([vehicle.latitude, vehicle.longitude], {
          icon: markerIcon,
          title: `${vehicle.vehicleId} · ${vehicle.town} · SIMULATED DATA`,
        }).addTo(map).bindPopup(popup);
        markers.set(vehicle.vehicleId, marker);
      }
    });

    markers.forEach((marker, vehicleId) => {
      if (!activeIds.has(vehicleId)) {
        map.removeLayer(marker);
        markers.delete(vehicleId);
      }
    });

    if (!mapHasFitted && markers.size > 0) {
      map.fitBounds(L.featureGroup(Array.from(markers.values())).getBounds().pad(0.08));
      mapHasFitted = true;
    }
  }

  function focusVehicle(vehicle) {
    const marker = markers.get(vehicle.vehicleId);
    if (!marker || !map) return;
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 7));
    marker.openPopup();
  }

  function renderAlerts(alerts) {
    elements.alertCount.textContent = String(alerts.length);
    elements.noAlerts.hidden = alerts.length > 0;
    elements.alertFeed.replaceChildren(...alerts.map(createAlert));
  }

  function createAlert(alert) {
    const item = document.createElement('li');
    item.className = `severity-${String(alert.severity).toLowerCase()}`;
    const title = document.createElement('strong');
    const details = document.createElement('span');
    const source = document.createElement('span');
    title.textContent = `${alert.type} · ${alert.vehicleId} · ${alert.severity}`;
    details.textContent = `${alert.details} (${new Date(alert.createdAt).toLocaleTimeString()})`;
    source.className = 'source-simulated';
    source.textContent = 'SIMULATED DATA';
    item.append(title, details, source);
    return item;
  }

  function setControlsDisabled(disabled) {
    elements.start.disabled = disabled || simulationActive;
    elements.stop.disabled = disabled || !simulationActive;
    elements.overload.disabled = disabled || !simulationActive;
    elements.temperature.disabled = disabled || !simulationActive;
    elements.accident.disabled = disabled || !simulationActive;
    elements.clear.disabled = disabled;
  }

  function statusLabel(status) {
    const labels = {
      MOVING: 'Operating normally',
      STOPPED: 'Stopped',
      WARNING: 'Warning',
      CRITICAL: 'Critical',
      OFFLINE: 'Offline',
      ACCIDENT: 'Accident',
    };
    return labels[status] || status;
  }

  function statusColor(status) {
    if (status === 'WARNING') return '#f5a623';
    if (status === 'CRITICAL' || status === 'ACCIDENT') return '#e4483a';
    if (status === 'OFFLINE' || status === 'STOPPED') return '#69758a';
    return '#35c48b';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character]));
  }

  function showError(error) {
    elements.error.textContent = error.message || 'Could not connect to the demo simulation API.';
    elements.error.hidden = false;
  }
})();
