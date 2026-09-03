import mongoose from 'mongoose'

const sha256Pattern = /^[a-f0-9]{64}$/
const tokenPattern = /^[a-z0-9](?:[a-z0-9._-]{0,198}[a-z0-9])?$/

const immutableString = ({ maxlength, lowercase = false, uppercase = false, match } = {}) => ({
  type: String,
  required: true,
  immutable: true,
  trim: true,
  ...(lowercase ? { lowercase: true } : {}),
  ...(uppercase ? { uppercase: true } : {}),
  ...(maxlength ? { maxlength } : {}),
  ...(match ? { match } : {}),
})

const runtimeSupportAssetSchema = new mongoose.Schema({
  stableId: {
    type: String,
    required: true,
    immutable: true,
    trim: true,
    lowercase: true,
    maxlength: 500,
    unique: true,
  },
  frameworkKey: immutableString({ maxlength: 80, uppercase: true }),
  packageKey: immutableString({ maxlength: 200, lowercase: true, match: tokenPattern }),
  packageVersion: immutableString({ maxlength: 50 }),
  assetKey: immutableString({ maxlength: 200, lowercase: true, match: tokenPattern }),
  ownerType: {
    ...immutableString({ maxlength: 80 }),
    enum: ['RuntimeSkill'],
  },
  ownerKey: immutableString({ maxlength: 200, lowercase: true, match: tokenPattern }),
  assetType: immutableString({ maxlength: 60, uppercase: true }),
  mimeType: {
    ...immutableString({ maxlength: 140, lowercase: true }),
    enum: ['text/markdown', 'text/plain', 'application/json'],
  },
  status: {
    ...immutableString({ maxlength: 40, uppercase: true }),
    enum: ['ACTIVE'],
  },
  runtimeAccessible: { type: Boolean, required: true, immutable: true, default: true },
  storageKey: immutableString({ maxlength: 500 }),
  byteLength: { type: Number, required: true, immutable: true, min: 1, max: 64 * 1024 },
  contentHash: {
    ...immutableString({ maxlength: 64, lowercase: true }),
    match: sha256Pattern,
  },
  content: {
    type: String,
    required: true,
    immutable: true,
    select: false,
    maxlength: 64 * 1024,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    immutable: true,
  },
}, {
  collection: 'runtime_support_assets',
  timestamps: { createdAt: true, updatedAt: false },
})

runtimeSupportAssetSchema.index(
  { packageKey: 1, packageVersion: 1, assetKey: 1 },
  { unique: true, name: 'unique_runtime_support_asset_package_identity' },
)
runtimeSupportAssetSchema.index(
  { packageKey: 1, packageVersion: 1, ownerKey: 1 },
  { name: 'runtime_support_assets_by_package_owner' },
)

const RuntimeSupportAsset = mongoose.model('RuntimeSupportAsset', runtimeSupportAssetSchema)

export { runtimeSupportAssetSchema }
export default RuntimeSupportAsset
