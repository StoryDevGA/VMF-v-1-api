import { Role } from '../models/index.js'

export const CUSTOMER_USER_ASSIGNABLE_ROLE_SCOPES = Object.freeze([
  'CUSTOMER',
  'TENANT',
  'VMF',
])

export const TENANT_MEMBERSHIP_ASSIGNABLE_ROLE_SCOPES = Object.freeze([
  'TENANT',
  'VMF',
])

export const IMPLICIT_TENANT_MEMBERSHIP_ROLE_KEYS = Object.freeze(['USER'])

const ROLE_ASSIGNMENT_VALIDATION_REASON = 'ROLE_ASSIGNMENT_INVALID'

const normalizeRoleKey = (roleKey) =>
  String(roleKey || '')
    .trim()
    .toUpperCase()

export const normalizeRoleAssignmentKeys = (roleKeys = []) =>
  [...new Set(
    (Array.isArray(roleKeys) ? roleKeys : [])
      .map(normalizeRoleKey)
      .filter(Boolean),
  )]

const buildRoleAssignmentError = ({
  field,
  assignmentLabel,
  missingRoleKeys,
  inactiveRoleKeys,
  scopeIncompatibleRoles,
  allowedScopes,
}) => {
  const issues = []

  if (missingRoleKeys.length > 0) {
    issues.push(`Unknown role keys: ${missingRoleKeys.join(', ')}`)
  }

  if (inactiveRoleKeys.length > 0) {
    issues.push(`Inactive role keys: ${inactiveRoleKeys.join(', ')}`)
  }

  if (scopeIncompatibleRoles.length > 0) {
    issues.push(
      `Scope-incompatible role keys for ${assignmentLabel}: ${scopeIncompatibleRoles
        .map(({ key, scope }) => `${key} (${scope})`)
        .join(', ')}. Allowed scopes: ${allowedScopes.join(', ')}`,
    )
  }

  const roleMessage = issues.join('. ')
  const error = new Error(`One or more roles are invalid for this assignment. ${roleMessage}`.trim())

  error.status = 422
  error.code = 'VALIDATION_FAILED'
  error.details = {
    reason: ROLE_ASSIGNMENT_VALIDATION_REASON,
    [field]: roleMessage,
    ...(missingRoleKeys.length > 0 ? { missingRoleKeys } : {}),
    ...(inactiveRoleKeys.length > 0 ? { inactiveRoleKeys } : {}),
    ...(scopeIncompatibleRoles.length > 0
      ? {
          scopeIncompatibleRoleKeys: scopeIncompatibleRoles.map(({ key }) => key),
          scopeIncompatibleRoles: scopeIncompatibleRoles.map(({ key, scope }) => ({ key, scope })),
          allowedScopes,
        }
      : {}),
  }

  return error
}

export const isRoleAssignmentValidationError = (err) =>
  err?.code === 'VALIDATION_FAILED'
  && err?.details?.reason === ROLE_ASSIGNMENT_VALIDATION_REASON

export const loadRoleDefinitionsByKey = async (roleKeys = []) => {
  const normalizedRoleKeys = normalizeRoleAssignmentKeys(roleKeys)

  if (normalizedRoleKeys.length === 0) {
    return new Map()
  }

  let query = Role.find({ key: { $in: normalizedRoleKeys } })

  if (query && typeof query.lean === 'function') {
    query = query.lean()
  }

  const roles = await query

  return new Map(
    (Array.isArray(roles) ? roles : []).map((role) => [normalizeRoleKey(role.key), role]),
  )
}

export const validateRoleAssignments = ({
  roleKeys = [],
  roleDefinitionsByKey = new Map(),
  allowedScopes = CUSTOMER_USER_ASSIGNABLE_ROLE_SCOPES,
  field = 'roles',
  assignmentLabel = 'role assignment',
}) => {
  const normalizedRoleKeys = normalizeRoleAssignmentKeys(roleKeys)

  if (normalizedRoleKeys.length === 0) {
    return normalizedRoleKeys
  }

  const missingRoleKeys = []
  const inactiveRoleKeys = []
  const scopeIncompatibleRoles = []

  for (const roleKey of normalizedRoleKeys) {
    const roleDefinition = roleDefinitionsByKey.get(roleKey)

    if (!roleDefinition) {
      missingRoleKeys.push(roleKey)
      continue
    }

    if (roleDefinition.isActive !== true) {
      inactiveRoleKeys.push(roleKey)
      continue
    }

    if (!allowedScopes.includes(roleDefinition.scope)) {
      scopeIncompatibleRoles.push({ key: roleKey, scope: roleDefinition.scope || 'UNKNOWN' })
    }
  }

  if (
    missingRoleKeys.length > 0
    || inactiveRoleKeys.length > 0
    || scopeIncompatibleRoles.length > 0
  ) {
    throw buildRoleAssignmentError({
      field,
      assignmentLabel,
      missingRoleKeys,
      inactiveRoleKeys,
      scopeIncompatibleRoles,
      allowedScopes,
    })
  }

  return normalizedRoleKeys
}