import { describe, test, expect, jest } from '@jest/globals'
import { resolveWorkflowPoliciesForRuntime } from '../services/workflowPolicyRuntimeService.js'

const buildFindOneChain = (row) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(row),
  }),
})

const buildFindChain = (rows) => ({
  select: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(rows),
  }),
})

describe('workflowPolicyRuntimeService', () => {
  test('resolves active package workflow bindings by governed action and ordered structured steps', async () => {
    const frameworkPackageModel = {
      findOne: jest.fn().mockReturnValue(buildFindOneChain({
        packageKey: 'vmf-standard',
        version: '1.0.0',
        frameworkKey: 'VMF',
        status: 'ACTIVE',
        workflowBindings: [
          { policyKey: 'vmf-submit-gate' },
          { policyKey: 'vmf-publish-gate' },
        ],
      })),
    }
    const workflowPolicyModel = {
      find: jest.fn().mockReturnValue(buildFindChain([
        {
          stableId: 'policy-vmf-submit-gate',
          key: 'vmf-submit-gate',
          name: 'VMF Submit Gate',
          priority: 200,
          governedAction: 'SUBMIT_FOR_REVIEW',
          triggerEvent: 'ON_SUBMIT',
          executionType: 'ORDERED_STEPS',
          componentVersion: 3,
          versionStatus: 'ACTIVE',
          lineageId: 'policy-lineage-submit',
          steps: [
            { stepKey: 'emit-ready', type: 'EVENT_EMIT', order: 20, eventKey: 'ready' },
            {
              stepKey: 'required-check',
              type: 'VALIDATION',
              order: 10,
              bindingKeys: ['required-sections-on-submit'],
            },
          ],
        },
      ])),
    }

    const result = await resolveWorkflowPoliciesForRuntime({
      governedAction: 'SUBMIT_FOR_REVIEW',
      frameworkKey: 'VMF',
      packageKey: 'vmf-standard',
      frameworkPackageModel,
      workflowPolicyModel,
    })

    expect(frameworkPackageModel.findOne).toHaveBeenCalledWith({
      frameworkKey: 'VMF',
      packageKey: 'vmf-standard',
    })
    expect(workflowPolicyModel.find).toHaveBeenCalledWith({
      key: { $in: ['vmf-submit-gate', 'vmf-publish-gate'] },
      status: 'ACTIVE',
      versionStatus: 'ACTIVE',
      governedAction: 'SUBMIT_FOR_REVIEW',
      frameworkKeys: 'VMF',
    })
    expect(result.policies).toEqual([
      expect.objectContaining({
        id: 'policy-vmf-submit-gate',
        key: 'vmf-submit-gate',
        componentVersion: 3,
        steps: [
          expect.objectContaining({ stepKey: 'required-check', order: 10 }),
          expect.objectContaining({ stepKey: 'emit-ready', order: 20 }),
        ],
      }),
    ])
    expect(result.issues).toEqual([
      'Workflow policy "vmf-publish-gate" is not ACTIVE, not version-active, incompatible, or not mapped to governed action "SUBMIT_FOR_REVIEW".',
    ])
  })
})
