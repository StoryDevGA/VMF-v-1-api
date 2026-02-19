import mongoose from 'mongoose'

const systemVersioningPolicySchema = new mongoose.Schema(
  {
    version: { type: Number, required: true, default: 1 },
    name: { type: String, required: true, trim: true, maxlength: 255 },
    description: { type: String, trim: true, maxlength: 1000 },
    rules: { type: mongoose.Schema.Types.Mixed, required: true },
    isActive: { type: Boolean, required: true, default: true },
    activatedAt: { type: Date },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    supersededBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SystemVersioningPolicy' },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

systemVersioningPolicySchema.index(
  { isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true }, name: 'unique_active_policy' },
)
systemVersioningPolicySchema.index({ version: -1 })
systemVersioningPolicySchema.index({ createdAt: -1 })

systemVersioningPolicySchema.statics.findActive = function findActive() {
  return this.findOne({ isActive: true }).sort({ version: -1 })
}

systemVersioningPolicySchema.pre('save', async function preSave(next) {
  try {
    if (this.isNew) {
      const latest = await this.constructor.findOne().sort({ version: -1 }).select('version')
      this.version = latest ? latest.version + 1 : 1
    }
    next()
  } catch (err) {
    next(err)
  }
})

const SystemVersioningPolicy = mongoose.model(
  'SystemVersioningPolicy',
  systemVersioningPolicySchema,
)

export default SystemVersioningPolicy
