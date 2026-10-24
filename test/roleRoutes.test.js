const express = require('express');
const http = require('http');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      _id: 'driver-1',
      role: req.get('x-test-role') || 'driver',
      organization: 'Fleet A',
    };
    next();
  },
  authorize: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    next();
  },
}));

const usersRouter = require('../routes/users');
const busesRouter = require('../routes/buses');

const app = express();
app.use(express.json());
app.use('/api/users', usersRouter);
app.use('/api/buses', busesRouter);

let server;
let baseUrl;

function call(path, method = 'GET', body) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-test-role': 'driver',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('role-protected management routes', () => {
  beforeAll((done) => {
    server = http.createServer(app).listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  test('a driver cannot create an administrator account', async () => {
    const response = await call('/api/users', 'POST', {
      name: 'Attempted admin',
      email: 'attempt@example.test',
      role: 'super_admin',
      password: 'StrongPass123',
    });

    expect(response.status).toBe(403);
  });

  test('a driver cannot list or suspend other accounts', async () => {
    const listResponse = await call('/api/users');
    const statusResponse = await call('/api/users/other-user/status', 'PATCH', { status: 'suspended' });
    const editResponse = await call('/api/users/other-user', 'PATCH', { role: 'super_admin' });
    const deleteResponse = await call('/api/users/other-user', 'DELETE');

    expect(listResponse.status).toBe(403);
    expect(statusResponse.status).toBe(403);
    expect(editResponse.status).toBe(403);
    expect(deleteResponse.status).toBe(403);
  });

  test('a driver cannot register, update, or delete fleet vehicles', async () => {
    const createResponse = await call('/api/buses', 'POST', { vehicleId: 'BUS-01', organization: 'Other Fleet' });
    const updateResponse = await call('/api/buses/vehicle-id', 'PATCH', { organization: 'Other Fleet' });
    const deleteResponse = await call('/api/buses/vehicle-id', 'DELETE');

    expect(createResponse.status).toBe(403);
    expect(updateResponse.status).toBe(403);
    expect(deleteResponse.status).toBe(403);
  });
});
