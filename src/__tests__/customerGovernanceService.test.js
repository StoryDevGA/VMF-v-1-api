import { describe, test, expect, beforeEach, jest } from '@jest/globals'
import customerGovernanceService from '../services/customerGovernanceService.js'
import { Customer, User } from '../models/index.js'

const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const OLD_ADMIN_USER_ID = '507f1f77bcf86cd799439012'
const NEW_ADMIN_USER_ID = '507f1f77bcf86cd799439013'

const makeCustomer = (overrides = {}) => ({
  _id: CUSTOMER_ID,
  status: 'ACTIVE',
  governance: {
    maxTenants: 1,
    maxVmfsPerTenant: 1,
    customerAdminUserId: OLD_ADMIN_USER_ID,
  },
  save: jest.fn(async function () { return this }),
  ...overrides,
})

const makeUser = ({
  id,
  isActive = true,
  roles = ['USER'],
  customerId = CUSTOMER_ID,
} = {}) => ({
  _id: id,
  isActive,
  memberships: customerId ? [{ customerId, roles: [...roles] }] : [],
  save: jest.fn(async function () { return this }),
})

beforeEach(() => {
  User.findById = jest.fn()
  User.findOne = jest.fn()
  Customer.findOne = jest.fn()
})

describe('customerGovernanceService.applyCustomerAdminAssignment', () => {
  test('sets canonical admin when active customer has no canonical pointer', async () => {
    const customer = makeCustomer({
      governance: {
        maxTenants: 1,
        maxVmfsPerTenant: 1,
        customerAdminUserId: null,
      },
    })
    const user = makeUser({
      id: NEW_ADMIN_USER_ID,
      roles: ['USER'],
    })

    User.findOne.mockResolvedValue(null)

    const result = await customerGovernanceService.applyCustomerAdminAssignment({
      customer,
      user,
    })

    expect(result.canonicalAdminUserId).toBe(NEW_ADMIN_USER_ID)
    expect(customer.governance.customerAdminUserId).toBe(NEW_ADMIN_USER_ID)
    expect(user.memberships[0].roles).toContain('CUSTOMER_ADMIN')
    expect(customer.save).toHaveBeenCalled()
    expect(user.save).toHaveBeenCalled()
  })

  test('rejects assignment when different canonical admin already exists', async () => {
    const customer = makeCustomer({
      governance: {
        maxTenants: 1,
        maxVmfsPerTenant: 1,
        customerAdminUserId: OLD_ADMIN_USER_ID,
      },
    })
    const user = makeUser({
      id: NEW_ADMIN_USER_ID,
      roles: ['USER'],
    })

    await expect(
      customerGovernanceService.applyCustomerAdminAssignment({
        customer,
        user,
      }),
    ).rejects.toMatchObject({
      isGovernanceError: true,
      status: 409,
      code: 'CONFLICT',
      details: {
        reason: customerGovernanceService.GOVERNANCE_REASONS.CANONICAL_ADMIN_EXISTS,
      },
    })
  })
})

describe('customerGovernanceService.replaceCustomerAdmin', () => {
  test('replaces canonical admin and updates memberships', async () => {
    const customer = makeCustomer()
    const oldAdmin = makeUser({
      id: OLD_ADMIN_USER_ID,
      roles: ['CUSTOMER_ADMIN'],
    })
    const newAdmin = makeUser({
      id: NEW_ADMIN_USER_ID,
      roles: ['USER'],
    })

    User.findById.mockResolvedValue(oldAdmin)

    const result = await customerGovernanceService.replaceCustomerAdmin({
      customer,
      newUser: newAdmin,
    })

    expect(result.oldUserId).toBe(OLD_ADMIN_USER_ID)
    expect(result.newUserId).toBe(NEW_ADMIN_USER_ID)
    expect(customer.governance.customerAdminUserId).toBe(NEW_ADMIN_USER_ID)
    expect(newAdmin.memberships[0].roles).toContain('CUSTOMER_ADMIN')
    expect(oldAdmin.memberships).toHaveLength(0)
    expect(newAdmin.save).toHaveBeenCalled()
    expect(oldAdmin.save).toHaveBeenCalled()
    expect(customer.save).toHaveBeenCalled()
  })

  test('rolls back in-memory state when persistence fails mid-replacement', async () => {
    const customer = makeCustomer()
    const oldAdmin = makeUser({
      id: OLD_ADMIN_USER_ID,
      roles: ['CUSTOMER_ADMIN'],
    })
    const newAdmin = makeUser({
      id: NEW_ADMIN_USER_ID,
      roles: ['USER'],
    })

    let oldAdminSaveCalls = 0
    oldAdmin.save = jest.fn(async function () {
      oldAdminSaveCalls += 1
      if (oldAdminSaveCalls === 1) {
        throw new Error('forced old admin save failure')
      }
      return this
    })

    User.findById.mockResolvedValue(oldAdmin)

    await expect(
      customerGovernanceService.replaceCustomerAdmin({
        customer,
        newUser: newAdmin,
      }),
    ).rejects.toMatchObject({
      isGovernanceError: true,
      status: 409,
      code: 'CONFLICT',
    })

    expect(customer.governance.customerAdminUserId).toBe(OLD_ADMIN_USER_ID)
    expect(oldAdmin.memberships[0].roles).toContain('CUSTOMER_ADMIN')
    expect(newAdmin.memberships[0].roles).toEqual(['USER'])
    expect(newAdmin.save).toHaveBeenCalledTimes(2)
    expect(customer.save).toHaveBeenCalledTimes(2)
  })
})

describe('customerGovernanceService.validateUserRoleUpdate', () => {
  test('blocks removal of CUSTOMER_ADMIN from canonical active customer admin', () => {
    const customer = makeCustomer()
    const canonicalUser = makeUser({
      id: OLD_ADMIN_USER_ID,
      roles: ['CUSTOMER_ADMIN'],
    })

    expect(() =>
      customerGovernanceService.validateUserRoleUpdate({
        customer,
        user: canonicalUser,
        nextRoles: ['USER'],
      }),
    ).toThrow('Cannot remove CUSTOMER_ADMIN role')

    try {
      customerGovernanceService.validateUserRoleUpdate({
        customer,
        user: canonicalUser,
        nextRoles: ['USER'],
      })
    } catch (err) {
      expect(err.details.reason).toBe(
        customerGovernanceService.GOVERNANCE_REASONS.CANONICAL_ADMIN_ROLE_REMOVAL_BLOCKED,
      )
    }
  })
})

describe('customerGovernanceService.assertUserCanBeDisabledOrDeleted', () => {
  test('blocks disable when user is canonical admin of active customer', async () => {
    const user = makeUser({
      id: OLD_ADMIN_USER_ID,
      roles: ['CUSTOMER_ADMIN'],
    })

    Customer.findOne.mockResolvedValue({
      _id: CUSTOMER_ID,
      governance: { customerAdminUserId: OLD_ADMIN_USER_ID },
    })

    await expect(
      customerGovernanceService.assertUserCanBeDisabledOrDeleted({
        user,
        operation: 'disable',
      }),
    ).rejects.toMatchObject({
      isGovernanceError: true,
      status: 409,
      code: 'CONFLICT',
      details: {
        reason: customerGovernanceService.GOVERNANCE_REASONS.CANONICAL_ADMIN_PROTECTED,
        operation: 'disable',
      },
    })
  })
})

describe('customerGovernanceService.assertTenantCreationWithinLimit', () => {
  test('allows tenant creation when current tenant count is below limit', () => {
    const customer = makeCustomer({
      governance: {
        maxTenants: 2,
        maxVmfsPerTenant: 1,
        customerAdminUserId: OLD_ADMIN_USER_ID,
      },
    })

    const result = customerGovernanceService.assertTenantCreationWithinLimit({
      customer,
      currentTenantCount: 1,
    })

    expect(result.limit).toBe(2)
    expect(result.currentCount).toBe(1)
    expect(result.nextCount).toBe(2)
  })

  test('throws deterministic conflict when tenant limit is reached', () => {
    const customer = makeCustomer({
      governance: {
        maxTenants: 1,
        maxVmfsPerTenant: 5,
        customerAdminUserId: OLD_ADMIN_USER_ID,
      },
    })

    expect(() =>
      customerGovernanceService.assertTenantCreationWithinLimit({
        customer,
        currentTenantCount: 1,
      }),
    ).toThrow('Tenant limit reached for this customer.')
  })
})

describe('customerGovernanceService.assertVmfCreationWithinLimit', () => {
  test('allows VMF creation when current count is below per-tenant limit', () => {
    const customer = makeCustomer({
      governance: {
        maxTenants: 5,
        maxVmfsPerTenant: 3,
        customerAdminUserId: OLD_ADMIN_USER_ID,
      },
    })

    const result = customerGovernanceService.assertVmfCreationWithinLimit({
      customer,
      tenantId: '707f1f77bcf86cd799439033',
      currentVmfCount: 2,
    })

    expect(result.limit).toBe(3)
    expect(result.currentCount).toBe(2)
    expect(result.nextCount).toBe(3)
  })

  test('throws deterministic conflict when VMF limit is reached', () => {
    const customer = makeCustomer({
      governance: {
        maxTenants: 5,
        maxVmfsPerTenant: 1,
        customerAdminUserId: OLD_ADMIN_USER_ID,
      },
    })

    expect(() =>
      customerGovernanceService.assertVmfCreationWithinLimit({
        customer,
        tenantId: '707f1f77bcf86cd799439033',
        currentVmfCount: 1,
      }),
    ).toThrow('VMF limit reached for this tenant.')
  })
})
