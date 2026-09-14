import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import env from '../config/env.js'
import { importFrameworkSeed } from './importFrameworkSeed.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const apiRoot = path.resolve(__dirname, '../..')
const workspaceRoot = path.resolve(apiRoot, '..')

const SEED_VERSION = '3.1.7'
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/
const DEFAULT_REPORT_DIR = path.resolve(workspaceRoot, 'docs/generated/seed-imports')

const readFlagValue = (argv, index, flagName) => {
  const value = argv[index + 1]
  if (!value || String(value).startsWith('--')) {
    throw new Error(`${flagName} requires a value. Run with --help for usage.`)
  }
  return String(value).trim()
}

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = {
    apply: false,
    database: '',
    help: false,
    json: false,
    noAudit: false,
    noEditorContract: false,
    noReport: false,
    reportDir: DEFAULT_REPORT_DIR,
    seedDir: '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--json') args.json = true
    else if (arg === '--no-audit') args.noAudit = true
    else if (arg === '--no-editor-contract') args.noEditorContract = true
    else if (arg === '--no-report') args.noReport = true
    else if (arg === '--source-dir') {
      args.seedDir = path.resolve(readFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--database') {
      args.database = readFlagValue(argv, index, arg)
      index += 1
    } else if (arg === '--report-dir') {
      args.reportDir = path.resolve(readFlagValue(argv, index, arg))
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`)
    }
  }

  if (args.help) return args
  if (!args.seedDir) throw new Error('--source-dir is required. Run with --help for usage.')
  if (args.database && !DATABASE_NAME_PATTERN.test(args.database)) {
    throw new Error('--database must contain only letters, numbers, hyphens, or underscores.')
  }
  if (args.apply && !args.database) {
    throw new Error('--apply requires --database so the target database is explicit.')
  }

  return args
}

const printHelp = () => {
  console.log(`
Create VMF v3.1.7 Framework Package data

Usage:
  node src/scripts/createVmfV317PackageData.js --source-dir <path> [options]

Options:
  --source-dir <path>       Unpacked VMF v3.1.7 seed-pack directory. Required.
  --database <name>         Explicit MongoDB database name for apply mode.
  --apply                   Create the package data in the selected database.
  --report-dir <path>      Import report directory. Defaults to ${DEFAULT_REPORT_DIR}.
  --no-audit                Skip the conformance-audit comparison.
  --no-editor-contract      Skip the Framework Package editor contract guard.
  --no-report               Do not write an import report.
  --json                    Print machine-readable output.
  --help                    Show this help.

Safety:
  Dry-run is the default. Apply requires --database and never resets Runtime
  Control collections. Existing locked records are preserved by the importer;
  an incompatible existing package fails closed.
`.trim())
}

const buildDatabaseUri = (database) => {
  const sourceUri = String(env.mongoUri || '').trim()
  if (!sourceUri) throw new Error('MONGODB_URI is not set.')
  if (!database) return sourceUri

  const queryIndex = sourceUri.indexOf('?')
  const base = queryIndex === -1 ? sourceUri : sourceUri.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : sourceUri.slice(queryIndex)
  const schemeIndex = base.indexOf('://')
  const authorityStart = schemeIndex === -1 ? 0 : schemeIndex + 3
  const pathIndex = base.indexOf('/', authorityStart)
  const authority = pathIndex === -1 ? base : base.slice(0, pathIndex)

  return `${authority}/${database}${query}`
}

const connectToDatabase = async (database) => {
  await mongoose.connect(buildDatabaseUri(database), {
    autoIndex: true,
    serverSelectionTimeoutMS: env.mongoServerSelectionTimeoutMs,
    connectTimeoutMS: env.mongoConnectTimeoutMs,
    socketTimeoutMS: env.mongoSocketTimeoutMs,
    heartbeatFrequencyMS: env.mongoHeartbeatFrequencyMs,
    minPoolSize: env.mongoMinPoolSize,
    maxPoolSize: env.mongoMaxPoolSize,
    maxIdleTimeMS: env.mongoMaxIdleTimeMs,
  })
}

const createVmfV317PackageData = async (optionOverrides = {}) => {
  const args = { ...optionOverrides }

  if (!args.seedDir) {
    throw new Error('--source-dir is required.')
  }

  if (args.apply && !args.database) {
    throw new Error('--apply requires an explicit database name.')
  }

  let connected = false
  try {
    if (args.apply) {
      await connectToDatabase(args.database)
      connected = true
    }

    const result = await importFrameworkSeed({
      apply: args.apply,
      auditFile: null,
      auditFileExplicit: false,
      json: true,
      manageConnection: false,
      noAudit: args.noAudit,
      noEditorContract: args.noEditorContract,
      noReport: args.noReport,
      reportDir: args.reportDir,
      resetRuntimeControl: false,
      seedDir: args.seedDir,
      seedVersion: SEED_VERSION,
    })

    return {
      ...result,
      targetDatabase: args.database || null,
      script: 'createVmfV317PackageData.js',
      seedVersion: SEED_VERSION,
    }
  } finally {
    if (connected) await mongoose.disconnect()
  }
}

const main = async () => {
  const args = parseArgs()
  if (args.help) {
    printHelp()
    return
  }

  const result = await createVmfV317PackageData(args)
  const output = {
    script: result.script,
    seedVersion: result.seedVersion,
    targetDatabase: result.targetDatabase,
    reportPath: result.reportPath,
    reportError: result.reportError,
    hasErrors: result.hasErrors,
    payload: result.payload,
  }

  if (args.json) {
    console.log(JSON.stringify(output, null, 2))
  } else {
    console.log(`VMF ${result.seedVersion} package data ${args.apply ? 'created' : 'validated'}`)
    console.log(`Source: ${args.seedDir}`)
    console.log(`Target database: ${args.database || '(no database write; dry-run)'}`)
    console.log(`Errors: ${result.payload.notes.filter((note) => note.level === 'error').length}`)
    console.log(`Report: ${result.reportPath || '(not written)'}`)
  }

  if (result.hasErrors) process.exitCode = 1
}

export {
  buildDatabaseUri,
  createVmfV317PackageData,
  parseArgs,
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(async (error) => {
    try {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect()
    } catch {
      // Preserve the original error.
    }
    console.error(error.message)
    process.exitCode = 1
  })
}
