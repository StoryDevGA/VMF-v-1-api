import mongoose from 'mongoose'
import {
  applyRuntimeControlVersioning,
  RUNTIME_CONTROL_COMPATIBILITY_MODES,
  RUNTIME_CONTROL_LOCK_IMPACTING_FIELDS,
} from '../utils/runtimeControlVersioning.js'

export const SKILL_ROLE_REGISTRY_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DEPRECATED: 'DEPRECATED',
})

const stableIdPattern = /^role-[a-z0-9][a-z0-9-]*$/
const roleKeyPattern = /^[A-Z][A-Z0-9_]*$/

const normalizeName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')

const normalizeStableKeySegment = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

export const buildSkillRoleRegistryStableId = (roleKey) =>
  `role-${normalizeStableKeySegment(roleKey).slice(0, 160)}`

const skillRoleRegistrySchema = new mongoose.Schema(
  {
    stableId: {
      type: String,
      required: true,
      default: function defaultStableId() {
        return buildSkillRoleRegistryStableId(this.roleKey)
      },
      trim: true,
      lowercase: true,
      immutable: true,
      maxlength: 180,
      match: [stableIdPattern, 'Skill role id must use the stable role-<token> format'],
    },
    roleKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      immutable: true,
      validate: {
        validator(value) {
          return roleKeyPattern.test(String(value || '').trim().toUpperCase())
        },
        message: 'Role key must use uppercase letters, numbers, or underscores.',
      },
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 800,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(SKILL_ROLE_REGISTRY_STATUSES),
      default: SKILL_ROLE_REGISTRY_STATUSES.ACTIVE,
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = ret.stableId
        delete ret.stableId
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

skillRoleRegistrySchema.index({ stableId: 1 }, { unique: true, name: 'unique_skill_role_registry_stable_id' })
skillRoleRegistrySchema.index({ roleKey: 1 }, { unique: true, name: 'unique_skill_role_registry_role_key' })
skillRoleRegistrySchema.index({ status: 1, updatedAt: -1 })

skillRoleRegistrySchema.statics.findByStableId = function findByStableId(stableId) {
  return this.findOne({ stableId: String(stableId || '').trim().toLowerCase() })
}

skillRoleRegistrySchema.pre('validate', function normalizeSkillRoleRegistry(next) {
  if (this.isNew || this.isModified('roleKey')) {
    this.roleKey = String(this.roleKey || '').trim().toUpperCase()
  }

  if (this.isNew || this.isModified('label')) {
    this.label = normalizeName(this.label)
  }

  if (this.isNew || this.isModified('description')) {
    this.description = normalizeName(this.description)
  }

  if (this.isNew || !this.stableId) {
    this.stableId = buildSkillRoleRegistryStableId(this.roleKey)
  }

  next()
})

applyRuntimeControlVersioning(skillRoleRegistrySchema, {
  lockImpactingFields: RUNTIME_CONTROL_LOCK_IMPACTING_FIELDS.SkillRoleRegistry,
  compatibilityModeDefault: RUNTIME_CONTROL_COMPATIBILITY_MODES.OPEN,
})

const SkillRoleRegistry = mongoose.model('SkillRoleRegistry', skillRoleRegistrySchema)

export default SkillRoleRegistry
