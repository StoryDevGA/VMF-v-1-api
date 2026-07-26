import crypto from 'crypto'
import mongoose from 'mongoose'
import {
  OutcomeStudioTestReferenceObject,
  OutcomeStudioTestReferencePointer,
  OutcomeStudioTestReferenceRevision,
} from '../models/index.js'
import {
  OUTCOME_STUDIO_REFERENCE_FAMILIES,
  OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES,
  OUTCOME_STUDIO_TEST_REFERENCE_FORMAT,
  OUTCOME_STUDIO_TEST_REFERENCE_STATUSES,
} from '../constants/outcomeStudioTestReferences.js'
import auditService from './auditService.js'

const TRANSACTION_TOPOLOGIES = new Set(['ReplicaSetWithPrimary', 'Sharded'])
const KNOWN_ERROR_CODES = new Set(Object.values(OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES))

const appError = (status, code, message) => {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

const notFound = () => appError(404, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.NOT_FOUND, 'Outcome Studio TEST reference was not found.')
const revisionConflict = () => appError(409, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.REVISION_CONFLICT, 'Outcome Studio TEST reference conflicts with the current revision.')
const invalidTransition = (message) => appError(409, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.TRANSITION_INVALID, message)
const objectMissing = () => appError(409, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.OBJECT_MISSING, 'Outcome Studio TEST reference bytes are missing.')
const objectCorrupt = () => appError(409, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.OBJECT_CORRUPT, 'Outcome Studio TEST reference bytes failed integrity verification.')

const isWriteConflict = (error) => error?.code === 11000 || error?.code === 112 || error?.codeName === 'WriteConflict' || /E11000|WriteConflict|write conflict/i.test(error?.message || '')
const toPlain = (value) => value?.toObject ? value.toObject() : value
const toId = (value) => value?.toString ? value.toString() : String(value || '')
const toIso = (value) => value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null

const serializeActor = (value) => {
  if (!value) return null
  const plain = toPlain(value)
  return {
    id: toId(plain.id || plain._id),
    name: String(plain.name || ''),
    ...(plain.email ? { email: String(plain.email) } : {}),
  }
}

export const serializeOutcomeStudioTestReference = (value) => {
  if (!value) return null
  const plain = toPlain(value)
  const approval = plain.productApproval ? toPlain(plain.productApproval) : null
  const supersession = plain.supersession ? toPlain(plain.supersession) : null
  return {
    referenceKey: plain.referenceKey,
    revision: plain.revision,
    family: plain.family,
    title: plain.title,
    purpose: plain.purpose || '',
    status: plain.status,
    originalFileName: plain.originalFileName,
    mimeType: plain.mimeType,
    extension: plain.extension,
    sha256: plain.sha256,
    byteLength: plain.byteLength,
    storageIdentity: plain.storageIdentity,
    productApproval: approval ? {
      approverName: approval.approverName,
      approverRole: approval.approverRole,
      rationale: approval.rationale,
      recordedBy: serializeActor(approval.recordedBy),
      recordedAt: toIso(approval.recordedAt),
    } : null,
    supersession: supersession ? {
      replacementReferenceKey: supersession.replacementReferenceKey,
      reason: supersession.reason,
      recordedBy: serializeActor(supersession.recordedBy),
      recordedAt: toIso(supersession.recordedAt),
    } : null,
    createdBy: serializeActor(plain.createdBy),
    createdAt: toIso(plain.createdAt),
  }
}

const compactAuditEvidence = (value) => {
  if (!value) return null
  const serialized = serializeOutcomeStudioTestReference(value)
  return {
    referenceKey: serialized.referenceKey,
    revision: serialized.revision,
    family: serialized.family,
    status: serialized.status,
    sha256: serialized.sha256,
    byteLength: serialized.byteLength,
    mimeType: serialized.mimeType,
    extension: serialized.extension,
    ...(serialized.productApproval ? { productApproval: { approverName: serialized.productApproval.approverName, approverRole: serialized.productApproval.approverRole } } : {}),
    ...(serialized.supersession ? { replacementReferenceKey: serialized.supersession.replacementReferenceKey } : {}),
  }
}

const actorFromRequest = (request) => {
  const source = request?.scopes?.user || {}
  const id = source.id || source._id || request?.context?.userId || request?.userId
  const name = String(source.name || source.email || request?.userEmail || '').trim().slice(0, 160)
  const email = String(source.email || request?.userEmail || '').trim().slice(0, 254)
  if (!id || !mongoose.isValidObjectId(id) || !name) {
    throw appError(422, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.VALIDATION_FAILED, 'Authenticated TEST reference recorder identity is unavailable.')
  }
  return { id, name, ...(email ? { email } : {}) }
}

const currentTopologyType = () => {
  try {
    return mongoose.connection.getClient()?.topology?.description?.type || ''
  } catch {
    return ''
  }
}

export const assertOutcomeStudioTestReferenceTransactionSupport = () => {
  if (mongoose.connection.readyState !== 1 || !TRANSACTION_TOPOLOGIES.has(currentTopologyType())) {
    throw appError(503, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.TRANSACTION_REQUIRED, 'Outcome Studio TEST reference writes require MongoDB transaction support.')
  }
}

const mapTransactionError = (error) => {
  if (KNOWN_ERROR_CODES.has(error?.code)) return error
  if (isWriteConflict(error)) return revisionConflict()
  return appError(500, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.PERSISTENCE_FAILED, 'Outcome Studio TEST reference persistence failed.')
}

const runTransaction = async (worker) => {
  assertOutcomeStudioTestReferenceTransactionSupport()
  let session
  let result
  try {
    session = await mongoose.startSession()
    await session.withTransaction(async () => { result = await worker(session) })
    return result
  } catch (error) {
    throw mapTransactionError(error)
  } finally {
    if (session) await session.endSession()
  }
}

const runRead = async (worker) => {
  try {
    return await worker()
  } catch (error) {
    if (KNOWN_ERROR_CODES.has(error?.code)) throw error
    throw appError(500, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.PERSISTENCE_FAILED, 'Outcome Studio TEST reference read failed.')
  }
}

const logMutation = async ({ request, session, action, revision, before = null }) => {
  try {
    const audit = await auditService.logFromRequest(request, {
      action,
      resourceType: auditService.RESOURCE_TYPES.OutcomeStudioTestReferenceRevision,
      resourceId: revision._id,
      diff: { before: compactAuditEvidence(before), after: compactAuditEvidence(revision) },
    }, { session, throwOnError: true })
    if (!audit) throw new Error('Audit write returned no record.')
  } catch {
    throw appError(500, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.AUDIT_FAILED, 'Outcome Studio TEST reference audit persistence failed.')
  }
}

const loadStoredObject = async (revision, session = null) => {
  let query = OutcomeStudioTestReferenceObject.findOne({ _id: revision.objectId, storageIdentity: revision.storageIdentity }).select('+bytes')
  if (session) query = query.session(session)
  const stored = await query
  if (!stored) throw objectMissing()
  return stored
}

const verifyStoredObject = (revisionValue, objectValue) => {
  const revision = toPlain(revisionValue)
  const object = toPlain(objectValue)
  const bytes = Buffer.isBuffer(objectValue?.bytes) ? objectValue.bytes : object?.bytes
  if (!Buffer.isBuffer(bytes)) throw objectMissing()
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const tail = bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1')
  const matches = (
    bytes.length === revision.byteLength
    && bytes.length === object.byteLength
    && sha256 === revision.sha256
    && sha256 === object.sha256
    && revision.storageIdentity === object.storageIdentity
    && revision.mimeType === OUTCOME_STUDIO_TEST_REFERENCE_FORMAT.MIME_TYPE
    && object.mimeType === OUTCOME_STUDIO_TEST_REFERENCE_FORMAT.MIME_TYPE
    && revision.extension === OUTCOME_STUDIO_TEST_REFERENCE_FORMAT.EXTENSION
    && object.extension === OUTCOME_STUDIO_TEST_REFERENCE_FORMAT.EXTENSION
    && bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    && tail.includes('%%EOF')
  )
  if (!matches) throw objectCorrupt()
  return bytes
}

const referenceSnapshot = (revisionValue) => {
  const revision = toPlain(revisionValue)
  return {
    family: revision.family,
    referenceKey: revision.referenceKey,
    referenceRevision: revision.revision,
    title: revision.title,
    sha256: revision.sha256,
    byteLength: revision.byteLength,
    mimeType: revision.mimeType,
  }
}

const resolveFamilyReference = async (family, session = null) => {
  let pointerQuery = OutcomeStudioTestReferencePointer.findOne({
    family,
    currentStatus: OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.APPROVED,
  })
  if (typeof pointerQuery?.sort === 'function') pointerQuery = pointerQuery.sort({ updatedAt: -1, _id: -1 })
  if (session && typeof pointerQuery?.session === 'function') pointerQuery = pointerQuery.session(session)
  const pointer = await pointerQuery
  if (!pointer) return { family, state: 'MISSING', snapshot: null }

  const pointerValue = toPlain(pointer)
  let revisionQuery = OutcomeStudioTestReferenceRevision.findById(pointerValue.currentRevisionId)
  if (session && typeof revisionQuery?.session === 'function') revisionQuery = revisionQuery.session(session)
  const revision = await revisionQuery
  if (!revision) return { family, state: 'CORRUPT', snapshot: null }
  const revisionValue = toPlain(revision)
  const pointerMatches = (
    pointerValue.family === family
    && pointerValue.currentStatus === OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.APPROVED
    && revisionValue.family === family
    && revisionValue.status === OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.APPROVED
    && pointerValue.referenceKey === revisionValue.referenceKey
    && pointerValue.currentRevision === revisionValue.revision
    && toId(pointerValue.currentRevisionId) === toId(revisionValue._id)
  )
  if (!pointerMatches) return { family, state: 'CORRUPT', snapshot: null }

  try {
    const object = await loadStoredObject(revision, session)
    verifyStoredObject(revision, object)
  } catch (error) {
    if ([
      OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.OBJECT_MISSING,
      OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.OBJECT_CORRUPT,
    ].includes(error?.code)) return { family, state: 'CORRUPT', snapshot: null }
    throw error
  }

  return { family, state: 'VALID', snapshot: referenceSnapshot(revision) }
}

export const resolveOutcomeStudioTestReferenceSnapshots = async ({ session = null } = {}) => {
  try {
    const results = []
    for (const family of OUTCOME_STUDIO_REFERENCE_FAMILIES) {
      results.push(await resolveFamilyReference(family, session))
    }
    return results
  } catch (error) {
    throw appError(503, 'OUTCOME_STUDIO_TEST_REFERENCE_RESOLUTION_FAILED', 'Outcome Studio TEST reference resolution failed.')
  }
}

const loadCurrent = async (referenceKey, session = null) => {
  let pointerQuery = OutcomeStudioTestReferencePointer.findOne({ referenceKey })
  if (session) pointerQuery = pointerQuery.session(session)
  const pointer = await pointerQuery
  if (!pointer) throw notFound()
  let revisionQuery = OutcomeStudioTestReferenceRevision.findById(pointer.currentRevisionId)
  if (session) revisionQuery = revisionQuery.session(session)
  const revision = await revisionQuery
  if (!revision) throw appError(500, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.PERSISTENCE_FAILED, 'Outcome Studio TEST reference pointer is inconsistent.')
  const pointerValue = toPlain(pointer)
  const revisionValue = toPlain(revision)
  const pointerMatches = (
    pointerValue.referenceKey === referenceKey
    && revisionValue.referenceKey === referenceKey
    && pointerValue.currentRevision === revisionValue.revision
    && pointerValue.family === revisionValue.family
    && pointerValue.currentStatus === revisionValue.status
    && toId(pointerValue.currentRevisionId) === toId(revisionValue._id)
  )
  if (!pointerMatches) throw appError(500, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.PERSISTENCE_FAILED, 'Outcome Studio TEST reference pointer is inconsistent.')
  return { pointer, revision }
}

const createNextRevision = ({ current, actor, now, status, productApproval, supersession }) => new OutcomeStudioTestReferenceRevision({
  referenceKey: current.referenceKey,
  revision: current.revision + 1,
  previousRevisionId: current._id,
  objectId: current.objectId,
  family: current.family,
  title: current.title,
  purpose: current.purpose || '',
  status,
  originalFileName: current.originalFileName,
  mimeType: current.mimeType,
  extension: current.extension,
  sha256: current.sha256,
  byteLength: current.byteLength,
  storageIdentity: current.storageIdentity,
  productApproval,
  supersession,
  createdBy: actor,
  createdAt: now,
})

export const uploadOutcomeStudioTestReference = async ({ payload, request }) => runTransaction(async (session) => {
  const actor = actorFromRequest(request)
  const now = new Date()
  const referenceKey = crypto.randomUUID()
  const storageIdentity = crypto.randomUUID()
  const sha256 = crypto.createHash('sha256').update(payload.buffer).digest('hex')
  const object = new OutcomeStudioTestReferenceObject({
    storageIdentity,
    bytes: payload.buffer,
    sha256,
    byteLength: payload.buffer.length,
    mimeType: payload.mimeType,
    extension: payload.extension,
    createdBy: actor.id,
    createdAt: now,
  })
  await object.save({ session })
  const revision = new OutcomeStudioTestReferenceRevision({
    referenceKey,
    revision: 1,
    objectId: object._id,
    family: payload.family,
    title: payload.title,
    purpose: payload.purpose,
    status: OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.DRAFT,
    originalFileName: payload.originalFileName,
    mimeType: payload.mimeType,
    extension: payload.extension,
    sha256,
    byteLength: payload.buffer.length,
    storageIdentity,
    productApproval: null,
    supersession: null,
    createdBy: actor,
    createdAt: now,
  })
  await revision.save({ session })
  await new OutcomeStudioTestReferencePointer({
    referenceKey,
    family: payload.family,
    currentRevision: 1,
    currentRevisionId: revision._id,
    currentStatus: OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.DRAFT,
  }).save({ session })
  await logMutation({ request, session, action: auditService.AUDIT_ACTIONS.OUTCOME_STUDIO_TEST_REFERENCE_UPLOADED, revision })
  return serializeOutcomeStudioTestReference(revision)
})

export const approveOutcomeStudioTestReference = async ({ referenceKey, payload, request }) => runTransaction(async (session) => {
  const { pointer, revision } = await loadCurrent(referenceKey, session)
  const current = toPlain(revision)
  if (pointer.currentRevision !== payload.expectedRevision) throw revisionConflict()
  if (current.status !== OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.DRAFT) throw invalidTransition('Only a current DRAFT TEST reference can be approved.')
  const stored = await loadStoredObject(current, session)
  verifyStoredObject(current, stored)
  const actor = actorFromRequest(request)
  const now = new Date()
  const next = createNextRevision({
    current,
    actor,
    now,
    status: OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.APPROVED,
    productApproval: {
      approverName: payload.approverName,
      approverRole: payload.approverRole,
      rationale: payload.rationale,
      recordedBy: actor,
      recordedAt: now,
    },
    supersession: null,
  })
  await next.save({ session })
  const advanced = await OutcomeStudioTestReferencePointer.findOneAndUpdate(
    { _id: pointer._id, currentRevision: payload.expectedRevision },
    { $set: { currentRevision: next.revision, currentRevisionId: next._id, currentStatus: next.status } },
    { new: true, session },
  )
  if (!advanced) throw revisionConflict()
  await logMutation({ request, session, action: auditService.AUDIT_ACTIONS.OUTCOME_STUDIO_TEST_REFERENCE_APPROVED, revision: next, before: current })
  return serializeOutcomeStudioTestReference(next)
})

export const supersedeOutcomeStudioTestReference = async ({ referenceKey, payload, request }) => runTransaction(async (session) => {
  if (referenceKey === payload.replacementReferenceKey) throw invalidTransition('A TEST reference cannot supersede itself.')
  const { pointer, revision } = await loadCurrent(referenceKey, session)
  const replacement = await loadCurrent(payload.replacementReferenceKey, session)
  const current = toPlain(revision)
  const replacementCurrent = toPlain(replacement.revision)
  if (pointer.currentRevision !== payload.expectedRevision) throw revisionConflict()
  if (current.status !== OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.APPROVED) throw invalidTransition('Only a current APPROVED TEST reference can be superseded.')
  if (replacementCurrent.status !== OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.APPROVED || replacementCurrent.family !== current.family) {
    throw invalidTransition('Replacement TEST reference must be current, APPROVED, and in the same family.')
  }
  const replacementObject = await loadStoredObject(replacementCurrent, session)
  verifyStoredObject(replacementCurrent, replacementObject)
  const actor = actorFromRequest(request)
  const now = new Date()
  const next = createNextRevision({
    current,
    actor,
    now,
    status: OUTCOME_STUDIO_TEST_REFERENCE_STATUSES.SUPERSEDED,
    productApproval: current.productApproval,
    supersession: { replacementReferenceKey: payload.replacementReferenceKey, reason: payload.reason, recordedBy: actor, recordedAt: now },
  })
  await next.save({ session })
  const advanced = await OutcomeStudioTestReferencePointer.findOneAndUpdate(
    { _id: pointer._id, currentRevision: payload.expectedRevision },
    { $set: { currentRevision: next.revision, currentRevisionId: next._id, currentStatus: next.status } },
    { new: true, session },
  )
  if (!advanced) throw revisionConflict()
  await logMutation({ request, session, action: auditService.AUDIT_ACTIONS.OUTCOME_STUDIO_TEST_REFERENCE_SUPERSEDED, revision: next, before: current })
  return serializeOutcomeStudioTestReference(next)
})

export const listOutcomeStudioTestReferences = async ({ page, pageSize }) => runRead(async () => {
  const [pointers, total] = await Promise.all([
    OutcomeStudioTestReferencePointer.find({}).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    OutcomeStudioTestReferencePointer.countDocuments({}),
  ])
  const revisionIds = pointers.map((pointer) => pointer.currentRevisionId)
  const revisions = revisionIds.length ? await OutcomeStudioTestReferenceRevision.find({ _id: { $in: revisionIds } }).lean() : []
  const byId = new Map(revisions.map((revision) => [toId(revision._id), revision]))
  const items = pointers.map((pointer) => {
    const revision = byId.get(toId(pointer.currentRevisionId))
    if (!revision) return null
    const matches = (
      pointer.referenceKey === revision.referenceKey
      && pointer.currentRevision === revision.revision
      && pointer.family === revision.family
      && pointer.currentStatus === revision.status
      && toId(pointer.currentRevisionId) === toId(revision._id)
    )
    return matches ? revision : null
  })
  if (items.some((item) => !item)) throw appError(500, OUTCOME_STUDIO_TEST_REFERENCE_ERROR_CODES.PERSISTENCE_FAILED, 'Outcome Studio TEST reference list is inconsistent.')
  return { items: items.map(serializeOutcomeStudioTestReference), page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
})

export const getOutcomeStudioTestReference = async (referenceKey) => runRead(async () => {
  const { revision } = await loadCurrent(referenceKey)
  return serializeOutcomeStudioTestReference(revision)
})

export const listOutcomeStudioTestReferenceHistory = async ({ referenceKey, page, pageSize }) => runRead(async () => {
  const exists = await OutcomeStudioTestReferencePointer.exists({ referenceKey })
  if (!exists) throw notFound()
  const [items, total] = await Promise.all([
    OutcomeStudioTestReferenceRevision.find({ referenceKey }).sort({ revision: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    OutcomeStudioTestReferenceRevision.countDocuments({ referenceKey }),
  ])
  return { items: items.map(serializeOutcomeStudioTestReference), page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
})

export const getOutcomeStudioTestReferenceContent = async (referenceKey) => runRead(async () => {
  const { revision } = await loadCurrent(referenceKey)
  const current = toPlain(revision)
  const stored = await loadStoredObject(current)
  const bytes = verifyStoredObject(current, stored)
  return { bytes, originalFileName: current.originalFileName, mimeType: current.mimeType }
})

export default {
  uploadOutcomeStudioTestReference,
  approveOutcomeStudioTestReference,
  supersedeOutcomeStudioTestReference,
  listOutcomeStudioTestReferences,
  getOutcomeStudioTestReference,
  listOutcomeStudioTestReferenceHistory,
  getOutcomeStudioTestReferenceContent,
  serializeOutcomeStudioTestReference,
  resolveOutcomeStudioTestReferenceSnapshots,
}
