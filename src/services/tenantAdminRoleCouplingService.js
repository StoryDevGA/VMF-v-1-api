import mongoose from 'mongoose'
import { Customer, Tenant, User } from '../models/index.js'
import customerGovernanceService from './customerGovernanceService.js'
import { createTenantWithDefaults } from './provisioningService.js'
import {
  buildTenantAdminAssignmentErrorPayload,
  TENANT_MANAGEMENT_REASONS,
  validateTenantAdminAssignments,
} from './tenantManagementContractService.js'

const TENANT_ADMIN_ROLE = 'TENANT_ADMIN'

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

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

const normalizeTenantAdminUserIds = (tenantAdminUserIds = []) =>
  Array.from(
    new Set(
      (Array.isArray(tenantAdminUserIds) ? tenantAdminUserIds : [])
        .map((userId) => toIdString(userId))
        .filter(Boolean),
    ),
  )

const resolveCustomerMembership = (user, customerId) =>
  (user?.memberships || []).find(
    (membership) => toIdString(membership?.customerId) === toIdString(customerId),
  ) || null

const createHttpResponseError = ({ status, code, message, response }) => {
  const err = new Error(message || response?.error?.message || 'Request failed.')
  err.status = status
  err.code = code
  err.response = response
  err.isHttpResponseError = true
  return err
}

const buildTenantNotFoundError = (requestId) =>
  createHttpResponseError({
    status: 404,
    code: 'NOT_FOUND',
    response: {
      error: {
        code: 'NOT_FOUND',
        message: 'Tenant not found.',
        requestId,
      },
    },
  })

const buildCustomerNotFoundError = (requestId) =>
  createHttpResponseError({
    status: 404,
    code: 'NOT_FOUND',
    response: {
      error: {
        code: 'NOT_FOUND',
        message: 'Customer not found.',
        requestId,
      },
    },
  })

const buildTenantAdminAssignmentValidationError = ({
  customerId,
  requestId,
  validation,
}) =>
  createHttpResponseError({
    status: 422,
    code: 'VALIDATION_FAILED',
    response: {
      error: buildTenantAdminAssignmentErrorPayload({
        customerId,
        validation,
        requestId,
      }),
    },
  })

const findUsersForValidation = ({ session }) => (filter) => {
  const query = attachSession(User.find(filter), session)
  if (query && typeof query.lean === 'function') {
    return query.lean()
  }
  return query
}

const findTenantAdminUser = async ({
  customerId,
  userId,
  session,
}) =>
  attachSession(
    User.findOne({
      _id: userId,
      memberships: {
        $elemMatch: { customerId },
      },
    }),
    session,
  )

export const ensureTenantAdminCustomerRole = ({ user, customerId }) => {
  const membership = resolveCustomerMembership(user, customerId)

  if (!membership) {
    throw buildTenantAdminAssignmentValidationError({
      customerId,
      requestId: null,
      validation: {
        message: 'One or more tenant admin assignments are invalid.',
        reason: TENANT_MANAGEMENT_REASONS.INVALID_TENANT_ADMIN_ASSIGNMENTS,
        invalidTenantAdminUserIds: [toIdString(user?._id || user?.id)].filter(Boolean),
        missingTenantAdminUserIds: [],
        inactiveTenantAdminUserIds: [],
        outOfCustomerTenantAdminUserIds: [toIdString(user?._id || user?.id)].filter(Boolean),
      },
    })
  }

  const previousRoles = Array.from(new Set(membership.roles || []))
  if (previousRoles.includes(TENANT_ADMIN_ROLE)) {
    return {
      changed: false,
      previousRoles,
      nextRoles: previousRoles,
    }
  }

  membership.roles = [...previousRoles, TENANT_ADMIN_ROLE]

  return {
    changed: true,
    previousRoles,
    nextRoles: [...membership.roles],
  }
}

const validateTenantAdminAssignmentsInSession = async ({
  customerId,
  requestId,
  tenantAdminUserIds,
  session,
}) => {
  const validation = await validateTenantAdminAssignments({
    customerId,
    tenantAdminUserIds,
    findUsers: findUsersForValidation({ session }),
  })

  if (validation) {
    throw buildTenantAdminAssignmentValidationError({
      customerId,
      requestId,
      validation,
    })
  }
}

export const createTenantWithAdminRoleCoupling = async ({
  customerId,
  payload,
  actorUserId,
  req,
  startSession = mongoose.startSession,
}) => {
  const session = await startSession()
  let mutationResult = null

  try {
    await session.withTransaction(async () => {
      const customer = await attachSession(Customer.findById(customerId), session)

      if (!customer) {
        throw buildCustomerNotFoundError(req.requestId)
      }

      const currentTenantCount = await attachSession(
        Tenant.countDocuments({
          customerId: customer._id,
          status: { $ne: 'ARCHIVED' },
        }),
        session,
      )

      customerGovernanceService.assertTenantCreationWithinLimit({
        customer,
        currentTenantCount,
      })

      await validateTenantAdminAssignmentsInSession({
        customerId: customer._id,
        requestId: req.requestId,
        tenantAdminUserIds: payload.tenantAdminUserIds,
        session,
      })

      const [tenantAdminUserId] = normalizeTenantAdminUserIds(payload.tenantAdminUserIds)
      const tenantAdminUser = tenantAdminUserId
        ? await findTenantAdminUser({
            customerId: customer._id,
            userId: tenantAdminUserId,
            session,
          })
        : null

      const tenantAdminRoleChange = tenantAdminUser
        ? ensureTenantAdminCustomerRole({
            user: tenantAdminUser,
            customerId: customer._id,
          })
        : null

      if (tenantAdminRoleChange?.changed) {
        await saveDocument(tenantAdminUser, session)
      }

      const created = await createTenantWithDefaults(
        payload,
        customer,
        actorUserId,
        req,
        { session, skipAudit: true },
      )

      mutationResult = {
        customer,
        tenant: created.tenant,
        vmf: created.vmf,
        tenantAdminUser,
        tenantAdminRoleChange,
      }
    })

    return mutationResult
  } finally {
    await session.endSession()
  }
}

export const updateTenantWithAdminRoleCoupling = async ({
  tenantId,
  updates,
  req,
  startSession = mongoose.startSession,
}) => {
  const session = await startSession()
  let mutationResult = null

  try {
    await session.withTransaction(async () => {
      const tenant = await attachSession(Tenant.findById(tenantId), session)

      if (!tenant) {
        throw buildTenantNotFoundError(req.requestId)
      }

      if (updates.tenantAdminUserIds !== undefined) {
        await validateTenantAdminAssignmentsInSession({
          customerId: tenant.customerId,
          requestId: req.requestId,
          tenantAdminUserIds: updates.tenantAdminUserIds,
          session,
        })
      }

      const allowedFields = ['name', 'website', 'tenantAdminUserIds']
      const diff = {}

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          diff[field] = { from: tenant[field], to: updates[field] }
          tenant[field] = updates[field]
        }
      }

      let tenantAdminUser = null
      let tenantAdminRoleChange = null

      if (updates.tenantAdminUserIds !== undefined) {
        const [tenantAdminUserId] = normalizeTenantAdminUserIds(updates.tenantAdminUserIds)
        tenantAdminUser = tenantAdminUserId
          ? await findTenantAdminUser({
              customerId: tenant.customerId,
              userId: tenantAdminUserId,
              session,
            })
          : null

        tenantAdminRoleChange = tenantAdminUser
          ? ensureTenantAdminCustomerRole({
              user: tenantAdminUser,
              customerId: tenant.customerId,
            })
          : null

        if (tenantAdminRoleChange?.changed) {
          await saveDocument(tenantAdminUser, session)
        }
      }

      await saveDocument(tenant, session)

      mutationResult = {
        tenant,
        diff,
        tenantAdminUser,
        tenantAdminRoleChange,
      }
    })

    return mutationResult
  } finally {
    await session.endSession()
  }
}

export const isHttpResponseError = (err) => Boolean(err?.isHttpResponseError)
