import mongoose from 'mongoose'
import http from 'node:http'
import https from 'node:https'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'
import { installControlledDocxReadFence } from './controlledDocxReadFence.js'
import { APPROVED_DOCX_READ_SELECTION, NARROW_DOCX_READ_SELECTION } from './approvedDocxReadProfile.js'
import {
  CONTROLLED_DOCX_DATABASE, CORRECTED_DOCX_READ_VERSION, controlledReadProfile,
  CONTROLLED_DOCX_RESULT_VERSION, CONTROLLED_DOCX_READ_LIMITS as limits,
  assertControlledReadRequest, assertControlledReadData,
} from './controlledDocxReadContract.js'

// This entry owns one read and one connection. It never boots a server or a login.
export const executeControlledDocxReadWorker = async (request) => {
  assertControlledReadRequest(request)
  const profile = controlledReadProfile(request.contractVersion), fixed = profile.identity
  let rejected = 0, client
  const deny = () => { rejected++; throw new Error('CONTROLLED_READ_FENCE') }
  mongoose.set('autoCreate', false)
  mongoose.set('autoIndex', false)
  mongoose.set('autoSearchIndex', false)
  const driver = mongoose.mongo
  const fence = installControlledDocxReadFence(driver, { database: CONTROLLED_DOCX_DATABASE, onReject: () => rejected++,
    ...(profile.narrow ? { nativeRecorderId: NARROW_DOCX_READ_SELECTION.recorderUserId, readPurpose: 'NARROW_CANDIDATE' }
      : profile.approved ? { nativeRecorderId: APPROVED_DOCX_READ_SELECTION.recorderUserId, readPurpose: 'APPROVED_CANDIDATE' } : {}) })
  globalThis.fetch = deny
  http.request = http.get = https.request = https.get = deny
  for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[method] = deny
  syncBuiltinESMExports()
  const { default: env } = await import('../config/env.js')
  if (!['development', 'test'].includes(env.nodeEnv) || env.appEnv !== 'development'
    || env.outcomeStudioProviderEnabled || env.vmfSectionReasoningProviderEnabled
    || profile.corrected !== (env.controlledDocxReadCorrectionEnabled === true)
    || (profile.approved === true) !== (env.controlledDocxReadApprovedEnabled === true)
    || (profile.narrow === true) !== (env.controlledDocxReadNarrowEnabled === true)
    || ((request.contractVersion === CORRECTED_DOCX_READ_VERSION || profile.approved || profile.narrow) && env.controlledDocxReadEnabled !== true)) deny()
  try {
    client = new driver.MongoClient(env.mongoUri, { dbName: CONTROLLED_DOCX_DATABASE,
      maxPoolSize: 4, serverSelectionTimeoutMS: 10000, socketTimeoutMS: 30000 })
    await client.connect()
    fence.register(client)
    mongoose.connection.setClient(client)
    if (mongoose.connection.name !== CONTROLLED_DOCX_DATABASE) deny()
    const infos = await mongoose.connection.db.listCollections({}).toArray()
    if (!infos.length || infos.length > limits.namespaces) deny()
    fence.addNames([...infos.map(info => info.name), 'runtime_synthetic_test_disposition_receipts'])
    const { default: loadScopes } = await import('../middleware/loadScopes.js')
    const { buildRuntimeStateRequestScopes } = await import('../controllers/runtimeInstance.controller.js')
    // Service delegation carries the authenticated parent's actor, not an invented token/session.
    // The isolated user and role records are still loaded independently here.
    const req = { context: { userId: request.scope.actorUserId } }
    await new Promise((resolve, reject) => {
      const res = { status: () => ({ json: () => reject(new Error('ISOLATED_SCOPE_DENIED')) }) }
      Promise.resolve(loadScopes(req, res, error => error ? reject(error) : resolve())).catch(reject)
    })
    const scopes = buildRuntimeStateRequestScopes({ scopes: req.scopes, query: request.scope })
    const args = { actorUserId: request.scope.actorUserId, runtimeInstanceId: request.scope.runtimeInstanceId, scopes }
    let data
    if (request.operation === 'LIST') {
      const { readPrivateDocxCandidate } = await import('./outcomeDocxCandidatePersistenceService.js')
      const selected = await readPrivateDocxCandidate({ ...args, candidateId: fixed.candidateId, includeBytes: true })
      data = { scope: selected.scope, sourceFingerprint: selected.candidate.sourceFingerprint, candidates: [selected.candidate] }
    } else {
      const { readCurrentDocxPagePreview } = await import('./outcomeDocxPagePreviewPersistenceService.js')
      const bundle = await readCurrentDocxPagePreview({ ...args, candidateId: request.candidateId, includePages: true })
      data = { preview: bundle.preview, pages: bundle.pages.map((bytes, index) => ({
        number: index + 1, mimeType: 'image/png', base64: bytes.toString('base64'),
      })), document: { title: bundle.document.title, markdown: bundle.document.markdown, inputFingerprint: bundle.document.inputFingerprint } }
    }
    assertControlledReadData(request.operation, data, request.contractVersion)
    if (rejected) deny()
    return data
  } finally {
    await mongoose.disconnect()
    await client?.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let started = false
  const timer = setTimeout(() => process.exit(1), limits.deadlineMs)
  process.on('disconnect', () => process.exit(1))
  process.on('message', async request => {
    if (started) process.exit(1)
    started = true
    let reply, exitCode = 0, resultVersion = CONTROLLED_DOCX_RESULT_VERSION
    try {
      resultVersion = controlledReadProfile(request?.contractVersion).resultVersion
      const data = await executeControlledDocxReadWorker(request)
      reply = { contractVersion: resultVersion, operation: request.operation, status: 'SUCCESS', data }
    } catch {
      exitCode = 1
      reply = { contractVersion: resultVersion, operation: request?.operation,
        status: 'REFUSED', code: 'CONTROLLED_DOCX_READ_UNAVAILABLE', reason: 'SOURCE_UNAVAILABLE' }
    }
    clearTimeout(timer)
    if (!process.send || !process.connected) process.exit(1)
    process.send(reply, error => process.exit(error ? 1 : exitCode))
  })
}
