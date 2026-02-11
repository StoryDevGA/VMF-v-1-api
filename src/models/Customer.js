import mongoose from 'mongoose'

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  topology: {
    type: String,
    required: true,
    enum: ['SINGLE_TENANT', 'MULTI_TENANT'],
    default: 'SINGLE_TENANT'
  },
  vmfPolicy: {
    type: String,
    required: true,
    enum: ['SINGLE', 'MULTI', 'PER_TENANT_SINGLE', 'PER_TENANT_MULTI'],
    default: 'SINGLE'
  },
  defaultTenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: function() {
      return this.topology === 'SINGLE_TENANT'
    }
  },
  isServiceProvider: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'DISABLED', 'ARCHIVED'],
    default: 'ACTIVE'
  },
  entitlements: [{
    type: String,
    trim: true
  }],
  billing: {
    planCode: {
      type: String,
      required: true,
      trim: true
    },
    cycle: {
      type: String,
      required: true,
      enum: ['MONTHLY', 'QUARTERLY', 'ANNUAL'],
      default: 'MONTHLY'
    }
  },
  trial: {
    isTrial: {
      type: Boolean,
      default: false
    },
    endsAt: {
      type: Date,
      required: function() {
        return this.trial?.isTrial === true
      }
    }
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
customerSchema.index({ name: 1 })
customerSchema.index({ status: 1, topology: 1 })
customerSchema.index({ status: 1, topology: 1, createdAt: -1 })
customerSchema.index({ createdAt: -1 })
customerSchema.index({ createdBy: 1 })

// Validation middleware
customerSchema.pre('save', function(next) {
  // Validate VMF policy constraints based on topology
  if (this.topology === 'SINGLE_TENANT' && 
      !['SINGLE', 'MULTI'].includes(this.vmfPolicy)) {
    return next(new Error('Single-tenant customers can only have SINGLE or MULTI VMF policy'))
  }
  
  if (this.topology === 'MULTI_TENANT' && 
      !['PER_TENANT_SINGLE', 'PER_TENANT_MULTI'].includes(this.vmfPolicy)) {
    return next(new Error('Multi-tenant customers must have PER_TENANT_SINGLE or PER_TENANT_MULTI VMF policy'))
  }
  
  next()
})

const Customer = mongoose.model('Customer', customerSchema)

export default Customer
