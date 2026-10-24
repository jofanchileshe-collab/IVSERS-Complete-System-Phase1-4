jest.mock('../models/Bus', () => ({
  find: jest.fn(),
}));

const Bus = require('../models/Bus');
const { busFilterForUser, alertFilterForUser } = require('../utils/accessScope');

describe('role access scopes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('drivers are limited to their assigned vehicle for buses and alerts', async () => {
    const user = {
      _id: 'driver-1',
      role: 'driver',
      organization: 'Fleet A',
      assignedBus: 'bus-1',
    };
    Bus.find.mockReturnValue({
      distinct: jest.fn().mockResolvedValue(['bus-1']),
    });

    expect(busFilterForUser(user)).toEqual({
      $or: [
        { driver: 'driver-1', organization: 'Fleet A' },
        { _id: 'bus-1', organization: 'Fleet A' },
      ],
    });
    expect(await alertFilterForUser(user)).toEqual({
      $or: [{ bus: { $in: ['bus-1'] } }],
    });
  });

  test('bus owners do not inherit organization-wide alert access', async () => {
    const user = { _id: 'owner-1', role: 'bus_owner', organization: 'Fleet A' };
    Bus.find.mockReturnValue({
      distinct: jest.fn().mockResolvedValue(['bus-2']),
    });

    expect(busFilterForUser(user)).toEqual({ owner: 'owner-1', organization: 'Fleet A' });
    expect(await alertFilterForUser(user)).toEqual({
      $or: [{ bus: { $in: ['bus-2'] } }],
    });
  });

  test('fleet managers receive organization-scoped bus and alert access', async () => {
    const user = { _id: 'manager-1', role: 'fleet_manager', organization: 'Fleet A' };
    Bus.find.mockReturnValue({
      distinct: jest.fn().mockResolvedValue(['bus-1', 'bus-3']),
    });

    expect(busFilterForUser(user)).toEqual({ organization: 'Fleet A' });
    expect(await alertFilterForUser(user)).toEqual({
      $or: [
        { bus: { $in: ['bus-1', 'bus-3'] } },
        { organization: 'Fleet A' },
      ],
    });
  });

  test('super administrators have global access without a bus lookup', async () => {
    expect(busFilterForUser({ role: 'super_admin' })).toEqual({});
    expect(await alertFilterForUser({ role: 'super_admin' })).toEqual({});
    expect(Bus.find).not.toHaveBeenCalled();
  });
});
