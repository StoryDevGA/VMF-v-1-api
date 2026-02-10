import mongoose from 'mongoose'

const dealSchema = new mongoose.Schema({
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
  vmfId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VMF',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  stage: {
    type: String,
    trim: true,
    maxlength: 100
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'ARCHIVED'],
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
dealSchema.index({ vmfId: 1, updatedAt: -1 })
dealSchema.index({ tenantId: 1, vmfId: 1 })
dealSchema.index({ customerId: 1, status: 1 })
dealSchema.index({ createdBy: 1, status: 1 })
dealSchema.index({ status: 1, updatedAt: -1 })

// Text index for searching deals
dealSchema.index({ 
  title: 'text', 
  stage: 'text' 
}, {
  name: 'deal_text_search'
})

// Static methods
dealSchema.statics.findByVmf = function(vmfId, status = null) {
  const query = { vmfId }
  if (status) query.status = status
  return this.find(query)
    .populate('createdBy', 'name email')
    .sort({ updatedAt: -1 })
}

dealSchema.statics.findByTenant = function(tenantId, status = null) {
  const query = { tenantId }
  if (status) query.status = status
  return this.find(query)
    .populate('vmfId', 'name')
    .populate('createdBy', 'name email')
    .sort({ updatedAt: -1 })
}

dealSchema.statics.findByCustomer = function(customerId, status = null) {
  const query = { customerId }
  if (status) query.status = status
  return this.find(query)
    .populate('tenantId', 'name')
    .populate('vmfId', 'name')
    .populate('createdBy', 'name email')
    .sort({ updatedAt: -1 })
}

dealSchema.statics.countByVmf = function(vmfId, status = 'ACTIVE') {
  return this.countDocuments({ vmfId, status })
}

dealSchema.statics.searchDeals = function(vmfId, searchTerm, status = null) {
  const query = { 
    vmfId,
    $text: { $search: searchTerm }
  }
  if (status) query.status = status
  
  return this.find(query, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' }, updatedAt: -1 })
    .populate('createdBy', 'name email')
}

// Instance methods
dealSchema.methods.isActive = function() {
  return this.status === 'ACTIVE'
}

dealSchema.methods.archive = function() {
  this.status = 'ARCHIVED'
  return this.save()
}

dealSchema.methods.restore = function() {
  this.status = 'ACTIVE'
  return this.save()
}

// Pre-save validation
dealSchema.pre('save', async function(next) {
  try {
    // Verify VMF exists and is active
    const VMF = mongoose.model('VMF')
    const vmf = await VMF.findById(this.vmfId)
    
    if (!vmf) {
      return next(new Error('VMF not found'))
    }
    
    if (vmf.status !== 'ACTIVE') {
      return next(new Error('Cannot create deals in inactive VMF'))
    }
    
    // Verify tenant is enabled
    const Tenant = mongoose.model('Tenant')
    const tenant = await Tenant.findById(this.tenantId)
    
    if (!tenant) {
      return next(new Error('Tenant not found'))
    }
    
    if (tenant.status !== 'ENABLED') {
      return next(new Error('Cannot create deals in disabled tenant'))
    }
    
    next()
  } catch (error) {
    next(error)
  }
})

const Deal = mongoose.model('Deal', dealSchema)

export default Deal