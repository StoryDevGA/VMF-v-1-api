import RuntimePathRegistry, {
  RUNTIME_PATH_REGISTRY_OPERATIONS,
  RUNTIME_PATH_REGISTRY_STATUSES,
} from '../../models/RuntimePathRegistry.js'
import RuntimeSkill, { RUNTIME_SKILL_STATUSES } from '../../models/RuntimeSkill.js'
import SkillRoleRegistry, { SKILL_ROLE_REGISTRY_STATUSES } from '../../models/SkillRoleRegistry.js'
import { RUNTIME_VALIDATION_CODES, buildRuntimeValidationIssue } from './runtimeValidationCodes.js'
import { mergeRuntimeScopeLists, validateRuntimePathScopes } from './runtimeScopeValidator.js'

const leanQuery = async (query) => {
  if (!query) return null
  if (typeof query.lean === 'function') return query.lean()
  return query
}

const normalizeToken = (value) => String(value || '').trim()
const normalizeUpperToken = (value) => normalizeToken(value).toUpperCase()

const resolveRuntimeSkill = async (skillId) => {
  const normalizedSkillId = normalizeToken(skillId)
  if (!normalizedSkillId) return null

  const skillKey = normalizedSkillId.startsWith('skill-')
    ? normalizedSkillId.slice('skill-'.length)
    : normalizedSkillId

  return leanQuery(RuntimeSkill.findOne({
    $or: [
      { stableId: normalizedSkillId },
      { key: skillKey },
    ],
  }))
}

const resolveSkillRole = async (skillRoleKey) => {
  const normalizedSkillRoleKey = normalizeUpperToken(skillRoleKey)
  if (!normalizedSkillRoleKey) return null
  return leanQuery(SkillRoleRegistry.findOne({ roleKey: normalizedSkillRoleKey }))
}

const buildPathIssue = (message, path = 'runtimePath') => buildRuntimeValidationIssue({
  code: RUNTIME_VALIDATION_CODES.PATH_INVALID,
  severity: 'BLOCKING',
  message,
  path,
  source: 'runtime-mutation-validator',
})

const buildSkillIssue = (message, path = 'skillId') => buildRuntimeValidationIssue({
  code: RUNTIME_VALIDATION_CODES.SKILL_INVALID,
  severity: 'BLOCKING',
  message,
  path,
  source: 'runtime-mutation-validator',
})

const isFrameworkCompatible = (frameworkKeys, frameworkKey) => {
  const normalizedFrameworkKey = normalizeUpperToken(frameworkKey)
  if (!normalizedFrameworkKey) return true
  if (!Array.isArray(frameworkKeys) || frameworkKeys.length === 0) return true
  return frameworkKeys.map((value) => normalizeUpperToken(value)).includes(normalizedFrameworkKey)
}

const validateRuntimePathRegistryEntry = ({ runtimePathEntry, runtimePath, frameworkKey, operation }) => {
  const issues = []
  const normalizedOperation = normalizeUpperToken(operation)

  if (!runtimePathEntry) {
    issues.push(buildPathIssue(`Runtime path "${runtimePath}" is not registered.`))
    return issues
  }

  if (runtimePathEntry.status !== RUNTIME_PATH_REGISTRY_STATUSES.ACTIVE) {
    issues.push(buildPathIssue(`Runtime path "${runtimePath}" must be ACTIVE before runtime use.`))
  }

  if (!isFrameworkCompatible(runtimePathEntry.frameworkKeys, frameworkKey)) {
    issues.push(buildPathIssue(`Runtime path "${runtimePath}" does not support framework "${frameworkKey}".`))
  }

  const allowedOperations = Array.isArray(runtimePathEntry.allowedOperations)
    ? runtimePathEntry.allowedOperations.map((value) => normalizeUpperToken(value))
    : []
  if (normalizedOperation && !allowedOperations.includes(normalizedOperation)) {
    issues.push(buildPathIssue(`Runtime path "${runtimePath}" does not allow ${normalizedOperation}.`))
  }

  if (normalizedOperation === RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE && runtimePathEntry.isProtected) {
    issues.push(buildPathIssue(`Runtime path "${runtimePath}" is protected from runtime writes.`))
  }

  return issues
}

const validateSkillBoundary = ({ skill, runtimePath, operation }) => {
  if (!skill) return []
  const normalizedOperation = normalizeUpperToken(operation)
  const allowedReadScopes = normalizedOperation === RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE
    ? []
    : skill.allowedReadPaths
  const allowedWriteScopes = normalizedOperation === RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE
    ? skill.allowedWritePaths
    : []

  return validateRuntimePathScopes({
    runtimePath,
    operation,
    allowedReadScopes,
    allowedWriteScopes,
    forbiddenReadScopes: [],
    forbiddenWriteScopes: skill.forbiddenWritePaths,
  }).map((issue) => ({
    ...issue,
    source: 'runtime-skill-boundary-validator',
    message: issue.message.replace('configured', 'skill configured'),
  }))
}

const validateSkillRoleBoundary = ({ skillRole, runtimePath, operation }) => {
  if (!skillRole) return []
  const normalizedOperation = normalizeUpperToken(operation)
  const issues = []

  if (skillRole.status !== SKILL_ROLE_REGISTRY_STATUSES.ACTIVE) {
    issues.push(buildSkillIssue(`Skill role "${skillRole.roleKey}" must be ACTIVE before runtime use.`, 'skillRoleKey'))
  }

  const allowedOperations = Array.isArray(skillRole.allowedOperations)
    ? skillRole.allowedOperations.map((value) => normalizeUpperToken(value))
    : []
  if (normalizedOperation && allowedOperations.length > 0 && !allowedOperations.includes(normalizedOperation)) {
    issues.push(buildSkillIssue(`Skill role "${skillRole.roleKey}" does not allow ${normalizedOperation}.`, 'skillRoleKey'))
  }

  return issues.concat(validateRuntimePathScopes({
    runtimePath,
    operation,
    allowedReadScopes: skillRole.allowedReadScopes,
    allowedWriteScopes: skillRole.allowedWriteScopes,
    forbiddenReadScopes: skillRole.forbiddenReadScopes,
    forbiddenWriteScopes: skillRole.forbiddenWriteScopes,
  }).map((issue) => ({
    ...issue,
    source: 'runtime-skill-role-boundary-validator',
    message: issue.message.replace('configured', 'skill role configured'),
  })))
}

const validateRequestBoundary = ({
  runtimePath,
  operation,
  allowedReadScopes,
  allowedWriteScopes,
  forbiddenReadScopes,
  forbiddenWriteScopes,
}) => validateRuntimePathScopes({
  runtimePath,
  operation,
  allowedReadScopes,
  allowedWriteScopes,
  forbiddenReadScopes,
  forbiddenWriteScopes,
})

export const validateRuntimeMutation = async ({
  runtimePath,
  operation,
  frameworkKey,
  skillId,
  skillRoleKey,
  allowedReadScopes,
  allowedWriteScopes,
  forbiddenReadScopes,
  forbiddenWriteScopes,
}) => {
  const normalizedRuntimePath = normalizeToken(runtimePath)
  const normalizedOperation = normalizeUpperToken(operation)
  const issues = []

  if (!normalizedRuntimePath) {
    return [buildPathIssue('Runtime path is required for state mutation validation.')]
  }

  const runtimePathEntry = await leanQuery(RuntimePathRegistry.findOne({ pathKey: normalizedRuntimePath }))
  issues.push(...validateRuntimePathRegistryEntry({
    runtimePathEntry,
    runtimePath: normalizedRuntimePath,
    frameworkKey,
    operation: normalizedOperation,
  }))

  const skill = await resolveRuntimeSkill(skillId)
  if (normalizeToken(skillId) && !skill) {
    issues.push(buildSkillIssue(`Runtime skill "${skillId}" was not found.`))
  }

  if (skill && skill.status !== RUNTIME_SKILL_STATUSES.ACTIVE) {
    issues.push(buildSkillIssue(`Runtime skill "${skill.key || skill.stableId}" must be ACTIVE before runtime use.`))
  }

  const roleKey = normalizeUpperToken(skillRoleKey || skill?.skillRoleKey)
  const skillRole = await resolveSkillRole(roleKey)
  if (roleKey && !skillRole) {
    issues.push(buildSkillIssue(`Skill role "${roleKey}" was not found.`, 'skillRoleKey'))
  }

  issues.push(...validateSkillBoundary({
    skill,
    runtimePath: normalizedRuntimePath,
    operation: normalizedOperation,
  }))
  issues.push(...validateSkillRoleBoundary({
    skillRole,
    runtimePath: normalizedRuntimePath,
    operation: normalizedOperation,
  }))
  issues.push(...validateRequestBoundary({
    runtimePath: normalizedRuntimePath,
    operation: normalizedOperation,
    allowedReadScopes: mergeRuntimeScopeLists(allowedReadScopes),
    allowedWriteScopes: mergeRuntimeScopeLists(allowedWriteScopes),
    forbiddenReadScopes: mergeRuntimeScopeLists(forbiddenReadScopes),
    forbiddenWriteScopes: mergeRuntimeScopeLists(forbiddenWriteScopes),
  }))

  return issues
}
