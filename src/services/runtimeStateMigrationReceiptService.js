import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import {
  AUTHORITY_TOKEN_DIGEST_PATTERN,
  RUNTIME_STATE_MIGRATION_OPERATION_TYPES,
  RUNTIME_STATE_MIGRATION_RECEIPT_SCHEMA_VERSION,
  RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES,
  SHA256_PATTERN,
  STATE_VERSION_PATTERN,
} from '../models/RuntimeStateMigrationReceipt.js'
import {
  RUNTIME_STATE_VERSION_ERROR_CODES,
  resolveRuntimeStateVersion,
} from './runtimeStateVersionService.js'

export const RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES = Object.freeze({
  IDEMPOTENCY_CONFLICT: 'SS014_APPLY_IDEMPOTENCY_CONFLICT',
  INVALID_TRANSITION: 'SS014_RECEIPT_INVALID_TRANSITION',
  ASSIGNED_VERSION_REQUIRED: 'SS014_ASSIGNED_STATE_VERSION_REQUIRED',
  ASSIGNED_VERSION_MISMATCH: 'SS014_ASSIGNED_STATE_VERSION_MISMATCH',
  ASSIGNED_VERSION_ALREADY_PRESENT: 'SS014_CANONICAL_STATE_VERSION_ALREADY_PRESENT',
  COMPATIBILITY_ALIAS_PRESENT: 'SS014_COMPATIBILITY_ALIAS_PRESENT',
  MIXED_STATE_VERSION: RUNTIME_STATE_VERSION_ERROR_CODES.MIXED,
  FAILURE_CODE_REQUIRED: 'SS014_RECEIPT_FAILURE_CODE_REQUIRED',
  ROLLBACK_REFERENCE_REQUIRED: 'SS014_RECEIPT_ROLLBACK_REFERENCE_REQUIRED',
  STATE_VERSION_INPUT_FORBIDDEN: 'SS014_RECEIPT_STATE_VERSION_INPUT_FORBIDDEN',
  CALLER_IDEMPOTENCY_INPUT_FORBIDDEN: 'SS014_CALLER_IDEMPOTENCY_INPUT_FORBIDDEN',
  CALLER_AUTHORITY_INPUT_FORBIDDEN: 'SS014_CALLER_AUTHORITY_INPUT_FORBIDDEN',
  PLAN_NOT_TRUSTED: 'SS014_PLAN_NOT_SERVER_AUTHORIZED',
  PLAN_NOT_APPLY_AUTHORIZED: 'SS014_PLAN_NOT_APPLY_AUTHORIZED',
  AUTHORITY_TOKEN_INVALID: 'SS014_AUTHORITY_TOKEN_INVALID',
  AUTHORITY_TOKEN_EXPIRED: 'SS014_AUTHORITY_TOKEN_EXPIRED',
  AUTHORITY_TOKEN_CONSUMED: 'SS014_AUTHORITY_TOKEN_CONSUMED',
  AUTHORITY_SCOPE_MISMATCH: 'SS014_AUTHORITY_SCOPE_MISMATCH',
  BACKUP_VERIFICATION_REQUIRED: 'SS014_BACKUP_VERIFICATION_REQUIRED',
  BACKUP_VERIFICATION_FAILED: 'SS014_BACKUP_VERIFICATION_FAILED',
  RECEIPT_NOT_FOUND: 'SS014_RECEIPT_NOT_FOUND',
  RUNTIME_NOT_FOUND: 'SS014_RUNTIME_NOT_FOUND',
  RUNTIME_CONDITIONAL_UPDATE_FAILED: 'SS014_RUNTIME_CONDITIONAL_UPDATE_FAILED',
  RECEIPT_UPDATE_FAILED: 'SS014_RECEIPT_UPDATE_FAILED',
  TRANSACTION_READBACK_MISMATCH: 'SS014_TRANSACTION_READBACK_MISMATCH',
  COMMIT_AMBIGUOUS: 'SS014_BASELINE_COMMIT_AMBIGUOUS',
  RECONCILIATION_AMBIGUOUS: 'SS014_BASELINE_RECONCILIATION_AMBIGUOUS',
  AUTHORITY_RENEWAL_FORBIDDEN: 'SS014_AUTHORITY_RENEWAL_FORBIDDEN',
})

const ALLOWED_TRANSITIONS = Object.freeze({
  PLANNED: new Set(['APPLYING', 'FAILED']),
  APPLYING: new Set(['ASSIGNED', 'FAILED']),
  ASSIGNED: new Set(['VERIFIED', 'ROLLED_BACK']),
  VERIFIED: new Set(['ROLLED_BACK']),
  FAILED: new Set(),
  ROLLED_BACK: new Set(),
})

const APPLY_AUTHORIZED_STATUS = 'APPLY_AUTHORIZED'
const AUTHORITY_TOKEN_PATTERN = /^ss014-auth-v1:[0-9a-f]{64}$/
const MAX_AUTHORITY_TTL_MS = 15 * 60 * 1000
const SERVER_PLANS = new WeakSet()
const APPROVED_SCOPE_BINDINGS = new WeakSet()
const CONSUMED_SCOPE_BINDINGS = new WeakSet()

const normalizeText = (value) => String(value ?? '').trim()

const canonicalize = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value.toHexString === 'function') return value.toHexString()
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

export const stableJson = (value) => JSON.stringify(canonicalize(value))

const sha256 = (value) => `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`

export const stableDigest = (value) => sha256(stableJson(value))

const createReceiptError = (code, message, details = {}) => {
  const error = new Error(message)
  error.code = code
  error.status = [
    RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH,
    RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.COMMIT_AMBIGUOUS,
  ].includes(code) ? 409 : 422
  error.details = details
  return error
}

const assertSha256 = (value, fieldName) => {
  if (!SHA256_PATTERN.test(normalizeText(value))) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED,
      `${fieldName} must be a lowercase sha256 digest.`,
    )
  }
  return normalizeText(value)
}

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  if (value instanceof Date || Buffer.isBuffer(value) || typeof value.toHexString === 'function') return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

const immutableClone = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value.toHexString === 'function') return value.toHexString()
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (Array.isArray(value)) return value.map(immutableClone)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, immutableClone(nested)]))
  }
  return value
}

const assertNoCallerAuthorityFields = (input = {}) => {
  const forbidden = [
    'idempotencyKey',
    'authority',
    'authorityToken',
    'token',
    'tokenDigest',
    'bindingDigest',
    'issuedAt',
    'expiresAt',
    'consumedAt',
    'planHashRef',
    'backupManifestRef',
    'operationType',
    'stateVersion',
    'runtimeStateVersion',
    'assignedStateVersion',
  ]
  const found = forbidden.find((field) => Object.prototype.hasOwnProperty.call(input, field))
  if (found === 'idempotencyKey') {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.CALLER_IDEMPOTENCY_INPUT_FORBIDDEN,
      'The SS-014 idempotency key is server-computed.',
    )
  }
  if (found) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.CALLER_AUTHORITY_INPUT_FORBIDDEN,
      `The SS-014 ${found} field is server-owned.`,
    )
  }
}

const stableAuthorityBinding = ({
  actor,
  backupManifestRef,
  clusterRef,
  customerId,
  databaseName,
  environmentClass,
  operationType,
  planHash,
  runtimeInstanceId,
  runtimeInstanceKey,
  scopeDigest,
  sourceSetHash,
  tenantId,
} = {}) => ({
  actor,
  backupManifestRef,
  clusterRef,
  customerId,
  databaseName,
  environmentClass,
  operationType,
  planHash,
  runtimeInstanceId,
  runtimeInstanceKey,
  scopeDigest,
  sourceSetHash,
  tenantId,
})

export const createRuntimeStateMigrationAuthorityBindingDigest = (plan = {}) => (
  stableDigest(stableAuthorityBinding(plan))
)

const assertActor = (actor) => {
  if (!actor?.actorRef || !['USER', 'SERVICE', 'SYSTEM'].includes(actor.actorType)) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED,
      'SS-014 authority requires a governed actor identity.',
    )
  }
}

export const createApprovedRuntimeStateMigrationScopeBinding = ({
  scope,
  authorization,
  now = new Date(),
} = {}) => {
  if (
    !scope
    || authorization?.status !== APPLY_AUTHORIZED_STATUS
    || authorization?.operationType !== RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE
    || authorization?.oneUse !== true
    || !SHA256_PATTERN.test(normalizeText(authorization?.confirmationDigest))
    || !(new Date(now) < new Date(authorization?.expiresAt))
  ) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED,
      'An explicit, bounded, one-use SS-014 apply authorization is required.',
    )
  }
  const binding = immutableClone({ scope, authorization })
  APPROVED_SCOPE_BINDINGS.add(binding)
  return deepFreeze(binding)
}

export const isApprovedRuntimeStateMigrationScopeBinding = (binding) => APPROVED_SCOPE_BINDINGS.has(binding)

export const createApplyAuthorizedRuntimeStateMigrationPlan = (payload = {}) => {
  const forbidden = ['planHash', 'applyAuthority', 'approvalStatus']
  const suppliedForbidden = forbidden.find((field) => Object.prototype.hasOwnProperty.call(payload, field))
  if (suppliedForbidden) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_TRUSTED,
      `The server plan factory owns ${suppliedForbidden}.`,
    )
  }

  if (payload.operationType !== RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED,
      'Only the SS-014 LEGACY_BASELINE operation is supported by this slice.',
    )
  }

  const required = [
    'approvedScopeBinding',
    'targetSelectionRef',
    'environmentClass',
    'databaseName',
    'clusterRef',
    'scopeDigest',
    'customerId',
    'tenantId',
    'runtimeInstanceId',
    'runtimeInstanceKey',
    'logicalSources',
    'sourceSetHash',
    'dryRunObservationRefs',
    'backupManifestRef',
    'actor',
  ]
  const missing = required.find((field) => payload[field] === undefined || payload[field] === null)
  if (missing) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED,
      `The server plan is missing ${missing}.`,
    )
  }

  if (!isApprovedRuntimeStateMigrationScopeBinding(payload.approvedScopeBinding)) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_TRUSTED,
      'The SS-014 plan must be bound to a server-approved one-use scope authorization.',
    )
  }
  if (CONSUMED_SCOPE_BINDINGS.has(payload.approvedScopeBinding)) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED,
      'The one-use SS-014 apply authorization has already been consumed.',
    )
  }
  const boundScope = payload.approvedScopeBinding.scope
  const scopeFields = [
    'targetSelectionRef',
    'environmentClass',
    'databaseName',
    'clusterRef',
    'scopeDigest',
    'customerId',
    'tenantId',
    'runtimeInstanceId',
    'runtimeInstanceKey',
    'operationType',
    'logicalSources',
    'sourceSetHash',
    'dryRunObservationRefs',
    'backupManifestRef',
    'actor',
  ]
  if (scopeFields.some((field) => stableJson(payload[field]) !== stableJson(boundScope?.[field]))) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH,
      'The server plan payload does not match its approved scope binding.',
    )
  }

  assertActor(payload.actor)
  assertSha256(payload.scopeDigest, 'scopeDigest')
  assertSha256(payload.sourceSetHash, 'sourceSetHash')
  assertSha256(payload.backupManifestRef, 'backupManifestRef')

  const immutablePayload = immutableClone(payload)
  const planHash = stableDigest(immutablePayload)
  const plan = {
    ...immutablePayload,
    planHash,
    applyAuthority: true,
    approvalStatus: APPLY_AUTHORIZED_STATUS,
  }
  CONSUMED_SCOPE_BINDINGS.add(payload.approvedScopeBinding)
  SERVER_PLANS.add(plan)
  return deepFreeze(plan)
}

export const isServerAuthorizedRuntimeStateMigrationPlan = (plan) => SERVER_PLANS.has(plan)

export const createRuntimeStateMigrationAuthority = ({
  binding,
  now = new Date(),
  ttlMs = MAX_AUTHORITY_TTL_MS,
} = {}) => {
  if (!binding || typeof binding !== 'object') {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED,
      'SS-014 authority binding is required.',
    )
  }
  assertActor(binding.actor)
  if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_AUTHORITY_TTL_MS || !Number.isFinite(new Date(now).getTime())) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED,
      'SS-014 authority TTL must be between one millisecond and fifteen minutes.',
    )
  }
  const issuedAt = new Date(now)
  const expiresAt = new Date(issuedAt.getTime() + ttlMs)
  const token = `ss014-auth-v1:${randomBytes(32).toString('hex')}`
  const authority = {
    tokenDigest: sha256(token),
    bindingDigest: stableDigest(binding),
    issuedAt,
    expiresAt,
    issuedBy: binding.actor.actorRef,
    consumedAt: null,
  }
  return { token, authority }
}

export const renewRuntimeStateMigrationAuthority = ({
  receipt,
  now = new Date(),
  ttlMs = MAX_AUTHORITY_TTL_MS,
} = {}) => {
  if (
    receipt?.status !== RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.PLANNED
    || receipt.authority?.consumedAt
  ) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_RENEWAL_FORBIDDEN,
      'Authority can only be renewed for an unconsumed planned receipt.',
    )
  }
  if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_AUTHORITY_TTL_MS || !Number.isFinite(new Date(now).getTime())) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_RENEWAL_FORBIDDEN,
      'SS-014 authority renewal TTL and issuance time are invalid.',
    )
  }
  const issuedAt = new Date(now)
  const expiresAt = new Date(issuedAt.getTime() + ttlMs)
  const token = `ss014-auth-v1:${randomBytes(32).toString('hex')}`
  return {
    token,
    authority: {
      ...receipt.authority,
      tokenDigest: sha256(token),
      issuedAt,
      expiresAt,
      consumedAt: null,
    },
  }
}

const immutableIdentityProjection = (receipt = {}) => ({
  schemaVersion: receipt.schemaVersion,
  operationType: receipt.operationType,
  environmentClass: receipt.environmentClass,
  databaseName: receipt.databaseName,
  clusterRef: receipt.clusterRef,
  targetSelectionRef: receipt.targetSelectionRef,
  scopeDigest: receipt.scopeDigest,
  customerId: receipt.customerId,
  tenantId: receipt.tenantId,
  runtimeInstanceId: receipt.runtimeInstanceId,
  runtimeInstanceKey: receipt.runtimeInstanceKey,
  actor: receipt.actor,
  backupManifestRef: receipt.backupManifestRef,
  planHashRef: receipt.planHashRef,
  logicalSources: receipt.logicalSources,
  sourceSetHash: receipt.sourceSetHash,
  dryRunObservationRefs: receipt.dryRunObservationRefs,
  authority: {
    bindingDigest: receipt.authority?.bindingDigest,
    issuedBy: receipt.authority?.issuedBy,
  },
})

export const createRuntimeStateMigrationReceiptIdentity = (receipt = {}) => immutableIdentityProjection(receipt)

export const createRuntimeStateMigrationPlanIdentity = (plan = {}) => immutableIdentityProjection({
  ...plan,
  schemaVersion: RUNTIME_STATE_MIGRATION_RECEIPT_SCHEMA_VERSION,
  planHashRef: {
    value: plan.planHash,
    status: APPLY_AUTHORIZED_STATUS,
  },
  authority: {
    bindingDigest: createRuntimeStateMigrationAuthorityBindingDigest(plan),
    issuedBy: plan.actor?.actorRef,
  },
})

export const createRuntimeStateMigrationIdempotencyKey = (receipt = {}) => {
  const identity = immutableIdentityProjection({
    ...receipt,
    schemaVersion: receipt.schemaVersion || RUNTIME_STATE_MIGRATION_RECEIPT_SCHEMA_VERSION,
  })
  return `ss014:legacy-baseline:${stableDigest(identity)}`
}

export const prepareApplyAuthorizedRuntimeStateMigrationReceipt = (input = {}) => {
  assertNoCallerAuthorityFields(input)
  const { plan, now = new Date(), ttlMs = MAX_AUTHORITY_TTL_MS, ...unexpected } = input
  if (Object.keys(unexpected).length > 0) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_TRUSTED,
      'The SS-014 receipt factory accepts only a server-authorized plan, clock and bounded TTL.',
    )
  }
  if (!isServerAuthorizedRuntimeStateMigrationPlan(plan)) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_TRUSTED,
      'Only a plan created by the SS-014 server plan factory may authorize a receipt.',
    )
  }
  if (plan.approvalStatus !== APPLY_AUTHORIZED_STATUS || plan.applyAuthority !== true) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED,
      'The server plan is not apply-authoritative.',
    )
  }

  const binding = stableAuthorityBinding({
    actor: plan.actor,
    backupManifestRef: plan.backupManifestRef,
    clusterRef: plan.clusterRef,
    customerId: plan.customerId,
    databaseName: plan.databaseName,
    environmentClass: plan.environmentClass,
    operationType: plan.operationType,
    planHash: plan.planHash,
    runtimeInstanceId: plan.runtimeInstanceId,
    runtimeInstanceKey: plan.runtimeInstanceKey,
    scopeDigest: plan.scopeDigest,
    sourceSetHash: plan.sourceSetHash,
    tenantId: plan.tenantId,
  })
  const { token, authority } = createRuntimeStateMigrationAuthority({ binding, now, ttlMs })
  const receipt = {
    ...plan,
    schemaVersion: RUNTIME_STATE_MIGRATION_RECEIPT_SCHEMA_VERSION,
    operationType: RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE,
    idempotencyKey: null,
    planHashRef: {
      value: plan.planHash,
      status: APPLY_AUTHORIZED_STATUS,
    },
    authority,
    assignedStateVersion: null,
    status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.PLANNED,
    rollbackRef: null,
    failureCode: null,
  }
  receipt.idempotencyKey = createRuntimeStateMigrationIdempotencyKey(receipt)
  delete receipt.planHash
  delete receipt.applyAuthority
  delete receipt.approvalStatus
  delete receipt.approvedScopeBinding
  return { receipt, token }
}

export const preparePlannedRuntimeStateMigrationReceipt = (input = {}) => {
  assertNoCallerAuthorityFields(input)
  return {
    ...input,
    schemaVersion: RUNTIME_STATE_MIGRATION_RECEIPT_SCHEMA_VERSION,
    status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.PLANNED,
    assignedStateVersion: null,
    rollbackRef: null,
    failureCode: null,
  }
}

export const assertRuntimeStateMigrationReceiptIdempotency = ({ existing, candidate } = {}) => {
  if (!existing) return { action: 'CREATE' }

  if (
    existing.idempotencyKey !== createRuntimeStateMigrationIdempotencyKey(existing)
    || candidate.idempotencyKey !== createRuntimeStateMigrationIdempotencyKey(candidate)
  ) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      'The SS-014 receipt idempotency key is not the server-computed identity key.',
    )
  }

  const matches = stableJson(immutableIdentityProjection(existing))
    === stableJson(immutableIdentityProjection(candidate))
  if (!matches) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      'An existing SS-014 receipt has different immutable target, source or authority-binding identity.',
      { idempotencyKey: candidate?.idempotencyKey || null },
    )
  }

  return { action: 'REUSE', receipt: existing }
}

export const assertRuntimeStateMigrationReceiptTransition = ({
  currentStatus,
  nextStatus,
  assignedStateVersion,
  failureCode,
  rollbackRef,
} = {}) => {
  const current = normalizeText(currentStatus).toUpperCase()
  const next = normalizeText(nextStatus).toUpperCase()

  if (!ALLOWED_TRANSITIONS[current]?.has(next)) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.INVALID_TRANSITION,
      `SS-014 receipt transition ${current || 'MISSING'} -> ${next || 'MISSING'} is not allowed.`,
      { currentStatus: current || null, nextStatus: next || null },
    )
  }

  if (next === RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ASSIGNED) {
    if (!STATE_VERSION_PATTERN.test(normalizeText(assignedStateVersion))) {
      throw createReceiptError(
        RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.ASSIGNED_VERSION_REQUIRED,
        'Assigned receipts require an opaque rsv2 UUID state version.',
      )
    }
  }

  if (next === RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.FAILED && !normalizeText(failureCode)) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.FAILURE_CODE_REQUIRED,
      'Failed receipts require a governed failure code.',
    )
  }

  if (next === RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ROLLED_BACK && !rollbackRef) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.ROLLBACK_REFERENCE_REQUIRED,
      'Rolled-back receipts require a rollback reference.',
    )
  }

  return { currentStatus: current, nextStatus: next }
}

export const assertCanonicalRuntimeStateVersionAssignment = ({
  runtime,
  receipt,
  assignedStateVersion,
} = {}) => {
  const resolved = resolveRuntimeStateVersion(runtime)
  if (resolved.errorCode === RUNTIME_STATE_VERSION_ERROR_CODES.MIXED) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.MIXED_STATE_VERSION,
      'Canonical and compatibility runtime state versions disagree.',
      {
        stateVersion: resolved.canonicalStateVersion,
        runtimeStateVersion: resolved.compatibilityStateVersion,
      },
    )
  }

  if (resolved.compatibilityStateVersion && !resolved.canonicalStateVersion) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.COMPATIBILITY_ALIAS_PRESENT,
      'A compatibility-only runtime state version cannot establish the canonical baseline.',
    )
  }

  if (resolved.canonicalStateVersion) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.ASSIGNED_VERSION_ALREADY_PRESENT,
      'A canonical RuntimeInstance stateVersion is already present.',
    )
  }

  const normalizedAssignedVersion = normalizeText(assignedStateVersion)
  if (!STATE_VERSION_PATTERN.test(normalizedAssignedVersion)) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.ASSIGNED_VERSION_REQUIRED,
      'Canonical assignment requires an opaque rsv2 UUID state version.',
    )
  }

  if (normalizeText(receipt?.assignedStateVersion) !== normalizedAssignedVersion) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.ASSIGNED_VERSION_MISMATCH,
      'The canonical assignment version must match the migration receipt.',
    )
  }

  if (![RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ASSIGNED, RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED].includes(receipt?.status)) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.INVALID_TRANSITION,
      'Only an assigned or verified receipt may advance the canonical RuntimeInstance stateVersion.',
    )
  }

  return normalizedAssignedVersion
}

const readOne = async (model, filter, session) => {
  let query = model.findOne(filter)
  if (session && query && typeof query.session === 'function') query = query.session(session)
  if (query && typeof query.lean === 'function') query = query.lean()
  if (query && typeof query.exec === 'function') return query.exec()
  return query
}

export const reconcileRuntimeStateMigrationBaseline = async ({
  receiptId,
  receiptModel,
  runtimeModel,
} = {}) => {
  if (!receiptModel || !runtimeModel) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.RECONCILIATION_AMBIGUOUS,
      'Receipt and RuntimeInstance models are required for reconciliation.',
    )
  }
  const receipt = await readOne(receiptModel, { receiptId }, null)
  if (!receipt) {
    return { status: 'NOT_COMMITTED', receiptPresent: false, runtimeStateVersionPresent: false }
  }
  const runtime = await readOne(runtimeModel, {
    _id: receipt.runtimeInstanceId,
    customerId: receipt.customerId,
    tenantId: receipt.tenantId,
    runtimeInstanceKey: receipt.runtimeInstanceKey,
  }, null)
  if (!runtime) {
    return { status: 'AMBIGUOUS', receiptPresent: true, runtimeStateVersionPresent: false }
  }
  const canonicalPresent = Object.prototype.hasOwnProperty.call(runtime || {}, 'stateVersion')
  const compatibilityPresent = Object.prototype.hasOwnProperty.call(runtime || {}, 'runtimeStateVersion')
  const runtimeStateVersionPresent = canonicalPresent || compatibilityPresent
  if (compatibilityPresent) {
    return { status: 'AMBIGUOUS', receiptPresent: true, runtimeStateVersionPresent: true }
  }
  if (
    [RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ASSIGNED, RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED].includes(receipt.status)
    && receipt.authority?.consumedAt
    && runtime?.stateVersion === receipt.assignedStateVersion
  ) {
    return { status: 'COMMITTED', receiptPresent: true, runtimeStateVersionPresent: true }
  }
  if (receipt.status === RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.PLANNED && !runtimeStateVersionPresent) {
    return { status: 'NOT_COMMITTED', receiptPresent: true, runtimeStateVersionPresent: false }
  }
  return { status: 'AMBIGUOUS', receiptPresent: true, runtimeStateVersionPresent }
}

export const verifyAuthorityToken = ({ receipt, token, scopeDigest, now = new Date() } = {}) => {
  if (!AUTHORITY_TOKEN_PATTERN.test(normalizeText(token))) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_TOKEN_INVALID,
      'The SS-014 authority token has an invalid format.',
    )
  }
  if (!scopeDigest || normalizeText(scopeDigest) !== normalizeText(receipt?.scopeDigest)) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH,
      'The authority token scope does not match the receipt scope.',
    )
  }
  if (receipt?.authority?.consumedAt) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_TOKEN_CONSUMED,
      'The SS-014 authority token was already consumed by a committed assignment.',
    )
  }
  if (!(new Date(now) < new Date(receipt?.authority?.expiresAt))) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_TOKEN_EXPIRED,
      'The SS-014 authority token is expired.',
    )
  }
  const expected = Buffer.from(normalizeText(receipt?.authority?.tokenDigest), 'utf8')
  const actual = Buffer.from(sha256(token), 'utf8')
  if (
    expected.length !== actual.length
    || !timingSafeEqual(expected, actual)
  ) {
    throw createReceiptError(
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_TOKEN_INVALID,
      'The SS-014 authority token does not match the receipt.',
    )
  }
  return true
}

export const __testables = Object.freeze({
  canonicalize,
  stableJson,
  stableDigest,
  immutableIdentityProjection,
  AUTHORITY_TOKEN_PATTERN,
  ALLOWED_TRANSITIONS,
  MAX_AUTHORITY_TTL_MS,
})
