import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import express from 'express'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import authJwt from '../middleware/authJwt.js'

describe('private DOCX mounted transport (authenticated successes use simulated context)', () => {
  const owners = { createPrivateDocxCandidate: jest.fn(), readPrivateDocxCandidate: jest.fn(), listCurrentPrivateDocxCandidates: jest.fn() }
  const runtime = '507f1f77bcf86cd799439013', actor = '507f1f77bcf86cd799439014'
  const customer = '507f1f77bcf86cd799439012', tenant = '507f1f77bcf86cd799439011'
  const candidateId = `docx_candidate_${randomUUID()}`
  const route = `/${runtime}/outcome-studio/docx-candidates`
  const query = `?customerId=${customer}&tenantId=${tenant}`
  const payload = () => ({ requestKey: randomUUID(), expectedSourceFingerprint: 'a'.repeat(64), format: 'DOCX' })
  let app, unauthenticatedApp
  beforeAll(async () => {
    jest.unstable_mockModule('../services/outcomeDocxCandidatePersistenceService.js', () => owners)
    jest.unstable_mockModule('../controllers/runtimeInstance.controller.js', () => ({
      buildRuntimeStateRequestScopes: ({ query }) => ({ selectedCustomerId: query.customerId, selectedTenantId: query.tenantId }),
    }))
    const handlers = await import('../controllers/outcomeDocxCandidate.controller.js')
    const validators = await import('../validators/outcomeDocxCandidate.validator.js')
    const { validateIsolatedSyntheticScope } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    const mount = target => {
      target.post('/:runtimeInstanceId/outcome-studio/docx-candidates', validateIsolatedSyntheticScope, validators.validatePrivateDocxCandidateCreate, handlers.createPrivateDocxCandidateEndpoint)
      target.get('/:runtimeInstanceId/outcome-studio/docx-candidates', validateIsolatedSyntheticScope, handlers.listCurrentPrivateDocxCandidatesEndpoint)
      target.get('/:runtimeInstanceId/outcome-studio/docx-candidates/:candidateId', validateIsolatedSyntheticScope, validators.validatePrivateDocxCandidateParams, handlers.readPrivateDocxCandidateEndpoint)
      target.get('/:runtimeInstanceId/outcome-studio/docx-candidates/:candidateId/file', validateIsolatedSyntheticScope, validators.validatePrivateDocxCandidateParams, handlers.readPrivateDocxCandidateFileEndpoint)
      target.use((_error, _req, res, _next) => res.status(500).json({ error: { code: 'REJECTED_DEPENDENCY' } }))
    }
    app = express(); app.use(express.json()); app.use((req, _res, next) => { req.context = { userId: actor }; req.scopes = {}; req.requestId = 'mounted-unit'; next() }); mount(app)
    unauthenticatedApp = express(); unauthenticatedApp.use(express.json()); unauthenticatedApp.use(authJwt); mount(unauthenticatedApp)
  })
  beforeEach(() => Object.values(owners).forEach(owner => owner.mockReset()))
  test('scoped discovery is read-only metadata and rejects scope overrides', async () => {
    owners.listCurrentPrivateDocxCandidates.mockResolvedValue({ scope: { tenantId: tenant, customerId: customer, runtimeInstanceId: runtime }, sourceFingerprint: 'a'.repeat(64), candidates: [] })
    const response = await supertest(app).get(route + query)
    expect(response.status).toBe(200); expect(response.body.data.candidates).toEqual([])
    expect(owners.listCurrentPrivateDocxCandidates).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actor, scopes: { selectedCustomerId: customer, selectedTenantId: tenant } }))
    expect((await supertest(app).get(route + query + '&includeBytes=true')).status).toBe(422)
    expect((await supertest(app).get(route + query + '&includeInput=true')).status).toBe(422)
    expect(owners.createPrivateDocxCandidate).not.toHaveBeenCalled()
  })
  test('real JWT middleware rejects missing authorization before any candidate owner', async () => {
    expect((await supertest(unauthenticatedApp).post(route + query).send(payload())).status).toBe(401)
    expect(owners.createPrivateDocxCandidate).not.toHaveBeenCalled()
    expect((await supertest(unauthenticatedApp).get(`${route}/${candidateId}/file${query}`)).status).toBe(401)
    expect(owners.readPrivateDocxCandidate).not.toHaveBeenCalled()
  })
  test.each(['source', 'actorUserId', 'classification', 'deps', 'officialUse', 'packReceipts'])('rejects body %s override before calling owner', async key => {
    expect((await supertest(app).post(route + query).send({ ...payload(), [key]: true })).status).toBe(422)
    expect(owners.createPrivateDocxCandidate).not.toHaveBeenCalled()
  })
  test('passes trusted identity, strict request and scoped query', async () => {
    const body = payload(); owners.createPrivateDocxCandidate.mockResolvedValue({ candidate: { candidateId, status: 'PRIVATE_UNREVIEWED' }, idempotent: false })
    const response = await supertest(app).post(route + query).send(body)
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store')
    expect(owners.createPrivateDocxCandidate).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actor,
      runtimeInstanceId: runtime, payload: body, scopes: { selectedCustomerId: customer, selectedTenantId: tenant } }))
  })
  test('returns exact private bytes and never serializes them as metadata', async () => {
    const buffer = Buffer.from('Private binary fixture')
    owners.readPrivateDocxCandidate.mockImplementation(async input => ({ candidate: { candidateId,
      artifact: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } }, ...(input.includeBytes ? { buffer } : {}) }))
    const file = await supertest(app).get(`${route}/${candidateId}/file${query}`).buffer(true).parse((response, done) => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => done(null, Buffer.concat(chunks)))
      response.on('error', done)
    })
    expect(file.status).toBe(200); expect(file.body.equals(buffer)).toBe(true)
    expect(file.headers['cache-control']).toBe('no-store')
    expect(file.headers['x-outcome-candidate-status']).toBe('PRIVATE_UNREVIEWED')
    expect(file.headers['content-disposition']).toBe('inline; filename="private-outcome-candidate.docx"')
    const metadata = await supertest(app).get(`${route}/${candidateId}${query}`)
    expect(metadata.body.data.buffer).toBeUndefined()
  })
  test.each([403, 409, 503, 500])('preserves rejected source/database/audit promise (%s)', async status => {
    const error = status === 500 ? new Error('Dependency failed') : Object.assign(new Error('Unavailable'), { status, code: 'CANDIDATE_REJECTED', details: { reason: 'SOURCE_OR_STORE_UNAVAILABLE' } })
    owners.readPrivateDocxCandidate.mockRejectedValue(error)
    const response = await supertest(app).get(`${route}/${candidateId}/file${query}`)
    expect(response.status).toBe(status)
    expect(response.body.error.code).toBe(status === 500 ? 'REJECTED_DEPENDENCY' : 'CANDIDATE_REJECTED')
  })
  test('does not convert shared-user cross-customer rejection to empty success', async () => {
    owners.readPrivateDocxCandidate.mockImplementation(async input => {
      if (input.scopes.selectedCustomerId !== customer) throw Object.assign(new Error('Denied'), { status: 403, code: 'SOURCE_DENIED' })
      return { candidate: { candidateId } }
    })
    const response = await supertest(app).get(`${route}/${candidateId}?customerId=507f1f77bcf86cd799439015&tenantId=${tenant}`)
    expect(response.status).toBe(403); expect(response.body.error.code).toBe('SOURCE_DENIED')
    expect(owners.readPrivateDocxCandidate).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actor }))
  })
  test('rejects candidate or query overrides and runtime router retains global auth mount', async () => {
    expect((await supertest(app).get(`${route}/bad-candidate${query}`)).status).toBe(422)
    expect((await supertest(app).get(`${route}/${candidateId}${query}&includeBytes=true`)).status).toBe(422)
    expect(owners.readPrivateDocxCandidate).not.toHaveBeenCalled()
    const source = readFileSync(new URL('../routes/runtimeInstances.routes.js', import.meta.url), 'utf8')
    expect(source.indexOf('router.use(authJwt, loadScopes)')).toBeLessThan(source.indexOf("router.post('/:runtimeInstanceId/outcome-studio/docx-candidates'"))
  })
})
