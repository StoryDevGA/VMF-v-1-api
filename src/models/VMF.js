import mongoose from 'mongoose'

const LIFECYCLE_STATUSES = ['DRAFT', 'CANONISED', 'PUBLISHED']

const vmfSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: '',
  },
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'DISABLED', 'ARCHIVED'],
    default: 'ACTIVE'
  },
  lifecycleStatus: {
    type: String,
    required: true,
    enum: LIFECYCLE_STATUSES,
    default: 'DRAFT',
  },
  frameworkVersion: {
    type: String,
    trim: true,
    maxlength: 100,
    default: null,
  },
  versionPolicyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SystemVersioningPolicy',
    default: null,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  purgeAfter: {
    type: Date,
    default: null,
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id
      delete ret._id
      delete ret.__v
      return ret
    }
  }
})

// Indexes for performance
vmfSchema.index({ tenantId: 1, name: 1 })
vmfSchema.index({ customerId: 1, tenantId: 1 })
vmfSchema.index({ tenantId: 1, status: 1 })
vmfSchema.index({ customerId: 1, tenantId: 1, status: 1, createdAt: -1 })
vmfSchema.index({ customerId: 1, tenantId: 1, createdAt: -1 })
vmfSchema.index({ customerId: 1, tenantId: 1, deletedAt: 1, createdAt: -1 })
vmfSchema.index({ purgeAfter: 1, deletedAt: 1 })
vmfSchema.index({ createdBy: 1 })

// Static methods
vmfSchema.statics.findByTenant = function(tenantId, status = null, options = {}) {
  const { includeDeleted = false } = options
  const query = { tenantId }
  if (status) query.status = status
  if (!includeDeleted) query.deletedAt = null
  return this.find(query).populate('createdBy', 'name email')
}

vmfSchema.statics.findByCustomer = function(customerId, status = null, options = {}) {
  const { includeDeleted = false } = options
  const query = { customerId }
  if (status) query.status = status
  if (!includeDeleted) query.deletedAt = null
  return this.find(query).populate('tenantId', 'name').populate('createdBy', 'name email')
}

vmfSchema.statics.countByTenant = function(tenantId, status = 'ACTIVE') {
  return this.countDocuments({ tenantId, status, deletedAt: null })
}

// Instance methods
vmfSchema.methods.isActive = function() {
  return this.status === 'ACTIVE' && !this.deletedAt
}

vmfSchema.methods.isDeleted = function() {
  return Boolean(this.deletedAt)
}

// Pre-save validation
vmfSchema.pre('save', async function(next) {
  if (!this.isNew) return next()
  
  try {
    // Check VMF policy constraints
    const Customer = mongoose.model('Customer')
    const customer = await Customer.findById(this.customerId)
    
    if (!customer) {
      return next(new Error('Customer not found'))
    }
    
    const existingVmfCount = await mongoose.model('VMF').countByTenant(this.tenantId)
    
    // Enforce VMF policy constraints
    if (customer.vmfPolicy === 'SINGLE' && existingVmfCount >= 1) {
      return next(new Error('Customer policy allows only one VMF'))
    }
    
    if (customer.vmfPolicy === 'PER_TENANT_SINGLE' && existingVmfCount >= 1) {
      return next(new Error('Customer policy allows only one VMF per tenant'))
    }
    
    next()
  } catch (error) {
    next(error)
  }
})

// Cascade delete prevention for active VMFs with deals
vmfSchema.pre('deleteOne', { document: true, query: false }, async function(next) {
  try {
    const Deal = mongoose.model('Deal')
    const activeDealsCount = await Deal.countDocuments({ 
      vmfId: this._id, 
      status: 'ACTIVE' 
    })
    
    if (activeDealsCount > 0) {
      return next(new Error('Cannot delete VMF with active deals. Archive deals first.'))
    }
    
    next()
  } catch (error) {
    next(error)
  }
})

const VMF = mongoose.model('VMF', vmfSchema)

export default VMF
