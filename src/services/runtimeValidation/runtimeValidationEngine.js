import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { loadRuntimeCertificationPackage, captureRuntimeReleaseCertification } from '../runtimeReleaseCertificationCaptureService.js'
import { buildRuntimeReleaseCertificationBinding } from '../runtimeReleaseCertificationService.js'
import { RUNTIME_PATH_REGISTRY_OPERATIONS } from '../../models/RuntimePathRegistry.js'
import logger from '../../config/logger.js'
import { RUNTIME_VALIDATION_CODES, buildRuntimeValidationIssue } from './runtimeValidationCodes.js'
import { getRuntimeDependencyLockState, validateRuntimeDependencyState } from './runtimeDependencyValidator.js'
import { validateRuntimeExecution } from './runtimeExecutionValidator.js'
import { normalizeRuntimeValidationMode, RUNTIME_VALIDATION_MODES } from './runtimeValidationModes.js'
import { validateRuntimeMutation } from './runtimeMutationValidator.js'
import { validateRuntimeOutputContract } from './runtimeOutputValidator.js'
import { isVE02ResultContract } from './ve02EvidenceAssessmentResultContract.js'
import { assertVE02ReceiptIndex, buildVE02ConsumptionReceipt, fenceVE02Consumption } from './ve02ConsumptionReceipt.js'
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

export const validateRuntimeOperation = async (input, { session, resolveVE02Context } = {}) => {
  const ve02Requested = String(input.operationType || '').toUpperCase() === 'OUTPUT_VALIDATION' && isVE02ResultContract(input)
  if (ve02Requested && input.isPackageLevelValidation) throw Object.assign(
    new Error('VE02 result consumption cannot certify package readiness.'), { status: 422, code: 'VALIDATION_FAILED' })
  const ve02TransactionRequired = ve02Requested && resolveVE02Context
    && normalizeRuntimeValidationMode(input.mode) === RUNTIME_VALIDATION_MODES.STRICT
    && input.persistAudit !== false
  if (ve02TransactionRequired) await assertVE02ReceiptIndex()
  if ((input.isPackageLevelValidation === true || ve02TransactionRequired) && input.persistAudit !== false && !session) {
    const ownedSession = await mongoose.startSession()
    try {
      const run = () => ownedSession.withTransaction(() => validateRuntimeOperation(input, { session: ownedSession, resolveVE02Context }), {
        readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
      })
      try { return await run() } catch (error) {
        // A concurrent receipt may have won the unique result-ID index. A new
        // snapshot revalidates lineage and distinguishes replay from ID reuse.
        if (!ve02Requested || error.code !== 11000 || !String(error.message).includes('unique_ve02_consumption_result')) throw error
        return await run()
      }
    } finally {
      await ownedSession.endSession()
    }
  }
  const capturedPackage = input.isPackageLevelValidation === true && session
    ? await loadRuntimeCertificationPackage({ packageId: input.packageId, session })
    : undefined
  const operationType = String(input.operationType || '').trim().toUpperCase()
  const mode = normalizeRuntimeValidationMode(input.mode)
  // Raw lean reads: missing persisted lock status must never become a schema-default PASS.
  const certificationInput = capturedPackage
    && ['PASS', 'PASS_WITH_WARNINGS'].includes(capturedPackage.dependencyLock?.status)
    && ![RUNTIME_VALIDATION_MODES.DISABLED, RUNTIME_VALIDATION_MODES.AUDIT_ONLY].includes(mode)
    ? await captureRuntimeReleaseCertification({ frameworkPackage: capturedPackage, session })
    : null
  const operation = deriveOperation({ operationType, operation: input.operation })
  const timestamp = new Date().toISOString()
  const validationId = randomUUID()
  const issues = []
  const ve02Selected = operationType === 'OUTPUT_VALIDATION' && isVE02ResultContract(input)
  const ve02Context = ve02Selected && resolveVE02Context
    ? await resolveVE02Context(input, { session })
    : undefined
  const ve02Issues = ve02Selected
    ? validateRuntimeOutputContract(input, { ve02Context })
    : []

  if (mode === RUNTIME_VALIDATION_MODES.DISABLED) {
    issues.push(buildDisabledIssue())
  } else {
    issues.push(...await validateRuntimeDependencyState({
      packageId: input.packageId,
      frameworkKey: input.frameworkKey,
      session,
      capturedPackage,
    }))

    if (MUTATION_OPERATION_TYPES.has(operationType)) {
      issues.push(...await validateRuntimeMutation({
        session,
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
      issues.push(...(ve02Selected ? ve02Issues : validateRuntimeOutputContract({
        outputContract: input.outputContract,
        payload: input.payload,
      })))
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
  const packageResolved = capturedPackage !== null && !validationIssues.some((issue) =>
    issue.code === RUNTIME_VALIDATION_CODES.DEPENDENCY_INVALID && issue.packageResolved === false)
  const dependencyLockState = input.packageId && packageResolved
    ? await getRuntimeDependencyLockState({ packageId: input.packageId, session, capturedPackage })
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
    ...(ve02Selected ? { ve02ResultEligibility: {
      // Structural/context validation cannot substitute for durable consumption
      // history. The production receipt path must establish that separately.
      eligible: false,
      issues: ve02Issues,
    } } : {}),
    isPackageLevelValidation: input.isPackageLevelValidation === true,
  }

  if (input.persistAudit !== false) {
    try {
      const ve02ReceiptEligible = ve02Selected && ve02Issues.length === 0
        && mode === RUNTIME_VALIDATION_MODES.STRICT && result === 'ALLOW'
      if (ve02ReceiptEligible) await fenceVE02Consumption({ context: ve02Context, session })
      const certificationBinding = validationResult.isPackageLevelValidation
        && result === 'ALLOW' && ![RUNTIME_VALIDATION_MODES.DISABLED, RUNTIME_VALIDATION_MODES.AUDIT_ONLY].includes(mode)
        && packageResolved && dependencyLockState === 'LOCKED'
        ? buildRuntimeReleaseCertificationBinding({
            frameworkPackage: certificationInput.frameworkPackage,
            dependencies: certificationInput.dependencies,
          })
        : null
      const persistedAudit = await persistRuntimeValidationAudit(validationResult, {
        session,
        ...(ve02ReceiptEligible ? {
          ve02Receipt: buildVE02ConsumptionReceipt({ context: ve02Context, payload: input.payload }),
          existingVE02ReceiptAudit: ve02Context.existingReceiptAudit,
        } : {}),
        capturedPackage,
        certificationBinding,
        certificationDependencySnapshot: certificationBinding
          ? certificationInput.certificationDependencySnapshot
          : undefined,
        certificationDependencyLockObservation: certificationBinding
          ? certificationInput.certificationDependencyLockObservation
          : undefined,
      })
      if (ve02ReceiptEligible) {
        if (!persistedAudit?._id) throw Object.assign(new Error('VE02 consumption audit identity is missing.'), {
          status: 500, code: 'RUNTIME_VALIDATION_EVIDENCE_PERSISTENCE_FAILED',
        })
        validationResult.ve02ResultEligibility.eligible = true
        validationResult.ve02ResultEligibility.receiptAuditId = String(persistedAudit._id)
      }
    } catch (err) {
      logger.error(
        { err, validation: buildAuditFailureContext(validationResult) },
        'runtime validation persistence failed',
      )
      if (validationResult.isPackageLevelValidation || ve02Selected) {
        err.code = err.code || 'RUNTIME_VALIDATION_EVIDENCE_PERSISTENCE_FAILED'
        err.status = err.status || 500
        throw err
      }
    }
  }

  return validationResult
}
