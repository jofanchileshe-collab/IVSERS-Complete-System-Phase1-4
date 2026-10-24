/*
 * ============================================================================
 *  IVSERS Backend - utils/logger.js
 *
 *  Minimal structured console logger. Kept dependency-free intentionally:
 *  in a container/systemd deployment, stdout/stderr is already collected
 *  by the platform's own log driver (Docker json-file/loki, journald,
 *  etc.), so a heavier logging framework buys little at this project's
 *  scale while adding another dependency to keep patched.
 * ============================================================================
 */

const LEVELS = ['error', 'warn', 'info', 'debug'];

function timestamp() {
  return new Date().toISOString();
}

function format(level, message) {
  return `[${timestamp()}] [${level.toUpperCase()}] ${message}`;
}

const logger = {};

LEVELS.forEach((level) => {
  logger[level] = (message) => {
    const line = format(level, message);
    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(line);
    } else if (level === 'warn') {
      // eslint-disable-next-line no-console
      console.warn(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  };
});

module.exports = logger;
