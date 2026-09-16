// Runs only synthetic data against a new disposable loopback replica set.
// Uses the pre-existing local binary only. Existing data is never reused or deleted.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MongoClient } from 'mongodb'

const executable = 'C:/Users/garya/AppData/Local/StoryLineOS/MongoDB-Local-Restore/20260819T165416Z-6cbda3f44a59/server/mongodb-win32-x86_64-windows-8.0.28/bin/mongod.exe'
if (!fs.existsSync(executable)) throw new Error('Approved local mongod executable is unavailable')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const standalone = process.argv.includes('--standalone')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kcp-isolation-'))
const data = path.join(directory, 'data')
fs.mkdirSync(data)
if (fs.readdirSync(data).length || !path.resolve(data).startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error('Disposable directory validation failed')
const reservation = net.createServer()
await new Promise((resolve, reject) => reservation.listen(0, '127.0.0.1', resolve).once('error', reject))
const port = reservation.address().port
await new Promise((resolve) => reservation.close(resolve))
const database = `kcp_isolation_${Date.now()}`
const uri = `mongodb://127.0.0.1:${port}/${database}${standalone ? '' : '?replicaSet=kcp_isolation'}`
const mongod = spawn(executable, ['--port', String(port), '--bind_ip', '127.0.0.1', ...(standalone ? [] : ['--replSet', 'kcp_isolation']), '--dbpath', data, '--logpath', path.join(directory, 'mongod.log')], { windowsHide: true, stdio: 'ignore' })
const stopped = new Promise((resolve) => mongod.once('exit', resolve))
let spawnError
mongod.on('error', (err) => { spawnError = err })
const deadline = Date.now() + 30000
const pause = () => new Promise((resolve) => setTimeout(resolve, 250))
let admin
try {
  while (!admin) {
    if (spawnError || mongod.exitCode !== null || Date.now() > deadline) throw spawnError || new Error('Local mongod failed to start')
    const candidate = new MongoClient(`mongodb://127.0.0.1:${port}/admin?directConnection=true`, { serverSelectionTimeoutMS: 500 })
    try { await candidate.connect(); admin = candidate } catch { await candidate.close(); await pause() }
  }
  if (!standalone) await admin.db('admin').command({ replSetInitiate: { _id: 'kcp_isolation', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } })
  while (!(await admin.db('admin').command({ hello: 1 })).isWritablePrimary) {
    if (Date.now() > deadline) throw new Error('Local replica primary unavailable')
    await pause()
  }
  console.log(JSON.stringify({ scope: standalone ? 'new synthetic loopback standalone' : 'new synthetic loopback replica set', directory, database, port }))
  const test = spawn(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--runInBand', '--runTestsByPath', 'src/__tests__/outcomeKcpRequestIsolation.test.js'], {
    cwd: root, windowsHide: true, stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: uri, KCP_ISOLATION_TEST_URI: uri,
      KCP_ISOLATION_DATABASE: database, KCP_ISOLATION_PORT: String(port),
      KCP_ISOLATION_STANDALONE: String(standalone),
      AUDIT_SIGNATURE_SECRET: 'synthetic-kcp-isolation-audit-secret' },
  })
  process.exitCode = await new Promise((resolve, reject) => { test.once('error', reject); test.once('exit', (code) => resolve(code ?? 1)) })
} finally {
  if (admin) await admin.close()
  if (mongod.exitCode === null) mongod.kill()
  await stopped
  console.log(JSON.stringify({ localProcessStopped: true, directoryRetained: directory }))
}
