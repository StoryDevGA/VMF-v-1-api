import mongoose from 'mongoose'

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
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'DISABLED', 'ARCHIVED'],
    default: 'ACTIVE'
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
vmfSchema.index({ createdBy: 1 })

// Static methods
vmfSchema.statics.findByTenant = function(tenantId, status = null) {
  const query = { tenantId }
  if (status) query.status = status
  return this.find(query).populate('createdBy', 'name email')
}

vmfSchema.statics.findByCustomer = function(customerId, status = null) {
  const query = { customerId }
  if (status) query.status = status
  return this.find(query).populate('tenantId', 'name').populate('createdBy', 'name email')
}

vmfSchema.statics.countByTenant = function(tenantId, status = 'ACTIVE') {
  return this.countDocuments({ tenantId, status })
}

// Instance methods
vmfSchema.methods.isActive = function() {
  return this.status === 'ACTIVE'
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