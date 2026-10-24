/*
 * ============================================================================
 *  IVSERS Frontend - assets/config.js
 *
 *  Single place to point the dashboard at a backend. Left as relative/
 *  same-origin paths by default because Frontend/nginx.conf reverse-proxies
 *  /api and /socket.io to the backend container - so in the default Docker
 *  Compose deployment nothing here needs to change. Override apiBase /
 *  socketBase only if the frontend and backend are served from different
 *  origins (e.g. a CDN-hosted frontend against a separately-hosted API).
 * ============================================================================
 */

const localApiBase = window.location.port === '5500'
  ? `${window.location.protocol}//${window.location.hostname}:8080`
  : '';

window.IVSERS_CONFIG = {
  apiBase: localApiBase,       // Live Server uses the Docker frontend's API proxy
  socketBase: localApiBase,    // Keep Socket.IO on the same backend origin
  appName: 'IVSERS',
  institution: 'Zambia Air Services Training Institute',
};
