/*
 * ============================================================================
 *  IVSERS Frontend - dashboard/dashboard.js
 *
 *  Loads the initial fleet/alert snapshot over REST, then keeps the UI live
 *  via Socket.IO ('new_alert', 'bus_update', 'telemetry_update' - emitted
 *  by Backend/services/socketService.js). No build step / bundler: plain
 *  browser script, loaded after script.js (IVSERSAuth / IVSERSApi) and the
 *  Socket.IO + Leaflet CDN includes declared in dashboard.html.
 * ============================================================================
 */

(function () {
  IVSERSAuth.requireAuth();

  const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // no heartbeat in 2 min = offline
  const DEFAULT_MAP_CENTER = [-15.3875, 28.3228]; // Lusaka, Zambia
  const HAZARD_SEGMENTS = [
    { key: 'fireEngine', label: 'F' },
    { key: 'overload', label: 'O' },
    { key: 'accident', label: 'A' },
    { key: 'panic', label: 'P' },
  ];

  const state = {
    buses: new Map(),      // vehicleId -> bus document
    alerts: [],             // most-recent-first
    selectedVehicleId: null,
    map: null,
    markers: new Map(),    // vehicleId -> L.Marker
    socket: null,
    audioCtx: null,
  };

  const el = {
    connStatus: document.getElementById('conn-status'),
    connLabel: document.getElementById('conn-label'),
    userName: document.getElementById('user-name'),
    userRole: document.getElementById('user-role'),
    logoutBtn: document.getElementById('logout-btn'),
    annunciator: document.getElementById('annunciator-strip'),
    fleetBody: document.getElementById('fleet-table-body'),
    fleetCount: document.getElementById('fleet-count'),
    alertFeed: document.getElementById('alert-feed'),
    alertCount: document.getElementById('alert-count'),
    telemetryBody: document.getElementById('telemetry-body'),
    telemetryVehicleId: document.getElementById('telemetry-vehicle-id'),
    toastRegion: document.getElementById('toast-region'),
    resolveDialog: document.getElementById('resolve-dialog'),
    resolveForm: document.getElementById('resolve-form'),
    resolveCancel: document.getElementById('resolve-cancel'),
    resolutionNotes: document.getElementById('resolution-notes'),
    falseAlarmCheckbox: document.getElementById('false-alarm-checkbox'),
    roleSummary: document.getElementById('role-summary'),
    fleetHeading: document.getElementById('fleet-heading'),
    loadColumn: document.getElementById('load-column'),
    telemetryPanel: document.getElementById('telemetry-panel'),
    vehicleRegistration: document.getElementById('vehicle-registration'),
    vehicleForm: document.getElementById('vehicle-form'),
    vehicleFormMessage: document.getElementById('vehicle-form-message'),
    vehicleEditCancel: document.getElementById('vehicle-edit-cancel'),
    vehicleActionsHeading: document.getElementById('vehicle-actions-heading'),
    accountManagement: document.getElementById('account-management'),
    accountForm: document.getElementById('account-form'),
    accountFormMessage: document.getElementById('account-form-message'),
    accountTableBody: document.getElementById('account-table-body'),
    accountEditDialog: document.getElementById('account-edit-dialog'),
    accountEditForm: document.getElementById('account-edit-form'),
    accountEditCancel: document.getElementById('account-edit-cancel'),
    accountEditMessage: document.getElementById('account-edit-message'),
  };

  let alertBeingResolved = null;
  let vehicleBeingEdited = null;
  let accountBeingEdited = null;
  const currentUser = IVSERSAuth.getUser() || {};
  const isAdmin = currentUser.role === 'super_admin';
  const canManageFleet = isAdmin || currentUser.role === 'fleet_manager';

  init();

  async function init() {
    renderUserBar();
    configureRoleDashboard();
    initMap();
    wireStaticControls();
    wireManagementForms();

    try {
      await Promise.all([loadBuses(), loadAlerts()]);
    } catch (err) {
      showToast(err.message || 'Failed to load initial fleet data', 'critical');
    }

    connectSocket();
    if (isAdmin) loadAccounts();
    if (canManageFleet) loadAssignableOptions();
  }

  // ------------------------------------------------------------------
  // User bar
  // ------------------------------------------------------------------
  function renderUserBar() {
    const user = currentUser;
    el.userName.textContent = user ? user.name : 'Unknown';
    el.userRole.textContent = user ? roleLabel(user.role) : '-';
    el.logoutBtn.addEventListener('click', () => IVSERSAuth.logout());
  }

  function configureRoleDashboard() {
    const descriptions = {
      super_admin: 'System-wide administration: manage accounts and oversee registered fleets.',
      fleet_manager: 'Fleet operations: manage vehicles, assignments, live telemetry, and fleet alerts.',
      driver: 'Driver view: only vehicles assigned to your account and their relevant alerts are shown.',
      bus_owner: 'Owner view: only vehicles registered to your account and their relevant alerts are shown.',
      police: 'Police response view: organization-scoped incidents and limited vehicle/location details.',
      hospital: 'Hospital response view: organization-scoped incidents and limited vehicle/location details.',
      rtsa: 'RTSA view: organization-scoped incidents and limited vehicle/location details.',
      fire_brigade: 'Fire brigade response view: organization-scoped incidents and limited vehicle/location details.',
    };
    el.roleSummary.textContent = descriptions[currentUser.role] || 'Your account has access to its authorized fleet records.';
    el.fleetHeading.textContent = currentUser.role === 'driver'
      ? 'Assigned vehicle'
      : currentUser.role === 'bus_owner'
        ? 'Owned vehicles'
        : ['police', 'hospital', 'rtsa', 'fire_brigade'].includes(currentUser.role)
          ? 'Organization vehicles'
          : 'Fleet';
    document.body.classList.toggle('role-compact', !canManageFleet);
    el.vehicleRegistration.hidden = !canManageFleet;
    el.accountManagement.hidden = !isAdmin;
    const limitedRole = ['police', 'hospital', 'rtsa', 'fire_brigade'].includes(currentUser.role);
    el.loadColumn.hidden = limitedRole;
    el.telemetryPanel.hidden = limitedRole;
    el.vehicleActionsHeading.hidden = !canManageFleet;
    el.vehicleForm.elements.organization.required = isAdmin;
    document.querySelectorAll('.super-admin-only').forEach((node) => {
      node.hidden = !isAdmin;
    });
    const resolveButton = el.resolveForm.querySelector('button[type="submit"]');
    resolveButton.hidden = !(isAdmin || currentUser.role === 'fleet_manager');
  }

  function roleLabel(role) {
    const labels = {
      super_admin: 'Super administrator',
      fleet_manager: 'Fleet manager',
      bus_owner: 'Bus owner',
      fire_brigade: 'Fire brigade',
      rtsa: 'RTSA',
    };
    return labels[role] || (role || '').replaceAll('_', ' ');
  }

  function wireStaticControls() {
    el.resolveCancel.addEventListener('click', () => {
      alertBeingResolved = null;
      el.resolveDialog.close();
    });

    el.resolveForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!alertBeingResolved) return;

      try {
        await IVSERSApi.resolveAlert(
          alertBeingResolved,
          el.resolutionNotes.value.trim(),
          el.falseAlarmCheckbox.checked
        );
        showToast('Alert resolved', 'ok');
      } catch (err) {
        showToast(err.message || 'Failed to resolve alert', 'critical');
      } finally {
        alertBeingResolved = null;
        el.resolutionNotes.value = '';
        el.falseAlarmCheckbox.checked = false;
        el.resolveDialog.close();
        loadAlerts();
      }
    });
  }

  function wireManagementForms() {
    el.vehicleForm.addEventListener('submit', saveVehicle);
    el.vehicleEditCancel.addEventListener('click', cancelVehicleEdit);
    el.accountForm.addEventListener('submit', saveAccount);
    el.vehicleForm.elements.organization.addEventListener('change', loadAssignableOptions);
    el.accountEditForm.addEventListener('submit', saveAccountEdit);
    el.accountEditCancel.addEventListener('click', () => el.accountEditDialog.close());
  }

  async function loadAssignableOptions() {
    if (!canManageFleet) return;
    const organization = isAdmin
      ? el.vehicleForm.elements.organization.value.trim()
      : currentUser.organization;
    if (!organization) {
      setOptions(el.vehicleForm.elements.driver, [], 'Not assigned');
      setOptions(el.vehicleForm.elements.owner, [], 'Not assigned');
      return;
    }
    try {
      const [drivers, owners] = await Promise.all([
        IVSERSApi.getAssignableAccounts('driver', organization),
        IVSERSApi.getAssignableAccounts('bus_owner', organization),
      ]);
      setOptions(el.vehicleForm.elements.driver, drivers.data || [], 'Not assigned');
      setOptions(el.vehicleForm.elements.owner, owners.data || [], 'Not assigned');
    } catch (err) {
      showToast(err.message || 'Could not load assignable staff accounts', 'critical');
    }
  }

  function setOptions(select, accounts, emptyLabel) {
    select.replaceChildren(new Option(emptyLabel, ''));
    accounts.forEach((account) => select.add(new Option(`${account.name} (${account.email})`, account._id)));
  }

  async function saveVehicle(event) {
    event.preventDefault();
    const isEditing = Boolean(vehicleBeingEdited);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const vehicle = Object.fromEntries(formData.entries());
    ['year', 'capacity', 'maxLoadKg'].forEach((field) => {
      if (vehicle[field] === '') delete vehicle[field];
      else if (vehicle[field] !== undefined) vehicle[field] = Number(vehicle[field]);
    });
    ['owner', 'driver'].forEach((field) => {
      if (!vehicle[field]) delete vehicle[field];
    });
    if (!vehicle.organization) delete vehicle.organization;

    try {
      if (vehicleBeingEdited) {
        delete vehicle.vehicleId;
        await IVSERSApi.updateBus(vehicleBeingEdited._id, vehicle);
        showFormMessage(el.vehicleFormMessage, 'Vehicle updated successfully.');
      } else {
        await IVSERSApi.createBus(vehicle);
        showFormMessage(el.vehicleFormMessage, 'Vehicle registered successfully.');
      }
      form.reset();
      resetVehicleEdit();
      await Promise.all([loadBuses(), loadAssignableOptions()]);
      showToast(isEditing ? 'Vehicle updated' : 'Vehicle registered', 'ok');
    } catch (err) {
      showFormMessage(el.vehicleFormMessage, err.message || 'Vehicle registration failed.', true);
    }
  }

  async function loadAccounts() {
    try {
      const response = await IVSERSApi.getAccounts();
      renderAccounts(response.data || []);
    } catch (err) {
      el.accountTableBody.innerHTML = '<tr><td colspan="6" class="text-faint">Could not load accounts.</td></tr>';
      showToast(err.message || 'Failed to load accounts', 'critical');
    }
  }

  function renderAccounts(accounts) {
    el.accountTableBody.replaceChildren();
    if (accounts.length === 0) {
      el.accountTableBody.innerHTML = '<tr><td colspan="6" class="text-faint">No accounts found.</td></tr>';
      return;
    }
    accounts.forEach((account) => {
      const row = document.createElement('tr');
      [account.name, account.email, account.organization || '-', roleLabel(account.role), account.status]
        .forEach((value) => {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.appendChild(cell);
        });
      const actionCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'action-buttons';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn-sm';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => openAccountEdit(account));
      actions.appendChild(edit);
      const status = document.createElement('button');
      status.type = 'button';
      status.className = 'btn-sm';
      status.textContent = account.status === 'active' ? 'Suspend' : 'Reactivate';
      status.disabled = account._id === currentUser._id;
      status.addEventListener('click', () => changeAccountStatus(
        account._id,
        account.status === 'active' ? 'suspended' : 'active'
      ));
      actions.appendChild(status);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-sm danger-btn';
      remove.textContent = 'Delete';
      remove.disabled = account._id === currentUser._id;
      remove.addEventListener('click', () => removeAccount(account));
      actions.appendChild(remove);
      actionCell.appendChild(actions);
      row.appendChild(actionCell);
      el.accountTableBody.appendChild(row);
    });
  }

  async function saveAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const account = Object.fromEntries(new FormData(form).entries());
    try {
      await IVSERSApi.createAccount(account);
      form.reset();
      showFormMessage(el.accountFormMessage, 'Account created successfully.');
      await Promise.all([loadAccounts(), loadAssignableOptions()]);
    } catch (err) {
      showFormMessage(el.accountFormMessage, err.message || 'Account creation failed.', true);
    }
  }

  async function changeAccountStatus(id, status) {
    try {
      await IVSERSApi.updateAccountStatus(id, status);
      await loadAccounts();
      showToast(`Account ${status}`, 'ok');
    } catch (err) {
      showToast(err.message || `Could not ${status} account`, 'critical');
    }
  }

  function openAccountEdit(account) {
    accountBeingEdited = account;
    const form = el.accountEditForm;
    ['name', 'email', 'phone', 'organization', 'role'].forEach((field) => {
      form.elements[field].value = account[field] || '';
    });
    const isSelf = account._id === currentUser._id;
    form.elements.organization.disabled = isSelf;
    form.elements.role.disabled = isSelf;
    showFormMessage(el.accountEditMessage, '');
    el.accountEditDialog.showModal();
  }

  async function saveAccountEdit(event) {
    event.preventDefault();
    if (!accountBeingEdited) return;
    const form = event.currentTarget;
    const editedAccount = Object.fromEntries(new FormData(form).entries());
    if (form.elements.organization.disabled) delete editedAccount.organization;
    if (form.elements.role.disabled) delete editedAccount.role;
    try {
      await IVSERSApi.updateAccount(accountBeingEdited._id, editedAccount);
      el.accountEditDialog.close();
      accountBeingEdited = null;
      await Promise.all([loadAccounts(), loadAssignableOptions()]);
      showToast('Account updated', 'ok');
    } catch (err) {
      showFormMessage(el.accountEditMessage, err.message || 'Account update failed.', true);
    }
  }

  async function removeAccount(account) {
    if (!window.confirm(`Delete ${account.name}'s account? This cannot be undone.`)) return;
    try {
      await IVSERSApi.deleteAccount(account._id);
      await Promise.all([loadAccounts(), loadAssignableOptions(), loadBuses()]);
      showToast('Account deleted', 'ok');
    } catch (err) {
      showToast(err.message || 'Account could not be deleted', 'critical');
    }
  }

  async function openVehicleEdit(bus) {
    vehicleBeingEdited = bus;
    const form = el.vehicleForm;
    const fields = [
      'vehicleId', 'registrationNumber', 'make', 'model', 'year', 'capacity',
      'maxLoadKg', 'route', 'depot', 'organization',
    ];
    fields.forEach((field) => {
      form.elements[field].value = bus[field] == null ? '' : bus[field];
    });
    form.elements.vehicleId.readOnly = true;
    form.elements.organization.readOnly = true;
    el.vehicleRegistration.open = true;
    el.vehicleRegistration.querySelector('summary').textContent = 'Edit Vehicle';
    el.vehicleForm.querySelector('button[type="submit"]').textContent = 'Save changes';
    el.vehicleEditCancel.hidden = false;
    await loadAssignableOptions();
    if (bus.driver && bus.driver._id
      && !Array.from(form.elements.driver.options).some((option) => option.value === bus.driver._id)) {
      form.elements.driver.add(new Option(`${bus.driver.name} (currently assigned)`, bus.driver._id));
    }
    form.elements.driver.value = bus.driver && bus.driver._id ? bus.driver._id : '';
    form.elements.owner.value = bus.owner && bus.owner._id ? bus.owner._id : '';
    showFormMessage(el.vehicleFormMessage, '');
  }

  async function removeVehicle(bus) {
    if (!window.confirm(`Delete vehicle ${bus.vehicleId}? It will be retired from the active fleet and its history retained.`)) {
      return;
    }
    try {
      await IVSERSApi.deleteBus(bus._id);
      await Promise.all([loadBuses(), loadAssignableOptions()]);
      showToast('Vehicle retired from active fleet', 'ok');
    } catch (err) {
      showToast(err.message || 'Vehicle could not be deleted', 'critical');
    }
  }

  function cancelVehicleEdit() {
    el.vehicleForm.reset();
    resetVehicleEdit();
    showFormMessage(el.vehicleFormMessage, '');
  }

  function resetVehicleEdit() {
    vehicleBeingEdited = null;
    el.vehicleForm.elements.vehicleId.readOnly = false;
    el.vehicleForm.elements.organization.readOnly = false;
    el.vehicleRegistration.querySelector('summary').textContent = 'Add Vehicle';
    el.vehicleForm.querySelector('button[type="submit"]').textContent = 'Save vehicle';
    el.vehicleEditCancel.hidden = true;
  }

  function showFormMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  async function loadBuses() {
    const res = await IVSERSApi.getBuses();
    state.buses.clear();
    (res.data || []).forEach((bus) => {
      state.buses.set(bus.vehicleId, bus);
      upsertMarker(bus);
    });
    renderFleet();
  }

  async function loadAlerts() {
    const res = await IVSERSApi.getAlerts('?status=pending&limit=50');
    state.alerts = res.data || [];
    renderAlerts();
  }

  // ------------------------------------------------------------------
  // Socket.IO live feed
  // ------------------------------------------------------------------
  function connectSocket() {
    const cfg = window.IVSERS_CONFIG || {};
    state.socket = io(cfg.socketBase || undefined, {
      auth: { token: IVSERSAuth.getToken() },
      transports: ['websocket', 'polling'],
    });

    state.socket.on('connect', () => setConnectionState(true));
    state.socket.on('disconnect', () => setConnectionState(false));
    state.socket.on('connect_error', () => setConnectionState(false));

    state.socket.on('new_alert', handleNewAlert);
    state.socket.on('bus_update', handleBusUpdate);
    state.socket.on('telemetry_update', handleTelemetryUpdate);
  }

  function setConnectionState(online) {
    el.connStatus.classList.toggle('online', online);
    el.connStatus.classList.toggle('offline', !online);
    el.connLabel.textContent = online ? 'Live' : 'Reconnecting...';
  }

  function handleNewAlert(alert) {
    state.alerts = [alert, ...state.alerts.filter((a) => a._id !== alert._id)];
    renderAlerts();
    playAlertTone(alert.severity);
    showToast(`${alert.type} - ${alert.vehicleId}: ${alert.details || ''}`, 'critical');
  }

  function handleBusUpdate(bus) {
    if (!bus || !bus.vehicleId) return;
    state.buses.set(bus.vehicleId, bus);
    renderFleet();
    upsertMarker(bus);
    if (state.selectedVehicleId === bus.vehicleId) {
      renderTelemetry(bus);
    }
  }

  function handleTelemetryUpdate(payload) {
    // Raw sensor frames are informational here - the authoritative bus
    // state (already merged) arrives via 'bus_update' right after this on
    // the server side. We use this event only to give the operator a
    // subtle "live" pulse on the telemetry panel when it's the selected
    // vehicle, confirming the stream is actually flowing.
    if (payload && payload.vehicleId === state.selectedVehicleId) {
      el.telemetryVehicleId.classList.add('mono');
    }
  }

  // ------------------------------------------------------------------
  // Severity computation
  // ------------------------------------------------------------------
  function computeStatus(bus) {
    const heartbeat = bus.hardware && bus.hardware.lastHeartbeat;
    const isStale = !heartbeat || (Date.now() - new Date(heartbeat).getTime()) > OFFLINE_THRESHOLD_MS;
    const hazard = (bus.hardware && bus.hardware.hazardState) || {};

    if (isStale) return { level: 'offline', hazard };

    const anyCritical = hazard.fireEngine || hazard.fireCabin || hazard.fireElectric || hazard.accident || hazard.panic;
    if (anyCritical) return { level: 'critical', hazard };

    if (hazard.overload) return { level: 'warning', hazard };

    return { level: 'ok', hazard };
  }

  // ------------------------------------------------------------------
  // Rendering: annunciator strip + fleet table
  // ------------------------------------------------------------------
  function renderFleet() {
    const buses = Array.from(state.buses.values()).sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
    el.fleetCount.textContent = `${buses.length} vehicle${buses.length === 1 ? '' : 's'}`;

    renderAnnunciator(buses);
    renderFleetTable(buses);
  }

  function renderAnnunciator(buses) {
    if (buses.length === 0) {
      el.annunciator.innerHTML = '<div class="annunciator-empty text-faint">No vehicles registered yet.</div>';
      return;
    }

    el.annunciator.innerHTML = '';
    buses.forEach((bus) => {
      const status = computeStatus(bus);
      const chip = document.createElement('div');
      chip.className = `annunciator-chip state-${status.level}`;
      if (bus.vehicleId === state.selectedVehicleId) chip.classList.add('selected');
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      chip.setAttribute('aria-label', `${bus.vehicleId} - ${status.level}`);

      const idEl = document.createElement('div');
      idEl.className = 'annunciator-id';
      idEl.textContent = bus.vehicleId;
      chip.appendChild(idEl);

      const segRow = document.createElement('div');
      segRow.className = 'annunciator-segments';
      HAZARD_SEGMENTS.forEach((seg) => {
        const segEl = document.createElement('span');
        const active = seg.key === 'fireEngine'
          ? (status.hazard.fireEngine || status.hazard.fireCabin || status.hazard.fireElectric)
          : status.hazard[seg.key];
        segEl.className = `segment${active ? (seg.key === 'overload' ? ' lit-warning' : ' lit-danger') : ''}`;
        segEl.textContent = seg.label;
        segRow.appendChild(segEl);
      });
      chip.appendChild(segRow);

      chip.addEventListener('click', () => selectVehicle(bus.vehicleId));
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectVehicle(bus.vehicleId); }
      });

      el.annunciator.appendChild(chip);
    });
  }

  function renderFleetTable(buses) {
    if (buses.length === 0) {
      el.fleetBody.innerHTML = '<tr><td colspan="6" class="text-faint">No vehicles registered yet.</td></tr>';
      return;
    }

    const limitedRole = ['police', 'hospital', 'rtsa', 'fire_brigade'].includes(currentUser.role);
    el.vehicleActionsHeading.hidden = !canManageFleet;
    el.fleetBody.innerHTML = '';
    buses.forEach((bus) => {
      const status = computeStatus(bus);
      const loadKg = (bus.hardware && bus.hardware.sensors && bus.hardware.sensors.loadKg) || 0;
      const maxLoad = bus.maxLoadKg || 3500;
      const loadPct = Math.min(100, Math.round((loadKg / maxLoad) * 100));

      const tr = document.createElement('tr');
      if (bus.vehicleId === state.selectedVehicleId) tr.classList.add('selected');
      tr.addEventListener('click', () => selectVehicle(bus.vehicleId));

      tr.innerHTML = `
        <td>
          <div class="fleet-vehicle-cell">
            <span class="fleet-vehicle-id">${escapeHtml(bus.vehicleId)}</span>
            <span class="fleet-vehicle-route">${escapeHtml(bus.registrationNumber || 'Unregistered')}</span>
          </div>
        </td>
        <td>${statusBadge(status.level)}</td>
        ${['police', 'hospital', 'rtsa', 'fire_brigade'].includes(currentUser.role) ? '' : `<td>
          <span class="mono">${loadKg.toFixed(0)} / ${maxLoad} kg</span>
          <div class="load-bar"><div class="load-bar-fill ${loadPct >= 100 ? 'over' : loadPct >= 80 ? 'warn' : ''}" style="width:${loadPct}%"></div></div>
        </td>`}
        <td>${escapeHtml(bus.route || '-')}</td>
        <td class="mono text-faint">${timeAgo(bus.hardware && bus.hardware.lastHeartbeat)}</td>
      `;
      if (canManageFleet) {
        const actions = document.createElement('td');
        const buttons = document.createElement('div');
        buttons.className = 'action-buttons';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn-sm';
        edit.textContent = 'Edit';
        edit.addEventListener('click', (event) => {
          event.stopPropagation();
          openVehicleEdit(bus);
        });
        buttons.appendChild(edit);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-sm danger-btn';
        remove.textContent = 'Delete';
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          removeVehicle(bus);
        });
        buttons.appendChild(remove);
        actions.appendChild(buttons);
        tr.appendChild(actions);
      } else if (!limitedRole) {
        tr.insertAdjacentHTML('beforeend', '<td></td>');
      }
      el.fleetBody.appendChild(tr);
    });
  }

  function statusBadge(level) {
    const map = {
      critical: ['badge--danger', 'Critical'],
      warning: ['badge--warning', 'Warning'],
      ok: ['badge--safe', 'Normal'],
      offline: ['badge--neutral', 'Offline'],
    };
    const [cls, label] = map[level] || map.offline;
    return `<span class="badge ${cls}"><span class="dot"></span>${label}</span>`;
  }

  // ------------------------------------------------------------------
  // Vehicle selection + telemetry panel
  // ------------------------------------------------------------------
  function selectVehicle(vehicleId) {
    state.selectedVehicleId = vehicleId;
    renderFleet();
    const bus = state.buses.get(vehicleId);
    if (bus) renderTelemetry(bus);

    const marker = state.markers.get(vehicleId);
    if (marker && state.map) {
      state.map.setView(marker.getLatLng(), Math.max(state.map.getZoom(), 13));
      marker.openPopup();
    }
  }

  function renderTelemetry(bus) {
    el.telemetryVehicleId.textContent = bus.vehicleId;
    const s = (bus.hardware && bus.hardware.sensors) || {};
    const sup = (bus.hardware && bus.hardware.suppression) || {};
    const gps = (bus.hardware && bus.hardware.gps) || {};

    const cells = [
      cell('Flame - Engine', s.flameEngine, '', s.flameEngine != null && s.flameEngine < 400 ? 'danger' : ''),
      cell('Flame - Cabin', s.flameCabin, '', s.flameCabin != null && s.flameCabin < 400 ? 'danger' : ''),
      cell('Flame - Electric', s.flameElectric, '', s.flameElectric != null && s.flameElectric < 400 ? 'danger' : ''),
      cell('Smoke - Engine', s.smokeEngine),
      cell('Smoke - Cabin', s.smokeCabin),
      cell('Temp - Engine', s.tempEngine, '°C', s.tempEngine != null && s.tempEngine > 55 ? 'danger' : ''),
      cell('Temp - Electric', s.tempElectric, '°C', s.tempElectric != null && s.tempElectric > 55 ? 'danger' : ''),
      cell('Load', s.loadKg, 'kg', s.loadKg != null && s.loadKg > (bus.maxLoadKg || 3500) ? 'warning' : ''),
      cell('Acceleration', s.accelG, 'g', s.accelG != null && s.accelG > 3.5 ? 'danger' : ''),
      cell('Roll', s.roll, '°'),
      cell('Pitch', s.pitch, '°'),
      cell('Suppression tank', sup.tankPercent, '%', sup.tankPercent != null && sup.tankPercent <= 20 ? 'warning' : 'safe'),
      cell('Pump pressure', sup.pressureUnits),
      cell('GPS', (gps.latitude != null && gps.longitude != null) ? `${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}` : '-'),
      cell('Last heartbeat', timeAgo(bus.hardware && bus.hardware.lastHeartbeat)),
      cell('Firmware', (bus.hardware && bus.hardware.firmwareVersion) || 'unknown'),
    ];

    el.telemetryBody.innerHTML = `<div class="readout-grid">${cells.join('')}</div>`;
  }

  function cell(label, value, unit = '', tone = '') {
    const display = (value === null || value === undefined || Number.isNaN(value))
      ? '-'
      : `${typeof value === 'number' ? formatNumber(value) : value}${unit}`;
    return `
      <div class="readout-cell">
        <div class="readout-label">${escapeHtml(label)}</div>
        <div class="readout-value ${tone}">${escapeHtml(String(display))}</div>
      </div>
    `;
  }

  function formatNumber(n) {
    return Number.isInteger(n) ? n.toString() : n.toFixed(1);
  }

  // ------------------------------------------------------------------
  // Alert feed
  // ------------------------------------------------------------------
  function renderAlerts() {
    const pending = state.alerts.filter((a) => a.status === 'pending' || a.status === 'acknowledged');
    el.alertCount.textContent = `${pending.length} pending`;

    if (state.alerts.length === 0) {
      el.alertFeed.innerHTML = '<div class="text-faint" style="padding:16px;">No alerts yet.</div>';
      return;
    }

    el.alertFeed.innerHTML = '';
    state.alerts.forEach((alert) => {
      const item = document.createElement('div');
      item.className = 'alert-item';

      const [badgeClass] = severityBadge(alert.severity);
      item.innerHTML = `
        <div class="alert-item-head">
          <span class="alert-item-vehicle">${escapeHtml(alert.vehicleId)}</span>
          <span class="badge ${badgeClass}"><span class="dot"></span>${escapeHtml(alert.type)}</span>
        </div>
        <div class="alert-item-details">${escapeHtml(alert.details || '')}</div>
        <div class="alert-item-meta">${new Date(alert.createdAt).toLocaleString()} - ${escapeHtml(alert.status)}</div>
      `;

      if (alert.status === 'pending' || alert.status === 'acknowledged') {
        const actions = document.createElement('div');
        actions.className = 'alert-item-actions';

        if (alert.status === 'pending') {
          const ackBtn = document.createElement('button');
          ackBtn.className = 'btn-sm';
          ackBtn.textContent = 'Acknowledge';
          ackBtn.addEventListener('click', () => acknowledge(alert._id));
          actions.appendChild(ackBtn);
        }

        if (isAdmin || currentUser.role === 'fleet_manager') {
          const resolveBtn = document.createElement('button');
          resolveBtn.className = 'btn-sm danger-btn';
          resolveBtn.textContent = 'Resolve';
          resolveBtn.addEventListener('click', () => openResolveDialog(alert._id));
          actions.appendChild(resolveBtn);
        }

        item.appendChild(actions);
      }

      el.alertFeed.appendChild(item);
    });
  }

  function severityBadge(severity) {
    const map = {
      CRITICAL: ['badge--danger', 'Critical'],
      HIGH: ['badge--danger', 'High'],
      MEDIUM: ['badge--warning', 'Medium'],
      LOW: ['badge--info', 'Low'],
    };
    return map[severity] || map.LOW;
  }

  async function acknowledge(alertId) {
    try {
      await IVSERSApi.acknowledgeAlert(alertId);
      showToast('Alert acknowledged', 'ok');
      loadAlerts();
    } catch (err) {
      showToast(err.message || 'Failed to acknowledge alert', 'critical');
    }
  }

  function openResolveDialog(alertId) {
    alertBeingResolved = alertId;
    el.resolveDialog.showModal();
  }

  // ------------------------------------------------------------------
  // Map
  // ------------------------------------------------------------------
  function initMap() {
    state.map = L.map('fleet-map', { zoomControl: true }).setView(DEFAULT_MAP_CENTER, 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(state.map);
  }

  function upsertMarker(bus) {
    const gps = bus.hardware && bus.hardware.gps;
    if (!gps || gps.latitude == null || gps.longitude == null) return;

    const status = computeStatus(bus);
    const color = { critical: '#e4483a', warning: '#f5a623', ok: '#35c48b', offline: '#5b6b85' }[status.level];

    const icon = L.divIcon({
      className: 'ivsers-marker',
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #0c1220;box-shadow:0 0 0 2px ${color}55;"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

    let marker = state.markers.get(bus.vehicleId);
    const latLng = [gps.latitude, gps.longitude];

    if (marker) {
      marker.setLatLng(latLng);
      marker.setIcon(icon);
    } else {
      marker = L.marker(latLng, { icon }).addTo(state.map);
      state.markers.set(bus.vehicleId, marker);
    }

    marker.bindPopup(`<strong>${escapeHtml(bus.vehicleId)}</strong><br>${escapeHtml(bus.route || '')}<br>Status: ${status.level}`);
    marker.on('click', () => selectVehicle(bus.vehicleId));
  }

  // ------------------------------------------------------------------
  // Audio cue (no external asset - a short synthesized tone)
  // ------------------------------------------------------------------
  function playAlertTone(severity) {
    try {
      if (!state.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        state.audioCtx = new AudioContextClass();
      }
      const ctx = state.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();

      const freq = severity === 'CRITICAL' ? 880 : severity === 'HIGH' ? 660 : 440;
      const beepCount = severity === 'CRITICAL' ? 3 : 1;

      for (let i = 0; i < beepCount; i++) {
        const start = ctx.currentTime + i * 0.22;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.18);
      }
    } catch (err) {
      // Audio is a courtesy cue, never critical-path - fail silently.
    }
  }

  // ------------------------------------------------------------------
  // Toasts
  // ------------------------------------------------------------------
  function showToast(message, type = '') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    el.toastRegion.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function timeAgo(dateInput) {
    if (!dateInput) return 'never';
    const diffMs = Date.now() - new Date(dateInput).getTime();
    if (diffMs < 0) return 'just now';
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
