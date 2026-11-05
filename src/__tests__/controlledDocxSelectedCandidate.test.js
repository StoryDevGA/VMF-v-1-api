import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import http from 'node:http'
import https from 'node:https'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { CONTROLLED_DOCX_IDENTITY, CORRECTED_DOCX_IDENTITY, CONTROLLED_DOCX_READ_VERSION,
  CORRECTED_DOCX_READ_VERSION, CORRECTED_DOCX_HASHES, controlledScope } from '../services/controlledDocxReadContract.js'
import { correctedReadListFixture } from './fixtures/controlledDocxCorrectionFixture.js'
import fs from 'node:fs'
import { APPROVED_DOCX_READ_VERSION, NARROW_DOCX_READ_VERSION, NARROW_DOCX_READ_SELECTION } from '../services/approvedDocxReadProfile.js'
const approved = JSON.parse(fs.readFileSync(new URL('./fixtures/approvedDocxReadFixture.json', import.meta.url)))
const narrow = JSON.parse(fs.readFileSync(new URL('./fixtures/narrowDocxReadFixture.json', import.meta.url)))

const read = jest.fn(), list = jest.fn(), close = jest.fn(), disconnect = jest.fn()
const fenceSelection = jest.fn(() => ({ register: jest.fn(), addNames: jest.fn() }))
const config = { nodeEnv: 'development', appEnv: 'development', outcomeStudioProviderEnabled: false,
  vmfSectionReasoningProviderEnabled: false, controlledDocxReadEnabled: true, controlledDocxReadCorrectionEnabled: false }
const scopes = { customer: { _id: CONTROLLED_DOCX_IDENTITY.customerId }, tenant: { _id: CONTROLLED_DOCX_IDENTITY.tenantId } }
jest.unstable_mockModule('mongoose', () => ({ default: { set: jest.fn(),
  mongo: { MongoClient: class { async connect() {} async close() { close() } } },
  connection: { name: 'ss044_1619d7db635949898c9abb4592d10bcf', setClient: jest.fn(), db: { listCollections: () => ({ toArray: async () => [{ name: 'outcome_docx_rendition_candidates' }] }) } }, disconnect } }))
jest.unstable_mockModule('../services/controlledDocxReadFence.js', () => ({ installControlledDocxReadFence: fenceSelection }))
jest.unstable_mockModule('../config/env.js', () => ({ default: config }))
jest.unstable_mockModule('../middleware/loadScopes.js', () => ({ default: (req, _res, next) => { req.scopes = scopes; next() } }))
jest.unstable_mockModule('../controllers/runtimeInstance.controller.js', () => ({ buildRuntimeStateRequestScopes: () => scopes }))
jest.unstable_mockModule('../services/outcomeDocxCandidatePersistenceService.js', () => ({ readPrivateDocxCandidate: read, listCurrentPrivateDocxCandidates: list }))
const { executeControlledDocxReadWorker } = await import('../services/controlledDocxReadWorker.js')
const originalFetch = globalThis.fetch
const saved = [[http, ['request', 'get']], [https, ['request', 'get']], [childProcess, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']]]
  .map(([module, keys]) => [module, Object.fromEntries(keys.map(key => [key, module[key]]))])
beforeEach(() => {
  read.mockReset(); list.mockReset().mockRejectedValue(Error('UNRELATED_V3_NATIVE_AUTHORITY_MUST_NOT_BE_READ'))
  close.mockClear(); disconnect.mockClear(); fenceSelection.mockClear(); config.controlledDocxReadCorrectionEnabled = false; config.controlledDocxReadApprovedEnabled = false; config.controlledDocxReadNarrowEnabled = false; config.controlledDocxReadEnabled = true
})
afterEach(() => { globalThis.fetch = originalFetch; for (const [module, methods] of saved) Object.assign(module, methods); syncBuiltinESMExports() })
const request = corrected => ({ contractVersion: corrected ? CORRECTED_DOCX_READ_VERSION : CONTROLLED_DOCX_READ_VERSION,
  operation: 'LIST', scope: Object.fromEntries(['actorUserId', 'customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, CONTROLLED_DOCX_IDENTITY[key]])) })
const candidate = corrected => {
  const identity = corrected ? CORRECTED_DOCX_IDENTITY : CONTROLLED_DOCX_IDENTITY
  return { candidateId: identity.candidateId, contractVersion: 'private-docx-candidate.v2', status: 'PRIVATE_UNREVIEWED',
    classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', authoritative: false, officialUse: false, normalOutputAvailable: false,
    authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false, renderer: { version: '0.1.3' },
    sourceFingerprint: 'a'.repeat(64), inputFingerprint: 'b'.repeat(64), bodyFingerprint: 'c'.repeat(64), masterBindingFingerprint: 'd'.repeat(64),
    artifact: { format: 'DOCX', outputChecksum: `sha256:${'e'.repeat(64)}` } }
}
test('original profile reads only its fixed current candidate even if a later private candidate cannot be listed', async () => {
  const selected = candidate(false); read.mockResolvedValue({ candidate: selected, scope: controlledScope(), buffer: Buffer.from('private-not-published') })
  const result = await executeControlledDocxReadWorker(request(false))
  expect(result).toEqual({ scope: controlledScope(), sourceFingerprint: selected.sourceFingerprint, candidates: [selected] })
  expect(read).toHaveBeenCalledWith({ actorUserId: CONTROLLED_DOCX_IDENTITY.actorUserId, runtimeInstanceId: CONTROLLED_DOCX_IDENTITY.runtimeInstanceId,
    scopes, candidateId: CONTROLLED_DOCX_IDENTITY.candidateId, includeBytes: true })
  expect(list).not.toHaveBeenCalled(); expect(result).not.toHaveProperty('buffer'); expect(disconnect).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1)
})
test('corrected profile reads its exact fixed candidate without enumerating later private candidates', async () => {
  config.controlledDocxReadCorrectionEnabled = true; const expected = correctedReadListFixture()
  read.mockResolvedValue({ candidate: expected.candidates[0], scope: expected.scope })
  await expect(executeControlledDocxReadWorker(request(true))).resolves.toEqual(expected)
  expect(read.mock.calls[0][0].candidateId).toBe(CORRECTED_DOCX_IDENTITY.candidateId); expect(list).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1)
})
test('corrected profile still rejects a changed current binding', async () => {
  config.controlledDocxReadCorrectionEnabled = true
  const selected = { ...candidate(true), ...CORRECTED_DOCX_HASHES, artifact: { format: 'DOCX', byteLength: 13688, outputChecksum: CORRECTED_DOCX_HASHES.outputChecksum } }
  read.mockResolvedValue({ candidate: selected, scope: controlledScope() })
  await expect(executeControlledDocxReadWorker(request(true))).rejects.toMatchObject({ details: { reason: 'RESULT_CANDIDATE_INVALID' } })
  expect(read.mock.calls[0][0].candidateId).toBe(CORRECTED_DOCX_IDENTITY.candidateId); expect(list).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1)
})
test('selected-record refusal is preserved without discovering or substituting another candidate', async () => {
  const refusal = Object.assign(Error('SELECTED_PRIVATE_RECORD_HELD'), { code: 'PRIVATE_DOCX_CANDIDATE_BLOCKED' }); read.mockRejectedValue(refusal)
  await expect(executeControlledDocxReadWorker(request(false))).rejects.toBe(refusal)
  expect(read).toHaveBeenCalledTimes(1); expect(list).not.toHaveBeenCalled(); expect(disconnect).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1)
})
test('approved profile delegates only its exact candidate to the default reader and closes', async () => {
  config.controlledDocxReadApprovedEnabled = true
  const expected = { scope: controlledScope(), sourceFingerprint: approved.candidate.sourceFingerprint, candidates: [approved.candidate] }
  read.mockResolvedValue({ candidate: approved.candidate, scope: controlledScope() })
  await expect(executeControlledDocxReadWorker({ ...request(false), contractVersion: APPROVED_DOCX_READ_VERSION })).resolves.toEqual(expected)
  expect(read.mock.calls[0][0].candidateId).toBe(approved.candidate.candidateId); expect(list).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1); expect(disconnect).toHaveBeenCalledTimes(1)
})
test('approved worker independently refuses missing base reader flag before connecting', async () => {
  config.controlledDocxReadApprovedEnabled = true; config.controlledDocxReadEnabled = false
  await expect(executeControlledDocxReadWorker({ ...request(false), contractVersion: APPROVED_DOCX_READ_VERSION })).rejects.toThrow('CONTROLLED_READ_FENCE')
  expect(read).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
})
test('narrow worker selects only the actual saved candidate and its fixed 20000-call purpose', async () => {
  config.controlledDocxReadNarrowEnabled = true
  const expected = { scope: controlledScope(), sourceFingerprint: narrow.candidate.sourceFingerprint, candidates: [narrow.candidate] }
  read.mockResolvedValue({ candidate: narrow.candidate, scope: controlledScope() })
  await expect(executeControlledDocxReadWorker({ ...request(false), contractVersion: NARROW_DOCX_READ_VERSION })).resolves.toEqual(expected)
  expect(read.mock.calls[0][0].candidateId).toBe(NARROW_DOCX_READ_SELECTION.candidateId)
  expect(fenceSelection.mock.calls[0][1]).toMatchObject({ nativeRecorderId: NARROW_DOCX_READ_SELECTION.recorderUserId, readPurpose: 'NARROW_CANDIDATE' })
  expect(list).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1); expect(disconnect).toHaveBeenCalledTimes(1)
})
test('narrow worker independently rejects mixed profiles or a missing base reader before lookup', async () => {
  config.controlledDocxReadNarrowEnabled = true; config.controlledDocxReadApprovedEnabled = true
  await expect(executeControlledDocxReadWorker({ ...request(false), contractVersion: NARROW_DOCX_READ_VERSION })).rejects.toThrow('CONTROLLED_READ_FENCE')
  config.controlledDocxReadApprovedEnabled = false; config.controlledDocxReadEnabled = false
  await expect(executeControlledDocxReadWorker({ ...request(false), contractVersion: NARROW_DOCX_READ_VERSION })).rejects.toThrow('CONTROLLED_READ_FENCE')
  expect(read).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
})
