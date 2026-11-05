import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import express from 'express'
import supertest from 'supertest'
import authJwt from '../middleware/authJwt.js'

describe('private preview mounted transport; authenticated successes use simulated context', () => {
  const owners = { createDocxPagePreview: jest.fn(), readCurrentDocxPagePreview: jest.fn(), readDocxPagePreview: jest.fn() }
  const runtime = '507f1f77bcf86cd799439013', customer = '507f1f77bcf86cd799439012', tenant = '507f1f77bcf86cd799439011'
  const actor = '507f1f77bcf86cd799439014', candidateId = 'docx_candidate_12345678-1234-4234-8234-123456789012'
  const previewId = 'docx_preview_12345678-1234-4234-8234-123456789012'
  const route = `/${runtime}/outcome-studio/docx-candidates/${candidateId}/page-previews`, query = `?customerId=${customer}&tenantId=${tenant}`
  const payload = { expectedSourceFingerprint: 'a'.repeat(64), expectedOutputChecksum: `sha256:${'b'.repeat(64)}` }
  let app, unauthenticated
  beforeAll(async () => {
    jest.unstable_mockModule('../services/outcomeDocxPagePreviewPersistenceService.js', () => owners)
    jest.unstable_mockModule('../controllers/runtimeInstance.controller.js', () => ({ buildRuntimeStateRequestScopes: ({ query: q }) => ({ selectedCustomerId: q.customerId, selectedTenantId: q.tenantId }) }))
    const handlers = await import('../controllers/outcomeDocxPagePreview.controller.js')
    const validators = await import('../validators/outcomeDocxPagePreview.validator.js')
    const parent = await import('../validators/outcomeDocxCandidate.validator.js')
    const { validateIsolatedSyntheticScope } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    const mount = target => {
      const base = '/:runtimeInstanceId/outcome-studio/docx-candidates/:candidateId/page-previews'
      target.post(base, validateIsolatedSyntheticScope, parent.validatePrivateDocxCandidateParams, validators.validateDocxPagePreviewCreate, handlers.createDocxPagePreviewEndpoint)
      target.get(base, validateIsolatedSyntheticScope, parent.validatePrivateDocxCandidateParams, handlers.readCurrentDocxPagePreviewEndpoint)
      target.get('/:runtimeInstanceId/outcome-studio/docx-candidates/:candidateId/page-preview-bundle', validateIsolatedSyntheticScope, parent.validatePrivateDocxCandidateParams, handlers.readCurrentDocxPagePreviewBundleEndpoint)
      target.get(`${base}/:previewId/bundle`, validateIsolatedSyntheticScope, validators.validateDocxPagePreviewParams, handlers.readDocxPagePreviewBundleEndpoint)
      target.get(`${base}/:previewId`, validateIsolatedSyntheticScope, validators.validateDocxPagePreviewParams, handlers.readDocxPagePreviewEndpoint)
      target.use((_err, _req, res, _next) => res.status(500).json({ error: { code: 'REJECTED_DEPENDENCY' } }))
    }
    app = express(); app.use(express.json()); app.use((req, _res, next) => { req.context = { userId: actor }; req.requestId = 'preview-mounted'; next() }); mount(app)
    unauthenticated = express(); unauthenticated.use(express.json()); unauthenticated.use(authJwt); mount(unauthenticated)
  })
  beforeEach(() => Object.values(owners).forEach(owner => owner.mockReset()))
  test('JWT denies before preview operations', async () => {
    expect((await supertest(unauthenticated).post(route + query).send(payload)).status).toBe(401)
    expect((await supertest(unauthenticated).get(`${route}/${previewId}/bundle${query}`)).status).toBe(401)
    expect(owners.createDocxPagePreview).not.toHaveBeenCalled(); expect(owners.readDocxPagePreview).not.toHaveBeenCalled()
  })
  test.each(['deps', 'runtimeProfile', 'source', 'actorUserId', 'scope', 'authorisesApproval'])('rejects %s override', async key => {
    expect((await supertest(app).post(route + query).send({ ...payload, [key]: true })).status).toBe(422)
    expect(owners.createDocxPagePreview).not.toHaveBeenCalled()
  })
  test('passes actor and candidate request to owner; emits no-store metadata', async () => {
    owners.createDocxPagePreview.mockResolvedValue({ preview: { previewId }, idempotent: false })
    const response = await supertest(app).post(route + query).send(payload)
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store'); expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(owners.createDocxPagePreview).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actor, candidateId, payload,
      scopes: { selectedCustomerId: customer, selectedTenantId: tenant } }))
  })
  test('single bundle returns exact base64 bytes with no Buffer JSON or diagnostics', async () => {
    const buffer = Buffer.from('Generic bytes at transport seam')
    owners.readDocxPagePreview.mockResolvedValue({ preview: { previewId, inputFingerprint: 'a'.repeat(64) }, pages: [buffer],
      document: { title: 'Generic paper', markdown: '# Generic paper', inputFingerprint: 'a'.repeat(64), privatePath: 'secret' }, diagnostics: { privatePath: 'secret' } })
    const response = await supertest(app).get(`${route}/${previewId}/bundle${query}`)
    expect(response.status).toBe(200); expect(Buffer.from(response.body.data.pages[0].base64, 'base64').equals(buffer)).toBe(true)
    expect(response.body.data.pages[0]).toEqual({ number: 1, mimeType: 'image/png', base64: buffer.toString('base64') })
    expect(response.text).not.toMatch(/privatePath|secret|"type":"Buffer"/)
  })
  test('missing current preview returns null without mapping absent buffers', async () => {
    owners.readCurrentDocxPagePreview.mockResolvedValue({ preview: null })
    const currentRoute = route.replace('/page-previews', '/page-preview-bundle')
    const response = await supertest(app).get(currentRoute + query)
    expect(response.status).toBe(200); expect(response.body.data).toEqual({ preview: null })
  })
  test('bundle refuses an unrelated text alternative', async () => {
    owners.readDocxPagePreview.mockResolvedValue({ preview: { previewId, inputFingerprint: 'a'.repeat(64) }, pages: [],
      document: { title: 'Generic', markdown: 'Changed', inputFingerprint: 'b'.repeat(64) } })
    const response = await supertest(app).get(`${route}/${previewId}/bundle${query}`)
    expect(response.status).toBe(409); expect(response.body.error.reason).toBe('PREVIEW_TEXT_UNAVAILABLE')
  })
  test('oversized serialized envelope fails without returning bytes', async () => {
    owners.readDocxPagePreview.mockResolvedValue({ preview: { previewId, inputFingerprint: 'a'.repeat(64) }, pages: [Buffer.alloc(10 * 1024 ** 2)],
      document: { title: 'Generic', markdown: 'Generic', inputFingerprint: 'a'.repeat(64) } })
    const response = await supertest(app).get(`${route}/${previewId}/bundle${query}`)
    expect(response.status).toBe(409); expect(response.body.error.reason).toBe('PREVIEW_RESPONSE_LIMIT'); expect(response.body.data).toBeUndefined()
  })
  test.each([403, 409, 503, 500])('propagates downstream failure %s', async status => {
    owners.readDocxPagePreview.mockRejectedValue(status === 500 ? new Error('Rejected') : Object.assign(new Error('Unavailable'), { status, code: 'PREVIEW_DENIED', details: { reason: 'CURRENTNESS_DENIED' } }))
    const response = await supertest(app).get(`${route}/${previewId}/bundle${query}`)
    expect(response.status).toBe(status); expect(response.body.data).toBeUndefined()
  })
  test('rejects bad preview and query override before read owner', async () => {
    expect((await supertest(app).get(`${route}/bad/bundle${query}`)).status).toBe(422)
    expect((await supertest(app).get(`${route}/${previewId}/bundle${query}&includePages=true`)).status).toBe(422)
    expect(owners.readDocxPagePreview).not.toHaveBeenCalled()
  })
})
