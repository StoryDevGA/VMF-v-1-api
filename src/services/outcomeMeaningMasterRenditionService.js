import { createHash } from 'node:crypto'
import { readMeaningSourceMasterForRendition } from './outcomeMeaningSourceMasterService.js'
import { projectMeaningMasterSource, MEANING_MASTER_FLAGS, MEANING_MASTER_USE, meaningMasterId,
  meaningMasterObjectId } from './outcomeMeaningSourceMasterContract.js'
import { prepareGovernedPrivateDocxCandidate, GOVERNED_PRIVATE_DOCX_CAPABILITY } from './outcomeGovernedDocxCandidateService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { SYNTHETIC_OUTCOME_CLASSIFICATION } from '../models/SyntheticOutcomeRunEvent.js'
import { CORRECTED_MASTER_WRAPPER_VERSION, CORRECTED_MASTER_EXPRESSION_ORIGIN } from './outcomeMasterLinkedDocxContract.js'
import { CORRECTED_DOCX_INPUT_VERSION, assertCommercialDocxExpressionCorrection } from './commercialDocxExpressionCorrection.js'
import { APPROVED_MASTER_WRAPPER_VERSION, APPROVED_MASTER_EXPRESSION_ORIGIN,
  NARROW_MASTER_WRAPPER_VERSION, NARROW_MASTER_EXPRESSION_ORIGIN } from './outcomeMasterLinkedDocxContract.js'
import { NARROW_DOCX_INPUT_VERSION, approvedExpressionProfile,
  assertApprovedCommercialExpression, assertApprovedCompatibilityReference } from './commercialDocxApprovedExpression.js'

export const MEANING_MASTER_RENDITION_INPUT_VERSION = 'meaning-master-private-docx-input.v1'
const clone = value => JSON.parse(JSON.stringify(value))
const same = (a, b) => membershipHash(a) === membershipHash(b)
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const fail = reason => { throw Object.assign(new Error('The private master-linked Word document cannot be prepared.'), {
  code: 'MEANING_MASTER_RENDITION_BLOCKED', status: 409, details: { reason, contentIncludedInError: false },
}) }
const referenceKeys = ['storageId', 'masterId', 'version', 'scope', 'bodyFingerprint', 'sourceFingerprint',
  'sourceProjectionFingerprint', 'auditId', 'auditSignatureVersion']
const assertReceipt = (receipt, args) => {
  const { master, masterReference: ref, sourceEnvelope } = receipt || {}
  if (!ref || Object.getPrototypeOf(ref) !== Object.prototype || Object.keys(ref).length !== referenceKeys.length
    || !referenceKeys.every(key => Object.hasOwn(ref, key)) || ref.masterId !== args.masterId || ref.version !== args.version
    || !meaningMasterId(ref.masterId) || !meaningMasterObjectId(ref.storageId) || !meaningMasterObjectId(ref.auditId)
    || !Number.isSafeInteger(ref.auditSignatureVersion) || ref.auditSignatureVersion < 1
    || !['bodyFingerprint', 'sourceFingerprint', 'sourceProjectionFingerprint'].every(key => hash(ref[key]))
    || !master || master.masterId !== ref.masterId || master.version !== ref.version
    || master.sourceFingerprint !== ref.sourceFingerprint || master.sourceProjectionFingerprint !== ref.sourceProjectionFingerprint
    || master.purpose !== 'MEANING_SOURCE_ONLY' || master.status !== 'RECORDED_MEANING_SOURCE_ONLY'
    || master.permittedUse !== MEANING_MASTER_USE || master.classification !== SYNTHETIC_OUTCOME_CLASSIFICATION
    || MEANING_MASTER_FLAGS.some(key => master[key] !== false)) fail('MASTER_RECEIPT_INVALID')
  const scope = ref.scope
  if (!scope || Object.getPrototypeOf(scope) !== Object.prototype
    || Object.keys(scope).sort().join(',') !== 'customerId,runtimeInstanceId,tenantId'
    || !Object.values(scope).every(meaningMasterObjectId) || scope.runtimeInstanceId !== args.runtimeInstanceId
    || (args.scopes?.customer?._id && String(args.scopes.customer._id) !== scope.customerId)
    || (args.scopes?.tenant?._id && String(args.scopes.tenant._id) !== scope.tenantId)) fail('MASTER_SCOPE_CHANGED')
  const projection = projectMeaningMasterSource(sourceEnvelope)
  if (!same(projection.scope, { ...scope, classification: SYNTHETIC_OUTCOME_CLASSIFICATION, authoritative: false })
    || sourceEnvelope.sourceFingerprint !== ref.sourceFingerprint
    || membershipHash(projection) !== ref.sourceProjectionFingerprint) fail('MASTER_SOURCE_CHANGED')
}

// Private in-memory bridge only. This wrapper is deliberately not the legacy
// persisted candidate input contract and grants no write/review authority.
const prepareMasterRendition = async (args, correctionReference = null, approvedReference = null) => {
  if (!meaningMasterId(args?.masterId) || args.version !== 1) fail('MASTER_REQUEST_INVALID')
  const deadline = Date.now() + 360000
  const checkTime = () => { if (Date.now() > deadline) fail('MASTER_RENDITION_DEADLINE') }
  const reader = args.deps?.readMaster || readMeaningSourceMasterForRendition
  const request = { actorUserId: args.actorUserId, runtimeInstanceId: args.runtimeInstanceId,
    scopes: args.scopes, masterId: args.masterId, version: args.version }
  const first = await reader(request)
  checkTime(); assertReceipt(first, args)
  const accepted = clone(first), envelopeFingerprint = membershipHash(accepted.sourceEnvelope)
  const correction = correctionReference === null ? null : clone(correctionReference)
  const approved = approvedReference === null ? null : clone(assertApprovedCompatibilityReference(approvedReference))
  const approvedProfile = approved ? approvedExpressionProfile(approved.version) : null
  const narrow = approvedProfile?.inputVersion === NARROW_DOCX_INPUT_VERSION
  if (approved && correction) fail('CORRECTION_MODES_CONFLICT')
  if (correction && (Object.keys(correction).sort().join(',') !== 'predecessor,predecessorBodyFingerprint'
    || !hash(correction.predecessorBodyFingerprint))) fail('CORRECTION_REFERENCE_INVALID')
  const compiled = await (args.deps?.compileCandidate || prepareGovernedPrivateDocxCandidate)({
    actorUserId: args.actorUserId, runtimeInstanceId: args.runtimeInstanceId, scopes: args.scopes,
    ...(correction ? { correctionPredecessor: correction.predecessor } : {}),
    ...(approved ? { approvedCompatibilityReference: approved } : {}),
    deps: { readSource: async () => clone(accepted.sourceEnvelope),
      ...(args.deps?.loadPackContent ? { loadPackContent: args.deps.loadPackContent } : {}) },
  })
  checkTime()
  if (compiled?.status !== 'PRIVATE_UNREVIEWED' || compiled.classification !== SYNTHETIC_OUTCOME_CLASSIFICATION
    || MEANING_MASTER_FLAGS.filter(key => key !== 'authoritative').some(key => compiled[key] !== false)
    || compiled.input?.contractVersion !== (approved ? approvedProfile.inputVersion : correction ? CORRECTED_DOCX_INPUT_VERSION : 'governed-private-docx-input.v1')
    || membershipHash(compiled.input.sourceEnvelope) !== envelopeFingerprint
    || compiled.inputFingerprint !== membershipHash(compiled.input)
    || !same(compiled.input.renderer, approved ? approvedProfile.renderer : GOVERNED_PRIVATE_DOCX_CAPABILITY)
    || compiled.packageValidation?.status !== 'PASS' || !Buffer.isBuffer(compiled.buffer)
    || compiled.artifact?.format !== 'DOCX' || compiled.artifact.mimeType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || compiled.artifact.byteLength !== compiled.buffer.length
    || compiled.artifact.outputChecksum !== `sha256:${createHash('sha256').update(compiled.buffer).digest('hex')}`) fail('COMPILED_RENDITION_CHANGED')
  if (correction) {
    assertCommercialDocxExpressionCorrection(compiled.input)
    if (!same(compiled.input.expressionCorrection.predecessor, correction.predecessor)) fail('CORRECTION_REFERENCE_CHANGED')
  }
  if (approved && !same(assertApprovedCommercialExpression(compiled.input), approved)) fail('APPROVED_COMPATIBILITY_CHANGED')
  // Capture the validated bundle before yielding to another dependency. No
  // retained compiler object may change what is returned during that await.
  const prepared = { input: clone(compiled.input), inputFingerprint: compiled.inputFingerprint,
    artifact: clone(compiled.artifact), buffer: Buffer.from(compiled.buffer),
    packageValidation: clone(compiled.packageValidation) }
  const current = await reader(request)
  checkTime(); assertReceipt(current, args)
  if (!same(current.masterReference, accepted.masterReference)
    || membershipHash(current.sourceEnvelope) !== envelopeFingerprint) fail('MASTER_CHANGED_AFTER_COMPILATION')
  const input = clone({ contractVersion: approved ? narrow ? NARROW_MASTER_WRAPPER_VERSION : APPROVED_MASTER_WRAPPER_VERSION
    : correction ? CORRECTED_MASTER_WRAPPER_VERSION : MEANING_MASTER_RENDITION_INPUT_VERSION,
    masterReference: accepted.masterReference, expressionOrigin: approved ? narrow ? NARROW_MASTER_EXPRESSION_ORIGIN : APPROVED_MASTER_EXPRESSION_ORIGIN
      : correction ? CORRECTED_MASTER_EXPRESSION_ORIGIN : 'RETAINED_SOURCE_SHAPING_UNREVIEWED',
    renditionInput: prepared.input, renditionInputFingerprint: prepared.inputFingerprint,
    outputChecksum: prepared.artifact.outputChecksum, ...(correction ? { correctionReference: correction } : {}),
    ...(approved ? { compatibilityReference: approved } : {}) })
  return { status: 'PRIVATE_UNREVIEWED', classification: SYNTHETIC_OUTCOME_CLASSIFICATION,
    ...Object.fromEntries(MEANING_MASTER_FLAGS.map(key => [key, false])), persistenceAvailable: false,
    currentness: 'READ_OBSERVATION_ONLY_REVERIFY_BEFORE_PERSISTENCE', input, inputFingerprint: membershipHash(input),
    renderer: prepared.input.renderer, artifact: prepared.artifact, buffer: prepared.buffer,
    packageValidation: prepared.packageValidation }
}
export const prepareMeaningMasterDocxRendition = args => prepareMasterRendition(args)
export const prepareCorrectedMeaningMasterDocxRendition = args => {
  if (!args?.correctionReference) fail('CORRECTION_REFERENCE_INVALID')
  return prepareMasterRendition(args, args.correctionReference)
}
export const prepareApprovedMeaningMasterDocxRendition = args => {
  if (!args?.compatibilityReference) fail('APPROVED_COMPATIBILITY_MISSING')
  return prepareMasterRendition(args, null, args.compatibilityReference)
}
