import { describe, test, expect, jest, beforeAll, beforeEach } from '@jest/globals'
import express from 'express'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import Receipt, { assertRuntimeProductAuthorityReceipt } from '../models/RuntimeProductAuthorityReceipt.js'
import { parseApprovedProductAuthority, RUNTIME_PRODUCT_AUTHORITY_POLICY as policy } from '../constants/runtimeProductAuthorityPolicy.js'
import { runtimeProductAuthorityBodySchema, validateRuntimeProductAuthorityBody } from '../validators/reviewCompletion.validator.js'

const request = () => ({ requestKey: randomUUID(), expectedBasisHash: 'a'.repeat(64),
  expectedUpdatedAt: '2026-10-15T13:45:46.543Z', approvalDocumentText: 'test transport only', confirm: true })
describe('native authority strict import and immutable model', () => {
  test.each(['requestKey', 'expectedBasisHash', 'expectedUpdatedAt', 'approvalDocumentText', 'confirm'])('requires %s', key => {
    const input = request(); delete input[key]
    expect(runtimeProductAuthorityBodySchema.safeParse(input).success).toBe(false)
  })
  test.each([{ recorder: 'Angus' }, { approver: 'caller' }, { reviewerUserId: 'caller' }, { confirm: false },
    { expectedBasisHash: 'invalid' }, { approvalDocumentText: 'x'.repeat(16001) }])('rejects caller metadata or malformed input %j', extra => {
    expect(runtimeProductAuthorityBodySchema.safeParse({ ...request(), ...extra }).success).toBe(false)
  })
  test.each(['{}', '', 'x'.repeat(7143), null])('rejects all unapproved bytes without manufacturing a document', value => {
    expect(() => parseApprovedProductAuthority(value)).toThrow('exact approved')
  })
  test('contains no finding disposition or approval default', () => {
    expect(policy).not.toHaveProperty('disposition')
    expect(new Receipt().body).toBeUndefined()
    expect(() => assertRuntimeProductAuthorityReceipt({ body: {} })).toThrow()
    expect(Receipt.schema.options).toMatchObject({ autoCreate: false, autoIndex: false, minimize: false })
    expect(Receipt.schema.indexes().map(([fields, options]) => ({ fields, name: options.name, unique: options.unique }))).toEqual([
      { fields: { customerId: 1, tenantId: 1, runtimeInstanceId: 1, approvalReference: 1, approvalVersion: 1 }, name: 'unique_runtime_product_authority_version', unique: true },
      { fields: { customerId: 1, tenantId: 1, runtimeInstanceId: 1, requestKey: 1 }, name: 'unique_runtime_product_authority_request', unique: true },
    ])
  })
  test.each(['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'])('rejects %s before DB access', async method => {
    await expect(Receipt[method]({}, {})).rejects.toThrow('immutable')
  })
  test('rejects bulk deletion before DB access', async () => {
    await expect(Receipt.bulkWrite([{ deleteOne: { filter: {} } }])).rejects.toThrow('immutable')
  })
})

describe('mounted native authority controller with explicit simulated authentication seam', () => {
  const inspect = jest.fn(), record = jest.fn()
  let app
  beforeAll(async () => {
    jest.unstable_mockModule('../services/runtimeProductAuthorityService.js', () => ({
      inspectRuntimeProductAuthority: inspect, importRuntimeProductAuthority: record,
    }))
    jest.unstable_mockModule('../services/supplementalFindingReviewService.js', () => ({
      inspectSupplementalFindingReview: jest.fn(), recordSupplementalFindingReview: jest.fn(),
    }))
    jest.unstable_mockModule('../services/publishedDispositionRecoveryService.js', () => ({
      inspectPublishedDispositionRecovery: jest.fn(), recordPublishedDispositionRecovery: jest.fn(),
    }))
    jest.unstable_mockModule('../services/reviewCompletionService.js', () => ({ getReviewCompletion: jest.fn(), completeReview: jest.fn() }))
    jest.unstable_mockModule('../controllers/runtimeInstance.controller.js', () => ({ buildRuntimeStateRequestScopes: ({ scopes }) => scopes }))
    const handlers = await import('../controllers/reviewCompletion.controller.js')
    app = express(); app.use(express.json())
    app.use((req, _res, next) => {
      req.context = { userId: '698b3800f83b3257365fd7a3' }; req.scopes = { platformRoles: ['SUPER_ADMIN'] }; req.requestId = 'authority-mounted-test'; next()
    })
    app.get('/:runtimeInstanceId/product-authority', handlers.readRuntimeProductAuthority)
    app.post('/:runtimeInstanceId/product-authority', validateRuntimeProductAuthorityBody, handlers.recordRuntimeProductAuthority)
    app.use((_error, _req, res, _next) => res.status(500).json({ error: { code: 'UNEXPECTED_DEPENDENCY_FAILURE' } }))
  })
  beforeEach(() => { inspect.mockReset(); record.mockReset() })
  const path = '/6ace5ee09bd4472c6be0cb07/product-authority'
  test('passes actual authenticated recorder separately from source approver', async () => {
    record.mockResolvedValue({ receipt: { authorisesLock: false, authorisesARL: false }, replay: false })
    const input = request(), response = await supertest(app).post(path).send(input)
    expect(response.status).toBe(200)
    expect(record.mock.calls[0][0]).toMatchObject({ actorUserId: '698b3800f83b3257365fd7a3', payload: input,
      scopes: { platformRoles: ['SUPER_ADMIN'] } })
    expect(response.body.data.receipt).toMatchObject({ authorisesLock: false, authorisesARL: false })
  })
  test('rejects spoofed recorder before the service', async () => {
    const response = await supertest(app).post(path).send({ ...request(), recorder: 'Angus' })
    expect(response.status).toBe(422); expect(record).not.toHaveBeenCalled()
  })
  test.each(['get', 'post'])('fails closed for rejected %s authority dependency', async method => {
    const operation = method === 'get' ? inspect : record
    operation.mockRejectedValue(Object.assign(new Error('Unavailable authority audit'), { status: 503, code: 'PRODUCT_AUTHORITY_AUDIT_INVALID' }))
    const response = await supertest(app)[method](path).send(method === 'post' ? request() : undefined)
    expect(response.status).toBe(503); expect(response.body).not.toHaveProperty('data')
    expect(response.body.error.code).toBe('PRODUCT_AUTHORITY_AUDIT_INVALID')
  })
})
