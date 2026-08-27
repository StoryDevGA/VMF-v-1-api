import mongoose from 'mongoose'
import { describe, expect, jest, test } from '@jest/globals'

import models from '../models/index.js'
import RuntimeStateMigrationReceipt, {
  assertAssignedStateVersionBulkWrite,
  assertAssignedStateVersionUpdate,
  RUNTIME_STATE_MIGRATION_LOGICAL_PATHS,
  RUNTIME_STATE_MIGRATION_MODEL_ERROR_CODES,
  RUNTIME_STATE_MIGRATION_OPERATION_TYPES,
  RUNTIME_STATE_MIGRATION_RECEIPT_SCHEMA_VERSION,
  RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES,
  RUNTIME_STATE_MIGRATION_TARGET_COLLECTIONS,
  runtimeStateMigrationReceiptSchema,
} from '../models/RuntimeStateMigrationReceipt.js'
import {
  applyRuntimeStateMigrationBaseline,
  executeTransactionOnce,
} from '../services/runtimeStateMigrationBaselineApplyService.js'
import {
  assertCanonicalRuntimeStateVersionAssignment,
  assertRuntimeStateMigrationReceiptIdempotency,
  assertRuntimeStateMigrationReceiptTransition,
  createApprovedRuntimeStateMigrationScopeBinding,
  createApplyAuthorizedRuntimeStateMigrationPlan,
  createRuntimeStateMigrationAuthority,
  createRuntimeStateMigrationIdempotencyKey,
  isServerAuthorizedRuntimeStateMigrationPlan,
  prepareApplyAuthorizedRuntimeStateMigrationReceipt,
  reconcileRuntimeStateMigrationBaseline,
  RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES,
  renewRuntimeStateMigrationAuthority,
  verifyAuthorityToken,
} from '../services/runtimeStateMigrationReceiptService.js'

const customerId = new mongoose.Types.ObjectId('000000000000000000000001')
const tenantId = new mongoose.Types.ObjectId('000000000000000000000002')
const runtimeInstanceId = new mongoose.Types.ObjectId('000000000000000000000003')
const hash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const secondHash = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const makePlanPayload = (overrides = {}) => {
  const scope = {
  targetSelectionRef: { bindingRef: 'ss014-target-selection-v1:run-1', scopeDigest: hash },
  environmentClass: 'DEVELOPMENT_TEST',
  databaseName: 'test',
  clusterRef: 'VMF-v1-test',
  scopeDigest: hash,
  customerId,
  tenantId,
  runtimeInstanceId,
  runtimeInstanceKey: 'runtime-one',
  operationType: RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE,
  logicalSources: RUNTIME_STATE_MIGRATION_LOGICAL_PATHS.map((logicalPath) => ({
    logicalPath,
    targetCollections: RUNTIME_STATE_MIGRATION_TARGET_COLLECTIONS[logicalPath],
    sourceHash: hash,
    recordCount: 0,
  })),
  sourceSetHash: hash,
  dryRunObservationRefs: [
    { reference: 'run-1', referenceType: 'RUN' },
    { reference: 'run-2', referenceType: 'RECEIPT' },
  ],
  backupManifestRef: hash,
  actor: { actorRef: 'gary', actorType: 'USER' },
  ...overrides,
  }
  return {
    ...scope,
    approvedScopeBinding: createApprovedRuntimeStateMigrationScopeBinding({
      scope,
      authorization: {
        status: 'APPLY_AUTHORIZED',
        operationType: RUNTIME_STATE_MIGRATION_OPERATION_TYPES.LEGACY_BASELINE,
        oneUse: true,
        confirmationDigest: hash,
        expiresAt: new Date('2026-08-25T11:00:00.000Z'),
      },
      now: new Date('2026-08-25T10:00:00.000Z'),
    }),
  }
}

const makePlan = (overrides = {}) => createApplyAuthorizedRuntimeStateMigrationPlan(makePlanPayload(overrides))

const makePrepared = (overrides = {}) => {
  const plan = makePlan(overrides.plan)
  return {
    plan,
    ...prepareApplyAuthorizedRuntimeStateMigrationReceipt({ plan, now: new Date('2026-08-25T10:00:00.000Z'), ttlMs: 60_000 }),
  }
}

const validate = async (receiptOverrides = {}) => {
  const prepared = makePrepared()
  const receipt = new RuntimeStateMigrationReceipt({ ...prepared.receipt, ...receiptOverrides })
  try {
    await receipt.validate()
    return null
  } catch (error) {
    return error
  }
}

const expectErrorCode = async (callback, code) => {
  try {
    await callback()
    throw new Error('Expected the operation to fail.')
  } catch (error) {
    expect(error.code).toBe(code)
  }
}

const executeModelPreHook = (name, context, args = []) => new Promise((resolve, reject) => {
  runtimeStateMigrationReceiptSchema.s.hooks.execPre(name, context, args, (error) => {
    if (error) reject(error)
    else resolve()
  })
})

describe('Runtime State Migration Receipt contract', () => {
  test('registers the dedicated collection, schema version and exact uniqueness declarations', () => {
    expect(models.RuntimeStateMigrationReceipt).toBe(RuntimeStateMigrationReceipt)
    expect(RuntimeStateMigrationReceipt.collection.name).toBe('runtime_state_migration_receipts')
    expect(runtimeStateMigrationReceiptSchema.path('schemaVersion').options.default)
      .toBe(RUNTIME_STATE_MIGRATION_RECEIPT_SCHEMA_VERSION)
    expect(runtimeStateMigrationReceiptSchema.path('status').enumValues)
      .toEqual(Object.values(RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES))
    expect(runtimeStateMigrationReceiptSchema.path('operationType').enumValues)
      .toEqual(Object.values(RUNTIME_STATE_MIGRATION_OPERATION_TYPES))
    expect(runtimeStateMigrationReceiptSchema.indexes().map(([, options]) => options.name).filter(Boolean))
      .toEqual([
        'runtime_state_migration_receipt_scope_status',
        'unique_runtime_state_migration_assigned_version',
        'unique_ss014_legacy_baseline_per_runtime',
      ])
    const baselineIndex = runtimeStateMigrationReceiptSchema.indexes()
      .find(([, options]) => options.name === 'unique_ss014_legacy_baseline_per_runtime')
    expect(baselineIndex[0]).toEqual({ runtimeInstanceId: 1, operationType: 1 })
    expect(baselineIndex[1]).toMatchObject({ unique: true })
    expect(baselineIndex[1].partialFilterExpression).toBeUndefined()
  })

  test('accepts one apply-authorized planned receipt with the adopted logical mapping', async () => {
    expect(await validate()).toBeNull()
  })

  test('allows only the guarded APPLYING to ASSIGNED one-time state-version update', async () => {
    expect(runtimeStateMigrationReceiptSchema.path('assignedStateVersion').options.immutable).toBeUndefined()
    const assignedStateVersion = 'rsv2:00000000-0000-4000-8000-000000000001'
    expect(() => assertAssignedStateVersionUpdate({
      operation: 'updateOne',
      filter: {
        status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.APPLYING,
        assignedStateVersion: null,
      },
      update: {
        $set: {
          status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ASSIGNED,
          assignedStateVersion,
        },
      },
    })).not.toThrow()

    const forbidden = [
      { operation: 'updateMany', filter: { status: 'APPLYING', assignedStateVersion: null }, update: { $set: { status: 'ASSIGNED', assignedStateVersion } } },
      { operation: 'updateOne', filter: { status: 'ASSIGNED', assignedStateVersion }, update: { $set: { assignedStateVersion } } },
      { operation: 'updateOne', filter: { status: 'APPLYING', assignedStateVersion: null }, update: { $unset: { assignedStateVersion: 1 } } },
      { operation: 'updateOne', filter: { status: 'APPLYING', assignedStateVersion: null }, update: { $setOnInsert: { assignedStateVersion } } },
      { operation: 'updateOne', filter: { status: 'ASSIGNED' }, update: { $rename: { assignedStateVersion: 'legacyVersion' } } },
      { operation: 'updateOne', filter: { status: 'APPLYING' }, update: [{ $set: { assignedStateVersion } }] },
      { operation: 'updateOne', filter: { status: 'APPLYING' }, update: [{ $unset: 'assignedStateVersion' }] },
      { operation: 'replaceOne', filter: { status: 'ASSIGNED' }, update: { assignedStateVersion } },
      { operation: 'replaceOne', filter: { status: 'ASSIGNED' }, update: { status: 'VERIFIED' } },
    ]
    forbidden.forEach((candidate) => {
      expect(() => assertAssignedStateVersionUpdate(candidate)).toThrow(expect.objectContaining({
        code: RUNTIME_STATE_MIGRATION_MODEL_ERROR_CODES.ASSIGNED_STATE_VERSION_UPDATE_FORBIDDEN,
      }))
    })

    const query = RuntimeStateMigrationReceipt.updateOne(
      { status: 'APPLYING', assignedStateVersion: null },
      { $set: { status: 'ASSIGNED', assignedStateVersion } },
      { runValidators: true },
    )
    expect(query._castUpdate(query.getUpdate()).$set.assignedStateVersion).toBe(assignedStateVersion)
    expect(() => assertAssignedStateVersionBulkWrite([
      { updateOne: { filter: { status: 'APPLYING' }, update: { $set: { assignedStateVersion } } } },
    ])).toThrow(expect.objectContaining({
      code: RUNTIME_STATE_MIGRATION_MODEL_ERROR_CODES.ASSIGNED_STATE_VERSION_UPDATE_FORBIDDEN,
    }))
    expect(() => assertAssignedStateVersionBulkWrite([
      { replaceOne: { filter: { status: 'VERIFIED' }, replacement: { status: 'VERIFIED' } } },
    ])).toThrow(expect.objectContaining({
      code: RUNTIME_STATE_MIGRATION_MODEL_ERROR_CODES.ASSIGNED_STATE_VERSION_UPDATE_FORBIDDEN,
    }))
    expect(runtimeStateMigrationReceiptSchema.s.hooks._pres.get('bulkWrite')?.length).toBeGreaterThan(0)
    const allowedQuery = RuntimeStateMigrationReceipt.updateOne(
      { status: 'APPLYING', assignedStateVersion: null },
      { $set: { status: 'ASSIGNED', assignedStateVersion } },
    )
    await expect(executeModelPreHook('updateOne', allowedQuery)).resolves.toBeUndefined()
    const replacementQuery = RuntimeStateMigrationReceipt.replaceOne(
      { status: 'VERIFIED' },
      { status: 'VERIFIED' },
    )
    await expect(executeModelPreHook('replaceOne', replacementQuery)).rejects.toMatchObject({
      code: RUNTIME_STATE_MIGRATION_MODEL_ERROR_CODES.ASSIGNED_STATE_VERSION_UPDATE_FORBIDDEN,
    })
    await expect(executeModelPreHook('bulkWrite', RuntimeStateMigrationReceipt, [[
      { updateOne: { filter: { status: 'APPLYING' }, update: { $set: { assignedStateVersion } } } },
    ]])).rejects.toMatchObject({
      code: RUNTIME_STATE_MIGRATION_MODEL_ERROR_CODES.ASSIGNED_STATE_VERSION_UPDATE_FORBIDDEN,
    })
  })

  test('rejects a new assigned or verified receipt so bulkSave cannot bypass PLANNED creation', async () => {
    const assignedStateVersion = 'rsv2:00000000-0000-4000-8000-000000000001'
    expect(await validate({ status: 'ASSIGNED', assignedStateVersion })).toBeInstanceOf(mongoose.Error.ValidationError)
    expect(await validate({ status: 'VERIFIED', assignedStateVersion })).toBeInstanceOf(mongoose.Error.ValidationError)
  })

  test('requires operation, authority, backup and apply-authorized plan fields', async () => {
    const prepared = makePrepared()
    expect(await validate({ operationType: undefined })).toBeInstanceOf(mongoose.Error.ValidationError)
    expect(await validate({ authority: undefined })).toBeInstanceOf(mongoose.Error.ValidationError)
    expect(await validate({ backupManifestRef: undefined })).toBeInstanceOf(mongoose.Error.ValidationError)
    expect(await validate({ planHashRef: { value: hash, status: 'PROVISIONAL_NOT_APPLY_AUTHORITY' } }))
      .toBeInstanceOf(mongoose.Error.ValidationError)
    expect(prepared.receipt.planHashRef.status).toBe('APPLY_AUTHORIZED')
  })

  test('rejects invalid source ordering, scope, authority dates and consumed planned receipts', async () => {
    const prepared = makePrepared()
    expect(await validate({ logicalSources: [...prepared.receipt.logicalSources].reverse() }))
      .toBeInstanceOf(mongoose.Error.ValidationError)
    expect(await validate({ targetSelectionRef: { bindingRef: 'target', scopeDigest: secondHash } }))
      .toBeInstanceOf(mongoose.Error.ValidationError)
    expect(await validate({ authority: { ...prepared.receipt.authority, issuedAt: new Date('2026-08-25T10:01:00Z'), expiresAt: new Date('2026-08-25T10:00:00Z') } }))
      .toBeInstanceOf(mongoose.Error.ValidationError)
    expect(await validate({ authority: { ...prepared.receipt.authority, consumedAt: new Date() } }))
      .toBeInstanceOf(mongoose.Error.ValidationError)
  })
})

describe('Runtime State Migration Receipt guard service', () => {
  test('brands a server plan and rejects copied authority flags', () => {
    const plan = makePlan()
    expect(isServerAuthorizedRuntimeStateMigrationPlan(plan)).toBe(true)
    expect(isServerAuthorizedRuntimeStateMigrationPlan({ ...plan })).toBe(false)
    expectErrorCode(
      () => createApplyAuthorizedRuntimeStateMigrationPlan({ ...makePlanPayload(), applyAuthority: true }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_TRUSTED,
    )
  })

  test('rejects caller-supplied idempotency and authority fields', () => {
    expectErrorCode(
      () => prepareApplyAuthorizedRuntimeStateMigrationReceipt({ plan: makePlan(), idempotencyKey: 'caller' }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.CALLER_IDEMPOTENCY_INPUT_FORBIDDEN,
    )
    expectErrorCode(
      () => prepareApplyAuthorizedRuntimeStateMigrationReceipt({ plan: makePlan(), authority: {} }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.CALLER_AUTHORITY_INPUT_FORBIDDEN,
    )
  })

  test('creates a stable idempotency key across controlled credential renewal', () => {
    const prepared = makePrepared()
    const renewed = {
      ...prepared.receipt,
      authority: {
        ...prepared.receipt.authority,
        tokenDigest: secondHash,
        issuedAt: new Date('2026-08-25T10:01:00.000Z'),
        expiresAt: new Date('2026-08-25T10:02:00.000Z'),
      },
    }
    expect(createRuntimeStateMigrationIdempotencyKey(prepared.receipt))
      .toBe(createRuntimeStateMigrationIdempotencyKey(renewed))
    expect(assertRuntimeStateMigrationReceiptIdempotency({ existing: prepared.receipt, candidate: renewed }))
      .toMatchObject({ action: 'REUSE' })
    expectErrorCode(
      () => assertRuntimeStateMigrationReceiptIdempotency({
        existing: prepared.receipt,
        candidate: { ...renewed, sourceSetHash: secondHash },
      }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    )
    expect(createRuntimeStateMigrationIdempotencyKey({
      ...prepared.receipt,
      dryRunObservationRefs: [{ reference: 'changed', referenceType: 'RUN' }, { reference: 'run-2', referenceType: 'RECEIPT' }],
    })).not.toBe(createRuntimeStateMigrationIdempotencyKey(prepared.receipt))
  })

  test('rejects malformed server idempotency keys and unbounded authority renewal', () => {
    const prepared = makePrepared()
    expectErrorCode(
      () => assertRuntimeStateMigrationReceiptIdempotency({
        existing: prepared.receipt,
        candidate: { ...prepared.receipt, idempotencyKey: 'caller-key' },
      }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    )
    expectErrorCode(
      () => renewRuntimeStateMigrationAuthority({ receipt: prepared.receipt, ttlMs: 15 * 60 * 1000 + 1 }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_RENEWAL_FORBIDDEN,
    )
  })

  test('enforces token format, scope, expiry and one-use consumption', () => {
    const prepared = makePrepared()
    expect(verifyAuthorityToken({ receipt: prepared.receipt, token: prepared.token, scopeDigest: hash, now: new Date('2026-08-25T10:00:01Z') })).toBe(true)
    expectErrorCode(
      () => verifyAuthorityToken({ receipt: prepared.receipt, token: prepared.token, scopeDigest: secondHash, now: new Date('2026-08-25T10:00:01Z') }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH,
    )
    expectErrorCode(
      () => verifyAuthorityToken({ receipt: prepared.receipt, token: prepared.token, now: new Date('2026-08-25T10:00:01Z') }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH,
    )
    expectErrorCode(
      () => verifyAuthorityToken({ receipt: prepared.receipt, token: prepared.token, scopeDigest: hash, now: new Date('2026-08-25T10:01:00Z') }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_TOKEN_EXPIRED,
    )
    expectErrorCode(
      () => verifyAuthorityToken({ receipt: { ...prepared.receipt, authority: { ...prepared.receipt.authority, consumedAt: new Date() } }, token: prepared.token, scopeDigest: hash }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_TOKEN_CONSUMED,
    )
  })

  test('enforces lifecycle transitions and fail-closed canonical assignment', () => {
    expect(assertRuntimeStateMigrationReceiptTransition({ currentStatus: 'PLANNED', nextStatus: 'APPLYING' })).toMatchObject({ nextStatus: 'APPLYING' })
    expectErrorCode(
      () => assertRuntimeStateMigrationReceiptTransition({ currentStatus: 'PLANNED', nextStatus: 'VERIFIED' }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.INVALID_TRANSITION,
    )
    expectErrorCode(
      () => assertRuntimeStateMigrationReceiptTransition({ currentStatus: 'APPLYING', nextStatus: 'ASSIGNED' }),
      RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.ASSIGNED_VERSION_REQUIRED,
    )
    const assignedStateVersion = 'rsv2:00000000-0000-4000-8000-000000000001'
    expect(assertCanonicalRuntimeStateVersionAssignment({
      runtime: {},
      receipt: { status: 'ASSIGNED', assignedStateVersion },
      assignedStateVersion,
    })).toBe(assignedStateVersion)
    expectErrorCode(() => assertCanonicalRuntimeStateVersionAssignment({
      runtime: { runtimeStateVersion: assignedStateVersion },
      receipt: { status: 'ASSIGNED', assignedStateVersion },
      assignedStateVersion,
    }), RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.COMPATIBILITY_ALIAS_PRESENT)
    expectErrorCode(() => assertCanonicalRuntimeStateVersionAssignment({
      runtime: { stateVersion: assignedStateVersion, runtimeStateVersion: 'rsv2:00000000-0000-4000-8000-000000000002' },
      receipt: { status: 'ASSIGNED', assignedStateVersion },
      assignedStateVersion,
    }), RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.MIXED_STATE_VERSION)
  })

  test('reconciliation treats compatibility aliases as ambiguous', async () => {
    const prepared = makePrepared()
    const state = {
      receipt: {
        ...prepared.receipt,
        receiptId: 'receipt-1',
        status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.VERIFIED,
        assignedStateVersion: 'rsv2:00000000-0000-4000-8000-000000000001',
        authority: { ...prepared.receipt.authority, consumedAt: new Date() },
      },
      runtime: {
        _id: runtimeInstanceId,
        customerId,
        tenantId,
        runtimeInstanceKey: 'runtime-one',
        stateVersion: 'rsv2:00000000-0000-4000-8000-000000000001',
        runtimeStateVersion: 'rsv2:00000000-0000-4000-8000-000000000001',
      },
    }
    const model = (key) => ({
      findOne(filter) {
        const record = state[key]
        return { async exec() { return record && matches(record, filter) ? record : null } }
      },
    })
    await expect(reconcileRuntimeStateMigrationBaseline({
      receiptId: 'receipt-1',
      receiptModel: model('receipt'),
      runtimeModel: model('runtime'),
    })).resolves.toMatchObject({ status: 'AMBIGUOUS' })
    await expect(reconcileRuntimeStateMigrationBaseline({
      receiptId: 'receipt-1',
      receiptModel: model('receipt'),
      runtimeModel: model('missing'),
    })).resolves.toMatchObject({ status: 'AMBIGUOUS' })
  })
})

const getPath = (record, path) => path.split('.').reduce((value, key) => value?.[key], record)

const matches = (record, filter) => Object.entries(filter).every(([path, expected]) => {
  const actual = getPath(record, path)
  if (expected && typeof expected === 'object' && '$exists' in expected) {
    return (Object.prototype.hasOwnProperty.call(record, path) || actual !== undefined) === expected.$exists
  }
  if (expected === null) return actual === null || actual === undefined
  return actual?.toString?.() === expected?.toString?.() || actual === expected
})

const setPath = (record, path, value) => {
  const parts = path.split('.')
  const last = parts.pop()
  const parent = parts.reduce((current, part) => {
    current[part] ||= {}
    return current[part]
  }, record)
  parent[last] = value
}

const makeTransactionalModels = (prepared, runtimeOverrides = {}, options = {}) => {
  const state = {
    receipt: { receiptId: 'receipt-1', ...prepared.receipt, authority: { ...prepared.receipt.authority } },
    runtime: { _id: runtimeInstanceId, customerId, tenantId, runtimeInstanceKey: 'runtime-one', ...runtimeOverrides },
  }
  const calls = []
  const query = (kind, filter) => {
    const record = kind === 'receipt' ? state.receipt : state.runtime
    const cursor = {
      session() { return cursor },
      lean() { return cursor },
      async exec() { return matches(record, filter) ? record : null },
    }
    return cursor
  }
  const buildModel = (kind) => ({
    findOne(filter) {
      calls.push({ kind, operation: 'findOne', filter })
      return query(kind, filter)
    },
    async updateOne(filter, update) {
      calls.push({ kind, operation: 'updateOne', filter, update })
      const record = kind === 'receipt' ? state.receipt : state.runtime
      if (!matches(record, filter)) return { matchedCount: 0, modifiedCount: 0 }
      if (options.failOnUpdate?.(kind, update)) throw new Error('injected transaction failure')
      Object.entries(update.$set || {}).forEach(([path, value]) => setPath(record, path, value))
      return { matchedCount: 1, modifiedCount: 1 }
    },
  })
  const receiptModel = buildModel('receipt')
  const runtimeModel = buildModel('runtime')
  const session = {
    startTransaction(transactionOptions) {
      session.transactionOptions = transactionOptions
      session.beforeReceipt = { ...state.receipt, authority: { ...state.receipt.authority } }
      session.beforeRuntime = { ...state.runtime }
      session.active = true
    },
    async commitTransaction() {
      if (options.unknownCommit) {
        const error = new Error('unknown commit')
        error.errorLabels = ['UnknownTransactionCommitResult']
        throw error
      }
      session.active = false
    },
    async abortTransaction() {
      state.receipt = session.beforeReceipt
      state.runtime = session.beforeRuntime
      session.active = false
    },
    inTransaction() { return session.active === true },
    async endSession() {},
  }
  return { state, calls, receiptModel, runtimeModel, startSession: jest.fn(async () => session) }
}

describe('Runtime State Migration baseline apply control boundary', () => {
  test('executes exactly one explicit transaction and does not retry an unknown commit', async () => {
    const calls = []
    const unknownCommit = new Error('unknown commit')
    unknownCommit.errorLabels = ['UnknownTransactionCommitResult']
    const session = {
      startTransaction: jest.fn((options) => calls.push(['start', options])),
      commitTransaction: jest.fn(async () => { calls.push(['commit']); throw unknownCommit }),
      abortTransaction: jest.fn(async () => calls.push(['abort'])),
      inTransaction: jest.fn(() => true),
    }
    const callback = jest.fn(async () => calls.push(['callback']))
    await expect(executeTransactionOnce({ session, callback, options: { writeConcern: { w: 'majority' } } }))
      .rejects.toBe(unknownCommit)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(session.commitTransaction).toHaveBeenCalledTimes(1)
    expect(session.abortTransaction).not.toHaveBeenCalled()
    expect(calls.map(([name]) => name)).toEqual(['start', 'callback', 'commit'])
  })

  test('performs only receipt/runtime writes, applies absent predicates and verifies in-transaction readback', async () => {
    const prepared = makePrepared()
    const models = makeTransactionalModels(prepared)
    const result = await applyRuntimeStateMigrationBaseline({
      receiptId: prepared.receipt.receiptId || 'receipt-1',
      token: prepared.token,
      scopeDigest: hash,
      plan: prepared.plan,
      verifyBackupManifest: async ({ backupManifestRef, contract }) => ({
        verified: true,
        manifestDigest: backupManifestRef,
        contract,
        isolatedRestore: { performed: true, hashMatches: true, rootMatches: true },
      }),
      now: new Date('2026-08-25T10:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })
    expect(result.status).toBe('VERIFIED')
    expect(models.state.receipt.status).toBe('VERIFIED')
    expect(models.state.receipt.authority.consumedAt).toBeTruthy()
    expect(models.state.runtime.stateVersion).toMatch(/^rsv2:/)
    expect(Object.prototype.hasOwnProperty.call(models.state.runtime, 'runtimeStateVersion')).toBe(false)
    expect(models.calls.every(({ kind }) => ['receipt', 'runtime'].includes(kind))).toBe(true)
    const runtimeUpdate = models.calls.find(({ kind, operation }) => kind === 'runtime' && operation === 'updateOne')
    expect(runtimeUpdate.filter).toMatchObject({ stateVersion: { $exists: false }, runtimeStateVersion: { $exists: false } })
    const assignedReceiptUpdate = models.calls.find(({ kind, operation, update }) => (
      kind === 'receipt'
      && operation === 'updateOne'
      && update?.$set?.status === RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.ASSIGNED
    ))
    expect(assignedReceiptUpdate.filter).toMatchObject({
      status: RUNTIME_STATE_MIGRATION_RECEIPT_STATUSES.APPLYING,
      assignedStateVersion: null,
    })
    const replay = await applyRuntimeStateMigrationBaseline({
      receiptId: 'receipt-1',
      token: prepared.token,
      scopeDigest: hash,
      plan: prepared.plan,
      now: new Date('2026-08-25T10:00:02Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })
    expect(replay).toMatchObject({ status: 'VERIFIED', idempotentReplay: true })
    expect(models.startSession).toHaveBeenCalledTimes(1)
  })

  test('rejects committed replay when scopeDigest is omitted', async () => {
    const prepared = makePrepared()
    const models = makeTransactionalModels(prepared)
    await expect(applyRuntimeStateMigrationBaseline({
      receiptId: 'receipt-1',
      token: prepared.token,
      plan: prepared.plan,
      verifyBackupManifest: async () => ({
        verified: true,
        manifestDigest: hash,
        isolatedRestore: { performed: true, hashMatches: true, rootMatches: true },
      }),
      now: new Date('2026-08-25T10:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH })
    expect(models.startSession).not.toHaveBeenCalled()
  })

  test('rejects committed replay when scopeDigest does not match', async () => {
    const prepared = makePrepared()
    const models = makeTransactionalModels(prepared)
    await expect(applyRuntimeStateMigrationBaseline({
      receiptId: 'receipt-1',
      token: prepared.token,
      scopeDigest: secondHash,
      plan: prepared.plan,
      verifyBackupManifest: async () => ({
        verified: true,
        manifestDigest: hash,
        isolatedRestore: { performed: true, hashMatches: true, rootMatches: true },
      }),
      now: new Date('2026-08-25T10:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH })
    expect(models.startSession).not.toHaveBeenCalled()
  })

  test('allows committed read-only replay after mutation authority expiry', async () => {
    const prepared = makePrepared()
    const models = makeTransactionalModels(prepared)
    await applyRuntimeStateMigrationBaseline({
      receiptId: 'receipt-1',
      token: prepared.token,
      scopeDigest: hash,
      plan: prepared.plan,
      verifyBackupManifest: async ({ backupManifestRef }) => ({
        verified: true,
        manifestDigest: backupManifestRef,
        isolatedRestore: { performed: true, hashMatches: true, rootMatches: true },
      }),
      now: new Date('2026-08-25T10:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })
    const replay = await applyRuntimeStateMigrationBaseline({
      receiptId: 'receipt-1',
      token: prepared.token,
      scopeDigest: hash,
      plan: prepared.plan,
      now: new Date('2026-08-25T11:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })
    expect(replay).toMatchObject({ status: 'VERIFIED', idempotentReplay: true })
    expect(models.startSession).toHaveBeenCalledTimes(1)
  })

  test('rejects a new planned mutation after mutation authority expiry', async () => {
    const prepared = makePrepared()
    const models = makeTransactionalModels(prepared)
    await expect(applyRuntimeStateMigrationBaseline({
      receiptId: 'receipt-1',
      token: prepared.token,
      scopeDigest: hash,
      plan: prepared.plan,
      verifyBackupManifest: async () => ({
        verified: true,
        manifestDigest: hash,
        isolatedRestore: { performed: true, hashMatches: true, rootMatches: true },
      }),
      now: new Date('2026-08-25T11:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.PLAN_NOT_APPLY_AUTHORIZED })
    expect(models.startSession).not.toHaveBeenCalled()
  })

  test('rejects a receipt whose complete identity differs from the branded plan', async () => {
    const prepared = makePrepared()
    const models = makeTransactionalModels(prepared)
    models.state.receipt.customerId = new mongoose.Types.ObjectId('000000000000000000000009')
    await expect(applyRuntimeStateMigrationBaseline({
      receiptId: 'receipt-1',
      token: prepared.token,
      scopeDigest: hash,
      plan: prepared.plan,
      verifyBackupManifest: async ({ backupManifestRef }) => ({
        verified: true,
        manifestDigest: backupManifestRef,
        isolatedRestore: { performed: true, hashMatches: true, rootMatches: true },
      }),
      now: new Date('2026-08-25T10:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.AUTHORITY_SCOPE_MISMATCH })
    expect(models.startSession).not.toHaveBeenCalled()
  })

  test('leaves the receipt planned and token retryable when the transaction aborts', async () => {
    const prepared = makePrepared()
    const models = makeTransactionalModels(prepared, {}, { failOnUpdate: (kind) => kind === 'runtime' })
    await expect(applyRuntimeStateMigrationBaseline({
      receiptId: prepared.receipt.receiptId || 'receipt-1',
      token: prepared.token,
      scopeDigest: hash,
      plan: prepared.plan,
      verifyBackupManifest: async ({ backupManifestRef }) => ({
        verified: true,
        manifestDigest: backupManifestRef,
        isolatedRestore: { performed: true, hashMatches: true, rootMatches: true },
      }),
      now: new Date('2026-08-25T10:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })).rejects.toMatchObject({ message: 'injected transaction failure' })
    expect(models.state.receipt.status).toBe('PLANNED')
    expect(models.state.receipt.authority.consumedAt).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(models.state.runtime, 'stateVersion')).toBe(false)
  })

  test('fails before session creation when backup verification is missing or mismatched', async () => {
    const prepared = makePrepared()
    const models = makeTransactionalModels(prepared)
    await expect(applyRuntimeStateMigrationBaseline({
      receiptId: prepared.receipt.receiptId || 'receipt-1',
      token: prepared.token,
      scopeDigest: hash,
      plan: prepared.plan,
      now: new Date('2026-08-25T10:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.BACKUP_VERIFICATION_REQUIRED })
    expect(models.startSession).not.toHaveBeenCalled()
    await expect(applyRuntimeStateMigrationBaseline({
      receiptId: prepared.receipt.receiptId || 'receipt-1',
      token: prepared.token,
      scopeDigest: hash,
      plan: prepared.plan,
      verifyBackupManifest: async () => ({ verified: false }),
      now: new Date('2026-08-25T10:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.BACKUP_VERIFICATION_FAILED })
    expect(models.startSession).not.toHaveBeenCalled()
  })

  test('rejects alias-only roots and does not issue a runtime update', async () => {
    const prepared = makePrepared()
    const models = makeTransactionalModels(prepared, { runtimeStateVersion: 'rsv2:00000000-0000-4000-8000-000000000001' })
    await expect(applyRuntimeStateMigrationBaseline({
      receiptId: prepared.receipt.receiptId || 'receipt-1',
      token: prepared.token,
      scopeDigest: hash,
      plan: prepared.plan,
      verifyBackupManifest: async ({ backupManifestRef }) => ({
        verified: true,
        manifestDigest: backupManifestRef,
        isolatedRestore: { performed: true, hashMatches: true, rootMatches: true },
      }),
      now: new Date('2026-08-25T10:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.COMPATIBILITY_ALIAS_PRESENT })
    expect(models.calls.some(({ kind, operation }) => kind === 'runtime' && operation === 'updateOne')).toBe(false)
  })

  test('surfaces unknown commit results without blind retry', async () => {
    const prepared = makePrepared()
    const models = makeTransactionalModels(prepared, {}, { unknownCommit: true })
    await expect(applyRuntimeStateMigrationBaseline({
      receiptId: prepared.receipt.receiptId || 'receipt-1',
      token: prepared.token,
      scopeDigest: hash,
      plan: prepared.plan,
      verifyBackupManifest: async ({ backupManifestRef }) => ({
        verified: true,
        manifestDigest: backupManifestRef,
        isolatedRestore: { performed: true, hashMatches: true, rootMatches: true },
      }),
      now: new Date('2026-08-25T10:00:01Z'),
      startSession: models.startSession,
      receiptModel: models.receiptModel,
      runtimeModel: models.runtimeModel,
    })).rejects.toMatchObject({ code: RUNTIME_STATE_MIGRATION_RECEIPT_ERROR_CODES.COMMIT_AMBIGUOUS })
    expect(models.startSession).toHaveBeenCalledTimes(1)
  })
})
