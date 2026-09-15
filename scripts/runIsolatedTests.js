import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

// Never use configured credentials or fall back to an existing Mongo instance.
const replica = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port: 27017 }],
})
let exitCode
try {
  if (new URL(replica.getUri('vmf_test')).port !== '27017') {
    throw new Error('Isolated tests require their own MongoDB on port 27017; refusing to use an occupied port.')
  }
  const args = process.argv.slice(2)
  if (args[0] === '--review') {
    args.splice(0, 1, ...JSON.parse(readFileSync(new URL('./review-test-suites.json', import.meta.url), 'utf8')))
  }
  const child = spawn(process.execPath, [
    fileURLToPath(new URL('./runTests.js', import.meta.url)), '--maxWorkers=2', ...args,
  ], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test', APP_ENV: 'test',
      MONGODB_URI: replica.getUri('vmf_test'),
      JWT_SECRET: 'isolated-test-access-secret-not-for-deployment',
      JWT_REFRESH_SECRET: 'isolated-test-refresh-secret-not-for-deployment',
      AUDIT_SIGNATURE_SECRET: 'isolated-test-audit-secret-not-for-deployment',
      REDIS_REQUIRED: 'false',
      REDIS_URL: '',
    },
  })
  exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
} finally {
  await replica.stop()
}
process.exitCode = exitCode
