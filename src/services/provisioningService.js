/**
 * Provisioning Service
 *
 * Encapsulates provisioning logic for customers and tenants and adds
 * a transactional onboarding flow for external API consumers.
 */

import mongoose from 'mongoose'
import { Customer, Tenant, User, VMF } from '../models/index.js'
import logger from '../config/logger.js'
import auditService from './auditService.js'
import customerGovernanceService from './customerGovernanceService.js'

const DEFAULT_BILLING = Object.freeze({ planCode: 'DEFAULT', cycle: 'MONTHLY' })
const DUPLICATE_CUSTOMER_NAME_MESSAGE = 'A customer with this name already exists.'
const INACTIVE_ADMIN_USER_MESSAGE = 'Admin user must be active for onboarding.'
const DUPLICATE_ADMIN_EMAIL_MESSAGE = 'A user with this email already exists and cannot be used as onboarding admin.'

const normalizeCustomerName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

const normalizeEmail = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()

const createProvisioningError = ({ status, code, message, details }) => {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.details = details
  err.isProvisioningError = true
  return err
}

const isProvisioningError = (err) => Boolean(err?.isProvisioningError)

const attachSession = (query, session) => {
  if (!session) return query
  if (query && typeof query.session === 'function') {
    return query.session(session)
  }
  return query
}

const saveDocument = async (doc, session) => {
  if (!session) return doc.save()
  return doc.save({ session })
}

const findCustomerByNormalizedName = async (normalizedName, session) => {
  if (!normalizedName) return null
  const query = Customer.findOne({ nameNormalized: normalizedName }).select('_id')
  return attachSession(query, session)
}

const findUserByEmail = async (email, session) => {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const query = User.findOne({ email: normalized })
  return attachSession(query, session)
}

const resolveOnboardingTopology = (customerInput) =>
  customerInput.topology || 'MULTI_TENANT'

const resolveOnboardingVmfPolicy = (customerInput, topology) => {
  if (customerInput.vmfPolicy) return customerInput.vmfPolicy
  return topology === 'SINGLE_TENANT' ? 'SINGLE' : 'PER_TENANT_MULTI'
}

const assertTopologyAndPolicyCompatible = (topology, vmfPolicy) => {
  if (topology === 'SINGLE_TENANT' && !['SINGLE', 'MULTI'].includes(vmfPolicy)) {
    throw createProvisioningError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Single-tenant onboarding requires SINGLE or MULTI vmfPolicy.',
      details: { topology, vmfPolicy },
    })
  }

  if (topology === 'MULTI_TENANT' && !['PER_TENANT_SINGLE', 'PER_TENANT_MULTI'].includes(vmfPolicy)) {
    throw createProvisioningError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Multi-tenant onboarding requires PER_TENANT_SINGLE or PER_TENANT_MULTI vmfPolicy.',
      details: { topology, vmfPolicy },
    })
  }
}

const buildOnboardingPayload = ({ customerInput, adminUserId }) => {
  const topology = resolveOnboardingTopology(customerInput)
  const vmfPolicy = resolveOnboardingVmfPolicy(customerInput, topology)
  assertTopologyAndPolicyCompatible(topology, vmfPolicy)

  const name = customerInput.companyName || customerInput.name

  return {
    name,
    website: customerInput.website,
    topology,
    vmfPolicy,
    isServiceProvider: customerInput.serviceProvider ?? customerInput.isServiceProvider ?? false,
    licenseLevelId: customerInput.licenseLevelId,
    governance: {
      maxTenants: customerInput.maxTenants ?? customerInput.governance?.maxTenants ?? 1,
      maxVmfsPerTenant: customerInput.maxVmfsPerTenant ?? customerInput.governance?.maxVmfsPerTenant ?? 1,
      customerAdminUserId: adminUserId,
    },
    entitlements: customerInput.entitlements || [],
    billing: {
      planCode: customerInput.planCode || customerInput.billing?.planCode || DEFAULT_BILLING.planCode,
      cycle: customerInput.billingCycle || customerInput.billing?.cycle || DEFAULT_BILLING.cycle,
    },
    trial: customerInput.trial || { isTrial: false },
  }
}

/**
 * Create a customer and provision its required defaults.
 *
 * @param {Object} payload
 * @param {string} payload.name
 * @param {string} payload.topology - SINGLE_TENANT | MULTI_TENANT
 * @param {string} payload.vmfPolicy - SINGLE | MULTI | PER_TENANT_SINGLE | PER_TENANT_MULTI
 * @param {boolean} [payload.isServiceProvider]
 * @param {string} [payload.licenseLevelId]
 * @param {{ maxTenants?: number, maxVmfsPerTenant?: number, customerAdminUserId?: string }} [payload.governance]
 * @param {string[]} [payload.entitlements]
 * @param {Object} [payload.billing]
 * @param {Object} [payload.trial]
 * @param {string} actorUserId
 * @param {import('express').Request} [req]
 * @param {{ session?: import('mongoose').ClientSession|null, skipAudit?: boolean, defaultTenantAdminUserId?: string|null }} [options]
 * @returns {Promise<{ customer: Object, tenant: Object|null, vmf: Object|null }>}
 */
export const createCustomerWithDefaults = async (payload, actorUserId, req, options = {}) => {
  const {
    session = null,
    skipAudit = false,
    defaultTenantAdminUserId = null,
  } = options

  const result = { customer: null, tenant: null, vmf: null }

  const customer = new Customer({
    name: payload.name,
    website: payload.website,
    topology: payload.topology,
    vmfPolicy: payload.vmfPolicy,
    isServiceProvider: payload.isServiceProvider ?? false,
    licenseLevelId: payload.licenseLevelId ?? null,
    governance: payload.governance || undefined,
    status: 'ACTIVE',
    entitlements: payload.entitlements || [],
    billing: payload.billing || DEFAULT_BILLING,
    trial: payload.trial || { isTrial: false },
    createdBy: actorUserId,
  })

  if (payload.topology === 'SINGLE_TENANT') {
    const tenantAdminUserId = defaultTenantAdminUserId || actorUserId

    if (!tenantAdminUserId) {
      throw createProvisioningError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Default tenant admin user is required for single-tenant provisioning.',
      })
    }

    const tenant = new Tenant({
      customerId: customer._id,
      name: 'Default Tenant',
      website: 'https://default.tenant',
      status: 'ENABLED',
      isDefault: true,
      tenantAdminUserIds: [tenantAdminUserId],
    })
    await saveDocument(tenant, session)

    customer.defaultTenantId = tenant._id
    await saveDocument(customer, session)

    result.customer = customer
    result.tenant = tenant

    if (!skipAudit) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_CREATED',
        resourceType: 'Customer',
        resourceId: customer._id,
        scope: { customerId: customer._id },
        diff: null,
      })
      await auditService.logFromRequest(req, {
        action: 'TENANT_CREATED',
        resourceType: 'Tenant',
        resourceId: tenant._id,
        scope: { customerId: customer._id, tenantId: tenant._id },
        diff: null,
      })
    }

    const vmf = new VMF({
      customerId: customer._id,
      tenantId: tenant._id,
      name: 'VMF 1',
      status: 'ACTIVE',
      createdBy: actorUserId,
    })
    await saveDocument(vmf, session)
    result.vmf = vmf

    if (!skipAudit) {
      await auditService.logFromRequest(req, {
        action: 'VMF_CREATED',
        resourceType: 'VMF',
        resourceId: vmf._id,
        scope: { customerId: customer._id, tenantId: tenant._id, vmfId: vmf._id },
        diff: null,
      })
    }

    logger.info(
      { customerId: customer._id, tenantId: tenant._id, vmfId: vmf._id },
      'provisioning - single-tenant customer created with default tenant + VMF 1',
    )
  } else {
    customer.defaultTenantId = undefined
    await saveDocument(customer, session)
    result.customer = customer

    if (!skipAudit) {
      await auditService.logFromRequest(req, {
        action: 'CUSTOMER_CREATED',
        resourceType: 'Customer',
        resourceId: customer._id,
        scope: { customerId: customer._id },
        diff: null,
      })
    }

    logger.info(
      { customerId: customer._id },
      'provisioning - multi-tenant customer created (no default tenant)',
    )
  }

  return result
}

/**
 * Create a tenant under an existing customer, optionally auto-creating VMF 1.
 *
 * @param {Object} payload
 * @param {string} payload.name
 * @param {string} payload.website
 * @param {string[]} payload.tenantAdminUserIds
 * @param {Object} customer
 * @param {string} actorUserId
 * @param {import('express').Request} [req]
 * @param {{ session?: import('mongoose').ClientSession|null, skipAudit?: boolean }} [options]
 * @returns {Promise<{ tenant: Object, vmf: Object|null }>}
 */
export const createTenantWithDefaults = async (payload, customer, actorUserId, req, options = {}) => {
  const { session = null, skipAudit = false } = options
  const result = { tenant: null, vmf: null }

  const tenant = new Tenant({
    customerId: customer._id,
    name: payload.name,
    website: payload.website,
    status: 'ENABLED',
    isDefault: false,
    tenantAdminUserIds: payload.tenantAdminUserIds,
  })
  await saveDocument(tenant, session)
  result.tenant = tenant

  if (!skipAudit) {
    await auditService.logFromRequest(req, {
      action: 'TENANT_CREATED',
      resourceType: 'Tenant',
      resourceId: tenant._id,
      scope: { customerId: customer._id, tenantId: tenant._id },
      diff: null,
    })
  }

  if (['PER_TENANT_SINGLE', 'PER_TENANT_MULTI'].includes(customer.vmfPolicy)) {
    const vmf = new VMF({
      customerId: customer._id,
      tenantId: tenant._id,
      name: 'VMF 1',
      status: 'ACTIVE',
      createdBy: actorUserId,
    })
    await saveDocument(vmf, session)
    result.vmf = vmf

    if (!skipAudit) {
      await auditService.logFromRequest(req, {
        action: 'VMF_CREATED',
        resourceType: 'VMF',
        resourceId: vmf._id,
        scope: { customerId: customer._id, tenantId: tenant._id, vmfId: vmf._id },
        diff: null,
      })
    }
  }

  logger.info(
    { customerId: customer._id, tenantId: tenant._id, vmfId: result.vmf?._id || null },
    `provisioning - tenant created${result.vmf ? ' with VMF 1' : ''}`,
  )

  return result
}

/**
 * Transactional external onboarding: customer + canonical admin + defaults.
 *
 * @param {{ customer: Object, adminUser: { name: string, email: string } }} payload
 * @param {string} actorUserId
 * @param {import('express').Request} [req]
 * @returns {Promise<{ customer: Object, adminUser: Object, tenant: Object|null, vmf: Object|null, usedExistingAdmin: boolean }>}
 */
export const onboardCustomerWithAdmin = async (payload, actorUserId, req) => {
  const session = await mongoose.startSession()

  try {
    const result = {
      customer: null,
      adminUser: null,
      tenant: null,
      vmf: null,
      usedExistingAdmin: false,
    }

    await session.withTransaction(async () => {
      const customerInput = payload?.customer || {}
      const adminInput = payload?.adminUser || {}

      const customerName = String(customerInput.companyName || customerInput.name || '').trim()
      if (!customerName) {
        throw createProvisioningError({
          status: 422,
          code: 'VALIDATION_FAILED',
          message: 'customer.companyName is required.',
        })
      }

      const normalizedCustomerName = normalizeCustomerName(customerName)
      const existingCustomer = await findCustomerByNormalizedName(normalizedCustomerName, session)
      if (existingCustomer) {
        throw createProvisioningError({
          status: 409,
          code: 'CONFLICT',
          message: DUPLICATE_CUSTOMER_NAME_MESSAGE,
          details: { customerName: customerName.trim() },
        })
      }

      const adminEmail = normalizeEmail(adminInput.email)
      if (!adminEmail) {
        throw createProvisioningError({
          status: 422,
          code: 'VALIDATION_FAILED',
          message: 'adminUser.email is required.',
        })
      }

      if (!String(adminInput.name || '').trim()) {
        throw createProvisioningError({
          status: 422,
          code: 'VALIDATION_FAILED',
          message: 'adminUser.name is required.',
        })
      }

      let adminUser = await findUserByEmail(adminEmail, session)
      if (adminUser && !adminUser.isActive) {
        throw createProvisioningError({
          status: 422,
          code: 'VALIDATION_FAILED',
          message: INACTIVE_ADMIN_USER_MESSAGE,
          details: { email: adminEmail },
        })
      }

      if (!adminUser) {
        adminUser = new User({
          name: adminInput.name,
          email: adminEmail,
          isActive: true,
          identityPlus: { trustStatus: 'UNTRUSTED' },
          memberships: [],
          tenantMemberships: [],
          vmfGrants: [],
        })
      } else {
        result.usedExistingAdmin = true
      }

      const onboardingPayload = buildOnboardingPayload({
        customerInput: {
          ...customerInput,
          name: customerName,
        },
        adminUserId: adminUser._id,
      })

      const created = await createCustomerWithDefaults(
        onboardingPayload,
        actorUserId,
        req,
        {
          session,
          skipAudit: true,
          defaultTenantAdminUserId: adminUser._id,
        },
      )

      const userChanged = customerGovernanceService.ensureCustomerAdminRole(
        adminUser,
        created.customer._id,
      )

      if (!result.usedExistingAdmin || userChanged) {
        await saveDocument(adminUser, session)
      }

      const canonicalUserId = created.customer.governance?.customerAdminUserId?.toString()
      const adminUserId = adminUser._id?.toString()
      if (canonicalUserId !== adminUserId) {
        created.customer.governance = {
          ...(created.customer.governance || {}),
          customerAdminUserId: adminUser._id,
        }
        await saveDocument(created.customer, session)
      }

      result.customer = created.customer
      result.adminUser = adminUser
      result.tenant = created.tenant
      result.vmf = created.vmf
    })

    return result
  } catch (err) {
    if (isProvisioningError(err)) {
      throw err
    }

    if (err?.code === 11000 && (err?.keyPattern?.nameNormalized || err?.keyPattern?.name)) {
      throw createProvisioningError({
        status: 409,
        code: 'CONFLICT',
        message: DUPLICATE_CUSTOMER_NAME_MESSAGE,
      })
    }

    if (err?.code === 11000 && err?.keyPattern?.email) {
      throw createProvisioningError({
        status: 409,
        code: 'CONFLICT',
        message: DUPLICATE_ADMIN_EMAIL_MESSAGE,
      })
    }

    throw err
  } finally {
    await session.endSession()
  }
}

export { createProvisioningError, isProvisioningError }
