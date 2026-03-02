import mongoose from 'mongoose'

const normalizeLicenseLevelName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

const normalizeFeatureEntitlements = (values) => {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean)

  return [...new Set(normalized)]
}

const licenseLevelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    nameNormalized: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
      select: false,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    featureEntitlements: [
      {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 100,
      },
    ],
    isActive: {
      type: Boolean,
      required: true,
      default: true,
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
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        delete ret.nameNormalized
        return ret
      },
    },
  },
)

licenseLevelSchema.index({ nameNormalized: 1 }, { unique: true, name: 'unique_license_level_name' })
licenseLevelSchema.index({ isActive: 1, createdAt: -1 })
licenseLevelSchema.index({ createdAt: -1 })

licenseLevelSchema.pre('validate', function setNormalizedFields(next) {
  if (this.isNew || this.isModified('name') || !this.nameNormalized) {
    this.nameNormalized = normalizeLicenseLevelName(this.name)
  }

  if (this.isNew || this.isModified('featureEntitlements')) {
    this.featureEntitlements = normalizeFeatureEntitlements(this.featureEntitlements)
  }

  next()
})

const LicenseLevel = mongoose.model('LicenseLevel', licenseLevelSchema)

export default LicenseLevel
