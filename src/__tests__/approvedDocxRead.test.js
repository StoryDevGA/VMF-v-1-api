import fs from 'node:fs'
import { jest, expect, test } from '@jest/globals'
import { assertControlledReadRequest, assertControlledReadData, controlledReadProfile, CONTROLLED_DOCX_READ_VERSION,
  CORRECTED_DOCX_READ_VERSION, controlledScope } from '../services/controlledDocxReadContract.js'
import { APPROVED_DOCX_READ_VERSION as version, APPROVED_DOCX_READ_SELECTION as selected } from '../services/approvedDocxReadProfile.js'
import { readControlledDocx, controlledDocxWorkerEnvironment } from '../services/controlledDocxReadService.js'
import { resolveDevelopmentStartupPolicy } from '../config/developmentStartupPolicy.js'
const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/approvedDocxReadFixture.json', import.meta.url)))
const copy = v => JSON.parse(JSON.stringify(v))
const profile = controlledReadProfile(version), scope = Object.fromEntries(['actorUserId', 'customerId', 'tenantId', 'runtimeInstanceId'].map(k => [k, profile.identity[k]]))
const list = () => ({ scope: controlledScope(), sourceFingerprint: metadata.candidate.sourceFingerprint, candidates: [copy(metadata.candidate)] })
test('approved fixed profile is a separate held candidate; old profiles cannot read it', () => {
  const request = { contractVersion: version, operation: 'CURRENT_PREVIEW', scope, candidateId: selected.candidateId }
  expect(assertControlledReadRequest(request)).toBe(request)
  expect(assertControlledReadData('LIST', list(), version)).toBeTruthy()
  for (const old of [CONTROLLED_DOCX_READ_VERSION, CORRECTED_DOCX_READ_VERSION]) expect(() => assertControlledReadData('LIST', list(), old)).toThrow()
})
test.each(['candidateId', 'sourceFingerprint', 'inputFingerprint', 'bodyFingerprint', 'masterBindingFingerprint', 'renderer', 'compatibility', 'approval', 'bytes'])('rejects substituted %s', kind => {
  const f = list(), c = f.candidates[0]
  if (kind === 'candidateId') c.candidateId = 'docx_candidate_7c552bd4-90e9-43f8-8305-d1d6cfbb0a0a'
  else if (kind === 'renderer') c.renderer.version = '0.1.3'
  else if (kind === 'compatibility') c.masterBinding.compatibilityReference.decisionFingerprint = 'a'.repeat(64)
  else if (kind === 'approval') c.authorisesApproval = true
  else if (kind === 'bytes') c.artifact.byteLength++
  else c[kind] = 'a'.repeat(64)
  expect(() => assertControlledReadData('LIST', f, version)).toThrow()
})
test.each(['profile', 'database', 'uri', 'authorization', 'permission', 'readPurpose', 'methodCallLimit'])('cannot supply %s in worker request', key => {
  expect(() => assertControlledReadRequest({ contractVersion: version, operation: 'LIST', scope, [key]: 'injected' })).toThrow()
})
test('server selects approved version, checks authority twice and keeps token out of IPC', async () => {
  const deps = { env: { nodeEnv: 'test', appEnv: 'development', controlledDocxReadEnabled: true, controlledDocxReadApprovedEnabled: true },
    readAuthority: jest.fn(async () => ({ actorUserId: scope.actorUserId, fingerprint: 'a'.repeat(64) })), runChild: jest.fn(async () => list()) }
  const result = await readControlledDocx({ ...scope, operation: 'LIST', authorization: 'unit-only-not-a-token' }, deps)
  expect(deps.readAuthority).toHaveBeenCalledTimes(2)
  expect(deps.runChild.mock.calls[0][0]).toEqual({ contractVersion: version, operation: 'LIST', scope })
  expect(result.candidates[0].storageProvenance.customerApproved).toBe(false)
  const env = controlledDocxWorkerEnvironment(false, true)
  expect(env.CONTROLLED_DOCX_READ_APPROVED_ENABLED).toBe('true'); expect(env.OPENAI_API_KEY).toBe('')
})
test.each(['before rejection', 'after rejection', 'changed', 'foreign actor'])('refuses native authority %s without a result', async kind => {
  let calls = 0
  const deps = { env: { nodeEnv: 'test', appEnv: 'development', controlledDocxReadEnabled: true, controlledDocxReadApprovedEnabled: true },
    readAuthority: async () => { calls++; if (kind === 'before rejection' || kind === 'after rejection' && calls === 2) throw Error('DEPENDENCY_REJECTED')
      return { actorUserId: kind === 'foreign actor' ? 'f'.repeat(24) : scope.actorUserId, fingerprint: (kind === 'changed' && calls === 2 ? 'b' : 'a').repeat(64) } },
    runChild: jest.fn(async () => list()) }
  await expect(readControlledDocx({ ...scope, operation: 'LIST' }, deps)).rejects.toThrow()
  if (kind === 'before rejection' || kind === 'foreign actor') expect(deps.runChild).not.toHaveBeenCalled()
})
test.each([{ controlledDocxReadEnabled: false, controlledDocxReadApprovedEnabled: true },
  { controlledDocxReadEnabled: true, controlledDocxReadApprovedEnabled: true, controlledDocxReadCorrectionEnabled: true },
  { controlledDocxReadEnabled: true, controlledDocxReadApprovedEnabled: true, nodeEnv: 'production' }])('refuses incompatible approved startup %j', config => {
  expect(() => resolveDevelopmentStartupPolicy({ nodeEnv: 'test', appEnv: 'development', ...config })).toThrow()
})
