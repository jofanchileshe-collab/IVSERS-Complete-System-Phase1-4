/*
 * ============================================================================
 *  IVSERS Backend - utils/accessScope.js
 *
 *  Builds server-side Mongo filters for role and organization isolation.
 * ============================================================================
 */

const Bus = require('../models/Bus');

function busFilterForUser(user) {
  if (user.role === 'super_admin') return {};
  if (user.role === 'driver') {
    if (!user.organization) return { _id: null };
    const assignments = [{ driver: user._id, organization: user.organization }];
    if (user.assignedBus) {
      assignments.push({ _id: user.assignedBus, organization: user.organization });
    }
    return { $or: assignments };
  }
  if (user.role === 'bus_owner') {
    return user.organization
      ? { owner: user._id, organization: user.organization }
      : { _id: null };
  }
  if (user.organization) return { organization: user.organization };
  return { _id: null };
}

async function alertFilterForUser(user) {
  if (user.role === 'super_admin') return {};

  const busIds = await Bus.find(busFilterForUser(user)).distinct('_id');
  const scopes = [{ bus: { $in: busIds } }];
  if (user.organization && !['driver', 'bus_owner'].includes(user.role)) {
    scopes.push({ organization: user.organization });
  }
  return { $or: scopes };
}

function combineFilters(...filters) {
  const activeFilters = filters.filter((filter) => filter && Object.keys(filter).length > 0);
  if (activeFilters.length === 0) return {};
  if (activeFilters.length === 1) return activeFilters[0];
  return { $and: activeFilters };
}

module.exports = { busFilterForUser, alertFilterForUser, combineFilters };
