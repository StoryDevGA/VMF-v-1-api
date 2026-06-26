import { describe, expect, test, jest } from '@jest/globals'
import { RuntimeGraphRelationship } from '../models/index.js'
import {
  createRuntimeGraphRelationshipDocuments,
  deleteRuntimeGraphRelationshipDocuments,
  listRuntimeGraphRelationshipsForRuntime,
  projectRuntimeGraphRelationship,
} from '../services/runtimeGraphRelationshipService.js'

const TENANT_ID = '707f1f77bcf86cd799439033'
const CUSTOMER_ID = '607f1f77bcf86cd799439022'
const RUNTIME_INSTANCE_ID = 'a27f1f77bcf86cd799439111'
const ACTOR_ID = '507f1f77bcf86cd799439012'

const buildFindChain = (rows = []) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
})

describe('RuntimeGraphRelationship model and service', () => {
  test('validates and normalizes a runtime-scoped graph relationship', async () => {
    const [relationship] = createRuntimeGraphRelationshipDocuments([{
      relationshipType: ' session_bound_to_truth ',
      workspaceType: ' outcome ',
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      sourceNode: {
        nodeType: ' workspace_session ',
        nodeId: ' out_sess_existing_fixture ',
        recordModel: 'OutcomeSession',
      },
      targetNode: {
        nodeType: ' truth_signature ',
        nodeId: ' truth_sig_existing_fixture ',
        recordModel: 'TruthSignature',
      },
      evidence: {
        truthSignatureId: 'truth_sig_existing_fixture',
        graphHash: 'sha256:graph-hash',
      },
      createdBy: ACTOR_ID,
    }])

    await expect(relationship.validate()).resolves.toBeUndefined()
    expect(relationship.relationshipId).toMatch(/^rt_graph_rel_/)
    expect(relationship.relationshipType).toBe('SESSION_BOUND_TO_TRUTH')
    expect(relationship.workspaceType).toBe('OUTCOME')
    expect(relationship.sourceNode).toEqual(expect.objectContaining({
      nodeType: 'WORKSPACE_SESSION',
      nodeId: 'out_sess_existing_fixture',
    }))
    expect(relationship.targetNode).toEqual(expect.objectContaining({
      nodeType: 'TRUTH_SIGNATURE',
      nodeId: 'truth_sig_existing_fixture',
    }))
  })

  test('rejects unsupported relationship and node types at the schema boundary', async () => {
    const [relationship] = createRuntimeGraphRelationshipDocuments([{
      relationshipType: 'RAW_UNGOVERNED_EDGE',
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      sourceNode: {
        nodeType: 'RAW_PROMPT',
        nodeId: 'raw_prompt_fixture',
      },
      targetNode: {
        nodeType: 'TRUTH_SIGNATURE',
        nodeId: 'truth_sig_existing_fixture',
      },
      createdBy: ACTOR_ID,
    }])

    await expect(relationship.validate()).rejects.toThrow()
  })

  test('projects relationships without raw evidence content', () => {
    const circularEvidence = {
      truthSignatureId: 'truth_sig_existing_fixture',
      nested: {
        graphHash: 'sha256:graph-hash',
      },
      rawPrompt: 'raw prompt must not project',
    }
    circularEvidence.nested.circular = circularEvidence

    const projected = projectRuntimeGraphRelationship({
      relationshipId: 'rt_graph_rel_fixture',
      relationshipType: 'ASSET_DERIVED_FROM_TRUTH',
      workspaceType: 'OUTCOME',
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      sourceNode: {
        nodeType: 'TRUTH_SIGNATURE',
        nodeId: 'truth_sig_existing_fixture',
      },
      targetNode: {
        nodeType: 'WORKSPACE_ASSET',
        nodeId: 'outcome_asset_existing_fixture',
      },
      evidence: circularEvidence,
      status: 'ACTIVE',
      createdBy: ACTOR_ID,
      createdAt: '2026-06-26T10:00:00.000Z',
    })

    expect(projected).toEqual(expect.objectContaining({
      relationshipId: 'rt_graph_rel_fixture',
      relationshipType: 'ASSET_DERIVED_FROM_TRUTH',
      workspaceType: 'OUTCOME',
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      status: 'ACTIVE',
    }))
    expect(projected.evidence).toEqual(expect.objectContaining({
      truthSignatureId: 'truth_sig_existing_fixture',
      nested: {
        graphHash: 'sha256:graph-hash',
        circular: {},
      },
    }))
    expect(JSON.stringify(projected)).not.toContain('raw prompt must not project')
    expect(JSON.stringify(projected)).not.toContain('raw customer content must not project')
  })

  test('lists relationships through a runtime and tenant scoped query', async () => {
    RuntimeGraphRelationship.find = jest.fn().mockReturnValue(buildFindChain([{
      relationshipId: 'rt_graph_rel_fixture',
      relationshipType: 'SESSION_BOUND_TO_TRUTH',
      workspaceType: 'OUTCOME',
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      sourceNode: {
        nodeType: 'WORKSPACE_SESSION',
        nodeId: 'out_sess_existing_fixture',
      },
      targetNode: {
        nodeType: 'TRUTH_SIGNATURE',
        nodeId: 'truth_sig_existing_fixture',
      },
      evidence: {
        truthSignatureId: 'truth_sig_existing_fixture',
      },
      status: 'ACTIVE',
      createdBy: ACTOR_ID,
      createdAt: '2026-06-26T10:00:00.000Z',
    }]))

    const rows = await listRuntimeGraphRelationshipsForRuntime({
      customerId: CUSTOMER_ID,
      relationshipType: 'session_bound_to_truth',
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      tenantId: TENANT_ID,
      workspaceType: 'outcome',
    })

    expect(RuntimeGraphRelationship.find).toHaveBeenCalledWith({
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      relationshipType: 'SESSION_BOUND_TO_TRUTH',
      status: 'ACTIVE',
      workspaceType: 'OUTCOME',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(expect.objectContaining({
      relationshipId: 'rt_graph_rel_fixture',
      relationshipType: 'SESSION_BOUND_TO_TRUTH',
    }))
  })

  test('deletes relationship documents with an optional transaction session', async () => {
    RuntimeGraphRelationship.deleteMany = jest.fn().mockResolvedValue({ deletedCount: 1 })
    const dbSession = { id: 'session-fixture' }

    const result = await deleteRuntimeGraphRelationshipDocuments([
      { _id: 'relationship-mongo-id' },
      { _id: null },
    ], { dbSession })

    expect(result).toEqual({ deletedCount: 1 })
    expect(RuntimeGraphRelationship.deleteMany).toHaveBeenCalledWith(
      { _id: { $in: ['relationship-mongo-id'] } },
      { session: dbSession },
    )
  })

  test('keeps graph relationship index contract category-neutral and status-aware', () => {
    const indexes = RuntimeGraphRelationship.schema.indexes()
    const indexFields = indexes.map(([fields]) => fields)

    expect(indexFields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: 1,
        customerId: 1,
        runtimeInstanceId: 1,
        workspaceType: 1,
        relationshipType: 1,
        status: 1,
        createdAt: -1,
      }),
      expect.objectContaining({
        runtimeInstanceId: 1,
        'sourceNode.nodeType': 1,
        'sourceNode.nodeId': 1,
        createdAt: -1,
      }),
      expect.objectContaining({
        runtimeInstanceId: 1,
        'targetNode.nodeType': 1,
        'targetNode.nodeId': 1,
        createdAt: -1,
      }),
    ]))

    expect(RuntimeGraphRelationship.schema.path('relationshipType').options.index).toBeUndefined()
    expect(RuntimeGraphRelationship.schema.path('workspaceType').options.index).toBeUndefined()
    expect(RuntimeGraphRelationship.schema.path('tenantId').options.index).toBeUndefined()
    expect(RuntimeGraphRelationship.schema.path('customerId').options.index).toBeUndefined()
    expect(RuntimeGraphRelationship.schema.path('runtimeInstanceId').options.index).toBeUndefined()
    expect(RuntimeGraphRelationship.schema.path('status').options.index).toBeUndefined()
  })
})
