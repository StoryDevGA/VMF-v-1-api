import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { Customer, LicenseLevel, Role, Tenant } from '../models/index.js'
import performanceCacheService from '../services/performanceCacheService.js'
import {
  assertCustomerTenantContext,
  assertFeatureEntitlement,
  assertRuntimePermission,
} from '../services/runtimeInstanceService.js'

const session = { id: 'authorization-session' }
const customer = { _id: 'customer', topology: 'MULTI_TENANT', licenseLevelId: 'license', entitlements: [] }
const tenant = { _id: 'tenant', customerId: 'customer', status: 'ENABLED', tenantAdminUserIds: [] }
const license = { _id: 'license', isActive: true, featureEntitlements: ['VMF'] }
const scope = {
  resolvedPermissions: {
    customers: [{ customerId: 'customer', roleKeys: ['TENANT_ADMIN'], permissions: ['VMF_UPDATE'] }],
  },
  memberships: [{ customerId: 'customer', roles: ['TENANT_ADMIN'] }],
}
const args = { customerId: 'customer', tenantId: 'tenant', actorUserId: 'actor', scopes: scope, permission: 'VMF_UPDATE' }
let queries, events, caches

const query = (name, result) => {
  const q = {
    select: jest.fn(() => q),
    lean: jest.fn(() => q),
    session: jest.fn(() => q),
    then: (resolve, reject) => {
      events.push(`${name}:resolved`)
      return Promise.resolve(result).then(resolve, reject)
    },
  }
  queries.push({ name, q })
  events.push(`${name}:created`)
  return q
}

beforeEach(() => {
  queries = []
  events = []
  jest.spyOn(Role, 'find').mockImplementation(() => query('role', [
    { key: 'TENANT_ADMIN', scope: 'TENANT', permissions: ['VMF_UPDATE'], isActive: true },
  ]))
  jest.spyOn(Customer, 'findById').mockImplementation(() => query('customer', customer))
  jest.spyOn(Tenant, 'findById').mockImplementation(() => query('tenant', tenant))
  jest.spyOn(LicenseLevel, 'findById').mockImplementation(() => query('license', license))
  caches = ['getCustomerTopology', 'setCustomerTopology', 'getLicenseLevelEntitlements', 'setLicenseLevelEntitlements']
    .map((key) => jest.spyOn(performanceCacheService, key).mockResolvedValue(null))
})

afterEach(() => jest.restoreAllMocks())

const expectSessions = (expected) => {
  expect(queries.length).toBeGreaterThan(0)
  for (const { q } of queries) {
    if (expected) expect(q.session).toHaveBeenCalledWith(expected)
    else expect(q.session).not.toHaveBeenCalled()
  }
}

describe.each([['session', session], ['no session', undefined]])('%s authorization traversal', (_label, activeSession) => {
  test('preserves denial after Role, Tenant and Customer fallback reads', async () => {
    await expect(assertRuntimePermission({ ...args, session: activeSession }))
      .rejects.toMatchObject({ status: 403, details: { reason: 'FORBIDDEN' } })
    expect(queries.map(({ name }) => name)).toEqual(['role', 'tenant', 'customer'])
    expectSessions(activeSession)
  })

  test('preserves tenant-admin and single-tenant fallback grants', async () => {
    Tenant.findById.mockImplementation(() => query('tenant', { ...tenant, tenantAdminUserIds: ['actor'] }))
    await expect(assertRuntimePermission({ ...args, session: activeSession })).resolves.toBeUndefined()
    expect(Customer.findById).not.toHaveBeenCalled()
    Tenant.findById.mockImplementation(() => query('tenant', tenant))
    Customer.findById.mockImplementation(() => query('customer', { ...customer, topology: 'SINGLE_TENANT' }))
    await expect(assertRuntimePermission({ ...args, session: activeSession })).resolves.toBeUndefined()
    expectSessions(activeSession)
  })

  test('preserves customer-role grant without tenant or customer reads', async () => {
    Role.find.mockImplementation(() => query('role', [
      { key: 'TENANT_ADMIN', scope: 'CUSTOMER', permissions: ['VMF_UPDATE'], isActive: true },
    ]))
    await expect(assertRuntimePermission({ ...args, session: activeSession })).resolves.toBeUndefined()
    expect(queries.map(({ name }) => name)).toEqual(['role'])
    expectSessions(activeSession)
  })

  test('loads context sequentially only for session-bound reads', async () => {
    await expect(assertCustomerTenantContext({ ...args, session: activeSession })).resolves.toEqual({ customer, tenant })
    expectSessions(activeSession)
    expect(events).toEqual(activeSession
      ? ['customer:created', 'customer:resolved', 'tenant:created', 'tenant:resolved']
      : ['customer:created', 'tenant:created', 'customer:resolved', 'tenant:resolved'])
  })

  test('retains context ownership rejection', async () => {
    Tenant.findById.mockImplementation(() => query('tenant', { ...tenant, customerId: 'other' }))
    await expect(assertCustomerTenantContext({ ...args, session: activeSession }))
      .rejects.toMatchObject({ status: 404, details: { reason: 'TENANT_NOT_IN_CUSTOMER' } })
    expectSessions(activeSession)
  })

  test('traverses actual entitlement resolver with compatible cache behavior', async () => {
    await expect(assertFeatureEntitlement({ customerId: 'customer', feature: 'VMF', session: activeSession }))
      .resolves.toBeUndefined()
    expect(queries.map(({ name }) => name)).toEqual(['customer', 'license'])
    expectSessions(activeSession)
    for (const cache of caches) {
      expect(cache).toHaveBeenCalledTimes(activeSession ? 0 : 1)
    }
  })

  test('uses supplied customer and session-bound license while preserving feature denial', async () => {
    await expect(assertFeatureEntitlement({ customerId: 'customer', customer, feature: 'DEALS', session: activeSession }))
      .rejects.toMatchObject({ status: 403, code: 'LICENSE_FEATURE_NOT_ENABLED' })
    expect(Customer.findById).not.toHaveBeenCalled()
    expect(queries.map(({ name }) => name)).toEqual(['license'])
    expectSessions(activeSession)
    expect(caches[0]).not.toHaveBeenCalled()
    expect(caches[1]).not.toHaveBeenCalled()
    expect(caches[2]).toHaveBeenCalledTimes(activeSession ? 0 : 1)
    expect(caches[3]).toHaveBeenCalledTimes(activeSession ? 0 : 1)
  })
})

test('session ignores populated caches; no-session still consumes them', async () => {
  caches[0].mockResolvedValue(customer)
  caches[2].mockResolvedValue({ ...license, featureEntitlements: ['DEALS'] })
  await expect(assertFeatureEntitlement({ customerId: 'customer', feature: 'VMF', session })).resolves.toBeUndefined()
  for (const cache of caches) expect(cache).not.toHaveBeenCalled()
  expectSessions(session)
  Customer.findById.mockClear()
  LicenseLevel.findById.mockClear()
  await expect(assertFeatureEntitlement({ customerId: 'customer', feature: 'DEALS' })).resolves.toBeUndefined()
  expect(Customer.findById).not.toHaveBeenCalled()
  expect(LicenseLevel.findById).not.toHaveBeenCalled()
  expect(caches[0]).toHaveBeenCalledTimes(1)
  expect(caches[2]).toHaveBeenCalledTimes(1)
  expect(caches[1]).not.toHaveBeenCalled()
  expect(caches[3]).not.toHaveBeenCalled()
})
