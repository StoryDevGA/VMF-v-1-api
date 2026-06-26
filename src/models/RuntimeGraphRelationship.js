import mongoose from 'mongoose'
import {
  DEFAULT_OUTCOME_WORKSPACE_TYPE,
  RUNTIME_GRAPH_NODE_TYPES,
  RUNTIME_GRAPH_RELATIONSHIP_STATUSES,
  RUNTIME_GRAPH_RELATIONSHIP_TYPES,
  WORKSPACE_TYPES,
} from '../constants/workspaceGovernance.js'

const runtimeGraphNodeSchema = new mongoose.Schema(
  {
    nodeType: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(RUNTIME_GRAPH_NODE_TYPES),
    },
    nodeId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    recordId: {
      type: String,
      trim: true,
      maxlength: 240,
      default: '',
    },
    recordModel: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    label: {
      type: String,
      trim: true,
      maxlength: 240,
      default: '',
    },
  },
  { _id: false },
)

const runtimeGraphRelationshipSchema = new mongoose.Schema(
  {
    relationshipId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 180,
    },
    relationshipType: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(RUNTIME_GRAPH_RELATIONSHIP_TYPES),
    },
    workspaceType: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(WORKSPACE_TYPES),
      default: DEFAULT_OUTCOME_WORKSPACE_TYPE,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
    },
    runtimeInstanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RuntimeInstance',
      required: true,
    },
    sourceNode: {
      type: runtimeGraphNodeSchema,
      required: true,
    },
    targetNode: {
      type: runtimeGraphNodeSchema,
      required: true,
    },
    evidence: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    status: {
      type: String,
      required: true,
      uppercase: true,
      enum: Object.values(RUNTIME_GRAPH_RELATIONSHIP_STATUSES),
      default: RUNTIME_GRAPH_RELATIONSHIP_STATUSES.ACTIVE,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  {
    collection: 'runtime_graph_relationships',
    timestamps: true,
    toJSON: {
      transform: function transform(_doc, ret) {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

runtimeGraphRelationshipSchema.index({
  tenantId: 1,
  customerId: 1,
  runtimeInstanceId: 1,
  workspaceType: 1,
  relationshipType: 1,
  status: 1,
  createdAt: -1,
})
runtimeGraphRelationshipSchema.index({
  runtimeInstanceId: 1,
  'sourceNode.nodeType': 1,
  'sourceNode.nodeId': 1,
  createdAt: -1,
})
runtimeGraphRelationshipSchema.index({
  runtimeInstanceId: 1,
  'targetNode.nodeType': 1,
  'targetNode.nodeId': 1,
  createdAt: -1,
})

export const normalizeRuntimeGraphNode = (node = {}) => ({
  nodeType: String(node.nodeType || '').trim().toUpperCase(),
  nodeId: String(node.nodeId || '').trim(),
  recordId: String(node.recordId || '').trim(),
  recordModel: String(node.recordModel || '').trim(),
  label: String(node.label || '').trim(),
})

runtimeGraphRelationshipSchema.pre('validate', function normalizeRuntimeGraphRelationship(next) {
  this.relationshipId = String(this.relationshipId || '').trim()
  this.relationshipType = String(this.relationshipType || '').trim().toUpperCase()
  this.workspaceType = String(this.workspaceType || DEFAULT_OUTCOME_WORKSPACE_TYPE).trim().toUpperCase()
  this.status = String(this.status || RUNTIME_GRAPH_RELATIONSHIP_STATUSES.ACTIVE).trim().toUpperCase()
  this.sourceNode = normalizeRuntimeGraphNode(this.sourceNode)
  this.targetNode = normalizeRuntimeGraphNode(this.targetNode)
  next()
})

const RuntimeGraphRelationship = mongoose.model('RuntimeGraphRelationship', runtimeGraphRelationshipSchema)

export default RuntimeGraphRelationship
