import mongoose from 'mongoose'

import { OUTCOME_KNOWLEDGE_PACK_TYPES } from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_PACK_LAYERS,
  KNOWLEDGE_PACK_BOUNDARIES,
  KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES,
  KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
  KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS,
  KNOWLEDGE_PACK_RELATIONSHIP_TYPES,
} from '../constants/knowledgeRuntime.js'
import { WORKSPACE_TYPES } from '../constants/workspaceGovernance.js'
import {
  buildKnowledgePackRelationshipChecksum,
  normalizeKnowledgeAssetId,
  normalizeKnowledgePackRelationship,
  normalizeKnowledgePackRelationships,
} from '../services/knowledgePackRelationshipContract.js'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

export const knowledgePackLayerField = {
  type: String,
  uppercase: true,
  enum: Object.values(KNOWLEDGE_PACK_LAYERS),
  default: undefined,
}

export const knowledgePackBoundaryField = {
  type: String,
  uppercase: true,
  enum: Object.values(KNOWLEDGE_PACK_BOUNDARIES),
  default: undefined,
}

export const knowledgePackCapabilityKeyField = {
  type: String,
  trim: true,
  lowercase: true,
  maxlength: 140,
  default: undefined,
}

export const knowledgePackKnowledgeAssetIdField = {
  type: String,
  trim: true,
  uppercase: true,
  maxlength: 128,
  default: undefined,
}

export const knowledgePackWorkspaceCompatibilityField = {
  type: [{
    type: String,
    uppercase: true,
    enum: Object.values(WORKSPACE_TYPES),
  }],
  default: undefined,
}

const knowledgePackVersionConstraintSchema = new mongoose.Schema(
  {
    exactVersion: { type: String, trim: true, maxlength: 60, default: undefined },
    minimumVersionInclusive: { type: String, trim: true, maxlength: 60, default: undefined },
    maximumVersionExclusive: { type: String, trim: true, maxlength: 60, default: undefined },
  },
  { _id: false, strict: 'throw' },
)

export const knowledgePackDependencyReferenceSchema = new mongoose.Schema(
  {
    relationshipType: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_RELATIONSHIP_TYPES),
    },
    targetPackType: {
      type: String,
      uppercase: true,
      enum: Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES),
      default: undefined,
    },
    targetPackKey: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 140,
      default: undefined,
    },
    targetCapabilityKey: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 140,
      default: undefined,
    },
    targetKnowledgeAssetId: knowledgePackKnowledgeAssetIdField,
    targetKnowledgeLayer: knowledgePackLayerField,
    requiredAt: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_RELATIONSHIP_TIMINGS),
    },
    cardinality: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_RELATIONSHIP_CARDINALITIES),
    },
    versionConstraint: {
      type: knowledgePackVersionConstraintSchema,
      default: undefined,
    },
  },
  { _id: false, strict: 'throw' },
)

knowledgePackDependencyReferenceSchema.pre('validate', function normalizeRelationship(next) {
  try {
    const normalized = normalizeKnowledgePackRelationship(this.toObject({ depopulate: true }))
    this.set(normalized)
    next()
  } catch (error) {
    this.invalidate('relationshipType', error.message)
    next()
  }
})

export const normalizeKnowledgePackGovernanceFields = (
  document,
  { includeDependencies = false } = {},
) => {
  if (document.knowledgeLayer !== undefined) {
    document.knowledgeLayer = normalizeToken(document.knowledgeLayer) || undefined
  }
  if (document.boundary !== undefined) {
    document.boundary = normalizeToken(document.boundary) || undefined
  }
  if (document.capabilityKey !== undefined) {
    document.capabilityKey = normalizeLowerKey(document.capabilityKey) || undefined
  }
  if (document.knowledgeAssetId !== undefined) {
    document.knowledgeAssetId = normalizeKnowledgeAssetId(document.knowledgeAssetId) || undefined
  }
  if (document.workspaceCompatibility !== undefined) {
    document.workspaceCompatibility = Array.isArray(document.workspaceCompatibility)
      ? [...new Set(document.workspaceCompatibility.map(normalizeToken).filter(Boolean))]
      : undefined
  }
  if (includeDependencies) {
    document.relationshipContractVersion = normalizeToken(
      document.relationshipContractVersion || KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION,
    )
    if (document.relationshipContractVersion !== KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION) {
      document.invalidate(
        'relationshipContractVersion',
        `relationshipContractVersion must be ${KNOWLEDGE_PACK_RELATIONSHIP_CONTRACT_VERSION}.`,
      )
    }
    try {
      const relationships = normalizeKnowledgePackRelationships(
        document.dependencyReferences === undefined ? [] : document.dependencyReferences,
      )
      document.dependencyReferences = relationships
      document.relationshipChecksum = buildKnowledgePackRelationshipChecksum(relationships)
    } catch (error) {
      document.invalidate('dependencyReferences', error.message)
    }
  }
}
