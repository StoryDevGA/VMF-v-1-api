import { createHash } from 'node:crypto'
import mongoose from 'mongoose'

import {
  OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION,
  OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
  OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
  OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION,
  OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION,
  OUTCOME_QUALITY_STAGE_PROVIDER_CONFIG_VERSIONS,
  OUTCOME_QUALITY_STAGE_ERROR_CODES,
  OUTCOME_QUALITY_STAGE_OUTPUT_TYPES,
  OUTCOME_QUALITY_STAGE_SEQUENCE,
  OUTCOME_QUALITY_STAGE_STATUSES,
  OUTCOME_QUALITY_STAGES,
  OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION,
  OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
  OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
} from '../constants/outcomeGovernedQuality.js'
import { findOutcomeFrameworkGuidanceStageClaim } from '../utils/outcomeFrameworkGuidanceStageClaims.js'
import { containsOutcomeWorkingDraftProhibitedStageClaim } from '../utils/outcomeWorkingDraftStageClaims.js'

const sha256Pattern = /^[a-f0-9]{64}$/
const contentHashPattern = /^sha256:[a-f0-9]{64}$/
const stableKeyPattern = /^[a-z0-9](?:[a-z0-9._-]{0,138}[a-z0-9])?$/
const sectionRootPattern = /^framework_state\.sections\.([a-z0-9](?:[a-z0-9_-]{0,138}[a-z0-9])?)$/
const legacySectionPathPattern = /^framework_state\.sections\.([a-z0-9](?:[a-z0-9_-]{0,138}[a-z0-9])?)(\.accepted)?$/
const nestedOptions = { _id: false, strict: 'throw' }
const requiredText = (maxlength) => ({ type: String, required: true, trim: true, minlength: 1, maxlength })
const optionalText = (maxlength) => ({ type: String, trim: true, maxlength, default: '' })
const strictInteger = ({ min = 0, max = Number.MAX_SAFE_INTEGER }) => ({
  type: mongoose.Schema.Types.Mixed,
  required: true,
  validate: {
    validator: (value) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max,
    message: 'Integer value is outside the governed boundary.',
  },
})
const stringArray = ({ min = 0, max, itemMax }) => ({
  type: [{ type: String, trim: true, minlength: 1, maxlength: itemMax }],
  required: true,
  default: undefined,
  validate: {
    validator: (value) => Array.isArray(value) && value.length >= min && value.length <= max,
    message: 'Array length is outside the governed boundary.',
  },
})

const acceptedSectionSchema = new mongoose.Schema({
  sectionKey: { ...requiredText(140), lowercase: true, match: stableKeyPattern },
  stateSectionKey: { type: String, trim: true, lowercase: true, maxlength: 140, match: stableKeyPattern },
  runtimePath: requiredText(500),
  truthHash: { type: String, required: true, lowercase: true, match: contentHashPattern },
}, nestedOptions)

const assignedPackSchema = new mongoose.Schema({
  activationId: requiredText(180),
  packId: requiredText(180),
  versionId: requiredText(180),
  contentHash: { type: String, required: true, lowercase: true, match: contentHashPattern },
  packType: requiredText(100),
  packKey: { ...requiredText(140), lowercase: true, match: stableKeyPattern },
  knowledgeLayer: requiredText(100),
  executionMode: requiredText(100),
  requirement: requiredText(40),
  stageRole: {
    type: String,
    required: true,
    enum: [
      OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
      OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
      OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
      OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
      OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    ],
  },
}, nestedOptions)

const consumerIntentSchema = new mongoose.Schema({
  outcome: requiredText(4000),
  decisionPurpose: requiredText(4000),
  consumer: requiredText(500),
  audience: stringArray({ min: 1, max: 50, itemMax: 500 }),
  requestedOutputTypeKey: { ...requiredText(140), lowercase: true, match: stableKeyPattern },
  format: requiredText(1000),
  channel: optionalText(1000),
  requirements: stringArray({ max: 50, itemMax: 2000 }),
  unresolvedGaps: stringArray({ max: 50, itemMax: 2000 }),
}, nestedOptions)

const inputSnapshotSchema = new mongoose.Schema({
  plan: {
    type: new mongoose.Schema({
      recordId: requiredText(180),
      planId: requiredText(180),
      planVersion: strictInteger({ min: 1 }),
      planFingerprint: { type: String, required: true, lowercase: true, match: sha256Pattern },
      resolutionFingerprint: { type: String, required: true, lowercase: true, match: sha256Pattern },
      contextFingerprint: { type: String, required: true, lowercase: true, match: sha256Pattern },
    }, nestedOptions),
    required: true,
  },
  lockedTruth: {
    type: new mongoose.Schema({
      acceptedTruthIdentityContractVersion: {
        type: String,
        trim: true,
        enum: [OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION],
      },
      publishSnapshotId: requiredText(180),
      publishSnapshotHash: { type: String, required: true, lowercase: true, match: sha256Pattern },
      lockSnapshotId: requiredText(180),
      lockSnapshotHash: { type: String, required: true, lowercase: true, match: sha256Pattern },
      replayAnchorId: requiredText(180),
      replayAnchorHash: { type: String, required: true, lowercase: true, match: sha256Pattern },
      dependencySnapshotId: requiredText(180),
      dependencySnapshotHash: { type: String, required: true, lowercase: true, match: sha256Pattern },
      acceptedSectionCount: strictInteger({ min: 1, max: 100 }),
      acceptedSections: {
        type: [acceptedSectionSchema], required: true, default: undefined,
        validate: { validator: (value) => Array.isArray(value) && value.length >= 1 && value.length <= 100 },
      },
    }, nestedOptions),
    required: true,
  },
  consumerIntent: { type: consumerIntentSchema, required: true },
  consumerIntentFingerprint: { type: String, required: true, lowercase: true, match: sha256Pattern },
  stage: {
    type: new mongoose.Schema({
      stageKey: {
        type: String,
        required: true,
        enum: [
          OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
          OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
          OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
          OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
          OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
          OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
        ],
      },
      stageOrder: strictInteger({ min: 1, max: 6 }),
      assignedActivationCount: strictInteger({ min: 0, max: 100 }),
      assignedPacks: {
        type: [assignedPackSchema], required: true, default: undefined,
        validate: { validator: (value) => Array.isArray(value) && value.length <= 100 },
      },
    }, nestedOptions),
    required: true,
  },
  sourceStage: {
    type: new mongoose.Schema({
      stageExecutionId: requiredText(180),
      stageKey: {
        type: String,
        required: true,
        enum: [
          OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
          OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
          OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
          OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
          OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
        ],
      },
      stageOrder: strictInteger({ min: 1, max: 5 }),
      attemptNumber: strictInteger({ min: 1 }),
      attemptFingerprint: { type: String, required: true, lowercase: true, match: sha256Pattern },
      outputFingerprint: { type: String, required: true, lowercase: true, match: sha256Pattern },
      outputType: {
        type: String,
        required: true,
        enum: [
          OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.FRAMEWORK_GUIDANCE_ANALYSIS,
          OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT,
          OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.ARL_MEANING_REVIEW,
          OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.OUTCOME_NARRATIVE_PLAN,
          OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION,
        ],
      },
      schemaVersion: {
        type: String,
        required: true,
        enum: [
          OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
          OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
          OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
          OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION,
          OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
        ],
      },
      decisionLogicFingerprint: {
        type: String,
        required() {
          return this.stageKey === OUTCOME_QUALITY_STAGES.WORKING_DRAFT
        },
        lowercase: true,
        match: /^(?:[a-f0-9]{64})?$/,
      },
    }, nestedOptions),
  },
  visibleGaps: stringArray({ max: 50, itemMax: 2000 }),
}, nestedOptions)

const failureSchema = new mongoose.Schema({
  failureCode: { ...requiredText(140), uppercase: true, match: /^[A-Z0-9](?:[A-Z0-9._-]{0,138}[A-Z0-9])?$/ },
  safeReason: requiredText(500),
  retryable: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    validate: { validator: (value) => typeof value === 'boolean', message: 'Retryable must be a boolean.' },
  },
}, nestedOptions)

const executionIdentitySchema = new mongoose.Schema({
  executionMode: requiredText(80),
  providerKey: { ...optionalText(140), lowercase: true, match: /^(?:[a-z0-9](?:[a-z0-9._-]{0,138}[a-z0-9])?)?$/ },
  providerConfigurationVersion: {
    ...optionalText(160),
    enum: ['', ...new Set(Object.values(OUTCOME_QUALITY_STAGE_PROVIDER_CONFIG_VERSIONS).flat())],
  },
  model: optionalText(160),
  grrExecutionId: optionalText(180),
  grrRuntimeArtifactId: optionalText(180),
  runtimeVersion: requiredText(80),
}, nestedOptions)

const schema = new mongoose.Schema({
  stageExecutionId: { type: String, required: true, immutable: true, trim: true, maxlength: 180 },
  qualityRunId: { type: String, required: true, immutable: true, trim: true, maxlength: 180 },
  contractVersion: { type: String, required: true, immutable: true, enum: [OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION], default: OUTCOME_GOVERNED_QUALITY_CONTRACT_VERSION },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, immutable: true },
  runtimeInstanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'RuntimeInstance', required: true, immutable: true },
  runtimeInstanceKey: { type: String, required: true, immutable: true, trim: true, lowercase: true, maxlength: 160 },
  knowledgeCompositionPlanRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'OutcomeKnowledgeCompositionPlan', required: true, immutable: true },
  planId: { type: String, required: true, immutable: true, trim: true, maxlength: 180 },
  planVersion: { ...strictInteger({ min: 1 }), immutable: true },
  planFingerprint: { type: String, required: true, immutable: true, match: sha256Pattern },
  resolutionFingerprint: { type: String, required: true, immutable: true, match: sha256Pattern },
  contextFingerprint: { type: String, required: true, immutable: true, match: sha256Pattern },
  stageKey: {
    type: String,
    required: true,
    immutable: true,
    enum: [
      OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
      OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
      OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
      OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
      OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
    ],
  },
  stageOrder: { ...strictInteger({ min: 1, max: 6 }), immutable: true },
  attemptNumber: { ...strictInteger({ min: 1 }), immutable: true },
  predecessorStageExecutionId: { type: String, immutable: true, trim: true, maxlength: 180, default: '' },
  predecessorAttemptFingerprint: { type: String, immutable: true, match: /^(?:[a-f0-9]{64})?$/, default: '' },
  status: { type: String, required: true, immutable: true, enum: Object.values(OUTCOME_QUALITY_STAGE_STATUSES) },
  inputFingerprint: { type: String, required: true, immutable: true, match: sha256Pattern },
  outputFingerprint: { type: String, immutable: true, match: /^(?:[a-f0-9]{64})?$/, default: '' },
  attemptFingerprint: { type: String, required: true, immutable: true, match: sha256Pattern },
  inputSnapshot: { type: inputSnapshotSchema, required: true, immutable: true },
  outputSnapshot: { type: mongoose.Schema.Types.Mixed, immutable: true, default: undefined },
  failure: { type: failureSchema, immutable: true, default: undefined },
  executionIdentity: { type: executionIdentitySchema, required: true, immutable: true },
  assignedActivationCount: { ...strictInteger({ min: 0, max: 100 }), immutable: true },
  contributingActivationCount: { ...strictInteger({ max: 100 }), immutable: true },
  truthReferenceCount: { ...strictInteger({ max: 100 }), immutable: true },
  startedAt: { type: Date, required: true, immutable: true },
  completedAt: { type: Date, required: true, immutable: true },
  durationMs: { ...strictInteger({ max: 86_400_000 }), immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, {
  collection: 'outcome_quality_stage_executions',
  strict: 'throw',
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: {
    transform(_doc, ret) {
      ret.id = String(ret._id)
      delete ret._id
      delete ret.__v
      return ret
    },
  },
})

schema.index({ stageExecutionId: 1 }, { unique: true, name: 'uniq_outcome_quality_stage_execution_id' })
schema.index(
  { runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 },
  { unique: true, name: 'uniq_outcome_quality_stage_attempt' },
)

const immutableError = () => {
  const error = new Error('Outcome quality stage executions are immutable.')
  error.code = OUTCOME_QUALITY_STAGE_ERROR_CODES.IMMUTABLE
  error.status = 409
  return error
}

const shapeError = (message) => {
  const error = new mongoose.Error.ValidationError()
  error.addError('governedShape', new mongoose.Error.ValidatorError({ message }))
  return error
}

const plain = (value) => value?.toObject ? value.toObject({ depopulate: true }) : value
const canonicalize = (value) => {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof mongoose.Types.ObjectId) return value.toString().toLowerCase()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    if (key !== '_id' && key !== '__v' && value[key] !== undefined) result[key] = canonicalize(value[key])
    return result
  }, {})
  return value
}
const hash = (value) => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
const sameSet = (left, right) => JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort())
const exactKeys = (value, keys) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)),
)
const stageOrders = Object.freeze({
  [OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE]: 1,
  [OUTCOME_QUALITY_STAGES.WORKING_DRAFT]: 2,
  [OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW]: 3,
  [OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN]: 4,
  [OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING]: 5,
  [OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL]: 6,
})
const arlRequiredDimensions = Object.freeze([
  'ANALYTICAL_STRENGTH', 'COHERENCE', 'PRIORITISATION', 'EVIDENCE_USE', 'DECISION_USEFULNESS',
])
const rlRequiredDimensions = Object.freeze([
  'STATEMENTS', 'HEADINGS', 'DIAGRAMS', 'HIERARCHY', 'QUALIFICATION', 'ACCESSIBILITY', 'BRAND_EXPRESSION',
])
const nonEmptyString = (value) => typeof value === 'string' && value.length >= 1
const stringArrayValid = (value, { min = 0 } = {}) => Array.isArray(value)
  && value.length >= min
  && value.every(nonEmptyString)
const outputShapeValid = ({ stageKey, output, input }) => {
  if (!output || JSON.stringify(output.visibleGaps) !== JSON.stringify(input.visibleGaps)) return false
  if (stageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE) {
    return output.outputType === OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.FRAMEWORK_GUIDANCE_ANALYSIS
      && output.schemaVersion === OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION
      && Array.isArray(output.sections)
      && output.sections.length >= 1
      && exactKeys(output, [
        'outputType', 'schemaVersion', 'title', 'sections', 'decisionUsefulness', 'assumptions', 'visibleGaps',
      ])
  }
  if (stageKey === OUTCOME_QUALITY_STAGES.WORKING_DRAFT) {
    const sectionsValid = Array.isArray(output.sections)
      && output.sections.length >= 1
      && output.sections.every((section, sectionIndex) => exactKeys(section, [
        'order', 'sectionKey', 'title', 'content', 'claims', 'truthReferences',
        'contributingActivationIds', 'assumptions', 'gaps',
      ])
        && section.order === sectionIndex + 1
        && nonEmptyString(section.sectionKey)
        && nonEmptyString(section.title)
        && nonEmptyString(section.content)
        && stringArrayValid(section.truthReferences, { min: 1 })
        && stringArrayValid(section.contributingActivationIds, { min: 1 })
        && stringArrayValid(section.assumptions)
        && stringArrayValid(section.gaps)
        && Array.isArray(section.claims)
        && section.claims.length >= 1
        && section.claims.every((claim) => exactKeys(claim, [
          'claimKey', 'statement', 'truthReferences', 'evidence',
        ])
          && nonEmptyString(claim.claimKey)
          && nonEmptyString(claim.statement)
          && stringArrayValid(claim.truthReferences, { min: 1 })
          && stringArrayValid(claim.evidence, { min: 1 })))
    const decisionsValid = Array.isArray(output.decisionLogic)
      && output.decisionLogic.length >= 1
      && output.decisionLogic.every((decision) => exactKeys(decision, [
        'decisionKey', 'rationale', 'priority', 'truthReferences',
      ])
        && nonEmptyString(decision.decisionKey)
        && nonEmptyString(decision.rationale)
        && nonEmptyString(decision.priority)
        && stringArrayValid(decision.truthReferences, { min: 1 }))
    const provenanceValid = exactKeys(output.compositionProvenance, [
      'frameworkGuidanceStageExecutionId', 'frameworkGuidanceOutputFingerprint', 'planFingerprint',
    ])
      && output.compositionProvenance.frameworkGuidanceStageExecutionId === input.sourceStage?.stageExecutionId
      && output.compositionProvenance.frameworkGuidanceOutputFingerprint === input.sourceStage?.outputFingerprint
      && output.compositionProvenance.planFingerprint === input.plan?.planFingerprint
    const revisionsValid = Array.isArray(output.revisionHistory)
      && output.revisionHistory.length === output.draftVersion
      && output.revisionHistory.every((revision, index) => exactKeys(revision, [
        'version', 'summary', 'sourceStageExecutionId', 'sourceOutputFingerprint',
      ])
        && revision.version === index + 1
        && nonEmptyString(revision.summary)
        && revision.sourceStageExecutionId === input.sourceStage?.stageExecutionId
        && revision.sourceOutputFingerprint === input.sourceStage?.outputFingerprint)
    return output.outputType === OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT
      && output.schemaVersion === OUTCOME_WORKING_DRAFT_SCHEMA_VERSION
      && Number.isInteger(output.draftVersion)
      && output.draftVersion >= 1
      && sectionsValid
      && decisionsValid
      && provenanceValid
      && revisionsValid
      && stringArrayValid(output.assumptions)
      && !Object.prototype.hasOwnProperty.call(output, 'approvedMeaning')
      && !containsOutcomeWorkingDraftProhibitedStageClaim(output)
      && exactKeys(output, [
        'outputType', 'schemaVersion', 'draftVersion', 'title', 'sections', 'decisionLogic',
        'compositionProvenance', 'revisionHistory', 'assumptions', 'visibleGaps',
      ])
  }
  if (stageKey === OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN) {
    return output.outputType === OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.OUTCOME_NARRATIVE_PLAN
      && output.schemaVersion === OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION
      && output.arlStageExecutionId === input.sourceStage?.stageExecutionId
      && /^[a-f0-9]{64}$/.test(output.approvedMeaningFingerprint || '')
      && Array.isArray(output.sections)
      && output.sections.length >= 1
      && output.sections.every((section, index) => exactKeys(section, [
        'order', 'sectionKey', 'heading', 'purpose', 'keyMessages', 'truthReferences', 'qualification', 'diagramIntent',
      ]) && section.order === index + 1 && nonEmptyString(section.sectionKey)
        && nonEmptyString(section.heading) && nonEmptyString(section.purpose)
        && stringArrayValid(section.keyMessages, { min: 1 }) && stringArrayValid(section.truthReferences, { min: 1 }))
      && stringArrayValid(output.truthReferences, { min: 1 })
      && stringArrayValid(output.contributingActivationIds, { min: 1 })
      && exactKeys(output, [
        'outputType', 'schemaVersion', 'arlStageExecutionId', 'approvedMeaningFingerprint',
        'sections', 'truthReferences', 'contributingActivationIds', 'visibleGaps',
      ])
  }
  if (stageKey === OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING) {
    const baseKeys = [
      'outputType', 'schemaVersion', 'narrativePlanStageExecutionId', 'narrativePlanOutputFingerprint',
      'candidateType', 'title', 'sections', 'truthReferences', 'contributingActivationIds', 'visibleGaps',
    ]
    const revisionKeys = [
      ...baseKeys,
      'candidateVersion', 'revisionScope', 'revisionOfStageExecutionId', 'revisionOfOutputFingerprint',
      'remediationSourceStageExecutionId', 'remediationSourceAttemptFingerprint',
      'remediationFailureCode', 'rlFindingFingerprint',
    ]
    const revision = exactKeys(output, revisionKeys)
    return output.outputType === OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION
      && output.schemaVersion === OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION
      && output.narrativePlanStageExecutionId === input.sourceStage?.stageExecutionId
      && output.narrativePlanOutputFingerprint === input.sourceStage?.outputFingerprint
      && output.candidateType === 'EXECUTIVE_BRIEF'
      && nonEmptyString(output.title)
      && Array.isArray(output.sections)
      && output.sections.length >= 1
      && output.sections.every((section, index) => exactKeys(section, [
        'order', 'elementId', 'sectionKey', 'heading', 'body', 'qualification', 'diagram', 'truthReferences',
      ]) && section.order === index + 1 && nonEmptyString(section.elementId)
        && nonEmptyString(section.sectionKey) && nonEmptyString(section.heading)
        && nonEmptyString(section.body) && stringArrayValid(section.truthReferences, { min: 1 })
        && exactKeys(section.diagram, ['present', 'description', 'accessibleText'])
        && typeof section.diagram.present === 'boolean')
      && stringArrayValid(output.truthReferences, { min: 1 })
      && stringArrayValid(output.contributingActivationIds, { min: 1 })
      && (exactKeys(output, baseKeys) || revision)
      && (!revision || (Number.isInteger(output.candidateVersion)
        && output.candidateVersion >= 2
        && output.revisionScope === 'EXPRESSION_ONLY'
        && nonEmptyString(output.revisionOfStageExecutionId)
        && sha256Pattern.test(output.revisionOfOutputFingerprint || '')
        && nonEmptyString(output.remediationSourceStageExecutionId)
        && sha256Pattern.test(output.remediationSourceAttemptFingerprint || '')
        && output.remediationFailureCode === 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE'
        && sha256Pattern.test(output.rlFindingFingerprint || '')))
  }
  if (stageKey === OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL) {
    return output.outputType === OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION_RL
      && output.schemaVersion === OUTCOME_RENDERED_EXPRESSION_RL_SCHEMA_VERSION
      && output.candidateStageExecutionId === input.sourceStage?.stageExecutionId
      && output.candidateOutputFingerprint === input.sourceStage?.outputFingerprint
      && output.overallStatus === 'PASS'
      && Array.isArray(output.findings)
      && output.findings.length === rlRequiredDimensions.length
      && sameSet(output.findings.map((finding) => finding.dimension), rlRequiredDimensions)
      && output.findings.every((finding) => exactKeys(finding, ['dimension', 'status', 'finding', 'requiredChange'])
        && finding.status === 'PASS' && nonEmptyString(finding.finding) && finding.requiredChange === false)
      && stringArrayValid(output.truthReferences, { min: 1 })
      && stringArrayValid(output.contributingActivationIds, { min: 1 })
      && exactKeys(output, [
        'outputType', 'schemaVersion', 'candidateStageExecutionId', 'candidateOutputFingerprint',
        'overallStatus', 'findings', 'truthReferences', 'contributingActivationIds', 'visibleGaps',
      ])
  }
  const findingsValid = Array.isArray(output.findings)
    && output.findings.length >= 1
    && output.findings.every((finding) => exactKeys(finding, [
      'findingKey', 'dimension', 'severity', 'finding', 'requiredChange', 'disposition', 'changeApplied',
    ])
      && nonEmptyString(finding.findingKey)
      && arlRequiredDimensions.includes(finding.dimension)
      && nonEmptyString(finding.severity)
      && nonEmptyString(finding.finding)
      && typeof finding.requiredChange === 'boolean'
      && nonEmptyString(finding.disposition)
      && typeof finding.changeApplied === 'boolean'
      && !(finding.severity === 'BLOCKING' && !finding.requiredChange)
      && (!finding.requiredChange || (finding.disposition === 'APPLIED' && finding.changeApplied === true)))
  const approvedDecisionLogicValid = Array.isArray(output.approvedMeaning?.decisionLogic)
    && output.approvedMeaning.decisionLogic.length >= 1
    && output.approvedMeaning.decisionLogic.every((decision) => exactKeys(decision, [
      'decisionKey', 'rationale', 'priority', 'truthReferences',
    ])
      && nonEmptyString(decision.decisionKey)
      && nonEmptyString(decision.rationale)
      && nonEmptyString(decision.priority)
      && stringArrayValid(decision.truthReferences, { min: 1 }))
  const decisionLogicFingerprint = hash(output.approvedMeaning?.decisionLogic)
  const expectedMeaningFingerprint = hash({
    workingDraftStageExecutionId: input.sourceStage?.stageExecutionId,
    workingDraftOutputFingerprint: input.sourceStage?.outputFingerprint,
    decisionLogicFingerprint,
  })
  return output.outputType === OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.ARL_MEANING_REVIEW
    && output.schemaVersion === OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION
    && output.workingDraftStageExecutionId === input.sourceStage?.stageExecutionId
    && output.workingDraftOutputFingerprint === input.sourceStage?.outputFingerprint
    && findingsValid
    && sameSet(output.findings.map((finding) => finding.dimension), arlRequiredDimensions)
    && exactKeys(output.approvedMeaning, [
      'state', 'version', 'workingDraftStageExecutionId', 'workingDraftOutputFingerprint',
      'meaningSummary', 'decisionLogic', 'meaningFingerprint', 'decisionLogicFingerprint',
    ])
    && output.approvedMeaning?.state === 'APPROVED'
    && Number.isInteger(output.approvedMeaning?.version)
    && output.approvedMeaning.version >= 1
    && output.approvedMeaning.workingDraftStageExecutionId === input.sourceStage?.stageExecutionId
    && output.approvedMeaning.workingDraftOutputFingerprint === input.sourceStage?.outputFingerprint
    && nonEmptyString(output.approvedMeaning.meaningSummary)
    && approvedDecisionLogicValid
    && input.sourceStage?.decisionLogicFingerprint === decisionLogicFingerprint
    && output.approvedMeaning.meaningFingerprint === expectedMeaningFingerprint
    && output.approvedMeaning.decisionLogicFingerprint === decisionLogicFingerprint
    && stringArrayValid(output.truthReferences, { min: 1 })
    && stringArrayValid(output.contributingActivationIds, { min: 1 })
    && exactKeys(output, [
      'outputType', 'schemaVersion', 'workingDraftStageExecutionId', 'workingDraftOutputFingerprint',
      'findings', 'approvedMeaning', 'truthReferences', 'contributingActivationIds', 'visibleGaps',
    ])
}

schema.pre('validate', function validateShape(next) {
  if (!this.isNew) return next(immutableError())
  this.stageExecutionId = String(this.stageExecutionId || '').trim()
  this.qualityRunId = String(this.qualityRunId || '').trim()
  this.runtimeInstanceKey = String(this.runtimeInstanceKey || '').trim().toLowerCase()
  this.planId = String(this.planId || '').trim()
  this.planFingerprint = String(this.planFingerprint || '').trim().toLowerCase()
  this.resolutionFingerprint = String(this.resolutionFingerprint || '').trim().toLowerCase()
  this.contextFingerprint = String(this.contextFingerprint || '').trim().toLowerCase()
  this.stageKey = String(this.stageKey || '').trim().toUpperCase()
  this.predecessorStageExecutionId = String(this.predecessorStageExecutionId || '').trim()
  this.predecessorAttemptFingerprint = String(this.predecessorAttemptFingerprint || '').trim().toLowerCase()
  this.status = String(this.status || '').trim().toUpperCase()
  this.inputFingerprint = String(this.inputFingerprint || '').trim().toLowerCase()
  this.outputFingerprint = String(this.outputFingerprint || '').trim().toLowerCase()
  this.attemptFingerprint = String(this.attemptFingerprint || '').trim().toLowerCase()

  const input = plain(this.inputSnapshot)
  const output = plain(this.outputSnapshot)
  const failure = plain(this.failure)
  const identity = plain(this.executionIdentity)
  const providerConfigurationVersion = String(identity?.providerConfigurationVersion || '').trim()
  const allowedProviderConfigurationVersions = OUTCOME_QUALITY_STAGE_PROVIDER_CONFIG_VERSIONS[this.stageKey] || []
  const providerConfigurationIdentityInvalid = Boolean(identity?.providerKey)
    !== Boolean(providerConfigurationVersion)
    || (providerConfigurationVersion
      && !allowedProviderConfigurationVersions.includes(providerConfigurationVersion))
  const providerRequired = [
    OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
    OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
    OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
  ].includes(this.stageKey)
  const succeeded = this.status === OUTCOME_QUALITY_STAGE_STATUSES.SUCCEEDED
  const duration = this.completedAt instanceof Date && this.startedAt instanceof Date
    ? this.completedAt.getTime() - this.startedAt.getTime()
    : Number.NaN
  const directReferenceStage = [
    OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
    OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN,
    OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
    OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
  ].includes(this.stageKey)
  const truthRefs = directReferenceStage
    ? output?.truthReferences || []
    : output?.sections?.flatMap((section) => section.truthReferences || []) || []
  const activationRefs = directReferenceStage
    ? output?.contributingActivationIds || []
    : output?.sections?.flatMap((section) => section.contributingActivationIds || []) || []
  const acceptedSections = input?.lockedTruth?.acceptedSections || []
  const expectedTruth = acceptedSections.map((section) => section.sectionKey)
  const acceptedTruthMarkerPresent = Boolean(input?.lockedTruth)
    && Object.prototype.hasOwnProperty.call(input.lockedTruth, 'acceptedTruthIdentityContractVersion')
  const markedAcceptedTruth = input?.lockedTruth?.acceptedTruthIdentityContractVersion
    === OUTCOME_ACCEPTED_TRUTH_IDENTITY_CONTRACT_VERSION
  const acceptedTruthIdentityInvalid = acceptedTruthMarkerPresent && !markedAcceptedTruth
    || (markedAcceptedTruth && (
      new Set(acceptedSections.map((section) => section.stateSectionKey)).size !== acceptedSections.length
      || acceptedSections.some((section) => {
        const match = String(section.runtimePath || '').match(sectionRootPattern)
        return !section.stateSectionKey || !match || match[1] !== section.stateSectionKey
      })
    ))
    || (!acceptedTruthMarkerPresent && acceptedSections.some((section) => {
      const match = String(section.runtimePath || '').match(legacySectionPathPattern)
      return Object.prototype.hasOwnProperty.call(section, 'stateSectionKey')
        || !match
        || match[1] !== section.sectionKey
    }))
  const expectedActivations = input?.stage?.assignedPacks?.map((pack) => pack.activationId) || []
  const outputSections = output?.sections || []
  const expectedStageOrder = stageOrders[this.stageKey]
  const sourceStage = input?.sourceStage
  const sourceExpected = expectedStageOrder > 1
  const sourceInvalid = sourceExpected
    ? (!sourceStage
      || sourceStage.stageOrder !== expectedStageOrder - 1
      || sourceStage.stageKey !== OUTCOME_QUALITY_STAGE_SEQUENCE[expectedStageOrder - 2]
      || sourceStage.outputType !== ({
        2: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.FRAMEWORK_GUIDANCE_ANALYSIS,
        3: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.WORKING_DRAFT,
        4: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.ARL_MEANING_REVIEW,
        5: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.OUTCOME_NARRATIVE_PLAN,
        6: OUTCOME_QUALITY_STAGE_OUTPUT_TYPES.RENDERED_EXPRESSION,
      })[expectedStageOrder]
      || sourceStage.schemaVersion !== ({
        2: OUTCOME_FRAMEWORK_GUIDANCE_SCHEMA_VERSION,
        3: OUTCOME_WORKING_DRAFT_SCHEMA_VERSION,
        4: OUTCOME_ARL_MEANING_REVIEW_SCHEMA_VERSION,
        5: OUTCOME_NARRATIVE_PLAN_SCHEMA_VERSION,
        6: OUTCOME_RENDERED_EXPRESSION_SCHEMA_VERSION,
      })[expectedStageOrder]
      || (expectedStageOrder === 3
        ? !sha256Pattern.test(sourceStage.decisionLogicFingerprint || '')
        : Boolean(sourceStage.decisionLogicFingerprint))
      || !sourceStage.stageExecutionId
      || !sha256Pattern.test(sourceStage.attemptFingerprint || '')
      || !sha256Pattern.test(sourceStage.outputFingerprint || ''))
    : Boolean(sourceStage)
  const firstAttemptPredecessorInvalid = this.attemptNumber === 1
    && (expectedStageOrder === 1
      ? Boolean(this.predecessorStageExecutionId || this.predecessorAttemptFingerprint)
      : (this.predecessorStageExecutionId !== sourceStage?.stageExecutionId
        || this.predecessorAttemptFingerprint !== sourceStage?.attemptFingerprint))
  const stageReferencesInvalid = [
    OUTCOME_QUALITY_STAGES.ARL_MEANING_REVIEW,
    OUTCOME_QUALITY_STAGES.OUTPUT_SHAPING,
    OUTCOME_QUALITY_STAGES.RENDERED_EXPRESSION_RL,
  ].includes(this.stageKey)
    ? (!sameSet(truthRefs, expectedTruth) || !sameSet(activationRefs, expectedActivations))
    : this.stageKey === OUTCOME_QUALITY_STAGES.OUTCOME_NARRATIVE_PLAN
      ? (!sameSet(truthRefs, expectedTruth) || activationRefs.length < 1)
    : this.stageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
      ? (!sameSet(truthRefs, expectedTruth) || !sameSet(activationRefs, expectedActivations))
      : (!sameSet(truthRefs, expectedTruth) || activationRefs.length < 1)
  const expectedQualityRunId = `quality_run_${hash({
    tenantId: this.tenantId,
    customerId: this.customerId,
    runtimeInstanceId: this.runtimeInstanceId,
    planId: this.planId,
    planVersion: this.planVersion,
    planFingerprint: this.planFingerprint,
  }).slice(0, 40)}`
  const invalid = !input
    || !identity
    || providerConfigurationIdentityInvalid
    || input.plan?.recordId !== String(this.knowledgeCompositionPlanRecordId || '')
    || input.plan?.planId !== this.planId
    || input.plan?.planVersion !== this.planVersion
    || input.plan?.planFingerprint !== this.planFingerprint
    || input.plan?.resolutionFingerprint !== this.resolutionFingerprint
    || input.plan?.contextFingerprint !== this.contextFingerprint
    || input.stage?.stageKey !== this.stageKey
    || input.stage?.stageOrder !== this.stageOrder
    || this.stageOrder !== expectedStageOrder
    || input.stage?.assignedActivationCount !== this.assignedActivationCount
    || input.stage?.assignedPacks?.length !== this.assignedActivationCount
    || input.lockedTruth?.acceptedSectionCount !== input.lockedTruth?.acceptedSections?.length
    || acceptedTruthIdentityInvalid
    || new Set(expectedTruth).size !== expectedTruth.length
    || new Set(expectedActivations).size !== expectedActivations.length
    || input.consumerIntentFingerprint !== hash(input.consumerIntent)
    || this.inputFingerprint !== hash(input)
    || this.qualityRunId !== expectedQualityRunId
    || sourceInvalid
    || !Number.isFinite(duration)
    || duration < 0
    || duration > 86_400_000
    || duration !== this.durationMs
    || firstAttemptPredecessorInvalid
    || (this.attemptNumber > 1 && (!this.predecessorStageExecutionId || !sha256Pattern.test(this.predecessorAttemptFingerprint)))
    || (succeeded && (!output || failure || !sha256Pattern.test(this.outputFingerprint)))
    || (!succeeded && (output || !failure || this.outputFingerprint))
    || (succeeded && this.outputFingerprint !== hash(output))
    || (succeeded && !outputShapeValid({ stageKey: this.stageKey, output, input }))
    || (succeeded && [
      OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE,
      OUTCOME_QUALITY_STAGES.WORKING_DRAFT,
    ].includes(this.stageKey)
      && (new Set(outputSections.map((section) => section.sectionKey)).size !== outputSections.length
      || outputSections.some((section, index) => section.order !== index + 1
        || new Set(section.truthReferences).size !== section.truthReferences.length
        || new Set(section.contributingActivationIds).size !== section.contributingActivationIds.length
        || section.truthReferences.some((reference) => !expectedTruth.includes(reference))
        || (this.stageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
          && section.contributingActivationIds.some((activationId) => !expectedActivations.includes(activationId))))))
    || (succeeded && stageReferencesInvalid)
    || (succeeded && (new Set(truthRefs).size !== this.truthReferenceCount || new Set(activationRefs).size !== this.contributingActivationCount))
    || (!succeeded && (this.truthReferenceCount !== 0 || this.contributingActivationCount !== 0))
    || (succeeded && providerRequired && (!identity.providerKey
      || !providerConfigurationVersion
      || !identity.model
      || !identity.grrExecutionId
      || !identity.grrRuntimeArtifactId))
    || (succeeded && this.stageKey === OUTCOME_QUALITY_STAGES.FRAMEWORK_GUIDANCE
      && Boolean(findOutcomeFrameworkGuidanceStageClaim(output)))
  if (invalid) return next(shapeError('Outcome quality stage governed shape is inconsistent.'))

  const expectedAttemptFingerprint = hash({
    qualityRunId: this.qualityRunId,
    planId: this.planId,
    planVersion: this.planVersion,
    planFingerprint: this.planFingerprint,
    stageKey: this.stageKey,
    stageOrder: this.stageOrder,
    attemptNumber: this.attemptNumber,
    predecessorStageExecutionId: this.predecessorStageExecutionId,
    predecessorAttemptFingerprint: this.predecessorAttemptFingerprint,
    status: this.status,
    inputFingerprint: this.inputFingerprint,
    outputFingerprint: this.outputFingerprint,
    output: succeeded ? output : undefined,
    failure: succeeded ? undefined : failure,
    executionIdentity: identity,
  })
  if (expectedAttemptFingerprint !== this.attemptFingerprint) {
    return next(shapeError('Outcome quality stage attempt fingerprint is inconsistent.'))
  }
  next()
})

schema.pre('save', function rejectExistingSave(next) {
  if (!this.isNew) return next(immutableError())
  next()
})

for (const operation of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndRemove',
]) {
  schema.pre(operation, function rejectMutation(next) { next(immutableError()) })
}

schema.pre('deleteOne', { document: true, query: false }, function rejectDocumentDelete(next) {
  next(immutableError())
})

export default mongoose.model('OutcomeQualityStageExecution', schema)
