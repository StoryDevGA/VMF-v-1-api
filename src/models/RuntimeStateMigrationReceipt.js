import mongoose from 'mongoose'

export const RUNTIME_STATE_MIGRATION_RECEIPT_SCHEMA_VERSION = 'ss014-runtime-baseline-receipt-v1'

export const RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES = Object.freeze({
  PLANNED: 'PLANNED',
  APPLYING: 'APPLYING',
  ASSIGNED: 'ASSIGNED',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  ROLLED_BACK: 'ROLLED_BACK',
})

export const RUNTIME_STATE_MIGRATION_OPERATION_TYPES = Object.freeze({
  LEGACY_BASELINE: 'LEGACY_BASELINE',
  NATIVE_INITIALIZATION: 'NATIVE_INITIALIZATION',
})

export const RUNTIME_STATE_MIGRATION_MODEL_ERROR_CODES = Object.freeze({
  ASSIGNED_STATE_VERSION_UPDATE_FORBIDDEN: 'SS014_ASSIGNED_STATE_VERSION_UPDATE_FORBIDDEN',
})

export const RUNTIME_STATE_MIGRATION_LOGICAL_PATHS = Object.freeze([
  'framework_state.sections',
  'framework_state.evidence_pack',
  'framework_state.intelligence_graph',
])

export const RUNTIME_STATE_MIGRATION_TARGET_COLLECTIONS = Object.freeze({
  'framework_state.sections': ['runtime_section_states'],
  'framework_state.evidence_pack': ['runtime_evidence_sources', 'runtime_evidence_objects'],
  'framework_state.intelligence_graph': ['runtime_graph_snapshots', 'runtime_graph_elements'],
})

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/
const STATE_VERSION_PATTERN = /^rsv2:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const AUTHORITY_TOKEN_DIGEST_PATTERN = SHA256_PATTERN
const IDEMPOTENCY_KEY_PATTERN = /^ss014:(legacy-baseline|native-initialization):sha256:[0-9a-f]{64}$/
const LEGACY_BASELINE_IDEMPOTENCY_KEY_PATTERN = /^ss014:legacy-baseline:sha256:[0-9a-f]{64}$/
const NATIVE_INITIALIZATION_IDEMPOTENCY_KEY_PATTERN = /^ss014:native-initialization:sha256:[0-9a-f]{64}$/

const isLegacyBaselineReceipt = function isLegacyBaselineReceipt() {
  return this.operationType === RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE
}

const targetSelectionRefSchema = new mongoose.Schema(
  {
    bindingRef: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
      immutable: true,
    },
    scopeDigest: {
      type: String,
      required: true,
      match: SHA256_PATTERN,
      immutable: true,
    },
  },
  { _id: false },
)

const logicalSourceSchema = new mongoose.Schema(
  {
    logicalPath: {
      type: String,
      required: true,
      enum: RUNTIME_STATE_MIGRATION_LOGICAL_PATHS,
      immutable: true,
    },
    targetCollections: {
      type: [String],
      required: true,
      immutable: true,
    },
    sourceHash: {
      type: String,
      required: true,
      match: SHA256_PATTERN,
      immutable: true,
    },
    recordCount: {
      type: Number,
      required: true,
      min: 0,
      immutable: true,
    },
  },
  { _id: false },
)

const dryRunObservationRefSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
      immutable: true,
    },
    referenceType: {
      type: String,
      required: true,
      enum: ['RUN', 'RECEIPT'],
      immutable: true,
    },
  },
  { _id: false },
)

const planHashRefSchema = new mongoose.Schema(
  {
    value: {
      type: String,
      required: true,
      trim: true,
      match: SHA256_PATTERN,
      immutable: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['APPLY_AUTHORIZED'],
      immutable: true,
    },
  },
  { _id: false },
)

const authoritySchema = new mongoose.Schema(
  {
    tokenDigest: {
      type: String,
      required: true,
      match: AUTHORITY_TOKEN_DIGEST_PATTERN,
    },
    bindingDigest: {
      type: String,
      required: true,
      match: SHA256_PATTERN,
      immutable: true,
    },
    issuedAt: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    issuedBy: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
      immutable: true,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
)

const actorSchema = new mongoose.Schema(
  {
    actorRef: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
      immutable: true,
    },
    actorType: {
      type: String,
      required: true,
      enum: ['USER', 'SERVICE', 'SYSTEM'],
      immutable: true,
    },
  },
  { _id: false },
)

const rollbackRefSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
      immutable: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
      immutable: true,
    },
  },
  { _id: false },
)

const validateLogicalSources = (sources) => {
  if (!Array.isArray(sources) || sources.length !== RUNTIME_STATE_MIGRATION_LOGICAL_PATHS.length) {
    return false
  }

  const paths = sources.map((source) => source?.logicalPath)
  if (paths.some((path, index) => path !== RUNTIME_STATE_MIGRATION_LOGICAL_PATHS[index])) {
    return false
  }

  return sources.every((source) => {
    const expectedCollections = RUNTIME_STATE_MIGRATION_TARGET_COLLECTIONS[source.logicalPath]
    return JSON.stringify(source.targetCollections) === JSON.stringify(expectedCollections)
  })
}

const validateDryRunObservationRefs = (refs) => (
  Array.isArray(refs)
  && refs.length === 2
  && new Set(refs.map((ref) => ref?.reference)).size === 2
)

const runtimeStateMigrationReceiptSchema = new mongoose.Schema(
  {
    schemaVersion: {
      type: String,
      required: true,
      enum: [RUNTIME_STATE_MIGRATION_RECEIPT_SCHEMA_VERSION],
      default: RUNTIME_STATE_MIGRATION_RECEIPT_SCHEMA_VERSION,
      immutable: true,
    },
    receiptId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      default: () => new mongoose.Types.ObjectId(),
      immutable: true,
      unique: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 800,
      match: IDEMPOTENCY_KEY_PATTERN,
      immutable: true,
      unique: true,
    },
    operationType: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_STATE_MIGRATION_OPERATION_TYPES),
      immutable: true,
    },
    targetSelectionRef: {
      type: targetSelectionRefSchema,
      required: true,
      immutable: true,
    },
    environmentClass: {
      type: String,
      required: isLegacyBaselineReceipt,
      enum: ['DEVELOPMENT_TEST'],
      immutable: true,
    },
    databaseName: {
      type: String,
      required: isLegacyBaselineReceipt,
      trim: true,
      immutable: true,
    },
    clusterRef: {
      type: String,
      required: isLegacyBaselineReceipt,
      trim: true,
      maxlength: 240,
      immutable: true,
    },
    scopeDigest: {
      type: String,
      required: true,
      match: SHA256_PATTERN,
      immutable: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      immutable: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      immutable: true,
    },
    runtimeInstanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RuntimeInstance',
      required: true,
      immutable: true,
    },
    runtimeInstanceKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
      immutable: true,
    },
    logicalSources: {
      type: [logicalSourceSchema],
      required: true,
      validate: {
        validator: validateLogicalSources,
        message: 'SS-014 logical sources must be the ordered sections, evidence and graph mapping.',
      },
      immutable: true,
    },
    sourceSetHash: {
      type: String,
      required: true,
      match: SHA256_PATTERN,
      immutable: true,
    },
    dryRunObservationRefs: {
      type: [dryRunObservationRefSchema],
      required: isLegacyBaselineReceipt,
      default: undefined,
      validate: {
        validator(refs) {
          return !isLegacyBaselineReceipt.call(this) || validateDryRunObservationRefs(refs)
        },
        message: 'Exactly two distinct SS-014 dry-run observation references are required.',
      },
      immutable: true,
    },
    planHashRef: {
      type: planHashRefSchema,
      required: isLegacyBaselineReceipt,
      immutable: true,
    },
    authority: {
      type: authoritySchema,
      required: isLegacyBaselineReceipt,
    },
    assignedStateVersion: {
      type: String,
      trim: true,
      match: STATE_VERSION_PATTERN,
      default: null,
    },
    actor: {
      type: actorSchema,
      required: true,
      immutable: true,
    },
    backupManifestRef: {
      type: String,
      required: isLegacyBaselineReceipt,
      trim: true,
      match: SHA256_PATTERN,
      immutable: true,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES),
      default: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.PLANNED,
      index: true,
    },
    rollbackRef: {
      type: rollbackRefSchema,
      default: null,
    },
    failureCode: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    rolledBackAt: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'runtime_state_migration_receipts',
    timestamps: true,
    strict: 'throw',
  },
)

runtimeStateMigrationReceiptSchema.index(
  { scopeDigest: 1, status: 1 },
  { name: 'runtime_state_migration_receipt_scope_status' },
)
runtimeStateMigrationReceiptSchema.index(
  { runtimeInstanceId: 1, assignedStateVersion: 1 },
  {
    name: 'unique_runtime_state_migration_assigned_version',
    unique: true,
    partialFilterExpression: { assignedStateVersion: { $type: 'string' } },
  },
)
runtimeStateMigrationReceiptSchema.index(
  { runtimeInstanceId: 1, operationType: 1 },
  {
    name: 'unique_ss014_legacy_baseline_per_runtime',
    unique: true,
  },
)

runtimeStateMigrationReceiptSchema.pre('validate', function validateReceipt(next) {
  const nativeInitialization = this.operationType
    === RUNTIME_STATE_MIGRATION_OPERATION_TYPES.NATIVE_INITIALIZATION
  if (
    this.isNew
    && !nativeInitialization
    && (this.status !== RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.PLANNED || this.assignedStateVersion != null)
  ) {
    this.invalidate('assignedStateVersion', 'New SS-014 receipts must begin PLANNED without an assigned state version.')
  }
  const operationKeyValid = (
    this.operationType === RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE
    && LEGACY_BASELINE_IDEMPOTENCY_KEY_PATTERN.test(String(this.idempotencyKey || ''))
  ) || (
    nativeInitialization
    && NATIVE_INITIALIZATION_IDEMPOTENCY_KEY_PATTERN.test(String(this.idempotencyKey || ''))
  )
  if (!operationKeyValid) {
    this.invalidate('idempotencyKey', 'Receipt idempotency key must match its operation type.')
  }
  if (
    this.isNew
    && nativeInitialization
    && (
      this.status !== RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED
      || !this.assignedStateVersion
      || !this.assignedAt
      || !this.verifiedAt
    )
  ) {
    this.invalidate(
      'assignedStateVersion',
      'Native Runtime State V2 initialization receipts must be created VERIFIED with assignment timestamps.',
    )
  }
  if (this.targetSelectionRef?.scopeDigest !== this.scopeDigest) {
    this.invalidate('targetSelectionRef.scopeDigest', 'Target scope digest must match the receipt scope digest.')
  }

  if (this.authority && this.authority.issuedAt >= this.authority.expiresAt) {
    this.invalidate('authority.expiresAt', 'Authority expiry must be after issuance.')
  }

  if (
    this.authority?.consumedAt
    && ![
      RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ASSIGNED,
      RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED,
    ].includes(this.status)
  ) {
    this.invalidate('authority.consumedAt', 'Consumed authority requires an assigned or verified receipt.')
  }

  if (
    [RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ASSIGNED, RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED].includes(this.status)
    && !this.assignedStateVersion
  ) {
    this.invalidate('assignedStateVersion', 'Assigned and verified receipts require an opaque state version.')
  }

  if (this.status === RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.FAILED && !this.failureCode) {
    this.invalidate('failureCode', 'Failed receipts require a governed failure code.')
  }

  if (
    this.status === RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ROLLED_BACK
    && (!this.assignedStateVersion || !this.rollbackRef)
  ) {
    this.invalidate('rollbackRef', 'Rolled-back receipts require an assigned version and rollback reference.')
  }

  next()
})

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)

const assignedStateVersionUpdateError = () => {
  const error = new Error('assignedStateVersion may only be assigned once during APPLYING to ASSIGNED.')
  error.code = RUNTIME_STATE_MIGRATION_MODEL_ERROR_CODES.ASSIGNED_STATE_VERSION_UPDATE_FORBIDDEN
  return error
}

export const assertAssignedStateVersionUpdate = ({ operation, filter = {}, update = {} } = {}) => {
  if (['replaceOne', 'findOneAndReplace'].includes(operation) || Array.isArray(update)) {
    throw assignedStateVersionUpdateError()
  }
  const directAssignment = hasOwn(update, 'assignedStateVersion')
  const setAssignment = hasOwn(update.$set, 'assignedStateVersion')
  const unsetAssignment = hasOwn(update.$unset, 'assignedStateVersion')
  const setOnInsertAssignment = hasOwn(update.$setOnInsert, 'assignedStateVersion')
  const operatorAssignment = Object.entries(update).some(([operator, value]) => (
    !['$set', '$unset', '$setOnInsert'].includes(operator)
    && (hasOwn(value, 'assignedStateVersion') || Object.values(value || {}).includes('assignedStateVersion'))
  ))
  if (!directAssignment && !setAssignment && !unsetAssignment && !setOnInsertAssignment && !operatorAssignment) return

  if (
    operation !== 'updateOne'
    || directAssignment
    || unsetAssignment
    || setOnInsertAssignment
    || !setAssignment
    || filter.status !== RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.APPLYING
    || filter.assignedStateVersion !== null
    || update.$set?.status !== RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ASSIGNED
    || !STATE_VERSION_PATTERN.test(String(update.$set.assignedStateVersion || ''))
  ) throw assignedStateVersionUpdateError()
}

export const assertAssignedStateVersionBulkWrite = (operations = []) => {
  if (!Array.isArray(operations)) throw assignedStateVersionUpdateError()
  for (const entry of operations) {
    if (entry?.replaceOne || entry?.updateMany) throw assignedStateVersionUpdateError()
    if (entry?.updateOne) {
      const update = entry.updateOne.update
      const touchesAssignment = Array.isArray(update)
        || hasOwn(update, 'assignedStateVersion')
        || Object.entries(update || {}).some(([, value]) => (
          hasOwn(value, 'assignedStateVersion') || Object.values(value || {}).includes('assignedStateVersion')
        ))
      if (touchesAssignment) throw assignedStateVersionUpdateError()
    }
    if (entry?.insertOne && entry.insertOne.document?.assignedStateVersion != null) {
      throw assignedStateVersionUpdateError()
    }
  }
}

runtimeStateMigrationReceiptSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'],
  function guardAssignedStateVersionUpdate(next) {
    try {
      assertAssignedStateVersionUpdate({
        operation: this.op,
        filter: this.getFilter(),
        update: this.getUpdate(),
      })
      next()
    } catch (error) {
      next(error)
    }
  },
)

runtimeStateMigrationReceiptSchema.pre('save', function guardAssignedStateVersionSave(next) {
  if (!this.isNew && this.isModified('assignedStateVersion')) {
    next(assignedStateVersionUpdateError())
    return
  }
  next()
})

runtimeStateMigrationReceiptSchema.pre('bulkWrite', function guardAssignedStateVersionBulkWrite(next, operations) {
  try {
    assertAssignedStateVersionBulkWrite(operations)
    next()
  } catch (error) {
    next(error)
  }
})

const RuntimeStateMigrationReceipt = mongoose.model(
  'RuntimeStateMigrationReceipt',
  runtimeStateMigrationReceiptSchema,
)

export {
  runtimeStateMigrationReceiptSchema,
  targetSelectionRefSchema,
  logicalSourceSchema,
  dryRunObservationRefSchema,
  planHashRefSchema,
  actorSchema,
  rollbackRefSchema,
  authoritySchema,
  SHA256_PATTERN,
  STATE_VERSION_PATTERN,
  AUTHORITY_TOKEN_DIGEST_PATTERN,
  IDEMPOTENCY_KEY_PATTERN,
}
export default RuntimeStateMigrationReceipt
