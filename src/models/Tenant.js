import mongoose from 'mongoose'

const tenantSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  website: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
    match: [/^https?:\/\/.+/, 'Website must be a valid URL starting with http:// or https://']
  },
  status: {
    type: String,
    required: true,
    enum: ['ENABLED', 'DISABLED', 'ARCHIVED'],
    default: 'ENABLED'
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  tenantAdminUserIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }]
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
tenantSchema.index({ customerId: 1, name: 1 })
tenantSchema.index({ customerId: 1, status: 1 })
tenantSchema.index({ customerId: 1, isDefault: 1 })
tenantSchema.index({ tenantAdminUserIds: 1 })

// Static methods
tenantSchema.statics.findByCustomer = function(customerId, status = null) {
  const query = { customerId }
  if (status) query.status = status
  return this.find(query).populate('tenantAdminUserIds', 'name email isActive')
}

tenantSchema.statics.findDefaultTenant = function(customerId) {
  return this.findOne({ customerId, isDefault: true })
}

tenantSchema.statics.findEnabledTenants = function(customerId) {
  return this.find({ customerId, status: 'ENABLED' })
}

// Instance methods
tenantSchema.methods.isEnabled = function() {
  return this.status === 'ENABLED'
}

tenantSchema.methods.hasActiveAdmin = function() {
  // This would typically be populated and checked
  // For now, we assume at least one admin exists
  return this.tenantAdminUserIds && this.tenantAdminUserIds.length > 0
}

// Validation middleware
tenantSchema.pre('save', function(next) {
  // Ensure default tenants are always enabled initially
  if (this.isDefault && this.isNew && this.status !== 'ENABLED') {
    return next(new Error('Default tenants must be enabled'))
  }
  
  // Ensure tenant admin requirements
  if (this.tenantAdminUserIds.length === 0) {
    return next(new Error('Tenant must have at least one admin user'))
  }
  
  next()
})

// Prevent deletion of default tenants
tenantSchema.pre('deleteOne', { document: true, query: false }, function(next) {
  if (this.isDefault) {
    return next(new Error('Cannot delete default tenant'))
  }
  next()
})

tenantSchema.pre('findOneAndDelete', function(next) {
  this.where({ isDefault: { $ne: true } })
  next()
})

// Compound indexes to ensure uniqueness
tenantSchema.index(
  { customerId: 1, isDefault: 1 },
  { 
    unique: true, 
    partialFilterExpression: { isDefault: true },
    name: 'unique_default_tenant_per_customer'
  }
)

const Tenant = mongoose.model('Tenant', tenantSchema)

export default Tenant