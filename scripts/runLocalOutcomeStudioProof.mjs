// Isolated uncommitted-source engineering proof; never uses or relaxes formal replay certificates.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EJSON } from 'bson'
import { MongoClient } from 'mongodb'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = process.env.LOCAL_PROOF_EVIDENCE_ROOT || path.resolve(root, '../docs/generated/harness-runs/ss-041/2026-10-05-local-react-proof')
const apiRevision = 'ee888ec3cf4874e5d22852cf0010f95e94a200f3'
const clientRevision = '2e86c4015baaa6972b602ac7015b9d26ddd08d3b'
const binary = 'C:/Users/garya/AppData/Local/StoryLineOS/MongoDB-Local-Restore/20260819T165416Z-6cbda3f44a59/server/mongodb-win32-x86_64-windows-8.0.28/bin/mongod.exe'
const sha = (value) => createHash('sha256').update(value).digest('hex')
const overlays = {
  'src/services/outcomeQualityStageExecutionService.js': 'c4f6ee14b24fe9a930f6945d8abec5acdcdd5e0854394c75391d5e60b0d6902d',
  'src/models/OutcomeQualityStageExecution.js': '9db7633a18cca6619428beb961bcdbbfe36c89f27c0c857daf48655c418ec543',
  'src/__tests__/outcomeQualityStageExecutions.test.js': '01a723e8c472de75a5ef1ac196d63d042a0cf2a3a0c8e06ce865928795d2bba9',
  'src/__tests__/outcomeStageLineagePersistence.integration.test.js': '16650cc5d9b4fe05dc6094e4778dd0f3e313b20646eab627ad61e2a7aa23de47',
  'src/services/outcomeStudioRequestPlanService.js': '7fde5108566d9002a9c799fc4653c4246517bb50cc242ec456249a444ed84b66',
  'src/__tests__/outcomeStudioRequestPlans.test.js': 'b86597479d21bb235aeb53f8fcbc2a4b5994e9b582d42987d4f6655b56696b24',
}
const harness = ['scripts/runLocalOutcomeStudioProof.mjs', 'scripts/serveLocalOutcomeStudioProof.mjs',
  'src/__tests__/localOutcomeStudioProof.integration.test.js']
const manifestFor = (directory) => {
  const entries = []
  const visit = (relative = '') => {
    for (const row of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git'].includes(row.name)) continue
      const name = path.posix.join(relative, row.name)
      if (row.isDirectory()) visit(name)
      else if (row.isFile()) {
        const bytes = fs.readFileSync(path.join(directory, name))
        const text = bytes.toString('utf8')
        const isText = !bytes.includes(0) && Buffer.from(text, 'utf8').equals(bytes)
        entries.push({ path: name, sha256: sha(bytes), normalizedLfSha256: isText ? sha(text.replace(/\r\n/g, '\n')) : null })
      }
    }
  }
  visit()
  return entries
}
const archive = (repository, revision, destination, directory) => {
  fs.mkdirSync(destination)
  const file = path.join(directory, `${path.basename(destination)}.tar`)
  execFileSync('git', ['archive', '--format=tar', '-o', file, revision], { cwd: repository })
  execFileSync('tar', ['-xf', file, '-C', destination])
  fs.symlinkSync(path.join(repository, 'node_modules'), path.join(destination, 'node_modules'), 'junction')
}
const reserve = async (host, port = 0) => {
  const server = net.createServer()
  await new Promise((resolve, reject) => server.listen(port, host, resolve).once('error', reject))
  const assigned = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return assigned
}

if (process.argv.includes('--child')) {
  const uri = process.env.LOCAL_PROOF_URI
  if (uri !== process.env.MONGODB_URI || !/^mongodb:\/\/127\.0\.0\.1:\d+\/ss041_po_replay_\d+\?replicaSet=ss041_po_replay$/.test(uri || '')
    || process.env.NODE_ENV !== 'test' || process.env.APP_ENV !== 'test' || process.env.FAKE_AUTH_ENABLED !== 'false') throw Error('LOCAL_PROOF_ISOLATION_REQUIRED')
  const mongoose = (await import('mongoose')).default
  const { assertIsolatedReplayDatabase, ensureControlledIndexes } = await import('./serveControlledOutcomeReplay.mjs')
  const { seedControlledReplayFixture } = await import('./controlledOutcomeReplayFixture.mjs')
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false })
  await assertIsolatedReplayDatabase(mongoose.connection, uri)
  const configuration = mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(process.env.LOCAL_PROOF_CONFIGURATION_PATH, 'utf8'))
  const credentials = { email: `local-${randomUUID()}@controlled.example.test`, password: randomBytes(32).toString('base64url') }
  fs.writeFileSync(process.env.LOCAL_PROOF_CREDENTIAL_PATH, JSON.stringify(credentials))
  const manifest = JSON.parse(fs.readFileSync(process.env.LOCAL_PROOF_MANIFEST_PATH, 'utf8'))
  const identity = await seedControlledReplayFixture({ configuration, credentials, apiCommit: apiRevision })
  await ensureControlledIndexes()
  const { default: productApp } = await import('../src/app.js')
  const { buildOutcomeStudioProviderRuntime } = await import('../src/config/outcomeStudioProvider.js')
  const { createLocalOutcomeStudioProofApp } = await import('./serveLocalOutcomeStudioProof.mjs')
  const providerRuntime = buildOutcomeStudioProviderRuntime()
  const verifyManifest = () => {
    if (JSON.stringify(manifestFor(root)) !== JSON.stringify(manifest.apiFiles)
      || JSON.stringify(manifestFor(process.env.LOCAL_PROOF_CLIENT_ROOT)) !== JSON.stringify(manifest.clientFiles)) throw Error('LOCAL_PROOF_SOURCE_BYTES_CHANGED')
  }
  verifyManifest()
  const { app } = createLocalOutcomeStudioProofApp({ productApp, identity, providerRuntime, manifest,
    verifyManifest, reviewPath: path.join(evidence, 'local-preprovider-final-review.json') })
  const server = app.listen(18082, '127.0.0.2')
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject))
  const safe = { evidenceClass: 'SOURCE_MANIFEST_LOCAL_UNCOMMITTED_ONLY', sourceManifestHash: manifest.sourceManifestHash,
    apiBaseRevision: apiRevision, clientRevision, apiPid: process.pid, apiPort: 18082,
    database: mongoose.connection.name, mongoPort: mongoose.connection.port, runtimeInstanceId: identity.runtimeInstanceId,
    customerId: identity.customerId, tenantId: identity.tenantId, actorUserId: identity.actorUserId,
    runtimeRevision: identity.runtimeRevision, frozenSourceHash: identity.frozenSourceHash, graphHash: identity.graphHash,
    configurationHash: configuration.configurationHash, governedAuthorityHash: identity.governedAuthorityHash,
    targetReceiptFingerprint: identity.targetReceiptFingerprint, evidenceCount: identity.evidenceCount,
    providerConfigured: providerRuntime.status.configured, providerDispatch: 'HELD_UNTIL_FRESH_LOCAL_CERTIFICATE',
    browserOrigin: 'http://127.0.0.2:5176' }
  fs.writeFileSync(path.join(evidence, 'local-environment.json'), JSON.stringify(safe, null, 2))
  console.log(JSON.stringify({ ready: true, ...safe }))
  let stopping = false
  const stop = async () => { if (stopping) return; stopping = true; await new Promise((resolve) => server.close(resolve)); await mongoose.disconnect(); process.exit(0) }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
} else {
  if (process.argv.includes('--live')) throw Error('LOCAL_PROOF_IS_NOT_FORMAL_LIVE_REPLAY')
  await reserve('127.0.0.2', 18082)
  await reserve('127.0.0.2', 5176)
  if (!fs.existsSync(binary)) throw Error('LOCAL_PROOF_MONGO_BINARY_UNAVAILABLE')
  for (const [file, expected] of Object.entries(overlays)) if (sha(fs.readFileSync(path.join(root, file))) !== expected) throw Error('LOCAL_PROOF_REVIEWED_REPAIR_BYTES_CHANGED')
  const { default: sourceEnv } = await import('../src/config/env.js')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-outcome-studio-proof-'))
  const api = path.join(directory, 'api')
  const client = path.join(directory, 'client')
  archive(root, apiRevision, api, directory)
  archive(path.resolve(root, '../VMF-v-1-client'), clientRevision, client, directory)
  for (const file of [...Object.keys(overlays), ...harness]) {
    fs.mkdirSync(path.dirname(path.join(api, file)), { recursive: true })
    fs.copyFileSync(path.join(root, file), path.join(api, file))
  }
  const manifest = { evidenceClass: 'SOURCE_MANIFEST_LOCAL_UNCOMMITTED_ONLY', apiBaseRevision: apiRevision, clientRevision,
    apiFiles: manifestFor(api), clientFiles: manifestFor(client) }
  manifest.sourceManifestHash = sha(JSON.stringify(manifest))
  const manifestPath = path.join(directory, 'source-manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  fs.mkdirSync(evidence, { recursive: true })
  fs.copyFileSync(manifestPath, path.join(evidence, 'source-inventory.json'))
  const { captureControlledConfiguration } = await import(pathToFileURL(path.join(api, 'scripts/controlledOutcomeReplayFixture.mjs')).href)
  const configuration = await captureControlledConfiguration(sourceEnv.mongoUri)
  const configurationPath = path.join(directory, 'configuration.private.json')
  fs.writeFileSync(configurationPath, EJSON.stringify(configuration))
  const port = await reserve('127.0.0.1')
  const database = `ss041_po_replay_${Date.now()}`
  const uri = `mongodb://127.0.0.1:${port}/${database}?replicaSet=ss041_po_replay`
  const data = path.join(directory, 'data'); fs.mkdirSync(data)
  const mongo = spawn(binary, ['--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', 'ss041_po_replay',
    '--dbpath', data, '--logpath', path.join(directory, 'mongod.private.log')], { windowsHide: true, stdio: 'ignore' })
  let admin, child, vite
  try {
    const deadline = Date.now() + 30000
    while (!admin) {
      if (mongo.exitCode !== null || Date.now() > deadline) throw Error('LOCAL_PROOF_MONGO_START_FAILED')
      const candidate = new MongoClient(`mongodb://127.0.0.1:${port}/admin?directConnection=true`, { serverSelectionTimeoutMS: 500 })
      try { await candidate.connect(); admin = candidate } catch { await candidate.close() }
    }
    await admin.db('admin').command({ replSetInitiate: { _id: 'ss041_po_replay', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } })
    while (!(await admin.db('admin').command({ hello: 1 })).isWritablePrimary) {
      if (Date.now() > deadline) throw Error('LOCAL_PROOF_PRIMARY_UNAVAILABLE')
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const childEnv = { ...process.env, NODE_ENV: 'test', APP_ENV: 'test', PORT: '18082', MONGODB_URI: uri,
      LOCAL_PROOF_URI: uri, LOCAL_PROOF_CONFIGURATION_PATH: configurationPath,
      LOCAL_PROOF_CREDENTIAL_PATH: path.join(directory, 'credentials.private.json'), LOCAL_PROOF_MANIFEST_PATH: manifestPath,
      LOCAL_PROOF_CLIENT_ROOT: client, REDIS_REQUIRED: 'false', PERF_CACHE_ENABLED: 'false', FAKE_AUTH_ENABLED: 'false',
      OUTCOME_STUDIO_PROVIDER_ENABLED: 'true', JWT_SECRET: randomBytes(48).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(48).toString('hex'), AUDIT_SIGNATURE_SECRET: randomBytes(48).toString('hex'),
      FIELD_ENCRYPTION_KEY: randomBytes(32).toString('hex'), FIELD_ENCRYPTION_ENABLED: 'true', CORS_ORIGIN: 'http://127.0.0.2:5176' }
    // Snapshot evidence stays outside the archived source manifest.
    childEnv.LOCAL_PROOF_EVIDENCE_ROOT = evidence
    child = spawn(process.execPath, [path.join(api, harness[0]), '--child'], { cwd: api, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], env: childEnv })
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk); const lines = buffer.split('\n'); buffer = lines.pop()
      for (const line of lines) { try { const item = JSON.parse(line); if (item.ready === true && item.evidenceClass === manifest.evidenceClass) console.log(JSON.stringify(item)) } catch { /* never forward product logs */ } }
    })
    child.stderr.on('data', (chunk) => fs.appendFileSync(path.join(directory, 'api-stderr.private.log'), chunk))
    vite = spawn(process.execPath, ['--input-type=module', '-e',
      'import path from "node:path"; const {createServer}=await import(process.env.LOCAL_PROOF_VITE_MODULE); const {default:react}=await import(process.env.LOCAL_PROOF_REACT_MODULE); const server=await createServer({configFile:false,plugins:[react()],resolve:{alias:{"@":path.resolve("src")}},cacheDir:process.env.LOCAL_PROOF_VITE_CACHE,server:{host:"127.0.0.2",port:5176,strictPort:true}}); await server.listen();'],
    { cwd: client, windowsHide: true, stdio: 'ignore', env: { ...process.env,
      VITE_API_URL: 'http://127.0.0.2:18082/api/v1', LOCAL_PROOF_VITE_CACHE: path.join(directory, 'vite-cache'),
      LOCAL_PROOF_VITE_MODULE: pathToFileURL(path.join(client, 'node_modules/vite/dist/node/index.js')).href,
      LOCAL_PROOF_REACT_MODULE: pathToFileURL(path.join(client, 'node_modules/@vitejs/plugin-react/dist/index.js')).href } })
    console.log(JSON.stringify({ isolatedDirectory: directory, database, mongoPort: port, mongoPid: mongo.pid,
      apiPid: child.pid, clientPid: vite.pid, sourceManifestHash: manifest.sourceManifestHash, providerDispatch: 'HELD' }))
    process.on('SIGINT', () => child?.kill('SIGINT')); process.on('SIGTERM', () => child?.kill('SIGTERM'))
    process.exitCode = await new Promise((resolve, reject) => child.once('error', reject).once('exit', (code) => resolve(code ?? 1)))
  } finally {
    if (child?.exitCode === null) child.kill()
    if (vite?.exitCode === null) vite.kill()
    await admin?.close()
    if (mongo.exitCode === null) mongo.kill()
    console.log(JSON.stringify({ directoryRetained: directory, isolatedProcessesStopping: true }))
  }
}
