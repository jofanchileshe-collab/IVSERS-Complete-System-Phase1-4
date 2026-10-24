/*
 * ============================================================================
 *  IVSERS Frontend - script.js
 *
 *  Small dependency-free API client shared by login.html and the dashboard.
 *  Handles JWT storage, authenticated fetch, and auth-guard redirects.
 *
 *  STORAGE NOTE: the token is kept in localStorage for simplicity in this
 *  phase. localStorage is readable by any script on the page, so it is
 *  vulnerable to theft via an XSS bug elsewhere in the app. The documented
 *  production hardening path is to move the token into an httpOnly,
 *  Secure, SameSite=Strict cookie set by the backend on login and have the
 *  backend read it from the cookie instead of an Authorization header -
 *  that changes only authenticate() in Backend/middleware/auth.js and the
 *  fetch calls below, not the rest of the app.
 * ============================================================================
 */

(function () {
  const CONFIG = window.IVSERS_CONFIG || { apiBase: '', socketBase: '' };
  const TOKEN_KEY = 'ivsers_token';
  const USER_KEY = 'ivsers_user';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch (err) {
      return null;
    }
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function isAuthenticated() {
    return Boolean(getToken());
  }

  /** Redirects to login.html if no token is present. Call at the top of any protected page. */
  function requireAuth() {
    if (!isAuthenticated()) {
      window.location.href = 'login.html';
    }
  }

  /** Redirects to the dashboard if already logged in. Call at the top of login.html. */
  function redirectIfAuthenticated() {
    if (isAuthenticated()) {
      window.location.href = 'dashboard/dashboard.html';
    }
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    if (!text.trim()) return null;

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Server returned an invalid response (HTTP ${response.status})`);
    }
  }

  async function authFetch(path, options = {}) {
    const token = getToken();
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      options.headers || {},
      token ? { Authorization: `Bearer ${token}` } : {}
    );

    const response = await fetch(`${CONFIG.apiBase}${path}`, { ...options, headers });

    if (response.status === 401) {
      // Session expired or invalid - clear and force a fresh login rather
      // than leaving the UI silently stuck in a half-authenticated state.
      clearSession();
      window.location.href = getDashboardRelativePath() + 'login.html';
      throw new Error('Session expired');
    }

    const body = await readJsonResponse(response);

    if (!response.ok) {
      const message = (body && body.error) || `Request failed (${response.status})`;
      throw new Error(message);
    }

    return body;
  }

  function getDashboardRelativePath() {
    // Works whether the caller is at the site root or inside /dashboard/.
    return window.location.pathname.includes('/dashboard/') ? '../' : '';
  }

  async function login(email, password) {
    const response = await fetch(`${CONFIG.apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await readJsonResponse(response);
    if (!response.ok || !body || !body.success) {
      const message = (body && body.error) || (
        response.ok
          ? 'Login server returned an empty response.'
          : `Login failed (HTTP ${response.status})`
      );
      throw new Error(message);
    }
    setSession(body.data.token, body.data.user);
    return body.data.user;
  }

  function logout() {
    clearSession();
    window.location.href = getDashboardRelativePath() + 'login.html';
  }

  // --- Domain-specific API calls ---
  const api = {
    getBuses: (params = '') => authFetch(`/api/buses${params}`),
    getBus: (id) => authFetch(`/api/buses/${id}`),
    getAlerts: (params = '') => authFetch(`/api/alerts${params}`),
    acknowledgeAlert: (id) => authFetch(`/api/alerts/${id}/acknowledge`, { method: 'PATCH' }),
    resolveAlert: (id, resolutionNotes, falseAlarm = false) =>
      authFetch(`/api/alerts/${id}/resolve`, {
        method: 'PATCH',
        body: JSON.stringify({ resolutionNotes, falseAlarm }),
      }),
    getAccounts: () => authFetch('/api/users'),
    createAccount: (account) => authFetch('/api/users', {
      method: 'POST',
      body: JSON.stringify(account),
    }),
    updateAccountStatus: (id, status) => authFetch(`/api/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
    updateAccount: (id, account) => authFetch(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(account),
    }),
    deleteAccount: (id) => authFetch(`/api/users/${id}`, { method: 'DELETE' }),
    getAssignableAccounts: (role, organization) => {
      const params = new URLSearchParams({ role });
      if (organization) params.set('organization', organization);
      return authFetch(`/api/users/assignable?${params}`);
    },
    createBus: (vehicle) => authFetch('/api/buses', {
      method: 'POST',
      body: JSON.stringify(vehicle),
    }),
    updateBus: (id, vehicle) => authFetch(`/api/buses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(vehicle),
    }),
    deleteBus: (id) => authFetch(`/api/buses/${id}`, { method: 'DELETE' }),
    me: () => authFetch('/api/auth/me'),
  };

  window.IVSERSAuth = {
    login,
    logout,
    getToken,
    getUser,
    isAuthenticated,
    requireAuth,
    redirectIfAuthenticated,
  };
  window.IVSERSApi = Object.assign({ authFetch }, api);
})();
