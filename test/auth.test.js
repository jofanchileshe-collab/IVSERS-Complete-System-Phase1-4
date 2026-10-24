const mockUserFindOne = jest.fn();
const mockUserCreate = jest.fn();

jest.mock('../models/User', () => ({
  findOne: mockUserFindOne,
  create: mockUserCreate,
}));

const { register, login } = require('../controllers/authController');
const User = require('../models/User');

describe('authController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_EXPIRES_IN = '7d';
  });

  test('register creates a user without returning an account token', async () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const createdUser = {
      _id: 'user-1',
      name: 'Jane Driver',
      email: 'jane@example.com',
      role: 'driver',
      toSafeObject: () => ({
        _id: 'user-1',
        name: 'Jane Driver',
        email: 'jane@example.com',
        role: 'driver',
      }),
    };

    mockUserFindOne.mockResolvedValue(null);
    mockUserCreate.mockResolvedValue(createdUser);

    await register(
      {
        body: {
          name: 'Jane Driver',
          email: 'JANE@example.com',
          password: 'StrongPass123',
          phone: '0912345678',
          role: 'driver',
        },
      },
      res
    );

    expect(mockUserFindOne).toHaveBeenCalledWith({ email: 'jane@example.com' });
    expect(mockUserCreate).toHaveBeenCalledWith({
      name: 'Jane Driver',
      email: 'JANE@example.com',
      password: 'StrongPass123',
      phone: '0912345678',
      role: 'driver',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const jsonPayload = res.json.mock.calls[0][0];
    expect(jsonPayload.data.token).toBeUndefined();
    expect(jsonPayload.data.user.email).toBe('jane@example.com');
    expect(jsonPayload.data.user.password).toBeUndefined();
  });

  test('login accepts a valid active user and issues a token', async () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const user = {
      _id: 'user-1',
      email: 'jane@example.com',
      role: 'driver',
      status: 'active',
      lastLoginAt: null,
      comparePassword: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(true),
      toSafeObject: () => ({
        _id: 'user-1',
        email: 'jane@example.com',
        role: 'driver',
      }),
    };

    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });

    await login(
      {
        body: {
          email: 'jane@example.com',
          password: 'StrongPass123',
        },
      },
      res
    );

    expect(user.comparePassword).toHaveBeenCalledWith('StrongPass123');
    expect(user.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const jsonPayload = res.json.mock.calls[0][0];
    expect(jsonPayload.data.token).toBeTruthy();
  });
});
