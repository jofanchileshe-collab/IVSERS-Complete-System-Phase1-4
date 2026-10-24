const { deviceAuth } = require('../middleware/deviceAuth');

describe('deviceAuth', () => {
  beforeEach(() => {
    delete process.env.DEVICE_API_KEY;
  });

  test('allows a valid device API key', () => {
    process.env.DEVICE_API_KEY = 'device-key';
    const req = {
      header: jest.fn((name) => (name === 'X-API-Key' ? 'device-key' : undefined)),
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    deviceAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects missing or invalid device API keys', () => {
    process.env.DEVICE_API_KEY = 'device-key';
    const req = { header: jest.fn(() => undefined) };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    deviceAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
