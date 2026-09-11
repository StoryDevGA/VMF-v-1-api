import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'FrameworkPackage', required: true },
  uiContractKey: { type: String, required: true, trim: true, lowercase: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, strict: 'throw' })
schema.index({ packageId: 1 }, { unique: true })

export default mongoose.model('FrameworkPackageDisplayBinding', schema)
