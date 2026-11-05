import { correctedReadListFixture, correctedReadBundleFixture } from './fixtures/controlledDocxCorrectionFixture.js'
import { CORRECTED_DOCX_READ_VERSION, CORRECTED_DOCX_IDENTITY as correctedFixed } from '../services/controlledDocxReadContract.js'
import { beforeAll, beforeEach, afterAll, describe, expect, jest, test } from '@jest/globals'
import express from 'express'
import supertest from 'supertest'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { APPROVED_DOCX_READ_VERSION, NARROW_DOCX_READ_VERSION } from '../services/approvedDocxReadProfile.js'
import env from '../config/env.js'
import authJwt from '../middleware/authJwt.js'
import tokenService from '../services/tokenService.js'
import { readControlledDocxAuthority } from '../services/controlledDocxReadAuthority.js'
import * as owner from '../services/controlledDocxReadService.js'
import { CONTROLLED_DOCX_IDENTITY as fixed, CONTROLLED_DOCX_PROVENANCE, controlledScope } from '../services/controlledDocxReadContract.js'

// Actual JWT/handlers/authority decisions; database rows and child result are explicit unit fixtures.
// No valid default worker, Mongo connection or provider may run in this suite.
describe('normal API controlled document read transport', () => {
  const original = { ...env }, sha = value => createHash('sha256').update(value).digest('hex')
  const flags = { classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', authoritative: false, officialUse: false,
    normalOutputAvailable: false, authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false }
  const candidate = () => ({ ...flags, contractVersion: 'private-docx-candidate.v2', candidateId: fixed.candidateId,
    status: 'PRIVATE_UNREVIEWED', sourceFingerprint: 'a'.repeat(64), inputFingerprint: 'b'.repeat(64),
    bodyFingerprint: 'c'.repeat(64), masterBindingFingerprint: 'd'.repeat(64), renderer: { version: '0.1.3' },
    artifact: { format: 'DOCX', outputChecksum: `sha256:${'1'.repeat(64)}` } })
  const list = () => ({ scope: controlledScope(), sourceFingerprint: 'a'.repeat(64), candidates: [candidate()] })
  const bundle = () => {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
    const bytes = Buffer.from(base64, 'base64'), c = candidate()
    return { preview: { ...flags, contractVersion: 'private-docx-page-preview.v2', status: 'PRIVATE_PREVIEW_ONLY',
      previewId: fixed.previewId, candidateId: fixed.candidateId, scope: controlledScope(), renderer: c.renderer,
      sourceFingerprint: c.sourceFingerprint, inputFingerprint: c.inputFingerprint,
      candidateBodyFingerprint: c.bodyFingerprint, masterBindingFingerprint: c.masterBindingFingerprint,
      conversion: { contractVersion: 'DOCX_PAGE_PREVIEW_V1', pages: Array.from({ length: 6 }, (_, index) => ({
        number: index + 1, width: 1, height: 1, byteLength: bytes.length, sha256: sha(bytes),
      })) } }, pages: Array.from({ length: 6 }, (_, index) => ({ number: index + 1, mimeType: 'image/png', base64 })),
    document: { title: 'Unit fixture', markdown: '# Unit fixture', inputFingerprint: c.inputFingerprint } }
  }
  const permissions = () => ({ platform: { roleKeys: [], permissions: [] },
    customers: [{ customerId: fixed.customerId, roleKeys: ['VMF_USER'], permissions: ['VMF_UPDATE', 'VMF_VIEW'] }], tenants: [] })
  let app, nativeUser, grants, runtime, runChild, authorityCalls, authorityReject, mutateAfterRead, jwtBlacklisted, userToken, mongoConnect, blacklist
  const route = `/api/v1/runtime-instances/${fixed.runtimeInstanceId}/outcome-studio/docx-candidates`
  const query = `?customerId=${fixed.customerId}&tenantId=${fixed.tenantId}`
  const call = (path = route + query, token = userToken) => supertest(app).get(path).set('Authorization', `Bearer ${token}`)
  beforeAll(async () => {
    mongoConnect = jest.spyOn(mongoose.mongo.MongoClient.prototype, 'connect').mockImplementation(() => { throw new Error('LIVE_MONGO_FORBIDDEN') })
    blacklist = jest.spyOn(tokenService, 'isTokenBlacklisted').mockImplementation(async () => jwtBlacklisted)
    const readAuthority = async args => {
      authorityCalls++
      if (authorityReject === authorityCalls) throw new Error('REJECTED_NATIVE_DEPENDENCY')
      return readControlledDocxAuthority(args, { tokenService, readUser: async () => nativeUser,
        buildPermissions: async () => ({ resolvedPermissions: grants }), readRuntime: async () => runtime })
    }
    const handler = owner.createControlledDocxReadRequestHandler({ env,
      readAuthority, runChild: (...args) => runChild(...args) })
    jest.unstable_mockModule('../services/controlledDocxReadService.js', () => ({ ...owner, readControlledDocxForRequest: handler }))
    const candidateHandlers = await import('../controllers/outcomeDocxCandidate.controller.js')
    const previewHandlers = await import('../controllers/outcomeDocxPagePreview.controller.js')
    const { validateIsolatedSyntheticScope } = await import('../validators/isolatedSyntheticOutcome.validator.js')
    app = express()
    app.use((req, _res, next) => { req.context = {}; req.requestId = 'unit-controlled-read'; next() })
    app.use(authJwt)
    // Existing loadScopes/native persistence is exercised in the separately gated live proof.
    app.use((req, _res, next) => { req.scopes = {}; next() })
    app.get('/api/v1/runtime-instances/:runtimeInstanceId/outcome-studio/docx-candidates', validateIsolatedSyntheticScope, candidateHandlers.listCurrentPrivateDocxCandidatesEndpoint)
    app.get('/api/v1/runtime-instances/:runtimeInstanceId/outcome-studio/docx-candidates/:candidateId/page-preview-bundle', validateIsolatedSyntheticScope, previewHandlers.readCurrentDocxPagePreviewBundleEndpoint)
    app.use((_error, _req, res, _next) => res.status(503).json({ error: { code: 'DEPENDENCY_UNAVAILABLE' } }))
  })
  beforeEach(() => {
    Object.assign(env, { nodeEnv: 'test', appEnv: 'development', controlledDocxReadEnabled: true, controlledDocxReadCorrectionEnabled: false,
      controlledDocxReadApprovedEnabled: false, controlledDocxReadNarrowEnabled: false, developmentStartupTasksEnabled: false })
    nativeUser = { _id: fixed.actorUserId, isActive: true }; grants = permissions()
    runtime = { id: fixed.runtimeInstanceId, customerId: fixed.customerId, tenantId: fixed.tenantId, runtimeType: 'VALUE_NARRATIVE', status: 'LOCKED' }
    authorityCalls = 0; authorityReject = 0; mutateAfterRead = null; jwtBlacklisted = false
    runChild = jest.fn(async request => { const result = request.operation === 'LIST' ? list() : bundle(); mutateAfterRead?.(); return result })
    userToken = jwt.sign({ userId: fixed.actorUserId, type: 'access' }, env.jwtSecret,
      { issuer: 'storylineos-vmf-api', audience: 'storylineos-vmf-client', expiresIn: '10m' })
  })
  afterAll(() => { Object.assign(env, original); blacklist.mockRestore(); expect(mongoConnect).not.toHaveBeenCalled(); mongoConnect.mockRestore() })
  test.each([0, 1, 2])('approved profile mounted route checks both authority observations (%s rejection)', async when => {
    const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/approvedDocxReadFixture.json', import.meta.url)))
    env.controlledDocxReadApprovedEnabled = true; authorityReject = when
    runChild = jest.fn(async request => {
      expect(request.contractVersion).toBe(APPROVED_DOCX_READ_VERSION); expect(request).not.toHaveProperty('authorization')
      return { scope: controlledScope(), sourceFingerprint: metadata.candidate.sourceFingerprint, candidates: [metadata.candidate] }
    })
    const response = await call()
    expect(response.status).toBe(when ? 503 : 200)
    if (when) expect(response.body.data).toBeUndefined()
    else expect(response.body.data.candidates[0]).toMatchObject({ candidateId: metadata.candidate.candidateId, authorisesApproval: false })
    expect(runChild).toHaveBeenCalledTimes(when === 1 ? 0 : 1)
  })
  test.each([0, 1, 2])('narrow profile mounted route preserves both native authority observations (%s rejection)', async when => {
    const metadata = JSON.parse(fs.readFileSync(new URL('./fixtures/narrowDocxReadFixture.json', import.meta.url)))
    env.controlledDocxReadNarrowEnabled = true; authorityReject = when
    runChild = jest.fn(async request => {
      expect(request.contractVersion).toBe(NARROW_DOCX_READ_VERSION); expect(request).not.toHaveProperty('authorization')
      return { scope: controlledScope(), sourceFingerprint: metadata.candidate.sourceFingerprint, candidates: [metadata.candidate] }
    })
    const response = await call()
    expect(response.status).toBe(when ? 503 : 200)
    if (when) expect(response.body.data).toBeUndefined()
    else expect(response.body.data.candidates[0]).toMatchObject({ candidateId: metadata.candidate.candidateId, authorisesApproval: false })
    expect(runChild).toHaveBeenCalledTimes(when === 1 ? 0 : 1)
    expect(authorityCalls).toBe(when === 1 ? 1 : 2)
  })
  test('approved profile refuses a shared user with only the other customer tenant grant before child', async () => {
    env.controlledDocxReadApprovedEnabled = true
    grants = { ...permissions(), customers: [], tenants: [{ customerId: '000000000000000000000001', tenantId: fixed.tenantId,
      roleKeys: ['TENANT_ADMIN'], permissions: ['VMF_UPDATE'] }] }
    const response = await call(); expect(response.status).toBe(403); expect(response.body.data).toBeUndefined(); expect(runChild).not.toHaveBeenCalled()
  })
  test('server selects the corrected profile on the same authenticated normal route', async () => {
    env.controlledDocxReadCorrectionEnabled = true
    runChild = jest.fn(async request => { expect(request.contractVersion).toBe(CORRECTED_DOCX_READ_VERSION); return correctedReadListFixture() })
    const response = await call()
    expect(response.status).toBe(200); expect(response.body.data.candidates[0].candidateId).toBe(correctedFixed.candidateId)
    expect(response.body.data.candidates[0].deliveryAvailable).toBe(false); expect(authorityCalls).toBe(2)
  })
  test('corrected preview refuses resealed foreign pages and the previous candidate selection', async () => {
    env.controlledDocxReadCorrectionEnabled = true
    runChild = jest.fn(async () => correctedReadBundleFixture())
    const response = await call(route + '/' + correctedFixed.candidateId + '/page-preview-bundle' + query)
    expect(response.status).toBe(409); expect(response.body.data).toBeUndefined()
    runChild.mockClear()
    expect((await call(route + '/' + fixed.candidateId + '/page-preview-bundle' + query)).status).toBe(409)
    expect(runChild).not.toHaveBeenCalled()
  })
  test.each([1, 2])('corrected read preserves native dependency refusal at observation %s', async when => {
    env.controlledDocxReadCorrectionEnabled = true; authorityReject = when
    runChild = jest.fn(async () => correctedReadListFixture())
    const response = await call(); expect(response.status).toBe(503); expect(response.body.data).toBeUndefined()
    expect(runChild).toHaveBeenCalledTimes(when === 1 ? 0 : 1)
  })
  test('normal handler returns exact held candidate only after both current authority checks', async () => {
    const response = await call()
    expect(response.status).toBe(200); expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.data.candidates[0].storageProvenance).toEqual(CONTROLLED_DOCX_PROVENANCE)
    expect(response.body.data.candidates[0].authorisesApproval).toBe(false)
    expect(authorityCalls).toBe(2); expect(runChild).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(runChild.mock.calls[0][0])).not.toContain(userToken)
  })
  test('same normal API previews six held pages with snapshot provenance', async () => {
    const response = await call(`${route}/${fixed.candidateId}/page-preview-bundle${query}`)
    expect(response.status).toBe(200); expect(response.body.data.pages).toHaveLength(6)
    expect(response.body.data.preview.storageProvenance).toEqual(CONTROLLED_DOCX_PROVENANCE)
    expect(response.body.data.preview.deliveryAvailable).toBe(false)
  })
  test.each([1, 2])('rejected native dependency at observation %s never returns private data', async when => {
    authorityReject = when; const response = await call()
    expect(response.status).toBe(503); expect(response.body.data).toBeUndefined()
    expect(runChild).toHaveBeenCalledTimes(when === 1 ? 0 : 1)
  })
  test.each(['inactive', 'missing roles', 'mixed permission', 'foreign customer', 'shared tenant other customer', 'global only'])('rejects %s before child', async kind => {
    if (kind === 'inactive') nativeUser.isActive = false
    if (kind === 'missing roles') delete grants.customers[0].roleKeys
    if (kind === 'mixed permission') grants.customers[0].permissions.push(null)
    if (kind === 'foreign customer') grants.customers[0].customerId = '000000000000000000000001'
    if (kind === 'shared tenant other customer') grants = { ...permissions(), customers: [], tenants: [{ customerId: '000000000000000000000001', tenantId: fixed.tenantId, roleKeys: ['TENANT_ADMIN'], permissions: ['VMF_UPDATE'] }] }
    if (kind === 'global only') grants = { platform: { roleKeys: ['SUPER_ADMIN'], permissions: ['VMF_UPDATE'] }, customers: [], tenants: [] }
    const response = await call(); expect(response.status).toBe(kind === 'inactive' ? 401 : 403); expect(response.body.data).toBeUndefined(); expect(runChild).not.toHaveBeenCalled()
  })
  test.each(['logout', 'permission loss', 'runtime change', 'actor change'])('discards buffered result after %s', async kind => {
    mutateAfterRead = () => {
      if (kind === 'logout') jwtBlacklisted = true
      if (kind === 'permission loss') grants.customers[0].permissions = []
      if (kind === 'runtime change') runtime.status = 'DRAFT'
      if (kind === 'actor change') nativeUser._id = '000000000000000000000001'
    }
    const response = await call(); expect(response.status).toBe(kind === 'logout' || kind === 'actor change' ? 401 : 403)
    expect(response.body.data).toBeUndefined(); expect(runChild).toHaveBeenCalledTimes(1)
  })
  test('wrong candidate refuses without child or native fallback', async () => {
    expect((await call(`${route}/docx_candidate_12345678-1234-4234-8234-123456789012/page-preview-bundle${query}`)).status).toBe(409)
    expect(runChild).not.toHaveBeenCalled()
  })
  test('missing normal JWT and rejected JWT dependency are denied before document lookup', async () => {
    expect((await supertest(app).get(route + query)).status).toBe(401)
    blacklist.mockRejectedValueOnce(new Error('SECURITY_STORE_FAILURE'))
    expect((await call()).status).toBe(503); expect(runChild).not.toHaveBeenCalled()
  })
  test.each(['&database=foreign', `&tenantId=${fixed.tenantId}`, '&deps=true'])('rejects query override %s', async suffix => {
    const response = await call(route + query + suffix); expect(response.status).toBe(422)
    expect(response.body.data).toBeUndefined(); expect(runChild).not.toHaveBeenCalled()
  })
  test('malformed child or rejected child never becomes empty success', async () => {
    runChild.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('CHILD_FAILED'))
    for (let i = 0; i < 2; i++) { const response = await call(); expect(response.status).toBe(i === 0 ? 409 : 503); expect(response.body.data).toBeUndefined() }
  })
  test('modified page bytes fail before publication', async () => {
    runChild.mockImplementationOnce(async () => { const data = bundle(); data.pages[0].base64 = data.pages[0].base64.replace('AAAADU', 'AAAAEU'); return data })
    const response = await call(`${route}/${fixed.candidateId}/page-preview-bundle${query}`)
    expect(response.status).toBe(409); expect(response.body.data).toBeUndefined()
  })
  test('disabled flag and unsupported environment never dispatch a child', async () => {
    await expect(owner.readControlledDocx({ ...fixed, operation: 'LIST' }, { env: { ...env, controlledDocxReadEnabled: false }, runChild })).rejects.toMatchObject({ code: 'CONTROLLED_DOCX_READ_UNAVAILABLE' })
    await expect(owner.readControlledDocx({ ...fixed, operation: 'LIST' }, { env: { ...env, nodeEnv: 'production' }, runChild })).rejects.toThrow()
    expect(runChild).not.toHaveBeenCalled()
  })
})
