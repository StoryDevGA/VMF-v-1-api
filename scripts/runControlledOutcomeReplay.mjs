// Fresh loopback database only. No existing database is reused or removed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { EJSON } from 'bson'
import { MongoClient } from 'mongodb'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = path.resolve(root, '../docs/generated/harness-runs/ss-041/2026-10-02-governed-replay-readiness')
const binary = 'C:/Users/garya/AppData/Local/StoryLineOS/MongoDB-Local-Restore/20260819T165416Z-6cbda3f44a59/server/mongodb-win32-x86_64-windows-8.0.28/bin/mongod.exe'
const argument = (name) => process.argv[process.argv.indexOf(name) + 1]
const wait = () => new Promise((resolve) => setTimeout(resolve, 250))
const commit = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const digest = (value) => createHash('sha256').update(value).digest('hex')
const definitionHash = () => digest(fs.readFileSync(path.join(root, 'scripts/controlledOutcomeReplayFixture.mjs')))
const pageHash = () => digest(fs.readFileSync(path.join(evidence, 'controlled-replay.html')))
const readReview = (reviewPath) => JSON.parse(fs.readFileSync(reviewPath, 'utf8').replace(/^\uFEFF/, ''))
const assertReviewFiles = (review) => {
  const preflightBytes = fs.readFileSync(path.join(evidence, 'deterministic-preflight.json'))
  const preflight = JSON.parse(preflightBytes.toString('utf8').replace(/^\uFEFF/, ''))
  const receipt = preflight.preflightReceipt
  if (review.decision !== 'PASS' || review.score < 0.9 || review.providerEligibility !== 'AUTHORIZED_FOR_ONE_ROOT_DISPATCH'
    || review.runtimeBindingStatus !== 'PASS'
    || review.preProviderBoundaryStatus !== 'PASS' || preflight.preProviderBoundaryStatus !== 'PASS'
    || review.preflightReceiptHash !== digest(preflightBytes)
    || !receipt || receipt.boundaryCount !== 1 || receipt.networkCalls !== 0 || receipt.countsUnchanged !== true
    || receipt.runtimeBindingStatus !== 'PASS' || receipt.sourceCurrentness?.current !== true
    || receipt.governedAuthorityHash !== review.governedAuthorityHash || receipt.graphHash !== review.graphHash
    || receipt.configurationHash !== review.configurationHash
    || receipt.providerDescriptorHash !== review.providerDescriptorHash || !receipt.providerConfigurationVersion
    || !/^outcome_kcp_[a-f0-9-]{36}$/.test(receipt.planId || '') || !/^[a-f0-9]{64}$/.test(receipt.contractHash || '')
    || JSON.stringify(receipt) !== JSON.stringify(review.preflightReceipt)
    || review.apiCommit !== commit() || review.fixtureDefinitionHash !== definitionHash()
    || review.browserPageHash !== pageHash()) throw Error('Independent review revision or fixture/page bytes changed')
}

if (process.argv.includes('--child')) {
  const uri = process.env.SS041_CONTROLLED_URI
  if (!uri || uri !== process.env.MONGODB_URI || process.env.NODE_ENV !== 'test' || process.env.APP_ENV !== 'test'
    || process.env.FAKE_AUTH_ENABLED !== 'false' || !/^mongodb:\/\/127\.0\.0\.1:\d+\/ss041_po_replay_\d+\?replicaSet=ss041_po_replay$/.test(uri)) throw Error('Exact isolated child environment required')
  const mongoose = (await import('mongoose')).default
  const { assertIsolatedReplayDatabase, createControlledReplayApp, ensureControlledIndexes } = await import('./serveControlledOutcomeReplay.mjs')
  const { seedControlledReplayFixture } = await import('./controlledOutcomeReplayFixture.mjs')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  await assertIsolatedReplayDatabase(mongoose.connection, uri)
  // Use the model driver's BSON classes so existing authority hash owners see
  // identical ObjectId and binary types after the private value-preserving freeze.
  const configuration = mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(process.env.SS041_CONFIGURATION_PATH, 'utf8'))
  const credentials = { email: `ss041-${randomUUID()}@controlled.example.test`, password: randomBytes(32).toString('base64url') }
  const identity = await seedControlledReplayFixture({ configuration, credentials, apiCommit: commit() })
  await ensureControlledIndexes()
  const { default: productApp } = await import('../src/app.js')
  const { buildOutcomeStudioProviderRuntime } = await import('../src/config/outcomeStudioProvider.js')
  const providerRuntime = buildOutcomeStudioProviderRuntime()
  const liveAuthorized = process.env.SS041_CONTROLLED_LIVE === 'true'
  if (liveAuthorized) {
    const review = readReview(process.env.SS041_CONTROLLED_REVIEW_PATH)
    assertReviewFiles(review)
    if (!providerRuntime.status.configured || review.configurationHash !== configuration.configurationHash
      || review.governedAuthorityHash !== identity.governedAuthorityHash || review.graphHash !== identity.graphHash
      || review.targetReceiptFingerprint !== identity.targetReceiptFingerprint || review.frozenSourceHash !== identity.frozenSourceHash
      || review.providerDescriptorHash !== digest(JSON.stringify(providerRuntime.deps.providerDescriptor))) {
      throw Error('Reviewed configuration, frozen source, target or real provider identity changed')
    }
  }
  const { app } = createControlledReplayApp({ productApp, identity, credentials, providerRuntime,
    pagePath: path.join(evidence, 'controlled-replay.html'), liveAuthorized })
  const server = app.listen(18081, '127.0.0.2')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const safe = { timestampUtc: new Date().toISOString(), evidenceClass: 'CONTROLLED_SYNTHETIC_SOURCE',
    apiCommit: commit(), apiBranch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
    apiPid: process.pid, apiPort: 18081, database: mongoose.connection.name, mongoPort: mongoose.connection.port,
    environment: 'test', runtimeId: identity.runtimeInstanceId, runtimeRevision: identity.runtimeRevision,
    customerId: identity.customerId, tenantId: identity.tenantId, userId: identity.actorUserId,
    targetReceiptFingerprint: identity.targetReceiptFingerprint, frozenSourceHash: identity.frozenSourceHash,
    governedAuthorityHash: identity.governedAuthorityHash, graphHash: identity.graphHash,
    evidenceCount: identity.evidenceCount, sourceCount: identity.sourceCount,
    liveAuthorized, providerConfigured: providerRuntime.status.configured, providerReason: providerRuntime.status.reason,
    fixtureDefinitionHash: definitionHash(), browserPageHash: pageHash(),
    model: providerRuntime.deps.providerDescriptor?.model, packManifest: identity.packManifest }
  fs.writeFileSync(path.join(evidence, liveAuthorized ? 'controlled-live-environment.json' : 'controlled-deterministic-environment.json'), JSON.stringify(safe, null, 2))
  console.log(JSON.stringify({ ready: true, evidenceClass: safe.evidenceClass, url: 'http://127.0.0.2:18081',
    apiCommit: safe.apiCommit, apiPid: safe.apiPid, database: safe.database, mongoPort: safe.mongoPort,
    runtimeId: safe.runtimeId, runtimeRevision: safe.runtimeRevision, frozenSourceHash: safe.frozenSourceHash,
    evidenceCount: safe.evidenceCount, sourceCount: safe.sourceCount, liveAuthorized, providerConfigured: safe.providerConfigured }))
  let stopping = false
  const stop = async () => { if (stopping) return; stopping = true; await new Promise((resolve) => server.close(resolve)); await mongoose.disconnect(); process.exit(0) }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
} else {
  if (!fs.existsSync(binary)) throw Error('Reviewed local MongoDB binary unavailable')
  const live = process.argv.includes('--live')
  let reviewPath, review
  if (live) {
    reviewPath = argument('--review')
    if (!reviewPath || path.basename(reviewPath) !== 'controlled-preprovider-final-review.json') throw Error('Named independent final pre-provider review required')
    review = readReview(reviewPath)
    if (review.decision !== 'PASS' || review.score < 0.9 || review.providerEligibility !== 'AUTHORIZED_FOR_ONE_ROOT_DISPATCH') throw Error('Independent provider eligibility not established')
    if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw Error('Committed clean API revision required for live replay')
    assertReviewFiles(review)
  }
  const portCheck = net.createServer()
  await new Promise((resolve, reject) => portCheck.listen(18081, '127.0.0.2', resolve).once('error', reject))
  await new Promise((resolve) => portCheck.close(resolve))
  const { default: sourceEnv } = await import('../src/config/env.js')
  const { captureControlledConfiguration } = await import('./controlledOutcomeReplayFixture.mjs')
  const configuration = await captureControlledConfiguration(sourceEnv.mongoUri)
  if (live && review.configurationHash !== configuration.configurationHash) throw Error('Reviewed configuration changed before live fixture creation')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ss041-po-replay-'))
  const dataPath = path.resolve(directory, 'data')
  if (!dataPath.startsWith(`${path.resolve(directory)}${path.sep}`)) throw Error('Checked isolated data path required')
  fs.mkdirSync(dataPath)
  const configurationPath = path.join(directory, 'frozen-configuration.private.json')
  fs.writeFileSync(configurationPath, EJSON.stringify(configuration))
  const reservation = net.createServer()
  await new Promise((resolve, reject) => reservation.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const database = `ss041_po_replay_${Date.now()}`
  const uri = `mongodb://127.0.0.1:${port}/${database}?replicaSet=ss041_po_replay`
  const mongo = spawn(binary, ['--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', 'ss041_po_replay',
    '--dbpath', dataPath, '--logpath', path.join(directory, 'mongod.log')], { windowsHide: true, stdio: 'ignore' })
  let admin, child, spawnFailure
  mongo.on('error', (error) => { spawnFailure = error })
  const deadline = Date.now() + 30000
  try {
    while (!admin) {
      if (spawnFailure || mongo.exitCode !== null || Date.now() > deadline) throw spawnFailure || Error('Isolated Mongo startup failed')
      const candidate = new MongoClient(`mongodb://127.0.0.1:${port}/admin?directConnection=true`, { serverSelectionTimeoutMS: 500 })
      try { await candidate.connect(); admin = candidate } catch { await candidate.close(); await wait() }
    }
    await admin.db('admin').command({ replSetInitiate: { _id: 'ss041_po_replay', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } })
    while (!(await admin.db('admin').command({ hello: 1 })).isWritablePrimary) { if (Date.now() > deadline) throw Error('Isolated primary unavailable'); await wait() }
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', APP_ENV: 'test', PORT: '18081', MONGODB_URI: uri,
        SS041_CONTROLLED_URI: uri, SS041_CONFIGURATION_PATH: configurationPath, SS041_CONTROLLED_LIVE: String(live),
        ...(live ? { SS041_CONTROLLED_REVIEW_PATH: path.resolve(reviewPath) } : {}),
        REDIS_REQUIRED: 'false', PERF_CACHE_ENABLED: 'false', FAKE_AUTH_ENABLED: 'false',
        // Construct the unchanged configured factories for the protected probe.
        // Actual dispatch remains guarded by liveAuthorized and the one-use latch.
        OUTCOME_STUDIO_PROVIDER_ENABLED: 'true', JWT_SECRET: randomBytes(48).toString('hex'),
        JWT_REFRESH_SECRET: randomBytes(48).toString('hex'), AUDIT_SIGNATURE_SECRET: randomBytes(48).toString('hex'),
        FIELD_ENCRYPTION_KEY: randomBytes(32).toString('hex'), FIELD_ENCRYPTION_ENABLED: 'true',
        CORS_ORIGIN: 'http://127.0.0.2:18081' } })
    // Product request logs are not evidence: never forward headers/cookies or provider payloads.
    let childOutput = ''
    child.stdout.on('data', (chunk) => {
      childOutput += String(chunk)
      const lines = childOutput.split('\n'); childOutput = lines.pop()
      for (const line of lines) {
        try { const item = JSON.parse(line); if (item.ready === true && item.evidenceClass === 'CONTROLLED_SYNTHETIC_SOURCE') console.log(JSON.stringify(item)) } catch { /* No raw application log forwarding. */ }
      }
    })
    child.stderr.on('data', (chunk) => fs.appendFileSync(path.join(directory, 'child-stderr.private.log'), chunk))
    console.log(JSON.stringify({ isolatedDirectory: directory, database, mongoPort: port, mongoPid: mongo.pid,
      childPid: child.pid, liveAuthorized: live, configurationHash: configuration.configurationHash }))
    process.on('SIGINT', () => child?.kill('SIGINT')); process.on('SIGTERM', () => child?.kill('SIGTERM'))
    process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => resolve(code ?? 1)) })
  } finally {
    if (child && child.exitCode === null) child.kill()
    await admin?.close()
    if (mongo.exitCode === null) mongo.kill()
    console.log(JSON.stringify({ directoryRetained: directory, isolatedProcessesStopping: true }))
  }
}
