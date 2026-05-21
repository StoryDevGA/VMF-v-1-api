import mongoose from 'mongoose'
import crypto from 'crypto'
import env from '../config/env.js'

const auditDisplaySchema = new mongoose.Schema({
  actorLabel: {
    type: String,
    trim: true,
    maxlength: 160
  },
  targetLabel: {
    type: String,
    trim: true,
    maxlength: 240
  },
  resourceLabel: {
    type: String,
    trim: true,
    maxlength: 240
  },
  scopeLabel: {
    type: String,
    trim: true,
    maxlength: 240
  },
  permissionLabels: [{
    type: String,
    trim: true,
    maxlength: 80
  }]
}, {
  _id: false,
  id: false
})

const auditSnapshotRefSchema = new mongoose.Schema({
  type: {
    type: String,
    trim: true,
    maxlength: 80
  },
  id: {
    type: String,
    trim: true,
    maxlength: 180
  },
  checksum: {
    type: String,
    trim: true,
    maxlength: 160
  }
}, {
  _id: false,
  id: false
})

const AUDIT_SIGNATURE_V2_FIELDS = Object.freeze([
  'auditSchemaVersion',
  'signatureVersion',
  'isSystemEvent',
  'systemEventType',
  'eventCategory',
  'eventSeverity',
  'actorType',
  'systemActor',
  'frameworkKey',
  'frameworkVersion',
  'packageKey',
  'componentType',
  'componentStableId',
  'componentVersion',
  'clonedFromStableId',
  'dependencyGraph',
  'dependencyImpact',
  'snapshotRef',
  'snapshot',
  'checksum',
])

const buildSignatureData = (doc) => {
  const data = {
    ts: doc.ts,
    actorUserId: doc.actorUserId,
    action: doc.action,
    resourceType: doc.resourceType,
    resourceId: doc.resourceId,
    summary: doc.summary,
    display: doc.display,
    scope: doc.scope,
    diff: doc.diff,
    ip: doc.ip,
    userAgent: doc.userAgent,
    requestId: doc.requestId
  }

  if (Number(doc.signatureVersion || 1) >= 2) {
    AUDIT_SIGNATURE_V2_FIELDS.forEach((field) => {
      if (doc[field] !== undefined) {
        data[field] = doc[field]
      }
    })
  }

  return data
}

const auditLogSchema = new mongoose.Schema({
  ts: {
    type: Date,
    required: true,
    default: Date.now
  },
  actorUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  resourceType: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  resourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  summary: {
    type: String,
    trim: true,
    maxlength: 240
  },
  display: auditDisplaySchema,
  scope: {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer'
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant'
    },
    vmfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VMF'
    },
    runtimeInstanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RuntimeInstance'
    },
    runtimeInstanceKey: {
      type: String,
      trim: true,
      maxlength: 160
    }
  },
  diff: {
    type: mongoose.Schema.Types.Mixed
  },
  ip: {
    type: String,
    trim: true
  },
  userAgent: {
    type: String,
    trim: true
  },
  requestId: {
    type: String,
    trim: true
  },
  auditSchemaVersion: {
    type: Number,
    min: 1,
    default: 1
  },
  signatureVersion: {
    type: Number,
    min: 1,
    default: 1
  },
  actorType: {
    type: String,
    trim: true,
    uppercase: true,
    enum: ['USER', 'SYSTEM', 'SERVICE', 'AGENT', 'SKILL'],
    default: 'USER'
  },
  systemActor: {
    type: String,
    trim: true,
    maxlength: 160
  },
  isSystemEvent: {
    type: Boolean,
    default: false
  },
  systemEventType: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 100
  },
  eventCategory: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 50
  },
  eventSeverity: {
    type: String,
    trim: true,
    uppercase: true,
    enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
  },
  frameworkKey: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 100
  },
  frameworkVersion: {
    type: String,
    trim: true,
    maxlength: 50
  },
  packageKey: {
    type: String,
    trim: true,
    maxlength: 160
  },
  componentType: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 80
  },
  componentStableId: {
    type: String,
    trim: true,
    maxlength: 180
  },
  componentVersion: {
    type: Number,
    min: 0
  },
  clonedFromStableId: {
    type: String,
    trim: true,
    maxlength: 180
  },
  dependencyGraph: {
    type: mongoose.Schema.Types.Mixed
  },
  dependencyImpact: {
    type: mongoose.Schema.Types.Mixed
  },
  snapshotRef: auditSnapshotRefSchema,
  snapshot: {
    type: mongoose.Schema.Types.Mixed
  },
  checksum: {
    type: String,
    trim: true,
    maxlength: 160
  },
  previousSignature: {
    type: String,
    trim: true,
    maxlength: 160
  },
  // Integrity protection
  signature: {
    type: String,
    required: true
  }
}, {
  timestamps: false, // We use custom ts field
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id
      delete ret._id
      delete ret.__v
      delete ret.signature // Don't expose signature in API responses
      return ret
    }
  }
})

// Indexes for performance and retention
auditLogSchema.index({ 'scope.customerId': 1, ts: -1 })
auditLogSchema.index({ actorUserId: 1, ts: -1 })
auditLogSchema.index({ resourceType: 1, resourceId: 1, ts: -1 })
auditLogSchema.index({ action: 1, ts: -1 })
auditLogSchema.index({ requestId: 1 }) // For correlation
auditLogSchema.index({ isSystemEvent: 1, ts: -1 })
auditLogSchema.index({ systemEventType: 1, ts: -1 })
auditLogSchema.index({ eventCategory: 1, ts: -1 })
auditLogSchema.index({ frameworkKey: 1, frameworkVersion: 1, ts: -1 })
auditLogSchema.index({ packageKey: 1, ts: -1 })
auditLogSchema.index({ componentType: 1, componentStableId: 1, componentVersion: 1, ts: -1 })
auditLogSchema.index({ checksum: 1 })

// TTL index for automatic cleanup (7 years = 220752000 seconds)
auditLogSchema.index({ ts: 1 }, { expireAfterSeconds: 220752000 })

// Static methods
auditLogSchema.statics.findByCustomer = function(customerId, options = {}) {
  const { 
    startDate, 
    endDate, 
    action, 
    resourceType, 
    limit = 100, 
    skip = 0 
  } = options
  
  const query = { 'scope.customerId': customerId }
  
  if (startDate || endDate) {
    query.ts = {}
    if (startDate) query.ts.$gte = startDate
    if (endDate) query.ts.$lte = endDate
  }
  
  if (action) query.action = action
  if (resourceType) query.resourceType = resourceType
  
  return this.find(query)
    .populate('actorUserId', 'name email')
    .sort({ ts: -1 })
    .limit(limit)
    .skip(skip)
}

auditLogSchema.statics.findByActor = function(actorUserId, options = {}) {
  const { 
    startDate, 
    endDate, 
    limit = 100, 
    skip = 0 
  } = options
  
  const query = { actorUserId }
  
  if (startDate || endDate) {
    query.ts = {}
    if (startDate) query.ts.$gte = startDate
    if (endDate) query.ts.$lte = endDate
  }
  
  return this.find(query)
    .sort({ ts: -1 })
    .limit(limit)
    .skip(skip)
}

auditLogSchema.statics.findByRequestId = function(requestId) {
  return this.find({ requestId }).sort({ ts: 1 })
}

auditLogSchema.statics.createLog = function(logData, options = {}) {
  const log = new this(logData)
  log.generateSignature()
  return log.save(options)
}

// Instance methods
auditLogSchema.methods.generateSignature = function() {
  const data = buildSignatureData(this)
  const dataString = JSON.stringify(data, null, 0)
  const secret = env.auditSignatureSecret
  
  this.signature = crypto
    .createHmac('sha256', secret)
    .update(dataString)
    .digest('hex')
}

auditLogSchema.methods.verifySignature = function() {
  const data = buildSignatureData(this)
  const dataString = JSON.stringify(data, null, 0)
  const secret = env.auditSignatureSecret

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(dataString)
    .digest('hex')

  return this.signature === expectedSignature
}

// Pre-save middleware to ensure integrity
auditLogSchema.pre('save', function(next) {
  if (this.isNew) {
    this.generateSignature()
  } else {
    // Prevent modification of existing audit logs
    return next(new Error('Audit logs are immutable'))
  }
  next()
})

// Prevent updates and deletions
auditLogSchema.pre('updateOne', function(next) {
  next(new Error('Audit logs cannot be updated'))
})

auditLogSchema.pre('findOneAndUpdate', function(next) {
  next(new Error('Audit logs cannot be updated'))
})

auditLogSchema.pre('deleteOne', function(next) {
  next(new Error('Audit logs cannot be deleted manually'))
})

auditLogSchema.pre('findOneAndDelete', function(next) {
  next(new Error('Audit logs cannot be deleted manually'))
})

const AuditLog = mongoose.model('AuditLog', auditLogSchema)

export default AuditLog
