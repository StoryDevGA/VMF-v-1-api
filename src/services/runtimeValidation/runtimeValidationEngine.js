import { randomUUID } from 'node:crypto'
import { RUNTIME_PATH_REGISTRY_OPERATIONS } from '../../models/RuntimePathRegistry.js'
import logger from '../../config/logger.js'
import { RUNTIME_VALIDATION_CODES, buildRuntimeValidationIssue } from './runtimeValidationCodes.js'
import { getRuntimeDependencyLockState, validateRuntimeDependencyState } from './runtimeDependencyValidator.js'
import { validateRuntimeExecution } from './runtimeExecutionValidator.js'
import { normalizeRuntimeValidationMode, RUNTIME_VALIDATION_MODES } from './runtimeValidationModes.js'
import { validateRuntimeMutation } from './runtimeMutationValidator.js'
import { validateRuntimeOutputContract } from './runtimeOutputValidator.js'
import { persistRuntimeValidationAudit } from './runtimeValidationPersistence.js'
import {
  getHighestRuntimeValidationSeverity,
  isRuntimeValidationIssueBlocking,
  summarizeRuntimeValidationIssues,
} from './runtimeValidationSeverity.js'
import { validateRuntimeLifecycleTransition } from './runtimeTransitionValidator.js'

const deriveOperation = ({ operationType, operation }) => {
  const normalizedOperation = String(operation || '').trim().toUpperCase()
  if (normalizedOperation) return normalizedOperation

  if (operationType === 'STATE_MUTATION' || operationType === 'STATE_WRITE') return RUNTIME_PATH_REGISTRY_OPERATIONS.WRITE
  return RUNTIME_PATH_REGISTRY_OPERATIONS.READ
}

const buildPassIssue = () => buildRuntimeValidationIssue({
  code: RUNTIME_VALIDATION_CODES.EXECUTION_INVALID,
  severity: 'INFO',
  message: 'Runtime validation passed.',
  path: '',
  source: 'runtime-validation-engine',
})

const buildDisabledIssue = () => buildRuntimeValidationIssue({
  code: RUNTIME_VALIDATION_CODES.EXECUTION_INVALID,
  severity: 'INFO',
  message: 'Runtime validation is disabled for this operation.',
  path: 'mode',
  source: 'runtime-validation-engine',
})

const dedupeIssues = (issues = []) => {
  const seen = new Set()
  const deduped = []
  for (const issue of issues) {
    const key = [
      issue.code,
      issue.severity,
      issue.path,
      issue.message,
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(issue)
  }
  return deduped
}

const hasSeverityAtOrAboveError = (issues = []) =>
  issues.some((issue) => ['ERROR', 'BLOCKING', 'CRITICAL'].includes(String(issue?.severity || '').trim().toUpperCase()))

const hasWarningSeverity = (issues = []) =>
  issues.some((issue) => String(issue?.severity || '').trim().toUpperCase() === 'WARN')

const MUTATION_OPERATION_TYPES = new Set(['STATE_MUTATION', 'STATE_READ', 'STATE_WRITE'])

const severityRank = Object.freeze({
  INFO: 0,
  WARN: 1,
  ERROR: 2,
  BLOCKING: 3,
  CRITICAL: 4,
})

const bySeverityDescending = (left, right) => (
  (severityRank[String(right?.severity || '').trim().toUpperCase()] ?? 0)
  - (severityRank[String(left?.severity || '').trim().toUpperCase()] ?? 0)
)

const buildAuditFailureContext = (validationResult) => ({
  validationId: validationResult.validationId,
  status: validationResult.status,
  result: validationResult.result,
  mode: validationResult.mode,
  operationType: validationResult.operationType,
  operation: validationResult.operation,
  packageId: validationResult.packageId,
  frameworkKey: validationResult.frameworkKey,
  workspaceId: validationResult.workspaceId,
  runtimePath: validationResult.runtimePath,
  actorId: validationResult.actorId,
  actorType: validationResult.actorType,
  validationCode: validationResult.validationCode,
  severity: validationResult.severity,
  message: validationResult.message,
  summary: validationResult.summary,
  issues: validationResult.issues,
  packageResolved: validationResult.packageResolved,
})

export const validateRuntimeOperation = async (input) => {
  const operationType = String(input.operationType || '').trim().toUpperCase()
  const mode = normalizeRuntimeValidationMode(input.mode)
  const operation = deriveOperation({ operationType, operation: input.operation })
  const timestamp = new Date().toISOString()
  const validationId = randomUUID()
  const issues = []

  if (mode === RUNTIME_VALIDATION_MODES.DISABLED) {
    issues.push(buildDisabledIssue())
  } else {
    issues.push(...await validateRuntimeDependencyState({
      packageId: input.packageId,
      frameworkKey: input.frameworkKey,
    }))

    if (MUTATION_OPERATION_TYPES.has(operationType)) {
      issues.push(...await validateRuntimeMutation({
        runtimePath: input.runtimePath,
        operation,
        frameworkKey: input.frameworkKey,
        skillId: input.skillId,
        skillRoleKey: input.skillRoleKey,
        allowedReadScopes: input.allowedReadScopes,
        allowedWriteScopes: input.allowedWriteScopes,
        forbiddenReadScopes: input.forbiddenReadScopes,
        forbiddenWriteScopes: input.forbiddenWriteScopes,
      }))
    }

    if (operationType === 'OUTPUT_VALIDATION') {
      issues.push(...validateRuntimeOutputContract({
        outputContract: input.outputContract,
        payload: input.payload,
      }))
    }

    if (operationType === 'LIFECYCLE_TRANSITION') {
      issues.push(...validateRuntimeLifecycleTransition({
        lifecycleStage: input.lifecycleStage,
        targetLifecycleStage: input.targetLifecycleStage,
      }))
    }

    if (operationType === 'WORKFLOW_EXECUTION' || operationType === 'AGENT_ACTION' || operationType === 'AGENT_EXECUTION' || operationType === 'SKILL_EXECUTION') {
      issues.push(...validateRuntimeExecution({
        operationType,
        skillId: input.skillId,
        actorType: input.actorType,
      }))
    }
  }

  const dedupedIssues = dedupeIssues(issues)
  const rawValidationIssues = dedupedIssues.length > 0 ? dedupedIssues : [buildPassIssue()]
  const validationIssues = [...rawValidationIssues].sort(bySeverityDescending)
  const blocking = validationIssues.some((issue) => isRuntimeValidationIssueBlocking(issue, mode))
  let status = 'PASS'
  if (blocking) {
    status = 'FAIL'
  } else if (hasSeverityAtOrAboveError(validationIssues) || hasWarningSeverity(validationIssues)) {
    status = 'WARN'
  }

  let result = 'ALLOW'
  if (mode === RUNTIME_VALIDATION_MODES.AUDIT_ONLY) {
    result = 'AUDIT_ONLY'
  } else if (blocking) {
    result = 'BLOCK'
  }
  const summary = summarizeRuntimeValidationIssues(validationIssues)
  const highestSeverity = getHighestRuntimeValidationSeverity(validationIssues)
  const packageResolved = !validationIssues.some((issue) =>
    issue.code === RUNTIME_VALIDATION_CODES.DEPENDENCY_INVALID && issue.packageResolved === false)
  const dependencyLockState = input.packageId && packageResolved
    ? await getRuntimeDependencyLockState({ packageId: input.packageId })
    : 'NOT_LOCKED'

  const validationResult = {
    validationId,
    status,
    result,
    mode,
    operationType,
    operation,
    runtimePath: input.runtimePath || '',
    packageId: input.packageId || '',
    frameworkKey: input.frameworkKey || '',
    workspaceId: input.workspaceId || '',
    actorId: input.actorId || '',
    actorType: input.actorType || 'USER',
    requestId: input.requestId || '',
    validationCode: validationIssues[0]?.code || RUNTIME_VALIDATION_CODES.EXECUTION_INVALID,
    severity: highestSeverity,
    message: blocking ? 'Runtime validation blocked this operation.' : 'Runtime validation allowed this operation.',
    issues: validationIssues,
    summary,
    timestamp,
    beforeState: input.beforeState,
    afterState: input.afterState,
    packageResolved,
    dependencyLockState,
    isPackageLevelValidation: input.isPackageLevelValidation === true,
  }

  if (input.persistAudit !== false) {
    try {
      await persistRuntimeValidationAudit(validationResult)
    } catch (err) {
      logger.error(
        { err, validation: buildAuditFailureContext(validationResult) },
        'runtime validation persistence failed',
      )
      if (validationResult.isPackageLevelValidation) {
        err.code = err.code || 'RUNTIME_VALIDATION_EVIDENCE_PERSISTENCE_FAILED'
        err.status = err.status || 500
        throw err
      }
    }
  }

  return validationResult
}
