import mongoose from 'mongoose'
import { SUPER_ADMIN_LOCKED_PERMISSION_KEYS } from '../constants/permissionCatalogue.js'

const roleSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    maxlength: 100,
    match: [/^[A-Z_]+$/, 'Role key must contain only uppercase letters and underscores']
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
    default: ''
  },
  scope: {
    type: String,
    required: true,
    enum: ['PLATFORM', 'CUSTOMER', 'TENANT', 'VMF'],
    default: 'VMF'
  },
  permissions: [{
    type: String,
    required: true,
    trim: true,
    uppercase: true
  }],
  isSystem: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
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

const SYSTEM_ROLE_MUTATION_ERROR =
  'System roles can only have their permissions and activation status modified'
const SUPER_ADMIN_LOCKED_PERMISSION_ERROR_PREFIX =
  'SUPER_ADMIN must retain locked baseline permissions'

// Indexes for performance
roleSchema.index({ scope: 1, isActive: 1 })
roleSchema.index({ isSystem: 1, isActive: 1 })

// Static methods
roleSchema.statics.findByScope = function(scope, activeOnly = true) {
  const query = { scope }
  if (activeOnly) query.isActive = true
  return this.find(query).sort({ name: 1 })
}

roleSchema.statics.findSystemRoles = function(activeOnly = true) {
  const query = { isSystem: true }
  if (activeOnly) query.isActive = true
  return this.find(query).sort({ scope: 1, name: 1 })
}

roleSchema.statics.findCustomRoles = function(activeOnly = true) {
  const query = { isSystem: false }
  if (activeOnly) query.isActive = true
  return this.find(query).sort({ scope: 1, name: 1 })
}

roleSchema.statics.findByKey = function(key) {
  return this.findOne({ key: key.toUpperCase(), isActive: true })
}

// Instance methods
roleSchema.methods.hasPermission = function(permission) {
  return this.permissions.includes(permission.toUpperCase())
}

roleSchema.methods.addPermission = function(permission) {
  const perm = permission.toUpperCase()
  if (!this.permissions.includes(perm)) {
    this.permissions.push(perm)
  }
}

roleSchema.methods.removePermission = function(permission) {
  const perm = permission.toUpperCase()
  this.permissions = this.permissions.filter(p => p !== perm)
}

// Pre-save middleware
roleSchema.pre('save', function(next) {
  if (this.key === 'SUPER_ADMIN' && (this.isNew || this.isModified('permissions'))) {
    const normalizedPermissionKeySet = new Set(
      (this.permissions || []).map((permission) => String(permission || '').trim().toUpperCase()),
    )
    const missingLockedPermissions = SUPER_ADMIN_LOCKED_PERMISSION_KEYS.filter(
      (permissionKey) => !normalizedPermissionKeySet.has(permissionKey),
    )

    if (missingLockedPermissions.length > 0) {
      return next(
        new Error(
          `${SUPER_ADMIN_LOCKED_PERMISSION_ERROR_PREFIX}: ${missingLockedPermissions.join(', ')}`,
        ),
      )
    }
  }

  // Prevent modification of system roles
  if (this.isSystem && !this.isNew) {
    const allowedChanges = ['isActive', 'permissions', 'updatedAt']
    const modifiedRootPaths = [...new Set(this.modifiedPaths().map((path) => path.split('.')[0]))]
    const hasDisallowedChanges = modifiedRootPaths.some(
      (path) => !allowedChanges.includes(path),
    )
    
    if (hasDisallowedChanges) {
      return next(new Error(SYSTEM_ROLE_MUTATION_ERROR))
    }
  }
  
  // Ensure permissions are uppercase
  this.permissions = [...new Set(this.permissions.map(p => p.toUpperCase()))]
  
  next()
})

// Prevent deletion of system roles
roleSchema.pre('deleteOne', { document: true, query: false }, function(next) {
  if (this.isSystem) {
    return next(new Error('System roles cannot be deleted'))
  }
  next()
})

roleSchema.pre('findOneAndDelete', function(next) {
  this.where({ isSystem: { $ne: true } })
  next()
})

const Role = mongoose.model('Role', roleSchema)

export default Role
