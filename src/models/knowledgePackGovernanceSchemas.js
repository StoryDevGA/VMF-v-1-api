import mongoose from 'mongoose'

import { OUTCOME_KNOWLEDGE_PACK_TYPES } from '../constants/outcomeKnowledgePacks.js'
import {
  KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS,
  KNOWLEDGE_PACK_LAYERS,
} from '../constants/knowledgeRuntime.js'
import { WORKSPACE_TYPES } from '../constants/workspaceGovernance.js'

const normalizeText = (value) => String(value || '').trim()
const normalizeToken = (value) => normalizeText(value).toUpperCase()
const normalizeLowerKey = (value) => normalizeText(value).toLowerCase()

export const knowledgePackLayerField = {
  type: String,
  uppercase: true,
  enum: Object.values(KNOWLEDGE_PACK_LAYERS),
  default: undefined,
}

export const knowledgePackCapabilityKeyField = {
  type: String,
  trim: true,
  lowercase: true,
  maxlength: 140,
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

export const knowledgePackDependencyReferenceSchema = new mongoose.Schema(
  {
    knowledgeLayer: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_LAYERS),
    },
    requirement: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS),
      default: KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.REQUIRED,
    },
    packType: {
      type: String,
      uppercase: true,
      enum: Object.values(OUTCOME_KNOWLEDGE_PACK_TYPES),
      default: undefined,
    },
    packKey: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 140,
      default: undefined,
    },
    capabilityKey: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 140,
      default: undefined,
    },
  },
  {
    _id: false,
  },
)

knowledgePackDependencyReferenceSchema.pre('validate', function normalizeDependencyReference(next) {
  this.knowledgeLayer = normalizeToken(this.knowledgeLayer)
  this.requirement = normalizeToken(
    this.requirement || KNOWLEDGE_PACK_DEPENDENCY_REQUIREMENTS.REQUIRED,
  )
  this.packType = normalizeToken(this.packType) || undefined
  this.packKey = normalizeLowerKey(this.packKey) || undefined
  this.capabilityKey = normalizeLowerKey(this.capabilityKey) || undefined

  const hasPackType = Boolean(this.packType)
  const hasPackKey = Boolean(this.packKey)
  const hasExactIdentity = hasPackType && hasPackKey
  const hasCapability = Boolean(this.capabilityKey)

  if (hasPackType !== hasPackKey) {
    this.invalidate(
      'packKey',
      'Knowledge Pack dependency identity requires both packType and packKey.',
    )
  }
  if (hasExactIdentity === hasCapability) {
    this.invalidate(
      'capabilityKey',
      'Knowledge Pack dependency must use exactly one selector: packType plus packKey, or capabilityKey.',
    )
  }

  next()
})

export const normalizeKnowledgePackGovernanceFields = (
  document,
  { includeDependencies = false } = {},
) => {
  if (document.knowledgeLayer !== undefined) {
    document.knowledgeLayer = normalizeToken(document.knowledgeLayer) || undefined
  }
  if (document.capabilityKey !== undefined) {
    document.capabilityKey = normalizeLowerKey(document.capabilityKey) || undefined
  }
  if (document.workspaceCompatibility !== undefined) {
    document.workspaceCompatibility = Array.isArray(document.workspaceCompatibility)
      ? [...new Set(document.workspaceCompatibility.map(normalizeToken).filter(Boolean))]
      : undefined
  }
  if (includeDependencies && document.dependencyReferences !== undefined) {
    document.dependencyReferences = Array.isArray(document.dependencyReferences)
      ? document.dependencyReferences
      : undefined
  }
}
