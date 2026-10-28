import { describe, test, expect, jest, beforeAll, beforeEach } from '@jest/globals'
import express from 'express'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import Receipt from '../models/RuntimeSyntheticTestDispositionReceipt.js'
import { syntheticTestDispositionBodySchema, validateSyntheticTestDispositionBody } from '../validators/syntheticTestDisposition.validator.js'
import { parseSyntheticTestAmendment } from '../constants/syntheticTestDispositionPolicy.js'

const input = () => ({ requestKey: randomUUID(), expectedBasisHash: 'a'.repeat(64),
  expectedUpdatedAt: '2026-10-15T13:45:46.543Z', amendmentDocumentText: '{}',
  disposition: 'REOPENED', rationale: 'Isolated engineering test; not an actual Angus decision.',
  decisionSource: { reference: 'engineering-test-only', text: 'Synthetic test input only; never an operational human decision.',
    decidedAt: '2026-10-16T15:27:18Z' }, conflictDisclosed: true, recorderAttestsDecision: true, confirm: true })
describe('distinct synthetic request contract', () => {
  test.each(['NOT_CONTRADICTORY', 'CONFIRMED', 'REOPENED'])('requires explicit governed %s', disposition => {
    expect(syntheticTestDispositionBodySchema.parse({ ...input(), disposition }).disposition).toBe(disposition)
  })
  test.each(Object.keys(input()))('rejects omitted %s', field => {
    const body = input(); delete body[field]
    expect(syntheticTestDispositionBodySchema.safeParse(body).success).toBe(false)
  })
  test.each([{ actorUserId: 'Angus' }, { reviewer: 'Andrew' }, { authorisesLock: true },
    { conflictDisclosed: false }, { recorderAttestsDecision: false }, { confirm: false },
    { disposition: 'APPROVED' }, { rationale: 'short' }, { expectedBasisHash: 'bad' },
    { decisionSource: { reference: 'missing text/time' } }])('rejects unsafe request %j', override => {
    expect(syntheticTestDispositionBodySchema.safeParse({ ...input(), ...override }).success).toBe(false)
  })
  test.each(['{}', '', null])('rejects unapproved amendment bytes %j', source => {
    expect(() => parseSyntheticTestAmendment(source)).toThrow('exact adopted')
  })
  test('uses distinct scoped uniqueness without automatic operational indexes', () => {
    expect(Receipt.collection.name).toBe('runtime_synthetic_test_disposition_receipts')
    expect(Receipt.schema.options.autoIndex).toBe(false)
    expect(Receipt.schema.indexes().map(([, options]) => options.name)).toEqual([
      'unique_synthetic_test_policy', 'unique_synthetic_test_request'])
  })
  test.each(['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace',
    'deleteOne', 'deleteMany', 'findOneAndDelete'])('rejects immutable %s before database access', async method => {
    await expect(Receipt[method]({}, {})).rejects.toThrow('immutable')
  })
  test('rejects bulk mutation before database access', async () => {
    await expect(Receipt.bulkWrite([{ deleteOne: { filter: {} } }])).rejects.toThrow('immutable')
  })
})
describe('mounted synthetic receipt controller', () => {
  const read = jest.fn(), write = jest.fn()
  let app
  beforeAll(async () => {
    jest.unstable_mockModule('../services/syntheticTestDispositionService.js', () => ({
      inspectSyntheticTestDisposition: read, recordSyntheticTestDisposition: write,
    }))
    jest.unstable_mockModule('../controllers/runtimeInstance.controller.js', () => ({
      buildRuntimeStateRequestScopes: ({ scopes }) => scopes,
    }))
    const controller = await import('../controllers/syntheticTestDisposition.controller.js')
    app = express(); app.use(express.json())
    app.use((req, _res, next) => {
      req.context = { userId: '698b3800f83b3257365fd7a3' }
      req.scopes = { platformRoles: ['SUPER_ADMIN'] }; req.requestId = 'engineering-test'
      next()
    })
    app.get('/:runtimeInstanceId/synthetic-test-disposition', controller.readSyntheticTestDisposition)
    app.post('/:runtimeInstanceId/synthetic-test-disposition', validateSyntheticTestDispositionBody, controller.saveSyntheticTestDisposition)
    app.use((_error, _req, res, _next) => res.status(500).json({ error: { code: 'UNEXPECTED_FAILURE' } }))
  })
  beforeEach(() => { read.mockReset(); write.mockReset() })
  const path = '/6ace5ee09bd4472c6be0cb07/synthetic-test-disposition'
  test('forwards authenticated recorder and exact source separately', async () => {
    write.mockResolvedValue({ receipt: { authorisesCompletion: false, authorisesLock: false, authorisesARL: false }, replay: false })
    const body = input(), response = await supertest(app).post(path).send(body)
    expect(response.status).toBe(200)
    expect(write.mock.calls[0][0]).toMatchObject({ actorUserId: '698b3800f83b3257365fd7a3', payload: body })
    expect(response.body.data.receipt.authorisesLock).toBe(false)
  })
  test('rejects spoofed recorder before invoking service', async () => {
    expect((await supertest(app).post(path).send({ ...input(), actorUserId: 'Angus' })).status).toBe(422)
    expect(write).not.toHaveBeenCalled()
  })
  test.each(['get', 'post'])('rejects failed %s dependency without empty success', async method => {
    ;(method === 'get' ? read : write).mockRejectedValue(Object.assign(new Error('Audit unavailable'), {
      status: 503, code: 'SYNTHETIC_TEST_AUDIT_INVALID',
    }))
    const response = await supertest(app)[method](path).send(method === 'post' ? input() : undefined)
    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('SYNTHETIC_TEST_AUDIT_INVALID')
    expect(response.body).not.toHaveProperty('data')
  })
  test('propagates unexpected rejected dependency through mounted error handler', async () => {
    read.mockRejectedValue(new Error('Unexpected driver failure'))
    expect((await supertest(app).get(path)).status).toBe(500)
  })
})
