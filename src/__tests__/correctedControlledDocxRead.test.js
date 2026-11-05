import { describe, expect, test } from '@jest/globals'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { CONTROLLED_DOCX_READ_VERSION, CONTROLLED_DOCX_RESULT_VERSION, CORRECTED_DOCX_READ_VERSION,
  CORRECTED_DOCX_RESULT_VERSION, CORRECTED_DOCX_IDENTITY as fixed, CONTROLLED_DOCX_IDENTITY as original,
  assertControlledReadRequest, assertControlledReadData } from '../services/controlledDocxReadContract.js'
import { runControlledDocxReadChild, controlledDocxWorkerEnvironment } from '../services/controlledDocxReadService.js'
import { correctedReadListFixture, correctedReadBundleFixture } from './fixtures/controlledDocxCorrectionFixture.js'
const request = (version = CORRECTED_DOCX_READ_VERSION) => ({ contractVersion: version, operation: 'LIST',
  scope: Object.fromEntries(['actorUserId', 'customerId', 'tenantId', 'runtimeInstanceId'].map(key => [key, fixed[key]])) })

describe('fixed corrected private read profile - unit projections only', () => {
  test('keeps the original identity separate and validates corrected scalar scope', () => {
    expect(original.candidateId).not.toBe(fixed.candidateId)
    expect(assertControlledReadRequest(request())).toEqual(request())
    expect(() => assertControlledReadRequest({ ...request(), contractVersion: 'future' })).toThrow()
    expect(() => assertControlledReadRequest({ ...request(), scope: { ...request().scope, customerId: [fixed.customerId] } })).toThrow()
    expect(() => assertControlledReadRequest({ ...request(), profile: 'caller-selected' })).toThrow()
  })
  test('validates exact corrected metadata and rejects resealed foreign seven-page pixels', () => {
    expect(assertControlledReadData('LIST', correctedReadListFixture(), CORRECTED_DOCX_READ_VERSION)).toBeTruthy()
    expect(() => assertControlledReadData('CURRENT_PREVIEW', correctedReadBundleFixture(), CORRECTED_DOCX_READ_VERSION)).toThrow()
    expect(() => assertControlledReadData('LIST', correctedReadListFixture(), CONTROLLED_DOCX_READ_VERSION)).toThrow()
  })
  test.each(['sourceFingerprint', 'inputFingerprint', 'bodyFingerprint', 'masterBindingFingerprint'])('refuses substituted %s', key => {
    const f = correctedReadListFixture(); f.candidates[0][key] = '0'.repeat(64)
    expect(() => assertControlledReadData('LIST', f, CORRECTED_DOCX_READ_VERSION)).toThrow()
  })
  test.each(['parent', 'self-parent', 'binding version', 'promoted', 'bytes', 'old candidate'])('refuses %s metadata', kind => {
    const f = correctedReadListFixture(), c = f.candidates[0]
    if (kind === 'parent') c.masterBinding.correctionReference.predecessor.failedReviewResultFingerprint = '0'.repeat(64)
    if (kind === 'self-parent') c.masterBinding.correctionReference.predecessor.candidateId = c.candidateId
    if (kind === 'binding version') c.masterBinding.contractVersion = 'master-linked-private-docx-binding.v1'
    if (kind === 'promoted') c.authorisesApproval = true
    if (kind === 'bytes') c.artifact.byteLength++
    if (kind === 'old candidate') c.candidateId = original.candidateId
    expect(() => assertControlledReadData('LIST', f, CORRECTED_DOCX_READ_VERSION)).toThrow()
  })
  test.each(['six pages', 'image bytes', 'page hash', 'conversion hash', 'old preview', 'old body'])('refuses %s preview', kind => {
    const f = correctedReadBundleFixture()
    if (kind === 'six pages') f.pages.pop()
    if (kind === 'image bytes') f.pages[6].base64 = f.pages[6].base64.replace('iVBO', 'AAAA')
    if (kind === 'page hash') f.preview.conversion.pages[6].sha256 = '0'.repeat(64)
    if (kind === 'conversion hash') f.preview.conversionFingerprint = '0'.repeat(64)
    if (kind === 'old preview') f.preview.previewId = original.previewId
    if (kind === 'old body') f.preview.candidateBodyFingerprint = '0'.repeat(64)
    expect(() => assertControlledReadData('CURRENT_PREVIEW', f, CORRECTED_DOCX_READ_VERSION)).toThrow()
  })
  test.each([CORRECTED_DOCX_RESULT_VERSION, CONTROLLED_DOCX_RESULT_VERSION])('binds result framing %s to the originating server choice', async version => {
    class Child extends EventEmitter {
      constructor() { super(); this.pid = 998; this.exitCode = null; this.signalCode = null; this.stdout = new PassThrough(); this.stderr = new PassThrough() }
      send(_request, callback) { callback?.(); queueMicrotask(() => { this.emit('message', { contractVersion: version, operation: 'LIST', status: 'SUCCESS', data: correctedReadListFixture() }); this.finish() }) }
      finish() { this.exitCode = 0; this.emit('close', 0, null) }
      kill() { queueMicrotask(() => this.finish()); return true }
    }
    const promise = runControlledDocxReadChild(request(), { forkChild: (_path, _args, options) => {
      expect(options.env.CONTROLLED_DOCX_READ_CORRECTION_ENABLED).toBe('true'); return new Child()
    } })
    if (version === CORRECTED_DOCX_RESULT_VERSION) await expect(promise).resolves.toEqual(correctedReadListFixture())
    else await expect(promise).rejects.toMatchObject({ code: 'CONTROLLED_DOCX_READ_UNAVAILABLE' })
    expect(controlledDocxWorkerEnvironment(false).CONTROLLED_DOCX_READ_CORRECTION_ENABLED).toBe('false')
  })
})
