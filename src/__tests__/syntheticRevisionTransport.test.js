import { beforeAll, beforeEach, test, expect, jest } from '@jest/globals'
import express from 'express'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { SYNTHETIC_REVISION_TEST_POLICY as p } from '../constants/syntheticRevisionTestPolicy.js'
import { validateReviewCompletionBody } from '../validators/reviewCompletion.validator.js'

const names = ['inspectSyntheticRevisionDisposition', 'recordSyntheticRevisionDisposition',
  'inspectSyntheticRevisionCompletion', 'recordSyntheticRevisionCompletion']
const owners = Object.fromEntries(names.map(name => [name, jest.fn()]))
const oldRead = jest.fn(), oldWrite = jest.fn()
let app
// Mount real Express handlers/validator, with simulated authentication and
// service dependencies. In-memory HTTP streams only: never listen on a port.
const request = (method, path, body) => new Promise((resolve, reject) => {
  const chunks = []
  const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done() } })
  const req = new IncomingMessage(socket)
  req.method = method; req.url = path; req.headers = {}; req.body = body
  const res = new ServerResponse(req); res.assignSocket(socket)
  res.on('error', reject)
  res.on('finish', () => {
    const text = Buffer.concat(chunks).toString(), json = text.slice(text.indexOf('\r\n\r\n') + 4)
    try { resolve({ status: res.statusCode, body: JSON.parse(json) }) } catch (e) { reject(e) }
    socket.destroy()
  })
  app.handle(req, res)
})
beforeAll(async () => {
  jest.unstable_mockModule('../services/syntheticRevisionTestService.js', () => owners)
  jest.unstable_mockModule('../services/syntheticTestDispositionService.js', () => ({ inspectSyntheticTestDisposition: oldRead, recordSyntheticTestDisposition: oldWrite }))
  jest.unstable_mockModule('../controllers/runtimeInstance.controller.js', () => ({ buildRuntimeStateRequestScopes: ({ scopes }) => scopes }))
  const c = await import('../controllers/syntheticTestDisposition.controller.js')
  app = express()
  app.use((req, _res, next) => { req.context = { userId: p.recorderUserId }; req.scopes = { platformRoles: ['SUPER_ADMIN'] }; next() })
  app.get('/:runtimeInstanceId/disposition', c.readSyntheticTestDisposition)
  app.post('/:runtimeInstanceId/disposition', c.saveSyntheticTestDisposition)
  app.get('/:runtimeInstanceId/completion', c.readSyntheticTestCompletion)
  app.post('/:runtimeInstanceId/completion', validateReviewCompletionBody, c.saveSyntheticTestCompletion)
  app.use((_error, _req, res, _next) => res.status(500).json({ error: { code: 'REJECTED_DEPENDENCY' } }))
})
beforeEach(() => { [...Object.values(owners), oldRead, oldWrite].forEach(f => f.mockReset()) })
test.each([p.runtimeInstanceId, p.runtimeInstanceKey])('exact R3 %s dispatches to separate service', async id => {
  owners.inspectSyntheticRevisionDisposition.mockResolvedValue({ authoritative: false, classification: p.classification, execution: 'HELD' })
  expect((await request('GET', `/${id}/disposition`)).body.data).toMatchObject({ authoritative: false, execution: 'HELD' })
  expect(oldRead).not.toHaveBeenCalled()
})
test('R1 dispatch remains unchanged', async () => {
  oldRead.mockResolvedValue({ receipt: null })
  expect((await request('GET', `/${p.rootRuntimeId}/disposition`)).status).toBe(200)
  expect(oldRead).toHaveBeenCalledTimes(1); expect(owners.inspectSyntheticRevisionDisposition).not.toHaveBeenCalled()
})
test('completion forwards authenticated recorder and strict body separately', async () => {
  const body = { requestKey: randomUUID(), expectedPopulationHash: 'a'.repeat(64), rationale: 'Engineering transport test only.', confirm: true }
  owners.recordSyntheticRevisionCompletion.mockResolvedValue({ receipt: { authoritative: false, execution: 'HELD' } })
  expect((await request('POST', `/${p.runtimeInstanceId}/completion`, body)).status).toBe(200)
  expect(owners.recordSyntheticRevisionCompletion.mock.calls[0][0]).toMatchObject({ actorUserId: p.recorderUserId, payload: body })
  expect((await request('POST', `/${p.runtimeInstanceId}/completion`, { ...body, authorisesLock: true })).status).toBe(422)
  expect(owners.recordSyntheticRevisionCompletion).toHaveBeenCalledTimes(1)
})
test.each([['disposition', 'inspectSyntheticRevisionDisposition'], ['completion', 'inspectSyntheticRevisionCompletion']])('rejected %s dependency remains an error', async (route, owner) => {
  owners[owner].mockRejectedValue(new Error('Dependency failed'))
  expect(await request('GET', `/${p.runtimeInstanceId}/${route}`)).toMatchObject({ status: 500, body: { error: { code: 'REJECTED_DEPENDENCY' } } })
})
test('governed permission rejection keeps its error status', async () => {
  owners.inspectSyntheticRevisionCompletion.mockRejectedValue(Object.assign(new Error('Denied'), { status: 403, code: 'FORBIDDEN' }))
  expect(await request('GET', `/${p.runtimeInstanceId}/completion`)).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } })
})
