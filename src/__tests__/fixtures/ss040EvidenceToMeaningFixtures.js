import { projectRuntimeEvidenceOutputPlanBinding } from '../../services/outcomeRuntimeEvidenceToMeaningService.js'
import { createHash } from 'node:crypto'
import { buildOutcomeStudioEvidenceComposition } from '../../services/outcomeStudioEvidenceCompositionService.js'
import { projectOutcomeSelectedTargetBinding } from '../../services/outcomeSelectedTargetService.js'
import { OUTCOME_SELECTED_TARGET_CONTRACT_VERSION } from '../../constants/outcomeSelectedTarget.js'
import { compileEvidenceToMeaningContract } from '../../services/outcomeEvidenceToMeaningContractService.js'
import { hashOutcomeShapingValue } from '../../utils/outcomeSelectedTargetIdentity.js'

const pack = (key, content) => {
  const contentHash = `sha256:${createHash('sha256').update(content).digest('hex')}`
  return { content, actualContentHash: contentHash, selection: {
    packId: `pack-${key}`, activationId: `activation-${key}`, versionId: `version-${key}`,
    semanticVersion: '1.0.0', contentFormat: 'MARKDOWN', status: 'ACTIVE', packKey: key,
    capabilityKey: key, contentHash,
  } }
}
export const makeSs040Fixture = ({ name = 'Synthetic', required = ['Executive Summary'], optional = [], format = 'MARKDOWN' } = {}) => {
  const outputType = pack('executive-brief', '# Executive Brief\nA decision brief grounded in customer evidence.')
  const schema = pack('executive-brief-schema', `# Executive Brief Schema\n## Required structure\n${required.map((heading, index) => `${index + 1}. **${heading}** — Explain the supported customer evidence.`).join('\n')}`)
  const projected = projectOutcomeSelectedTargetBinding({ contract: { outputType, schema,
    schemaProjection: { requiredSections: required, optionalSections: optional } } })
  const evidenceObjects = required.map((heading, index) => ({ evidenceObjectId: `evidence-${index}`,
    sourceId: 'source-1', lineageRef: `lineage:source-1:${index}`,
    extractedFact: `The ${name} team has a documented decision process for ${heading.toLowerCase()}.`,
    reviewStatus: 'ACCEPTED', validationStatus: 'VALIDATED', currentness: 'CURRENT',
    classification: 'CUSTOMER_EVIDENCE', confidenceWarnings: ['Customer-supplied evidence.'],
    attribution: name, permittedInterpretation: 'EXACT_STATEMENT_ONLY',
    blockedStrongerClaim: ['No inference of decision authority or financial proof.'],
    evidenceRequiredToSubstantiate: ['Retain the original documented source.'],
    proofDependency: [], proofOrderDisposition: 'PROOF_BEFORE_INTERPRETATION' }))
  const frameworkState = {
    lock: { outputEligibility: { state: 'OUTPUT_ELIGIBLE', locked: true, outputEligible: true,
      canonicalOutputEligible: true, snapshotId: 'lock-snapshot-1', snapshotHash: 'sha256:lock-snapshot-1',
      replayAnchorId: 'replay-anchor-1', replayAnchorHash: 'sha256:replay-anchor-1' } },
    evidence_pack: { evidenceObjects, sourceRegistry: [{ sourceId: 'source-1', sourceType: 'DOCUMENT', label: `${name} source` }],
      lineage: { evidenceVersion: 'evidence-version-1' }, needsRefresh: false, discoveryHealth: { contradictionCandidates: [] } },
    intelligence_graph: { graphVersion: '2.2', graphHash: 'sha256:graph-1' }, sectionTruthVersion: 'section-truth-version-1',
    sections: Object.fromEntries(required.map((heading, index) => [heading.toLowerCase().replaceAll(' ', '-'),
      { accepted: { supportingEvidenceRefs: [`evidence-${index}`] } }])) }
  const composition = buildOutcomeStudioEvidenceComposition({
    runtimeInstance: { _id: 'runtime-id-1', runtimeInstanceKey: 'value-narrative-test', runtimeType: 'VALUE_NARRATIVE',
      frameworkKey: 'VMF', packageKey: 'standard-package-vmf', packageVersion: '3.1.3', status: 'LOCKED', revision: { revisionNumber: 2 } },
    frameworkState, truthBinding: { currentness: 'CURRENT', unresolvedContradictionCount: 0,
      truthSignatureId: 'truth-signature-1', status: 'PROJECTED', runtimeInstanceId: 'runtime-id-1',
      runtimeInstanceKey: 'value-narrative-test', handoffHash: 'sha256:handoff-1', handoffStatus: 'READY_WITH_GAPS',
      sourceOutputAssetId: 'framework-handoff-1', sourceOutputTypeKey: 'EXECUTIVE_BRIEF', evidenceVersion: 'evidence-version-1',
      sectionTruthVersion: 'section-truth-version-1', lockSnapshotId: 'lock-snapshot-1', lockSnapshotHash: 'sha256:lock-snapshot-1',
      replayAnchorId: 'replay-anchor-1', replayAnchorHash: 'sha256:replay-anchor-1', graphVersion: '2.2', graphHash: 'sha256:graph-1' },
    knowledgeContext: { status: 'READY', available: true,
      outputType: { key: 'executive-brief', label: 'Executive Brief', version: '1.0.0' },
      outputTypeStructure: ['Customer context', 'Evidence boundaries', 'Decision relevance'],
      outputSchema: { key: 'executive-brief-schema', version: '1.0.0', requiredSections: required, optionalSections: optional },
      lineage: { versionIds: [outputType.selection.versionId, schema.selection.versionId],
        contentHashes: [outputType.actualContentHash, schema.actualContentHash] } },
    requestedOutputTypeKey: 'executive-brief', userPrompt: `Prepare an executive brief for ${name}.` })
  return { composition, selectedTarget: { contractVersion: OUTCOME_SELECTED_TARGET_CONTRACT_VERSION,
    receipt: projected.receipt, receiptFingerprint: projected.receiptFingerprint },
  sourceSnapshot: frameworkState.evidence_pack, request: { audience: ['Leadership'], format } }
}

const unsupported = (input) => { input.composition.businessFactLedger.facts = []; return input }
export const ss040TargetHashFor = (key) => Object.values(makeSs040Fixture().selectedTarget.receipt.contractIdentity)
  .find((item) => item.selection.capabilityKey === key)?.actualContentHash

// Regression fixtures explicitly supply admissible stored proof; production gates stay mandatory.
export const attachSs040PlanFixtureContract = (payload) => {
  const input = makeSs040Fixture()
  for (const identity of Object.values(input.selectedTarget.receipt.contractIdentity)) {
    const selected = payload.resolution.selectedPacks.find((item) => item.capabilityKey === identity.selection.capabilityKey)
    identity.selection = { ...identity.selection, ...Object.fromEntries(
      ['packId', 'activationId', 'versionId', 'semanticVersion', 'packKey', 'capabilityKey', 'contentHash']
        .map((field) => [field, selected[field]])) }
  }
  input.selectedTarget.receiptFingerprint = hashOutcomeShapingValue(input.selectedTarget.receipt)
  input.composition.outputBinding.lineage = {
    versionIds: Object.values(input.selectedTarget.receipt.contractIdentity).map((item) => item.selection.versionId),
    contentHashes: Object.values(input.selectedTarget.receipt.contractIdentity).map((item) => item.actualContentHash),
  }
  input.composition.runtimeBinding = payload.runtime
  input.composition.truthBinding = { lockedTruth: payload.lockedTruth, frameworkHandoff: payload.planningEvidence?.frameworkHandoff || null }
  input.composition.requestBinding = { ...payload.consumerIntent, requestId: payload.requestId || '' }
  input.composition.outputPlanBinding = projectRuntimeEvidenceOutputPlanBinding(payload)
  input.request = { audience: payload.consumerIntent.audience, format: payload.consumerIntent.format }
  const contract = compileEvidenceToMeaningContract(input)
  if (contract.status !== 'READY') throw new Error(`SS040 stage fixture must be ready: ${JSON.stringify(contract.clarification)}`)
  payload.evidenceToMeaning = { contractVersion: contract.contractVersion, contractId: contract.contractId,
    contractHash: contract.contractHash, contractJson: JSON.stringify(contract) }
  return payload
}

export const readSs040PlanFixtureSnapshot = (plan) => JSON.parse(plan.payload.evidenceToMeaning.contractJson).inputs.sourceSnapshot
export const ss040ScenarioFixtures = () => [
  { name: 'Parlon', expected: 'READY', input: makeSs040Fixture({ name: 'Parlon' }) },
  ...['StorylineOS internal VMF', 'BuildQM', 'CodeKarma', 'Synthetic complete'].map((name) => ({ name, expected: 'READY', input: makeSs040Fixture({ name }) })),
  { name: 'Source-presented unverified', expected: 'CLARIFICATION_REQUIRED', input: (() => {
    const input = unsupported(makeSs040Fixture())
    input.sourceSnapshot.evidenceObjects[0].validationStatus = 'UNVALIDATED'
    input.composition.businessFactLedger.omitted = [{ reference: 'evidence-0', reason: 'EVIDENCE_NOT_VALIDATED', sectionKeys: ['executive-summary'] }]
    return input
  })() },
  { name: 'Contradictions', expected: 'CLARIFICATION_REQUIRED', input: (() => {
    const input = makeSs040Fixture(); input.sourceSnapshot.discoveryHealth.unresolvedContradictionCount = 1; return input
  })() },
  { name: 'Missing economics and decision authority', expected: 'CLARIFICATION_REQUIRED', input: (() => {
    const input = makeSs040Fixture({ required: ['Economics', 'Decision Authority'] })
    input.composition.businessFactLedger.facts = []; return input
  })() },
  { name: 'Framework only', expected: 'CLARIFICATION_REQUIRED', input: (() => {
    const input = unsupported(makeSs040Fixture()); input.composition.frameworkIntelligence = { guidance: 'A decision process is useful.' }; return input
  })() },
  { name: 'Optional unresolved', expected: 'READY', input: makeSs040Fixture({ optional: ['Economics'] }) },
  { name: 'Mixed output and format', expected: 'READY', input: makeSs040Fixture({ format: 'PDF' }) },
  { name: 'Non-VMF-compatible output', expected: 'CLARIFICATION_REQUIRED', input: (() => {
    const input = makeSs040Fixture(); input.composition.requestBinding.requestedOutputTypeKey = 'incompatible-output'; return input
  })() },
]
