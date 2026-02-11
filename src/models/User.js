import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 255,
    match: [/^\S+@\S+\.\S+$/, 'Invalid email format']
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  passwordHash: {
    type: String,
    select: false // Don't include in queries by default
  },
  isActive: {
    type: Boolean,
    required: true,
    default: true
  },
  identityPlus: {
    externalId: {
      type: String,
      trim: true
    },
    trustStatus: {
      type: String,
      required: true,
      enum: ['UNTRUSTED', 'TRUSTED', 'REVOKED'],
      default: 'UNTRUSTED'
    },
    invitedAt: {
      type: Date
    },
    trustedAt: {
      type: Date
    }
  },
  memberships: [{
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null  // null = platform-level membership (e.g. SUPER_ADMIN)
    },
    roles: [{
      type: String,
      required: true,
      trim: true
    }]
  }],
  tenantMemberships: [{
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
    roles: [{
      type: String,
      required: true,
      trim: true
    }]
  }],
  vmfGrants: [{
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
    permissions: [{
      type: String,
      required: true,
      trim: true
    }]
  }]
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id
      delete ret._id
      delete ret.__v
      delete ret.passwordHash
      return ret
    }
  }
})

// Indexes for performance
userSchema.index({ 'memberships.customerId': 1 })
userSchema.index({ 'memberships.customerId': 1, isActive: 1, createdAt: -1 })
userSchema.index({ 'tenantMemberships.customerId': 1 })
userSchema.index({ 'tenantMemberships.tenantId': 1 })
userSchema.index({ isActive: 1, 'identityPlus.trustStatus': 1 })

// Instance methods
userSchema.methods.setPassword = async function(password) {
  const bcrypt = await import('bcryptjs')
  this.passwordHash = await bcrypt.hash(password, 12)
}

userSchema.methods.comparePassword = async function(password) {
  if (!this.passwordHash) return false
  const bcrypt = await import('bcryptjs')
  return bcrypt.compare(password, this.passwordHash)
}

userSchema.methods.hasCustomerRole = function(customerId, role) {
  const membership = this.memberships.find(m => 
    m.customerId.toString() === customerId.toString()
  )
  return membership ? membership.roles.includes(role) : false
}

userSchema.methods.hasTenantRole = function(customerId, tenantId, role) {
  const membership = this.tenantMemberships.find(m => 
    m.customerId.toString() === customerId.toString() &&
    m.tenantId.toString() === tenantId.toString()
  )
  return membership ? membership.roles.includes(role) : false
}

userSchema.methods.hasVmfPermission = function(customerId, tenantId, vmfId, permission) {
  const grant = this.vmfGrants.find(g => 
    g.customerId.toString() === customerId.toString() &&
    g.tenantId.toString() === tenantId.toString() &&
    g.vmfId.toString() === vmfId.toString()
  )
  return grant ? grant.permissions.includes(permission) : false
}

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() }).select('+passwordHash')
}

userSchema.statics.findActiveUsers = function(customerId) {
  return this.find({ 
    isActive: true,
    'memberships.customerId': customerId 
  })
}

// Pre-save middleware
userSchema.pre('save', function(next) {
  // Ensure trust status consistency
  if (this.isActive === false && this.identityPlus.trustStatus === 'TRUSTED') {
    this.identityPlus.trustStatus = 'REVOKED'
  }
  
  // Set invitation timestamp if newly untrusted
  if (this.isModified('identityPlus.trustStatus') && 
      this.identityPlus.trustStatus === 'UNTRUSTED' && 
      !this.identityPlus.invitedAt) {
    this.identityPlus.invitedAt = new Date()
  }
  
  // Set trusted timestamp if becoming trusted
  if (this.isModified('identityPlus.trustStatus') && 
      this.identityPlus.trustStatus === 'TRUSTED' && 
      !this.identityPlus.trustedAt) {
    this.identityPlus.trustedAt = new Date()
  }
  
  next()
})

const User = mongoose.model('User', userSchema)

export default User
