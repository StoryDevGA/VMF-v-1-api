import mongoose from 'mongoose'

const DUPLICATE_CUSTOMER_NAME_MESSAGE = 'A customer with this name already exists.'

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const normalizeCustomerName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

const buildCustomerNameRegex = (normalizedName) =>
  `^${normalizedName
    .split(' ')
    .filter(Boolean)
    .map((token) => escapeRegex(token))
    .join('\\s+')}$`

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  nameNormalized: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255,
    select: false,
  },
  website: {
    type: String,
    trim: true,
    maxlength: 500,
    match: [/^https?:\/\/.+/, 'Must be a valid URL starting with http:// or https://'],
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
      delete ret.nameNormalized
      return ret
    }
  }
})

// Indexes for performance
customerSchema.index({ name: 1 })
customerSchema.index({ nameNormalized: 1 }, { unique: true, name: 'unique_customer_name_normalized' })
customerSchema.index({ status: 1, topology: 1 })
customerSchema.index({ status: 1, topology: 1, createdAt: -1 })
customerSchema.index({ createdAt: -1 })
customerSchema.index({ createdBy: 1 })

customerSchema.pre('validate', function(next) {
  if (this.isNew || this.isModified('name') || !this.nameNormalized) {
    this.nameNormalized = normalizeCustomerName(this.name)
  }
  next()
})

// Validation middleware
customerSchema.pre('save', async function(next) {
  try {
    // Validate VMF policy constraints based on topology
    if (this.topology === 'SINGLE_TENANT' && 
        !['SINGLE', 'MULTI'].includes(this.vmfPolicy)) {
      return next(new Error('Single-tenant customers can only have SINGLE or MULTI VMF policy'))
    }
    
    if (this.topology === 'MULTI_TENANT' && 
        !['PER_TENANT_SINGLE', 'PER_TENANT_MULTI'].includes(this.vmfPolicy)) {
      return next(new Error('Multi-tenant customers must have PER_TENANT_SINGLE or PER_TENANT_MULTI VMF policy'))
    }

    // Enforce normalized-name uniqueness even when DB index is unavailable.
    if (this.isNew || this.isModified('nameNormalized')) {
      const existing = await this.constructor.findOne({
        _id: { $ne: this._id },
        $or: [
          { nameNormalized: this.nameNormalized },
          { name: { $regex: buildCustomerNameRegex(this.nameNormalized), $options: 'i' } },
        ],
      }).select('_id')

      if (existing) {
        const err = new Error(DUPLICATE_CUSTOMER_NAME_MESSAGE)
        err.code = 'DUPLICATE_CUSTOMER_NAME'
        err.status = 409
        return next(err)
      }
    }

    next()
  } catch (err) {
    next(err)
  }
})

const Customer = mongoose.model('Customer', customerSchema)

export default Customer
