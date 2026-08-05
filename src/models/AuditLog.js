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

const CURRENT_AUDIT_SIGNATURE_VERSION = 3
const SUPPORTED_AUDIT_SIGNATURE_VERSIONS = new Set([1, 2, CURRENT_AUDIT_SIGNATURE_VERSION])

const LEGACY_RUNTIME_ACTION_DIFF_FIELDS = new Set([
  'actionKey',
  'governedAction',
  'policyKey',
  'expectedUpdatedAt',
  'updatedAtBefore',
  'updatedAtAfter',
  'runtimeType',
  'frameworkKey',
  'packageKey',
  'packageVersion',
  'executionStatus',
  'runtimeStatus',
  'lock',
  'publish',
  'lifecycle',
  'readiness',
  'validation',
  'generation',
  'discovery',
  'intelligenceGraph',
  'actionedAt',
])

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(Object(value), key)

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
)

const copyPresentFields = (source, fields) => {
  const result = {}
  fields.forEach((field) => {
    if (hasOwn(source, field)) result[field] = source[field]
  })
  return result
}

const rebuildLegacyTransition = (value) => ({
  from: isPlainObject(value?.from) ? value.from : {},
  to: isPlainObject(value?.to) ? value.to : {},
})

const rebuildLegacyLockTransition = (value) => ({
  from: {
    lockedAt: hasOwn(value?.from, 'lockedAt') ? value.from.lockedAt : null,
    state: isPlainObject(value?.from?.state) ? value.from.state : {},
  },
  to: {
    lockedAt: hasOwn(value?.to, 'lockedAt') ? value.to.lockedAt : null,
    state: isPlainObject(value?.to?.state) ? value.to.state : {},
  },
})

const rebuildLegacyRuntimeActionDiff = (diff) => {
  if (!isPlainObject(diff)) return null
  if (Object.keys(diff).some((field) => !LEGACY_RUNTIME_ACTION_DIFF_FIELDS.has(field))) return null
  if (!diff.actionKey || !diff.governedAction || !diff.actionedAt) return null

  return {
    ...copyPresentFields(diff, [
      'actionKey',
      'governedAction',
      'policyKey',
      'expectedUpdatedAt',
      'updatedAtBefore',
      'updatedAtAfter',
      'runtimeType',
      'frameworkKey',
      'packageKey',
      'packageVersion',
    ]),
    executionStatus: copyPresentFields(diff.executionStatus, ['from', 'to']),
    runtimeStatus: copyPresentFields(diff.runtimeStatus, ['from', 'to']),
    lock: rebuildLegacyLockTransition(diff.lock),
    publish: rebuildLegacyTransition(diff.publish),
    lifecycle: rebuildLegacyTransition(diff.lifecycle),
    readiness: rebuildLegacyTransition(diff.readiness),
    ...copyPresentFields(diff, [
      'validation',
      'generation',
      'discovery',
      'intelligenceGraph',
      'actionedAt',
    ]),
  }
}

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

const buildPersistableSignatureData = (doc) => {
  const persistableDocument = typeof doc?.toObject === 'function'
    ? doc.toObject({
        depopulate: true,
        flattenMaps: true,
        getters: false,
        minimize: true,
        transform: false,
        virtuals: false,
      })
    : doc

  return buildSignatureData(persistableDocument)
}

const calculateSignature = (data) => crypto
  .createHmac('sha256', env.auditSignatureSecret)
  .update(JSON.stringify(data, null, 0))
  .digest('hex')

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
    enum: [...SUPPORTED_AUDIT_SIGNATURE_VERSIONS],
    default: CURRENT_AUDIT_SIGNATURE_VERSION
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
  const signatureVersion = Number(this.signatureVersion || 1)
  if (!SUPPORTED_AUDIT_SIGNATURE_VERSIONS.has(signatureVersion)) {
    throw new Error(`Unsupported audit signature version: ${signatureVersion}`)
  }

  const data = signatureVersion === CURRENT_AUDIT_SIGNATURE_VERSION
    ? buildPersistableSignatureData(this)
    : buildSignatureData(this)

  this.signature = calculateSignature(data)
}

auditLogSchema.methods.verifySignature = function() {
  const signatureVersion = Number(this.signatureVersion || 1)
  if (!SUPPORTED_AUDIT_SIGNATURE_VERSIONS.has(signatureVersion)) return false

  const data = signatureVersion === CURRENT_AUDIT_SIGNATURE_VERSION
    ? buildPersistableSignatureData(this)
    : buildSignatureData(this)

  if (this.signature === calculateSignature(data)) return true

  if (
    signatureVersion >= CURRENT_AUDIT_SIGNATURE_VERSION
    || this.action !== 'RUNTIME_ACTION_EXECUTED'
  ) return false

  const legacyDiff = rebuildLegacyRuntimeActionDiff(this.diff)
  if (!legacyDiff) return false

  return this.signature === calculateSignature({
    ...buildSignatureData(this),
    diff: legacyDiff,
  })
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
