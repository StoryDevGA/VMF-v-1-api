import { createHash } from 'node:crypto'
import { COMMERCIAL_OUTPUT_SECTION_KEYS } from '../../utils/outcomeCommercialExpressionProfile.js'
import { OUTCOME_DOCX_RENDITION_SOURCE_VERSION } from '../../services/outcomeDocxRenditionSourceService.js'
import { SYNTHETIC_OUTCOME_CLASSIFICATION } from '../../models/SyntheticOutcomeRunEvent.js'
import { membershipHash } from '../../services/runtimeEvidenceSnapshotContract.js'
import { hashOutcomeQualityStageValue } from '../../services/outcomeQualityStageExecutionService.js'
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
// Generic unsigned source fixture, never native admission or customer assertions.
export const governedDocxFixture = () => {
  const layers = ['OUTPUT_TYPE', 'OUTPUT_SCHEMA', 'STYLE', 'VISUAL_SYSTEM', 'AUDIENCE']
  const types = ['OUTPUT_TYPE_DEFINITION', 'OUTPUT_SCHEMA', 'STYLE', 'VISUAL_SYSTEM', 'AUDIENCE']
  const keys = ['commercial-strategy-and-decision-paper', 'commercial-strategy-and-decision-paper-schema', 'generic-style', 'generic-visual', 'generic-audience']
  const contents = layers.map(layer => `Generic document guidance for ${layer.toLowerCase().replaceAll('_', ' ')}.`)
  const packs = layers.map((knowledgeLayer, i) => ({ packType: types[i], packId: `pack-${i}`, packKey: keys[i],
    versionId: `version-${i}`, semanticVersion: '1.0.0', contentHash: digest(contents[i]) }))
  const selectedPacks = Object.fromEntries(layers.map((layer, i) => [layer, { ...packs[i], knowledgeLayer: layer,
    capabilityKey: keys[i], activationId: `activation-${i}` }]))
  selectedPacks.OUTPUT_TYPE.label = 'Commercial Strategy and Decision Paper'
  const shaping = { candidateType: 'COMMERCIAL_STRATEGY_AND_DECISION_PAPER', expressionProfileVersion: 'generic-test-profile.v1',
    styleValidationReceipt: { outputAssetId: 'OT-GENERIC' },
    title: 'Bounded decision paper',
    outputContract: { outputTypeKey: keys[0], outputSchemaKey: keys[1], styleKey: keys[2], visualSystemKey: keys[3],
      sections: [...COMMERCIAL_OUTPUT_SECTION_KEYS], packs: packs.slice(0, 4) },
    sections: COMMERCIAL_OUTPUT_SECTION_KEYS.map((sectionKey, i) => ({ sectionKey, elementId: `element-${i}`, order: i + 1,
      heading: `Section ${i + 1}`, body: `Observation ${i + 1} remains provisional.\n\n> Quoted source ${i + 1}.\n\nSource limit ${i + 1}: sample only.`,
      qualification: `Qualification ${i + 1}: broader evidence is missing.`,
      diagram: { present: false, description: '', accessibleText: '' }, truthReferences: [`reference-${i}`] })) }
  const source = { kind: 'GOVERNED_STAGE_CHAIN', scope: { runtimeInstanceId: 'actual-controlled-runtime', customerId: 'customer', tenantId: 'tenant',
    classification: SYNTHETIC_OUTCOME_CLASSIFICATION, authoritative: false }, selectedPacks,
    logicalDraft: { draftId: 'logical-only', draftIterationId: 'logical-iteration' },
    content: { shaping }, stageRefs: [{ stageKey: 'OUTPUT_SHAPING', stageExecutionId: 'shaping', status: 'SUCCEEDED' }],
    reviewState: { status: 'FAILED', failure: { failureCode: 'OLD_FAILURE_RETAINED' } } }
  const envelope = { contractVersion: OUTCOME_DOCX_RENDITION_SOURCE_VERSION, sourceAdmission: 'VERIFIED_READ_ONLY_CHAIN',
    classification: SYNTHETIC_OUTCOME_CLASSIFICATION, authoritative: false, normalOutputAvailable: false, authorisesApproval: false,
    renderingAvailable: false, finalisationAvailable: false, deliveryAvailable: false, source }
  const seal = () => { source.stageRefs[0].outputFingerprint = hashOutcomeQualityStageValue(shaping); envelope.sourceFingerprint = membershipHash(source) }
  seal()
  const documents = packs.slice(0, 4).map((pack, i) => ({ source: { ...pack, contentFormat: 'MARKDOWN' }, content: contents[i] }))
  const audienceDocument = { ...packs[4], available: true, status: 'ACTIVE', contentFormat: 'MARKDOWN', content: contents[4] }
  return { envelope, documents, audienceDocument, shaping, seal }
}

