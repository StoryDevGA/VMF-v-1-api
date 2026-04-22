import mongoose from 'mongoose'

export const FRAMEWORK_PACKAGE_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  ACTIVE: 'ACTIVE',
  DEPRECATED: 'DEPRECATED',
})

const frameworkKeyPattern = /^[A-Z][A-Z0-9_]*$/
const semverPattern = /^\d+\.\d+\.\d+$/
const tokenPattern = /^[a-z][a-z0-9-]*$/

const normalizeFrameworkKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()

const normalizeFrameworkName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')

const normalizeVersion = (value) =>
  String(value || '')
    .trim()

const normalizeTokenList = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)

  return [...new Set(normalized)]
}

const stringTokenField = {
  type: String,
  trim: true,
  lowercase: true,
  maxlength: 120,
  match: [tokenPattern, 'Value must use lowercase letters, numbers, or hyphens'],
}

const frameworkPackageSchema = new mongoose.Schema(
  {
    frameworkKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 100,
      match: [frameworkKeyPattern, 'Framework key must use uppercase letters, numbers, or underscores'],
    },
    frameworkName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    version: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
      match: [semverPattern, 'Version must use semantic version format'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(FRAMEWORK_PACKAGE_STATUSES),
      default: FRAMEWORK_PACKAGE_STATUSES.DRAFT,
    },
    isDefault: {
      type: Boolean,
      required: true,
      default: false,
    },
    compatibleWorkflowKeys: [stringTokenField],
    defaultAgentIds: [stringTokenField],
    requiredSkillIds: [stringTokenField],
    capabilities: {
      supportsPreviewMode: {
        type: Boolean,
        default: false,
      },
      supportsFullReport: {
        type: Boolean,
        default: false,
      },
      requiresValidationBeforePublish: {
        type: Boolean,
        default: true,
      },
    },
    validationRules: {
      requiredSections: [stringTokenField],
      publishChecks: [stringTokenField],
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
    activatedAt: {
      type: Date,
      default: null,
    },
    activatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

frameworkPackageSchema.index(
  { frameworkKey: 1, version: 1 },
  { unique: true, name: 'unique_framework_package_version' },
)
frameworkPackageSchema.index(
  { frameworkKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: FRAMEWORK_PACKAGE_STATUSES.ACTIVE },
    name: 'unique_active_framework_package',
  },
)
frameworkPackageSchema.index(
  { frameworkKey: 1, isDefault: 1 },
  {
    unique: true,
    partialFilterExpression: { isDefault: true },
    name: 'unique_default_framework_package',
  },
)
frameworkPackageSchema.index({ compatibleWorkflowKeys: 1, status: 1, updatedAt: -1 })
frameworkPackageSchema.index({ frameworkKey: 1, updatedAt: -1 })
frameworkPackageSchema.index({ status: 1, updatedAt: -1 })

frameworkPackageSchema.statics.findActiveByFrameworkKey = function findActiveByFrameworkKey(frameworkKey) {
  return this.findOne({
    frameworkKey: normalizeFrameworkKey(frameworkKey),
    status: FRAMEWORK_PACKAGE_STATUSES.ACTIVE,
    isDefault: true,
  })
}

frameworkPackageSchema.pre('validate', function normalizeFrameworkPackage(next) {
  if (this.isNew || this.isModified('frameworkKey')) {
    this.frameworkKey = normalizeFrameworkKey(this.frameworkKey)
  }

  if (this.isNew || this.isModified('frameworkName')) {
    this.frameworkName = normalizeFrameworkName(this.frameworkName)
  }

  if (this.isNew || this.isModified('version')) {
    this.version = normalizeVersion(this.version)
  }

  if (this.isNew || this.isModified('compatibleWorkflowKeys')) {
    this.compatibleWorkflowKeys = normalizeTokenList(this.compatibleWorkflowKeys)
  }

  if (this.isNew || this.isModified('defaultAgentIds')) {
    this.defaultAgentIds = normalizeTokenList(this.defaultAgentIds)
  }

  if (this.isNew || this.isModified('requiredSkillIds')) {
    this.requiredSkillIds = normalizeTokenList(this.requiredSkillIds)
  }

  if (this.isNew || this.isModified('validationRules')) {
    const validationRules = this.validationRules || {}
    this.validationRules = {
      requiredSections: normalizeTokenList(validationRules.requiredSections),
      publishChecks: normalizeTokenList(validationRules.publishChecks),
    }
  }

  if (this.isNew || this.isModified('status') || this.isModified('isDefault')) {
    this.isDefault = this.status === FRAMEWORK_PACKAGE_STATUSES.ACTIVE
  }

  next()
})

const FrameworkPackage = mongoose.model('FrameworkPackage', frameworkPackageSchema)

export default FrameworkPackage
