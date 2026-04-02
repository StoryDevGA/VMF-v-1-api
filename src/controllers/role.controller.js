import {
  PERMISSION_CATALOGUE,
  SUPER_ADMIN_LOCKED_PERMISSION_KEYS,
} from '../constants/permissionCatalogue.js'
import { Role, User } from '../models/index.js'
import logger from '../config/logger.js'
import auditService from '../services/auditService.js'
import performanceCacheService from '../services/performanceCacheService.js'

const DUPLICATE_ROLE_KEY_MESSAGE = 'A role with this key already exists.'
const SYSTEM_ROLE_MUTATION_MESSAGE = 'System roles are protected and cannot be modified.'
const SYSTEM_ROLE_SAVE_RESTRICTION_MESSAGE =
  'System roles can only have their permissions and activation status modified'
const SUPER_ADMIN_LOCKED_PERMISSION_MESSAGE_PREFIX =
  'SUPER_ADMIN must retain locked baseline permissions'
const USER_ROLE_ACTIVE_REQUIRED_MESSAGE =
  'USER role must remain active because tenant visibility assignments depend on it.'
const ROLE_IN_USE_MESSAGE = 'Role cannot be deleted while assigned to users.'
const RESERVED_ASSIGNABLE_ROLE_KEYS = Object.freeze(['CUSTOMER_ADMIN', 'SUPER_ADMIN'])
const EDITABLE_SYSTEM_ROLE_FIELDS = Object.freeze(['permissions', 'isActive'])
const SUPER_ADMIN_EDITABLE_FIELDS = Object.freeze(['permissions'])
const AUTHORIZATION_IMPACT_FIELDS = Object.freeze(['permissions', 'scope', 'isActive'])

const normalizeRoleKey = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .toUpperCase()

const escapeRegexForRoleKey = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildAssignedRoleUsageQuery = (roleKey) => {
  const normalized = normalizeRoleKey(roleKey)
  const pattern = `^${escapeRegexForRoleKey(normalized)}$`
  return {
    $or: [
      { 'memberships.roles': { $regex: pattern, $options: 'i' } },
      { 'tenantMemberships.roles': { $regex: pattern, $options: 'i' } },
    ],
  }
}

const normalizePermissionKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()

const isDuplicateRoleKeyError = (err) =>
  err?.code === 11000 && err?.keyPattern?.key

const arrayEquals = (left = [], right = []) => (
  Array.isArray(left)
  && Array.isArray(right)
  && left.length === right.length
  && left.every((value, index) => value === right[index])
)

const getAuthorizationImpactFields = (diff = {}) =>
  AUTHORIZATION_IMPACT_FIELDS.filter((field) => diff[field] !== undefined)

const mapAssignableRole = (role) => ({
  key: role.key,
  name: role.name,
  isActive: Boolean(role.isActive),
  isSystem: Boolean(role.isSystem),
})

const formatRoleAuditLabel = (role) => {
  const roleName = String(role?.name || '').trim()
  const roleKey = String(role?.key || '').trim()

  if (roleName && roleKey) return `${roleName} (${roleKey})`
  if (roleName) return roleName
  if (roleKey) return roleKey
  return 'Role'
}

const buildSystemRoleFieldRestrictionMessage = (
  allowedFields = EDITABLE_SYSTEM_ROLE_FIELDS,
  disallowedFields = [],
) => {
  const allowedFieldList = allowedFields.join(', ')

  if (disallowedFields.length === 0) {
    return `System roles can only update: ${allowedFieldList}.`
  }

  return `System roles can only update: ${allowedFieldList}. Disallowed fields: ${disallowedFields.join(', ')}.`
}

const getMissingSuperAdminLockedPermissions = (permissionKeys = []) => {
  const normalizedPermissionKeySet = new Set(
    Array.isArray(permissionKeys)
      ? permissionKeys.map(normalizePermissionKey).filter(Boolean)
      : [],
  )

  return SUPER_ADMIN_LOCKED_PERMISSION_KEYS.filter(
    (permissionKey) => !normalizedPermissionKeySet.has(permissionKey),
  )
}

const buildSuperAdminLockedPermissionMessage = (missingPermissionKeys = []) =>
  `${SUPER_ADMIN_LOCKED_PERMISSION_MESSAGE_PREFIX}: ${missingPermissionKeys.join(', ')}.`

const logBlockedSystemMutation = async (
  req,
  role,
  operation,
  attemptedFields = [],
  reason = 'SYSTEM_ROLE_PROTECTED',
  extraDiff = {},
) => {
  await auditService.logFromRequest(req, {
    action: auditService.AUDIT_ACTIONS.ROLE_MUTATION_BLOCKED,
    resourceType: auditService.RESOURCE_TYPES.Role,
    resourceId: role._id,
    scope: {},
    display: { resourceLabel: formatRoleAuditLabel(role) },
    diff: {
      reason,
      operation,
      attemptedFields,
      roleKey: role.key,
      ...extraDiff,
    },
  })
}

export const listRoles = async (req, res, next) => {
  try {
    const {
      q,
      scope,
      isSystem,
      isActive,
      page = 1,
      pageSize = 20,
    } = req.query

    const filter = {}

    if (q) {
      filter.$or = [
        { key: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
      ]
    }

    if (scope) {
      filter.scope = scope
    }
    if (typeof isSystem === 'boolean') {
      filter.isSystem = isSystem
    }
    if (typeof isActive === 'boolean') {
      filter.isActive = isActive
    }

    const pageNum = Math.max(1, Number(page) || 1)
    const limit = Math.min(100, Math.max(1, Number(pageSize) || 20))
    const skip = (pageNum - 1) * limit

    const [items, total] = await Promise.all([
      Role.find(filter)
        .sort({ isSystem: -1, scope: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Role.countDocuments(filter),
    ])

    const normalizedItems = items.map((item) => {
      const { _id, __v, ...rest } = item
      return {
        id: _id?.toString?.() || _id,
        ...rest,
      }
    })

    return res.status(200).json({
      data: normalizedItems,
      meta: {
        page: pageNum,
        pageSize: limit,
        total,
        totalPages: Math.ceil(total / limit),
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

export const listAssignableRoles = async (req, res, next) => {
  try {
    const roles = await Role.find({
      isActive: true,
      key: { $nin: RESERVED_ASSIGNABLE_ROLE_KEYS },
    })
      .sort({ isSystem: -1, name: 1, key: 1 })
      .lean()

    return res.status(200).json({
      data: roles.map(mapAssignableRole),
      meta: {
        customerId: req.params.customerId,
        total: roles.length,
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

export const getPermissionCatalogue = async (req, res, next) => {
  try {
    return res.status(200).json({
      data: PERMISSION_CATALOGUE,
      meta: {
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

export const createRole = async (req, res, next) => {
  try {
    const key = normalizeRoleKey(req.body.key)
    const existingRole = await Role.findOne({ key }).select('_id')

    if (existingRole) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_ROLE_KEY_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const role = new Role({
      ...req.body,
      key,
      isSystem: false,
    })

    await role.save()

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.ROLE_CREATED,
      resourceType: auditService.RESOURCE_TYPES.Role,
      resourceId: role._id,
      scope: {},
      display: { resourceLabel: formatRoleAuditLabel(role) },
      diff: {
        key: role.key,
        name: role.name,
        description: role.description,
        scope: role.scope,
        permissions: role.permissions,
        isSystem: role.isSystem,
        isActive: role.isActive,
      },
    })

    return res.status(201).json({
      data: role.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateRoleKeyError(err)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_ROLE_KEY_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (err?.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    next(err)
  }
}

export const getRole = async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.roleId)

    if (!role) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Role not found.',
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: role.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const updateRole = async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.roleId)

    if (!role) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Role not found.',
          requestId: req.requestId,
        },
      })
    }

    let fields = ['name', 'description', 'scope', 'permissions', 'isActive']

    if (role.isSystem) {
      const attemptedFields = Object.keys(req.body)
      const allowedFields = role.key === 'SUPER_ADMIN'
        ? SUPER_ADMIN_EDITABLE_FIELDS
        : EDITABLE_SYSTEM_ROLE_FIELDS

      const disallowedFields = attemptedFields.filter(
        (field) => !allowedFields.includes(field),
      )

      if (disallowedFields.length > 0) {
        await logBlockedSystemMutation(
          req,
          role,
          'update',
          attemptedFields,
          'SYSTEM_ROLE_FIELD_RESTRICTED',
        )

        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: buildSystemRoleFieldRestrictionMessage(allowedFields, disallowedFields),
            requestId: req.requestId,
          },
        })
      }

      if (role.key === 'SUPER_ADMIN' && req.body.permissions !== undefined) {
        const missingPermissionKeys = getMissingSuperAdminLockedPermissions(req.body.permissions)

        if (missingPermissionKeys.length > 0) {
          await logBlockedSystemMutation(
            req,
            role,
            'update',
            attemptedFields,
            'SUPER_ADMIN_LOCKED_PERMISSIONS_REQUIRED',
            { missingPermissionKeys },
          )

          return res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: buildSuperAdminLockedPermissionMessage(missingPermissionKeys),
              requestId: req.requestId,
            },
          })
        }
      }

      if (role.key === 'USER' && req.body.isActive === false) {
        await logBlockedSystemMutation(
          req,
          role,
          'update',
          attemptedFields,
          'USER_ROLE_ACTIVE_REQUIRED',
        )

        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: USER_ROLE_ACTIVE_REQUIRED_MESSAGE,
            requestId: req.requestId,
          },
        })
      }

      fields = [...allowedFields]
    }

    const diff = {}
    for (const field of fields) {
      if (req.body[field] === undefined) continue

      const previousValue = role[field]
      const nextValue = req.body[field]

      if (Array.isArray(previousValue) && Array.isArray(nextValue)) {
        if (arrayEquals(previousValue, nextValue)) continue
      } else if (previousValue === nextValue) {
        continue
      }

      diff[field] = { from: previousValue, to: nextValue }
      role[field] = nextValue
    }

    const authorizationImpactFields = getAuthorizationImpactFields(diff)
    const invalidationPlan = authorizationImpactFields.length > 0
      ? await performanceCacheService.planUserPermissionInvalidationForRoleKey(role.key)
      : null

    await role.save()

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.ROLE_UPDATED,
      resourceType: auditService.RESOURCE_TYPES.Role,
      resourceId: role._id,
      scope: {},
      display: { resourceLabel: formatRoleAuditLabel(role) },
      diff,
    })

    if (authorizationImpactFields.length > 0) {
      const invalidationSummary = await performanceCacheService.invalidateUserPermissionsForRoleKey(
        role.key,
        {
          affectedUserIds: invalidationPlan?.affectedUserIds,
          affectedUserCount: invalidationPlan?.affectedUserCount,
          invalidationPlan,
        },
      )

      logger.info(
        {
          requestId: req.requestId,
          roleId: role._id,
          roleKey: role.key,
          changedFields: authorizationImpactFields,
          affectedUserCount: invalidationPlan?.affectedUserCount ?? invalidationSummary.affectedUserCount,
          invalidatedUserCount: invalidationSummary.invalidatedUserCount,
          globalInvalidation: Boolean(invalidationSummary.globalInvalidation),
          globalInvalidationReason: invalidationSummary.globalInvalidationReason,
          redisFailureCount: invalidationSummary.redisFailureCount,
          skipped: Boolean(invalidationSummary.skipped),
        },
        'role authorization cache invalidation completed',
      )
    }

    return res.status(200).json({
      data: role.toJSON(),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.message?.startsWith(SUPER_ADMIN_LOCKED_PERMISSION_MESSAGE_PREFIX)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    if (err?.message === SYSTEM_ROLE_SAVE_RESTRICTION_MESSAGE) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: SYSTEM_ROLE_SAVE_RESTRICTION_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (err?.message === USER_ROLE_ACTIVE_REQUIRED_MESSAGE) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: USER_ROLE_ACTIVE_REQUIRED_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (err?.name === 'ValidationError') {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    next(err)
  }
}

export const deleteRole = async (req, res, next) => {
  try {
    const role = await Role.findById(req.params.roleId)

    if (!role) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Role not found.',
          requestId: req.requestId,
        },
      })
    }

    if (role.isSystem) {
      await logBlockedSystemMutation(req, role, 'delete')
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: SYSTEM_ROLE_MUTATION_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const assignedUserCount = await User.countDocuments(buildAssignedRoleUsageQuery(role.key))

    if (assignedUserCount > 0) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.ROLE_MUTATION_BLOCKED,
        resourceType: auditService.RESOURCE_TYPES.Role,
        resourceId: role._id,
        scope: {},
        display: { resourceLabel: formatRoleAuditLabel(role) },
        diff: {
          reason: 'ROLE_IN_USE',
          operation: 'delete',
          roleKey: role.key,
          assignedUserCount,
        },
      })

      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: ROLE_IN_USE_MESSAGE,
          details: {
            reason: 'ROLE_IN_USE',
            roleKey: role.key,
            assignedUserCount,
          },
          requestId: req.requestId,
        },
      })
    }

    await Role.deleteOne({ _id: role._id })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.ROLE_DELETED,
      resourceType: auditService.RESOURCE_TYPES.Role,
      resourceId: role._id,
      scope: {},
      display: { resourceLabel: formatRoleAuditLabel(role) },
      diff: {
        key: role.key,
        name: role.name,
        description: role.description,
        scope: role.scope,
        permissions: role.permissions,
      },
    })

    return res.status(200).json({
      data: {
        id: role.id || role._id.toString(),
        key: role.key,
        message: 'Role deleted successfully.',
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}
