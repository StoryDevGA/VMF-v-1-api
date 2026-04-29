import mongoose from 'mongoose'

export const UI_CONTRACT_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DEPRECATED: 'DEPRECATED',
})

export const UI_CONTRACT_COMPATIBILITY_MODES = Object.freeze({
  STRICT: 'STRICT',
  INHERITED_MINOR: 'INHERITED_MINOR',
  OPEN: 'OPEN',
})

const keyPattern = /^[a-z][a-z0-9-]*$/
const stableIdPattern = /^ui-contract-[a-z][a-z0-9-]*$/
const frameworkKeyPattern = /^[A-Z][A-Z0-9_]*$/
const semverPattern = /^\d+\.\d+\.\d+$/

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')

const normalizeTokenList = (values, { upper = false } = {}) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim())
    .map((value) => (upper ? value.toUpperCase() : value))
    .filter(Boolean)

  return [...new Set(normalized)]
}

export const buildUIContractStableId = (uiContractKey) => {
  const normalized = String(uiContractKey || '').trim().toLowerCase()
  return `ui-contract-${normalized}`
}

const uiContractSectionSchema = new mongoose.Schema(
  {
    sectionKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    runtimePath: {
      type: String,
      trim: true,
      maxlength: 240,
      default: '',
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    shortLabel: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    helpText: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    placeholder: {
      type: String,
      trim: true,
      maxlength: 250,
      default: '',
    },
    displayOrder: {
      type: Number,
      min: 0,
      max: 10000,
      required: true,
      default: 0,
    },
    isVisible: {
      type: Boolean,
      default: true,
    },
    isRequiredDisplay: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
)

const uiContractLifecycleStageSchema = new mongoose.Schema(
  {
    stageKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 120,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 250,
      default: '',
    },
    badgeLabel: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    displayOrder: {
      type: Number,
      min: 0,
      max: 10000,
      required: true,
      default: 0,
    },
    isVisible: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false },
)

const uiContractActionSchema = new mongoose.Schema(
  {
    actionKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 120,
    },
    buttonLabel: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    confirmationMessage: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    successMessage: {
      type: String,
      trim: true,
      maxlength: 250,
      default: '',
    },
    failureMessage: {
      type: String,
      trim: true,
      maxlength: 250,
      default: '',
    },
    displayOrder: {
      type: Number,
      min: 0,
      max: 10000,
      required: true,
      default: 0,
    },
    isVisible: {
      type: Boolean,
      default: true,
    },
    requiresConfirmation: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
)

const uiContractSchema = new mongoose.Schema(
  {
    stableId: {
      type: String,
      required: true,
      default: function defaultStableId() {
        return buildUIContractStableId(this.uiContractKey)
      },
      trim: true,
      lowercase: true,
      immutable: true,
      maxlength: 180,
      match: [stableIdPattern, 'Stable id must use ui-contract-<key> format.'],
    },
    uiContractKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      immutable: true,
      maxlength: 140,
      match: [keyPattern, 'UI contract key must use lowercase letters, numbers, or hyphens.'],
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 800,
      default: '',
    },
    status: {
      type: String,
      enum: Object.values(UI_CONTRACT_STATUSES),
      default: UI_CONTRACT_STATUSES.DRAFT,
    },
    frameworkKeys: {
      type: [String],
      required: true,
      validate: [
        {
          validator(values) {
            return Array.isArray(values) && values.length > 0
          },
          message: 'At least one framework key is required.',
        },
        {
          validator(values) {
            return Array.isArray(values) && values.every((value) => frameworkKeyPattern.test(String(value || '').trim().toUpperCase()))
          },
          message: 'Framework keys must use uppercase letters, numbers, or underscores.',
        },
      ],
    },
    introducedInVersion: {
      type: String,
      trim: true,
      maxlength: 50,
      default: '',
      validate: {
        validator(value) {
          return !value || semverPattern.test(String(value).trim())
        },
        message: 'Introduced version must use semantic version format.',
      },
    },
    deprecatedInVersion: {
      type: String,
      trim: true,
      maxlength: 50,
      default: '',
      validate: {
        validator(value) {
          return !value || semverPattern.test(String(value).trim())
        },
        message: 'Deprecated version must use semantic version format.',
      },
    },
    compatibilityTags: {
      type: [String],
      default: [],
    },
    compatibilityMode: {
      type: String,
      enum: Object.values(UI_CONTRACT_COMPATIBILITY_MODES),
      default: UI_CONTRACT_COMPATIBILITY_MODES.INHERITED_MINOR,
    },
    sections: [uiContractSectionSchema],
    lifecycleStages: [uiContractLifecycleStageSchema],
    actions: [uiContractActionSchema],
    isSystem: {
      type: Boolean,
      default: false,
    },
    isProtected: {
      type: Boolean,
      default: false,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    clonedFromStableId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: '',
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
    collection: 'uicontracts',
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

uiContractSchema.index({ stableId: 1 }, { unique: true, name: 'unique_ui_contract_stable_id' })
uiContractSchema.index({ uiContractKey: 1 }, { unique: true, name: 'unique_ui_contract_key' })
uiContractSchema.index({ frameworkKeys: 1, status: 1, updatedAt: -1 })
uiContractSchema.index({ status: 1, updatedAt: -1 })

uiContractSchema.statics.findByStableId = function findByStableId(stableId) {
  return this.findOne({ stableId: String(stableId || '').trim().toLowerCase() })
}

uiContractSchema.pre('validate', function normalizeUIContract(next) {
  if (this.isNew || this.isModified('uiContractKey')) {
    this.uiContractKey = String(this.uiContractKey || '').trim().toLowerCase()
  }

  if (this.isNew || this.isModified('name')) {
    this.name = normalizeText(this.name)
  }

  if (this.isNew || this.isModified('description')) {
    this.description = normalizeText(this.description)
  }

  if (this.isNew || this.isModified('frameworkKeys')) {
    this.frameworkKeys = normalizeTokenList(this.frameworkKeys, { upper: true })
  }

  if (this.isNew || this.isModified('compatibilityTags')) {
    this.compatibilityTags = normalizeTokenList(this.compatibilityTags)
  }

  const ensureUnique = (items, getKey, path, message) => {
    if (!Array.isArray(items)) return
    const seen = new Set()
    items.forEach((item, index) => {
      const key = getKey(item)
      if (!key) return
      if (seen.has(key)) {
        this.invalidate(`${path}.${index}`, message)
      }
      seen.add(key)
    })
  }

  ensureUnique(
    this.sections,
    (section) => String(section?.sectionKey || '').trim().toLowerCase(),
    'sections',
    'Section keys must be unique.',
  )
  ensureUnique(
    this.lifecycleStages,
    (stage) => String(stage?.stageKey || '').trim().toUpperCase(),
    'lifecycleStages',
    'Lifecycle stage keys must be unique.',
  )
  ensureUnique(
    this.actions,
    (action) => String(action?.actionKey || '').trim().toUpperCase(),
    'actions',
    'Action keys must be unique.',
  )

  next()
})

const UIContract = mongoose.model('UIContract', uiContractSchema)

export default UIContract
