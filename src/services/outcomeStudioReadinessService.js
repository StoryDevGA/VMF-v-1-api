import crypto from 'crypto'
import mongoose from 'mongoose'
import { OutcomeStudioReadinessPointer, OutcomeStudioReadinessRevision } from '../models/index.js'
import auditService from './auditService.js'
import { resolveOutcomeStudioTestReferenceSnapshots } from './outcomeStudioTestReferenceService.js'
import {
  OUTCOME_STUDIO_DEVELOPMENT_TEST_BLOCKERS,
  OUTCOME_STUDIO_DEVELOPMENT_TEST_GATES,
  OUTCOME_STUDIO_DEVELOPMENT_TEST_READINESS_VERDICTS,
  OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
  OUTCOME_STUDIO_READINESS_AUTHORITY_MATRIX,
  OUTCOME_STUDIO_READINESS_BLOCKERS,
  OUTCOME_STUDIO_READINESS_COMPONENT_ID,
  OUTCOME_STUDIO_READINESS_ENVIRONMENT,
  OUTCOME_STUDIO_READINESS_ERROR_CODES,
  OUTCOME_STUDIO_READINESS_POLICY_VERSIONS,
  OUTCOME_STUDIO_READINESS_REGISTER_ID,
  OUTCOME_STUDIO_READINESS_STATUSES,
  OUTCOME_STUDIO_READINESS_VERDICTS,
  OUTCOME_STUDIO_REFERENCE_FAMILIES,
  OUTCOME_STUDIO_TESTING_PURPOSE,
} from '../constants/outcomeStudioReadiness.js'

const TRANSACTION_TOPOLOGIES = new Set(['ReplicaSetWithPrimary', 'Sharded'])

const toPlain = (value) => {
  if (!value) return value
  if (typeof value.toObject === 'function') return value.toObject()
  return value
}
const toId = (value) => value?.toString ? value.toString() : String(value || '')
const toIso = (value) => value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null
const bounded = (value, length = 160) => String(value ?? '').trim().slice(0, length)

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonicalize(value[key]) }), {})
  return value
}

const canonicalizeDevelopment = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof mongoose.Types.ObjectId) return value.toString().toLowerCase()
  if (Array.isArray(value)) return value.map(canonicalizeDevelopment)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonicalizeDevelopment(value[key]) }), {})
  }
  return value
}

const appError = (status, code, message, details = null) => {
  const error = new Error(message)
  error.status = status
  error.code = code
  error.details = details || { reason: code }
  return error
}

const conflict = () => appError(409, OUTCOME_STUDIO_READINESS_ERROR_CODES.REVISION_CONFLICT, 'Outcome Studio readiness revision conflicts with the current revision.')
const transitionInvalid = () => appError(409, OUTCOME_STUDIO_READINESS_ERROR_CODES.POLICY_TRANSITION_INVALID, 'Outcome Studio readiness policy transition is invalid.')
const currentRevisionMissing = () => appError(409, OUTCOME_STUDIO_READINESS_ERROR_CODES.CURRENT_REVISION_MISSING, 'Current Outcome Studio readiness revision is unavailable.')
const transactionRequired = () => appError(503, OUTCOME_STUDIO_READINESS_ERROR_CODES.TRANSACTION_REQUIRED, 'Outcome Studio readiness writes require MongoDB transaction support.')
const persistenceFailed = () => appError(503, OUTCOME_STUDIO_READINESS_ERROR_CODES.PERSISTENCE_FAILED, 'Outcome Studio readiness persistence failed.')
const auditFailed = () => appError(503, OUTCOME_STUDIO_READINESS_ERROR_CODES.AUDIT_FAILED, 'Outcome Studio readiness audit persistence failed.')
const referenceResolutionFailed = () => appError(503, OUTCOME_STUDIO_READINESS_ERROR_CODES.TEST_REFERENCE_RESOLUTION_FAILED, 'Outcome Studio TEST reference resolution failed.')

const isWriteConflict = (error) => error?.code === 11000 || error?.code === 112 || error?.codeName === 'WriteConflict' || /E11000|WriteConflict|write conflict/i.test(error?.message || '')

const currentTopologyType = () => {
  try {
    return mongoose.connection.getClient()?.topology?.description?.type || ''
  } catch {
    return ''
  }
}

export const assertOutcomeStudioReadinessTransactionSupport = () => {
  if (mongoose.connection.readyState !== 1 || !TRANSACTION_TOPOLOGIES.has(currentTopologyType())) throw transactionRequired()
}

export const hashReadinessContent = (value) => crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
export const buildDevelopmentTestReadinessHashContent = (value = {}) => ({
  policyVersion: value.policyVersion,
  environment: value.environment,
  rubric: value.rubric,
  testReferences: value.testReferences,
  providerPolicy: value.providerPolicy,
  testingApproval: value.testingApproval,
})
export const hashDevelopmentTestReadinessContent = (value) => crypto.createHash('sha256')
  .update(JSON.stringify(canonicalizeDevelopment(buildDevelopmentTestReadinessHashContent(value))))
  .digest('hex')

const isHttpsUri = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const serializeActor = (actor) => actor ? {
  id: toId(actor.id || actor._id).toLowerCase(),
  name: bounded(actor.name),
  ...(actor.email ? { email: bounded(actor.email, 254) } : {}),
} : null

const serializeDecision = (decision = {}) => ({
  status: decision.status,
  productApproverName: bounded(decision.productApproverName),
  productApproverRole: bounded(decision.productApproverRole),
  rationale: bounded(decision.rationale, 1000),
  recordedBy: serializeActor(decision.recordedBy),
  recordedAt: toIso(decision.recordedAt),
})

const serializeDevelopmentTestReadiness = (value) => {
  const revision = toPlain(value)
  return {
    policyVersion: revision.policyVersion,
    revision: revision.revision,
    environment: revision.environment,
    verdict: revision.verdict,
    blockers: Array.isArray(revision.blockers) ? revision.blockers : [],
    gateResults: Array.isArray(revision.gateResults) ? revision.gateResults.map((result) => ({
      gate: result.gate,
      status: result.status,
      blockerCode: result.blockerCode || null,
      details: result.details || null,
    })) : [],
    rubric: {
      rubricKey: revision.rubric?.rubricKey,
      rubricVersion: revision.rubric?.rubricVersion,
      threshold: revision.rubric?.threshold,
      decision: serializeDecision(revision.rubric?.decision),
    },
    testReferences: Array.isArray(revision.testReferences) ? revision.testReferences.map((reference) => ({
      family: reference.family,
      referenceKey: reference.referenceKey,
      referenceRevision: reference.referenceRevision,
      title: reference.title,
      status: 'APPROVED',
      integrityVerified: true,
    })) : [],
    providerPolicy: {
      providerKey: revision.providerPolicy?.providerKey,
      model: revision.providerPolicy?.model,
      environment: revision.providerPolicy?.environment,
      safeContextPolicyKey: revision.providerPolicy?.safeContextPolicyKey,
      failurePosture: revision.providerPolicy?.failurePosture,
      decision: serializeDecision(revision.providerPolicy?.decision),
    },
    testingApproval: {
      purpose: revision.testingApproval?.purpose,
      decision: serializeDecision(revision.testingApproval?.decision),
    },
    contentHash: revision.contentHash,
    createdBy: toId(revision.createdBy),
    createdAt: toIso(revision.createdAt),
  }
}

export const serializeReadinessRevision = (revision) => {
  if (!revision || typeof revision !== 'object' || Array.isArray(revision)) return revision
  const plain = toPlain(revision)
  const policyVersion = plain.policyVersion
  if (policyVersion === OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.DEVELOPMENT_TEST) return serializeDevelopmentTestReadiness(plain)
  if (policyVersion === undefined || policyVersion === null || (typeof policyVersion === 'string' && !policyVersion.trim())) {
    return { ...plain, policyVersion: OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.LEGACY }
  }
  if (policyVersion === OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.LEGACY) return { ...plain }
  throw appError(500, 'OUTCOME_STUDIO_READINESS_POLICY_UNSUPPORTED', 'Outcome Studio readiness policy version is unsupported.')
}

export const deriveReadiness = (readiness = {}) => {
  const references = Array.isArray(readiness?.references) ? readiness.references : []
  const rubric = readiness?.rubric && typeof readiness.rubric === 'object' ? readiness.rubric : {}
  const providerPosture = readiness?.providerPosture && typeof readiness.providerPosture === 'object' ? readiness.providerPosture : {}
  const decisions = Array.isArray(readiness?.decisions) ? readiness.decisions : []
  const blockers = []
  for (const family of OUTCOME_STUDIO_REFERENCE_FAMILIES) {
    const familyReferences = references.filter((item) => item?.family === family)
    const approvedReferences = familyReferences.filter((item) => item?.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED)
    if (familyReferences.length > 1) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.REFERENCE_FAMILY_DUPLICATE, family })
    if (approvedReferences.length === 0) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.REFERENCE_FAMILY_NOT_APPROVED, family })
    if (approvedReferences.some((reference) => !String(reference.title || '').trim() || !/^[a-f0-9]{64}$/.test(reference.sha256 || '') || !isHttpsUri(reference.provenanceUri))) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.REFERENCE_EVIDENCE_INCOMPLETE, family })
  }
  if (rubric.status !== OUTCOME_STUDIO_READINESS_STATUSES.APPROVED) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.RUBRIC_NOT_APPROVED })
  if (!Number.isFinite(rubric.threshold) || rubric.threshold < 0 || rubric.threshold > 100) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.RUBRIC_THRESHOLD_MISSING })
  if (!String(rubric.primaryReviewer?.name || '').trim() || !String(rubric.primaryReviewer?.role || '').trim()) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.PRIMARY_REVIEWER_MISSING })
  if (rubric.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED && !isHttpsUri(rubric.provenanceUri)) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.RUBRIC_PROVENANCE_INVALID })
  if (!providerPosture.vendor || !providerPosture.model || !providerPosture.costBoundary || !providerPosture.privacyPosture || !providerPosture.dataRegion) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.PROVIDER_POSTURE_INCOMPLETE })
  if (providerPosture.failurePosture !== 'FAIL_CLOSED') blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.PROVIDER_FAILURE_POSTURE_INVALID })
  if (providerPosture.environment !== OUTCOME_STUDIO_READINESS_ENVIRONMENT) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.PROVIDER_ENVIRONMENT_INVALID })
  for (const [decisionKey, requiredAuthorities] of Object.entries(OUTCOME_STUDIO_READINESS_AUTHORITY_MATRIX)) {
    const matchingDecisions = decisions.filter((item) => item?.decisionKey === decisionKey)
    if (matchingDecisions.length > 1) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.DECISION_KEY_DUPLICATE, decisionKey })
    const matchingAuthorities = matchingDecisions.flatMap((decision) => Array.isArray(decision?.authorities) ? decision.authorities : [])
    for (const authority of requiredAuthorities) {
      const authorityDecision = matchingAuthorities.filter((item) => item?.authority === authority)
      const approvedAuthorityDecisions = authorityDecision.filter((item) => item?.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED)
      if (authorityDecision.length > 1) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.AUTHORITY_ENTRY_DUPLICATE, decisionKey, authority })
      if (approvedAuthorityDecisions.length === 0) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.REQUIRED_AUTHORITY_NOT_APPROVED, decisionKey, authority })
      if (approvedAuthorityDecisions.some((item) => !isHttpsUri(item.provenanceUri))) blockers.push({ code: OUTCOME_STUDIO_READINESS_BLOCKERS.AUTHORITY_PROVENANCE_INVALID, decisionKey, authority })
    }
  }
  return { verdict: blockers.length === 0 ? OUTCOME_STUDIO_READINESS_VERDICTS.READY : OUTCOME_STUDIO_READINESS_VERDICTS.BLOCKED, blockers }
}

const decisionApproved = (decision = {}) => decision.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED
  && Boolean(bounded(decision.productApproverName))
  && Boolean(bounded(decision.productApproverRole))
  && Boolean(bounded(decision.rationale, 1000))
  && Boolean(decision.recordedBy)
  && Boolean(decision.recordedAt)

export const deriveDevelopmentTestReadiness = ({ rubric, referenceResults = [], providerPolicy, testingApproval } = {}) => {
  const invalidFamilies = referenceResults.filter((result) => result.state !== 'VALID').map((result) => result.family)
  const testReferences = referenceResults.filter((result) => result.state === 'VALID').map((result) => result.snapshot)
  const conditions = {
    QUALITY_RUBRIC: Boolean(rubric?.rubricKey && rubric?.rubricVersion && Number.isFinite(rubric?.threshold) && decisionApproved(rubric?.decision)),
    TEST_REFERENCE_EXAMPLES: invalidFamilies.length === 0 && testReferences.length === OUTCOME_STUDIO_REFERENCE_FAMILIES.length,
    SAFE_PROVIDER_POLICY: Boolean(providerPolicy?.providerKey && providerPolicy?.model
      && providerPolicy.environment === OUTCOME_STUDIO_READINESS_ENVIRONMENT
      && providerPolicy.safeContextPolicyKey === OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY
      && providerPolicy.failurePosture === 'FAIL_CLOSED'
      && decisionApproved(providerPolicy?.decision)),
    PRODUCT_TESTING_APPROVAL: Boolean(testingApproval?.purpose === OUTCOME_STUDIO_TESTING_PURPOSE && decisionApproved(testingApproval?.decision)),
  }
  const gateResults = OUTCOME_STUDIO_DEVELOPMENT_TEST_GATES.map((gate) => ({
    gate,
    status: conditions[gate] ? 'PASSED' : 'BLOCKED',
    blockerCode: conditions[gate] ? null : OUTCOME_STUDIO_DEVELOPMENT_TEST_BLOCKERS[gate],
    details: gate === 'TEST_REFERENCE_EXAMPLES' && !conditions[gate] ? { missingOrInvalidFamilies: invalidFamilies } : null,
  }))
  const blockers = gateResults.filter((result) => result.status === 'BLOCKED').map((result) => ({ code: result.blockerCode, gate: result.gate, details: result.details }))
  return {
    verdict: blockers.length === 0 ? OUTCOME_STUDIO_DEVELOPMENT_TEST_READINESS_VERDICTS.READY : OUTCOME_STUDIO_DEVELOPMENT_TEST_READINESS_VERDICTS.BLOCKED,
    blockers,
    gateResults,
    testReferences,
  }
}

const blankReferences = () => OUTCOME_STUDIO_REFERENCE_FAMILIES.map((family) => ({ family, status: OUTCOME_STUDIO_READINESS_STATUSES.OPEN, title: '', sha256: '', provenanceUri: '', approvedBy: null, approvedAt: null }))
const blankDecisions = () => Object.entries(OUTCOME_STUDIO_READINESS_AUTHORITY_MATRIX).map(([decisionKey, authorities]) => ({
  decisionKey,
  authorities: authorities.map((authority) => ({ authority, status: OUTCOME_STUDIO_READINESS_STATUSES.OPEN, provenanceUri: '', actor: null, decidedAt: null })),
  note: '',
}))

const syntheticCurrent = (blocker = { code: 'READINESS_REVISION_MISSING' }) => serializeReadinessRevision({
  registerId: OUTCOME_STUDIO_READINESS_REGISTER_ID,
  environment: OUTCOME_STUDIO_READINESS_ENVIRONMENT,
  revision: 0,
  verdict: OUTCOME_STUDIO_READINESS_VERDICTS.BLOCKED,
  blockers: [blocker],
  references: blankReferences(),
  rubric: { status: OUTCOME_STUDIO_READINESS_STATUSES.OPEN, threshold: null, primaryReviewer: { name: '', role: '' }, provenanceUri: '', approvedBy: null, approvedAt: null },
  providerPosture: { vendor: '', model: '', costBoundary: '', privacyPosture: '', dataRegion: '', failurePosture: 'FAIL_CLOSED', environment: OUTCOME_STUDIO_READINESS_ENVIRONMENT },
  decisions: blankDecisions(),
  contentHash: null,
  createdAt: null,
  createdBy: null,
})

export const getCurrentReadiness = async () => {
  const pointer = await OutcomeStudioReadinessPointer.findOne({ registerId: OUTCOME_STUDIO_READINESS_REGISTER_ID, environment: OUTCOME_STUDIO_READINESS_ENVIRONMENT }).lean()
  if (!pointer) return syntheticCurrent()
  const revision = await OutcomeStudioReadinessRevision.findById(pointer.currentRevisionId).lean()
  return revision ? serializeReadinessRevision(revision) : syntheticCurrent({ code: 'CURRENT_READINESS_REVISION_MISSING', pointerRevision: pointer.currentRevision })
}

export const listReadinessHistory = async ({ page = 1, pageSize = 20 } = {}) => {
  const normalizedPage = Math.max(1, Number(page) || 1)
  const normalizedSize = Math.min(100, Math.max(1, Number(pageSize) || 20))
  const filter = { registerId: OUTCOME_STUDIO_READINESS_REGISTER_ID, environment: OUTCOME_STUDIO_READINESS_ENVIRONMENT }
  const [items, total] = await Promise.all([
    OutcomeStudioReadinessRevision.find(filter).sort({ revision: -1 }).skip((normalizedPage - 1) * normalizedSize).limit(normalizedSize).lean(),
    OutcomeStudioReadinessRevision.countDocuments(filter),
  ])
  return { items: items.map(serializeReadinessRevision), page: normalizedPage, pageSize: normalizedSize, total, totalPages: Math.ceil(total / normalizedSize) }
}

const actorFromRequest = (request) => {
  const source = request?.scopes?.user || {}
  const id = source.id || source._id || request?.context?.userId || request?.userId
  const name = bounded(source.name || source.email || request?.userEmail || 'Super Admin')
  if (!id || !mongoose.isValidObjectId(id) || !name) throw appError(422, 'OUTCOME_STUDIO_READINESS_ACTOR_INVALID', 'Authenticated readiness actor identity is unavailable.')
  return { id, name, ...(source.email || request?.userEmail ? { email: bounded(source.email || request.userEmail, 254) } : {}) }
}

const sameCanonical = (left, right) => JSON.stringify(canonicalizeDevelopment(left)) === JSON.stringify(canonicalizeDevelopment(right))

const sameFields = (left, right, fields) => fields.every((field) => sameCanonical(left?.[field], right?.[field]))

const stampLegacyContent = ({ payload, previous, actor, now }) => ({
  references: payload.references.map((reference) => {
    const prior = previous?.references?.find((item) => item.family === reference.family)
    const preserve = reference.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED
      && prior?.approvedBy
      && prior?.approvedAt
      && sameFields(reference, prior, ['family', 'status', 'title', 'sha256', 'provenanceUri'])
    return {
      ...reference,
      approvedBy: reference.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED ? (preserve ? prior.approvedBy : actor) : null,
      approvedAt: reference.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED ? (preserve ? prior.approvedAt : now) : null,
    }
  }),
  rubric: (() => {
    const prior = previous?.rubric
    const preserve = payload.rubric.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED
      && prior?.approvedBy
      && prior?.approvedAt
      && sameFields(payload.rubric, prior, ['status', 'threshold', 'provenanceUri'])
      && sameCanonical(payload.rubric.primaryReviewer, prior.primaryReviewer)
    return {
      ...payload.rubric,
      approvedBy: payload.rubric.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED ? (preserve ? prior.approvedBy : actor) : null,
      approvedAt: payload.rubric.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED ? (preserve ? prior.approvedAt : now) : null,
    }
  })(),
  providerPosture: payload.providerPosture,
  decisions: payload.decisions.map((decision) => {
    const priorDecision = previous?.decisions?.find((item) => item.decisionKey === decision.decisionKey)
    return {
      ...decision,
      authorities: decision.authorities.map((authority) => {
        const prior = priorDecision?.authorities?.find((item) => item.authority === authority.authority)
        const preserve = prior?.actor
          && prior?.decidedAt
          && sameFields(authority, prior, ['authority', 'status', 'provenanceUri'])
        return { ...authority, actor: preserve ? prior.actor : actor, decidedAt: preserve ? prior.decidedAt : now }
      }),
    }
  }),
})

const stampDecision = ({ decision, previousDecision, subject, previousSubject, actor, now }) => {
  if (decision.status === OUTCOME_STUDIO_READINESS_STATUSES.OPEN) return { ...decision, recordedBy: null, recordedAt: null }
  const preserve = previousDecision?.recordedBy && previousDecision?.recordedAt
    && sameCanonical(subject, previousSubject)
    && sameCanonical(decision, {
      status: previousDecision.status,
      productApproverName: previousDecision.productApproverName,
      productApproverRole: previousDecision.productApproverRole,
      rationale: previousDecision.rationale,
    })
  return { ...decision, recordedBy: preserve ? previousDecision.recordedBy : actor, recordedAt: preserve ? previousDecision.recordedAt : now }
}

const stampDevelopmentTestContent = ({ payload, previous, actor, now }) => {
  const rubricSubject = { rubricKey: payload.rubric.rubricKey, rubricVersion: payload.rubric.rubricVersion, threshold: payload.rubric.threshold }
  const previousRubricSubject = previous?.rubric ? { rubricKey: previous.rubric.rubricKey, rubricVersion: previous.rubric.rubricVersion, threshold: previous.rubric.threshold } : null
  const providerSubject = { providerKey: payload.providerPolicy.providerKey, model: payload.providerPolicy.model }
  const previousProviderSubject = previous?.providerPolicy ? { providerKey: previous.providerPolicy.providerKey, model: previous.providerPolicy.model } : null
  return {
    rubric: {
      ...rubricSubject,
      decision: stampDecision({ decision: payload.rubric.decision, previousDecision: previous?.rubric?.decision, subject: rubricSubject, previousSubject: previousRubricSubject, actor, now }),
    },
    providerPolicy: {
      ...providerSubject,
      environment: OUTCOME_STUDIO_READINESS_ENVIRONMENT,
      safeContextPolicyKey: OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_POLICY,
      failurePosture: 'FAIL_CLOSED',
      decision: stampDecision({ decision: payload.providerPolicy.decision, previousDecision: previous?.providerPolicy?.decision, subject: providerSubject, previousSubject: previousProviderSubject, actor, now }),
    },
    testingApproval: {
      purpose: OUTCOME_STUDIO_TESTING_PURPOSE,
      decision: stampDecision({ decision: payload.testingApproval.decision, previousDecision: previous?.testingApproval?.decision, subject: { purpose: OUTCOME_STUDIO_TESTING_PURPOSE }, previousSubject: previous?.testingApproval ? { purpose: previous.testingApproval.purpose } : null, actor, now }),
    },
  }
}

const compactActor = (actor) => actor ? { id: toId(actor.id || actor._id).toLowerCase(), name: bounded(actor.name) } : null
const compactProductDecision = (decision = {}) => ({ status: decision.status, productApproverName: bounded(decision.productApproverName), recordedBy: compactActor(decision.recordedBy) })

const compactLegacy = (revision) => ({
  references: (revision.references || []).map(({ family, status, sha256 }) => ({ family, status, sha256 })),
  rubric: revision.rubric ? { status: revision.rubric.status, threshold: revision.rubric.threshold, primaryReviewer: { name: bounded(revision.rubric.primaryReviewer?.name), role: bounded(revision.rubric.primaryReviewer?.role) } } : null,
  providerPosture: revision.providerPosture ? {
    vendor: bounded(revision.providerPosture.vendor), model: bounded(revision.providerPosture.model), costBoundary: bounded(revision.providerPosture.costBoundary),
    privacyPosture: bounded(revision.providerPosture.privacyPosture), dataRegion: bounded(revision.providerPosture.dataRegion), failurePosture: revision.providerPosture.failurePosture, environment: revision.providerPosture.environment,
  } : null,
  decisions: (revision.decisions || []).map((decision) => ({ decisionKey: decision.decisionKey, authorities: (decision.authorities || []).map(({ authority, status }) => ({ authority, status })) })),
})

const compactDevelopmentTest = (revision) => ({
  gateResults: (revision.gateResults || []).map(({ gate, status }) => ({ gate, status })),
  rubric: { rubricKey: revision.rubric?.rubricKey, rubricVersion: revision.rubric?.rubricVersion, threshold: revision.rubric?.threshold, decision: compactProductDecision(revision.rubric?.decision) },
  testReferences: (revision.testReferences || []).map(({ family, referenceKey, referenceRevision }) => ({ family, referenceKey, referenceRevision })),
  providerPolicy: {
    providerKey: revision.providerPolicy?.providerKey, model: revision.providerPolicy?.model, environment: revision.providerPolicy?.environment,
    safeContextPolicyKey: revision.providerPolicy?.safeContextPolicyKey, failurePosture: revision.providerPolicy?.failurePosture, decision: compactProductDecision(revision.providerPolicy?.decision),
  },
  testingApproval: { purpose: revision.testingApproval?.purpose, decision: compactProductDecision(revision.testingApproval?.decision) },
})

export const compactReadinessEvidence = (value) => {
  if (!value) return { policyVersion: null, revision: 0, verdict: OUTCOME_STUDIO_READINESS_VERDICTS.BLOCKED, blockerCodes: ['READINESS_REVISION_MISSING'], evidence: null }
  const revision = toPlain(value)
  const policyVersion = revision.policyVersion || OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.LEGACY
  return {
    policyVersion,
    revision: revision.revision,
    verdict: revision.verdict,
    blockerCodes: (revision.blockers || []).map((blocker) => blocker.code),
    evidence: policyVersion === OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.DEVELOPMENT_TEST
      ? { developmentTest: compactDevelopmentTest(revision) }
      : { legacy: compactLegacy(revision) },
  }
}

const logReadinessMutation = async ({ request, session, created, previous }) => {
  try {
    const audit = await auditService.logFromRequest(request, {
      action: auditService.AUDIT_ACTIONS.OUTCOME_STUDIO_READINESS_REVISION_CREATED,
      resourceType: auditService.RESOURCE_TYPES.OutcomeStudioReadinessRevision,
      resourceId: created._id,
      diff: { componentId: OUTCOME_STUDIO_READINESS_COMPONENT_ID, before: compactReadinessEvidence(previous), after: compactReadinessEvidence(created) },
    }, { session, throwOnError: true })
    if (!audit) throw new Error('Readiness audit returned no record.')
  } catch {
    throw auditFailed()
  }
}

const advancePointer = async ({ pointer, created, currentRevision, session }) => {
  if (pointer) {
    const advanced = await OutcomeStudioReadinessPointer.findOneAndUpdate({ _id: pointer._id, currentRevision }, { $set: { currentRevision: created.revision, currentRevisionId: created._id } }, { new: true, session })
    if (!advanced) throw conflict()
  } else {
    await new OutcomeStudioReadinessPointer({ currentRevision: created.revision, currentRevisionId: created._id }).save({ session })
  }
}

const loadTransactionalCurrent = async ({ expectedRevision, session }) => {
  const pointer = await OutcomeStudioReadinessPointer.findOne({ registerId: OUTCOME_STUDIO_READINESS_REGISTER_ID, environment: OUTCOME_STUDIO_READINESS_ENVIRONMENT }).session(session)
  const currentRevision = pointer?.currentRevision || 0
  if (expectedRevision !== currentRevision) throw conflict()
  const previous = pointer ? await OutcomeStudioReadinessRevision.findById(pointer.currentRevisionId).session(session) : null
  if (pointer && !previous) throw currentRevisionMissing()
  return { pointer, currentRevision, previous }
}

export const createReadinessRevision = async ({ payload, request }) => {
  const session = await mongoose.startSession()
  let created
  try {
    await session.withTransaction(async () => {
      const { pointer, currentRevision, previous } = await loadTransactionalCurrent({ expectedRevision: payload.expectedRevision, session })
      if (previous?.policyVersion === OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.DEVELOPMENT_TEST) throw transitionInvalid()
      const actor = actorFromRequest(request)
      const now = new Date()
      const content = stampLegacyContent({ payload, previous: toPlain(previous), actor, now })
      const derived = deriveReadiness(content)
      created = new OutcomeStudioReadinessRevision({ ...content, ...derived, revision: currentRevision + 1, contentHash: hashReadinessContent(content), createdBy: actor.id })
      await created.save({ session })
      await advancePointer({ pointer, created, currentRevision, session })
      await logReadinessMutation({ request, session, created, previous })
    })
    return serializeReadinessRevision(created.toJSON())
  } catch (error) {
    if (error.code === OUTCOME_STUDIO_READINESS_ERROR_CODES.REVISION_CONFLICT || isWriteConflict(error)) throw conflict()
    throw error
  } finally {
    await session.endSession()
  }
}

const mapDevelopmentTransactionError = (error) => {
  if (Object.values(OUTCOME_STUDIO_READINESS_ERROR_CODES).includes(error?.code)) return error
  if (error?.code === 'OUTCOME_STUDIO_TEST_REFERENCE_RESOLUTION_FAILED') return referenceResolutionFailed()
  if (isWriteConflict(error)) return conflict()
  return persistenceFailed()
}

export const createDevelopmentTestReadinessRevision = async ({ payload, request }) => {
  assertOutcomeStudioReadinessTransactionSupport()
  let session
  let created
  try {
    try {
      session = await mongoose.startSession()
    } catch {
      throw transactionRequired()
    }
    if (!session || typeof session.withTransaction !== 'function' || typeof session.endSession !== 'function') {
      throw transactionRequired()
    }
    await session.withTransaction(async () => {
      const { pointer, currentRevision, previous } = await loadTransactionalCurrent({ expectedRevision: payload.expectedRevision, session })
      const previousPolicy = previous?.policyVersion || OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.LEGACY
      if (previous && !Object.values(OUTCOME_STUDIO_READINESS_POLICY_VERSIONS).includes(previousPolicy)) throw transitionInvalid()
      const actor = actorFromRequest(request)
      const stamped = stampDevelopmentTestContent({ payload, previous: previousPolicy === OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.DEVELOPMENT_TEST ? toPlain(previous) : null, actor, now: new Date() })
      const referenceResults = await resolveOutcomeStudioTestReferenceSnapshots({ session })
      const derived = deriveDevelopmentTestReadiness({ ...stamped, referenceResults })
      const hashContent = {
        policyVersion: OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.DEVELOPMENT_TEST,
        environment: OUTCOME_STUDIO_READINESS_ENVIRONMENT,
        rubric: stamped.rubric,
        testReferences: derived.testReferences,
        providerPolicy: stamped.providerPolicy,
        testingApproval: stamped.testingApproval,
      }
      created = new OutcomeStudioReadinessRevision({
        policyVersion: OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.DEVELOPMENT_TEST,
        ...stamped,
        ...derived,
        revision: currentRevision + 1,
        contentHash: hashDevelopmentTestReadinessContent(hashContent),
        createdBy: actor.id,
      })
      await created.save({ session })
      await advancePointer({ pointer, created, currentRevision, session })
      await logReadinessMutation({ request, session, created, previous })
    })
    return serializeReadinessRevision(created.toJSON())
  } catch (error) {
    throw mapDevelopmentTransactionError(error)
  } finally {
    if (typeof session?.endSession === 'function') await session.endSession()
  }
}

const readinessBlocked = (revision = null) => appError(409, 'GRR_LIVE_TEST_READINESS_BLOCKED', 'Outcome Studio Development/Test execution is not currently authorized.', {
  reason: 'DEVELOPMENT_TEST_READINESS_BLOCKED',
  ...(revision ? {
    policyVersion: revision.policyVersion || OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.LEGACY,
    revision: revision.revision || 0,
    verdict: revision.verdict,
    blockerCodes: (revision.blockers || []).map((blocker) => blocker.code),
  } : {}),
})

const sameSnapshotSet = (left = [], right = []) => sameCanonical(
  left.map(({ family, referenceKey, referenceRevision, sha256, byteLength, mimeType }) => ({ family, referenceKey, referenceRevision, sha256, byteLength, mimeType })),
  right.map(({ family, referenceKey, referenceRevision, sha256, byteLength, mimeType }) => ({ family, referenceKey, referenceRevision, sha256, byteLength, mimeType })),
)

export const authorizeOutcomeStudioLiveTestExecution = async ({ providerDescriptor, stage } = {}) => {
  if (!['PRE_IDEMPOTENCY', 'PRE_ADAPTER', 'PRE_RACE_WINNER_RETURN'].includes(stage)) throw readinessBlocked()
  const pointer = await OutcomeStudioReadinessPointer.findOne({ registerId: OUTCOME_STUDIO_READINESS_REGISTER_ID, environment: OUTCOME_STUDIO_READINESS_ENVIRONMENT }).lean()
  if (!pointer) throw readinessBlocked()
  const revision = await OutcomeStudioReadinessRevision.findById(pointer.currentRevisionId).lean()
  if (!revision) throw readinessBlocked()
  if (revision.registerId !== OUTCOME_STUDIO_READINESS_REGISTER_ID
    || revision.environment !== OUTCOME_STUDIO_READINESS_ENVIRONMENT
    || revision.revision !== pointer.currentRevision) throw readinessBlocked()
  if (revision.policyVersion !== OUTCOME_STUDIO_READINESS_POLICY_VERSIONS.DEVELOPMENT_TEST || revision.verdict !== OUTCOME_STUDIO_DEVELOPMENT_TEST_READINESS_VERDICTS.READY) throw readinessBlocked(revision)
  const authority = {
    providerKey: revision.providerPolicy?.providerKey,
    model: revision.providerPolicy?.model,
    providerMode: 'LIVE_TEST',
    environment: revision.providerPolicy?.environment,
    safeContextPolicyKey: revision.providerPolicy?.safeContextPolicyKey,
    failurePosture: revision.providerPolicy?.failurePosture,
  }
  if (!sameCanonical(authority, providerDescriptor)) throw readinessBlocked(revision)
  let results
  try {
    results = await resolveOutcomeStudioTestReferenceSnapshots()
  } catch {
    throw referenceResolutionFailed()
  }
  if (results.some((result) => result.state !== 'VALID')) throw readinessBlocked(revision)
  const referenceSnapshots = results.map(({ snapshot }) => ({
    family: snapshot.family,
    referenceKey: snapshot.referenceKey,
    referenceRevision: snapshot.referenceRevision,
    sha256: snapshot.sha256,
    byteLength: snapshot.byteLength,
    mimeType: snapshot.mimeType,
  }))
  if (!sameSnapshotSet(referenceSnapshots, revision.testReferences || [])) throw readinessBlocked(revision)
  return {
    policyVersion: revision.policyVersion,
    revision: revision.revision,
    verdict: revision.verdict,
    providerAuthority: authority,
    referenceSnapshots,
  }
}

export default {
  getCurrentReadiness,
  listReadinessHistory,
  createReadinessRevision,
  createDevelopmentTestReadinessRevision,
  authorizeOutcomeStudioLiveTestExecution,
  deriveReadiness,
  deriveDevelopmentTestReadiness,
  hashReadinessContent,
  buildDevelopmentTestReadinessHashContent,
  hashDevelopmentTestReadinessContent,
  compactReadinessEvidence,
  serializeReadinessRevision,
}
