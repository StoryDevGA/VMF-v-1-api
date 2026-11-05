import { randomUUID } from 'node:crypto'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { assertRenditionReviewSubject, RENDITION_TRANSPORT } from './outcomeRenditionReviewClaimContract.js'
import { OUTCOME_RENDITION_QUALITY_STAGE_VERSION as version, OUTCOME_RENDITION_QUALITY_STAGE_KEY as key } from '../utils/outcomeQualityStageSubjects.js'
import { normalizeRenderedExpressionRlOutput } from '../utils/outcomeRenderedExpressionRlOutput.js'

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(field => Object.hasOwn(value, field))
const same = (a, b) => membershipHash(a) === membershipHash(b)
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const token = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,180}$/.test(value)
const oid = value => /^[a-f0-9]{24}$/.test(String(value || ''))
const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max
const plain = value => value?.toObject ? value.toObject({ depopulate: true }) : value
const clone = value => JSON.parse(JSON.stringify(value))
const iso = value => {
  if (!(value instanceof Date) && typeof value !== 'string') return ''
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const result = date.toISOString()
  return typeof value === 'string' && value !== result ? '' : result
}
export const isRenditionQualityStageTime = value => Boolean(iso(value))
export const renditionStageError = reason => Object.assign(new Error('The document review stage is not admissible.'), {
  code: 'RENDITION_QUALITY_STAGE_BLOCKED', status: 409, details: { reason, approvalAvailable: false },
})
const need = (condition, reason) => { if (!condition) throw renditionStageError(reason) }
const fields = ['stageExecutionId', 'qualityRunId', 'contractVersion', 'tenantId', 'customerId', 'runtimeInstanceId',
  'runtimeInstanceKey', 'knowledgeCompositionPlanRecordId', 'planId', 'requestId', 'draftId', 'draftIterationId',
  'planVersion', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint', 'stageKey', 'stageOrder', 'attemptNumber',
  'predecessorStageExecutionId', 'predecessorAttemptFingerprint', 'status', 'inputFingerprint', 'outputFingerprint',
  'attemptFingerprint', 'renditionInputSnapshot', 'outputSnapshot', 'failure', 'executionIdentity', 'assignedActivationCount',
  'contributingActivationCount', 'truthReferenceCount', 'startedAt', 'completedAt', 'durationMs', 'createdBy']
const failure = () => ({ failureCode: 'RENDITION_RENDERED_EXPRESSION_REQUIRES_CHANGE',
  safeReason: 'The document presentation needs required changes. Final delivery remains held.', retryable: false })
const identity = input => ({ executionMode: 'LIVE_TEST', providerKey: 'openai',
  providerConfigurationVersion: RENDITION_TRANSPORT.configurationVersion, model: RENDITION_TRANSPORT.model,
  grrExecutionId: input.result.executionId, grrRuntimeArtifactId: input.result.runtimeArtifactId,
  runtimeVersion: 'outcome-docx-rendition-review.v1' })
const countProfiles = subject => new Set(Object.values(subject.candidate.packs).map(pack => pack.activationId)).size
const runId = subject => `rendition_quality_run_${membershipHash({ scope: subject.scope,
  planId: subject.source.plan.planId, subjectFingerprint: membershipHash(subject) }).slice(0, 40)}`
const material = value => Object.fromEntries(fields.filter(field => field !== 'attemptFingerprint'
  && value[field] !== undefined).map(field => [field, ['startedAt', 'completedAt'].includes(field) ? iso(value[field]) : value[field]]))

export const assertRenditionQualityStageInput = input => {
  need(exact(input, ['contractVersion', 'subject', 'runtime', 'planVersion', 'claim', 'reservation', 'result', 'binding', 'receipt'])
    && input.contractVersion === 'outcome-rendition-stage-input.v1', 'INPUT_SHAPE')
  const subject = assertRenditionReviewSubject(input.subject)
  need(typeof subject.candidate.candidateId === 'string' && typeof subject.preview.previewId === 'string', 'SOURCE_DOCUMENT_IDENTITIES')
  need(exact(input.runtime, ['runtimeInstanceKey', 'runtimeType', 'frameworkKey', 'packageKey', 'packageVersion'])
    && ['runtimeInstanceKey', 'runtimeType', 'frameworkKey'].every(field => token(input.runtime[field]))
    && ['packageKey', 'packageVersion'].every(field => typeof input.runtime[field] === 'string' && input.runtime[field].length <= 120), 'RUNTIME_BINDING')
  need(Number.isSafeInteger(input.planVersion) && input.planVersion > 0
    && exact(input.claim, ['executionId', 'fingerprint']) && token(input.claim.executionId) && /^grr_rendition_claim_[a-f0-9-]{36}$/.test(input.claim.executionId)
    && hash(input.claim.fingerprint)
    && exact(input.reservation, ['executionId', 'fingerprint']) && token(input.reservation.executionId) && /^grr_rendition_dispatch_[a-f0-9-]{36}$/.test(input.reservation.executionId)
    && hash(input.reservation.fingerprint)
    && exact(input.result, ['executionId', 'runtimeArtifactId']) && token(input.result.executionId) && /^grr_rendition_result_[a-f0-9-]{36}$/.test(input.result.executionId)
    && token(input.result.runtimeArtifactId) && /^artifact_rendition_review_[a-f0-9-]{36}$/.test(input.result.runtimeArtifactId), 'RESULT_REFERENCES')
  need(exact(input.binding, ['requestIdentity', 'contextFingerprint', 'subjectFingerprint'])
    && Object.values(input.binding).every(hash) && input.binding.subjectFingerprint === membershipHash(subject), 'REQUEST_BINDING')
  const receipt = input.receipt
  need(exact(receipt, ['contractVersion', 'requestIdentity', 'subjectFingerprint', 'contextFingerprint', 'responseId',
    'postRequestId', 'provider', 'terminalStatus', 'latencyMs', 'pages', 'inputFingerprint', 'docxChecksum', 'tokenUsage',
    'storeRequested', 'temporaryProviderStorageForPolling'])
    && receipt.contractVersion === 'docx-rendition-visual-review-receipt.v1'
    && Object.keys(input.binding).every(field => receipt[field] === input.binding[field])
    && typeof receipt.responseId === 'string' && /^resp_[A-Za-z0-9_-]{1,195}$/.test(receipt.responseId)
    && typeof receipt.postRequestId === 'string' && (receipt.postRequestId === '' || /^[A-Za-z0-9._:-]{1,200}$/.test(receipt.postRequestId))
    && same(receipt.provider, RENDITION_TRANSPORT) && exact(receipt.provider, Object.keys(RENDITION_TRANSPORT))
    && receipt.terminalStatus === 'completed' && integer(receipt.latencyMs, 86400000)
    && same(receipt.pages, subject.preview.pages) && receipt.inputFingerprint === subject.candidate.inputFingerprint
    && receipt.docxChecksum === subject.candidate.docxChecksum && receipt.storeRequested === false
    && receipt.temporaryProviderStorageForPolling === true, 'TERMINAL_RECEIPT')
  need(Array.isArray(receipt.pages) && receipt.pages.every(page => exact(page, ['number', 'width', 'height', 'byteLength', 'sha256']))
    && exact(receipt.tokenUsage, ['inputTokens', 'outputTokens', 'totalTokens'])
    && Object.values(receipt.tokenUsage).every(value => value === null || integer(value)), 'RECEIPT_ACCOUNTING')
  need(Buffer.byteLength(JSON.stringify(input)) <= 128 * 1024, 'INPUT_SIZE')
  return input
}

export const assertRenditionQualityStage = value => {
  const row = plain(value)
  need(row && Object.keys(row).every(field => fields.includes(field) || ['_id', '__v', 'createdAt'].includes(field))
    && row.contractVersion === version && row.stageKey === key && row.stageOrder === 0 && row.attemptNumber === 1
    && row.inputSnapshot === undefined && row.predecessorStageExecutionId === '' && row.predecessorAttemptFingerprint === '', 'STAGE_SHAPE')
  const input = assertRenditionQualityStageInput(row.renditionInputSnapshot), subject = input.subject, plan = subject.source.plan
  need(token(row.stageExecutionId) && /^rendition_quality_stage_[a-f0-9-]{36}$/.test(row.stageExecutionId) && row.qualityRunId === runId(subject)
    && Object.keys(subject.scope).every(field => String(row[field]) === subject.scope[field])
    && String(row.knowledgeCompositionPlanRecordId) === plan.recordId && row.planId === plan.planId && row.requestId === plan.requestId
    && row.draftId === subject.source.logicalDraft.draftId && row.draftIterationId === subject.source.logicalDraft.draftIterationId
    && row.planVersion === input.planVersion && ['planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].every(field => row[field] === plan[field])
    && oid(row.createdBy) && String(row.createdBy) === subject.actorUserId && row.runtimeInstanceKey === input.runtime.runtimeInstanceKey
    && row.inputFingerprint === membershipHash(input), 'STAGE_LINEAGE')
  const output = normalizeRenderedExpressionRlOutput(row.outputSnapshot, () => renditionStageError('FINDINGS_INVALID'))
  need(same(output, row.outputSnapshot) && exact(row.outputSnapshot, ['outputType', 'schemaVersion', 'overallStatus', 'findings'])
    && row.outputSnapshot.findings.every(finding => exact(finding, ['dimension', 'status', 'finding', 'requiredChange']))
    && row.outputFingerprint === membershipHash(output), 'OUTPUT_BINDING')
  need(output.overallStatus === 'PASS' ? row.status === 'SUCCEEDED' && row.failure === undefined
    : row.status === 'FAILED' && exact(row.failure, ['failureCode', 'safeReason', 'retryable']) && same(row.failure, failure()), 'RESULT_STATUS')
  need(exact(plain(row.executionIdentity), Object.keys(identity(input))) && same(plain(row.executionIdentity), identity(input)), 'EXECUTION_IDENTITY')
  need(row.assignedActivationCount === countProfiles(subject) && row.contributingActivationCount === countProfiles(subject)
    && row.truthReferenceCount === 0, 'PROFILE_COUNTS')
  const start = iso(row.startedAt), end = iso(row.completedAt), duration = Date.parse(end) - Date.parse(start)
  need(start && end && integer(duration, 86400000) && row.durationMs === duration && input.receipt.latencyMs <= duration, 'TIMING')
  need(hash(row.attemptFingerprint) && row.attemptFingerprint === membershipHash(material(row)), 'ATTEMPT_FINGERPRINT')
  return row
}

// Plan integrity, signed receipts and actual provider authenticity belong to the
// future transactional owner. This pure builder checks their exact bindings.
export const buildRenditionQualityStage = ({ input, output, plan, startedAt, completedAt,
  stageExecutionId = `rendition_quality_stage_${randomUUID()}` }) => {
  assertRenditionQualityStageInput(input)
  const subject = input.subject, selected = subject.source.plan
  need(plan && String(plan._id || plan.id) === selected.recordId && plan.planVersion === input.planVersion
    && Object.keys(subject.scope).every(field => String(plan[field]) === subject.scope[field])
    && ['planId', 'requestId', 'planFingerprint', 'resolutionFingerprint', 'contextFingerprint'].every(field => plan[field] === selected[field]), 'PLAN_BINDING')
  const normalized = normalizeRenderedExpressionRlOutput(output, () => renditionStageError('FINDINGS_INVALID'))
  const row = { stageExecutionId, qualityRunId: runId(subject), contractVersion: version, ...subject.scope,
    runtimeInstanceKey: input.runtime.runtimeInstanceKey, knowledgeCompositionPlanRecordId: selected.recordId, planId: selected.planId, requestId: selected.requestId,
    ...subject.source.logicalDraft, planVersion: input.planVersion, planFingerprint: selected.planFingerprint,
    resolutionFingerprint: selected.resolutionFingerprint, contextFingerprint: selected.contextFingerprint,
    stageKey: key, stageOrder: 0, attemptNumber: 1, predecessorStageExecutionId: '', predecessorAttemptFingerprint: '',
    status: normalized.overallStatus === 'PASS' ? 'SUCCEEDED' : 'FAILED', inputFingerprint: membershipHash(input),
    outputFingerprint: membershipHash(normalized), renditionInputSnapshot: clone(input), outputSnapshot: normalized,
    ...(normalized.overallStatus === 'FAIL' ? { failure: failure() } : {}), executionIdentity: identity(input),
    // These counts describe unique supplied profile activations. The RL method
    // has its own receipt; this branch creates no original-plan stage assignment.
    assignedActivationCount: countProfiles(subject), contributingActivationCount: countProfiles(subject), truthReferenceCount: 0,
    startedAt: iso(startedAt), completedAt: iso(completedAt), durationMs: Date.parse(iso(completedAt)) - Date.parse(iso(startedAt)),
    createdBy: subject.actorUserId }
  row.attemptFingerprint = membershipHash(material(row))
  return assertRenditionQualityStage(row)
}

export const serializeRenditionQualityStage = value => {
  const row = assertRenditionQualityStage(value)
  const result = clone({ ...material(row), attemptFingerprint: row.attemptFingerprint })
  for (const field of ['tenantId', 'customerId', 'runtimeInstanceId', 'knowledgeCompositionPlanRecordId', 'createdBy']) result[field] = String(row[field])
  if (row._id) result.id = String(row._id)
  if (row.createdAt) result.createdAt = iso(row.createdAt)
  return result
}

const normalized = value => typeof value === 'string' ? value.trim().toUpperCase() : ''
export const hasRenditionQualityStageIdentity = row => (typeof row?.contractVersion === 'string' && row.contractVersion.trim() === version)
  || normalized(row?.stageKey) === key || row?.renditionInputSnapshot !== undefined
export const reservedRenditionStageFilter = () => ({ $or: [{ contractVersion: version }, { stageKey: key }, { renditionInputSnapshot: { $exists: true } }] })
