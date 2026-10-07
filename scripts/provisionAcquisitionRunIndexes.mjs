import mongoose from 'mongoose'
import { pathToFileURL } from 'node:url'
import RuntimeAcquisitionRun from '../src/models/RuntimeAcquisitionRun.js'
import { connectDb } from '../src/config/db.js'

const collectionName = RuntimeAcquisitionRun.collection.collectionName
const readOptions = { timeoutMS: 6000, maxTimeMS: 2000 }
const writeOptions = { timeoutMS: 6000, maxTimeMS: 6000 }
const expectedIndexes = RuntimeAcquisitionRun.schema.indexes().map(([key, options]) => ({ key, ...options }))
const normalise = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['v', 'ns'].includes(key)).sort(([a], [b]) => a.localeCompare(b)))
const matches = (actual, expected) => JSON.stringify(normalise(actual)) === JSON.stringify(normalise(expected))

export const inspectAcquisitionRunIndexes = async db => {
  const collections = await db.listCollections({ name: collectionName }, { nameOnly: false, ...readOptions }).toArray()
  const collection = collections[0]
  if (!collection) return { database: db.databaseName, collection: collectionName, exists: false,
    hasRecords: false, indexes: [], expectedIndexes, missing: expectedIndexes.map(index => index.name), verified: false }
  if (collection.type !== 'collection' || Object.keys(collection.options || {}).length)
    throw new Error('Acquisition collection options are incompatible; no changes made.')
  const store = db.collection(collectionName)
  const indexes = await store.listIndexes(readOptions).toArray()
  const unexpected = indexes.filter(index => index.name !== '_id_' && !expectedIndexes.some(expected => expected.name === index.name))
  if (unexpected.length) throw new Error('Unexpected acquisition indexes require separate review; no changes made.')
  for (const expected of expectedIndexes) {
    const actual = indexes.find(index => index.name === expected.name)
    if (actual && !matches(actual, expected)) throw new Error(`Acquisition index ${expected.name} is incompatible; no changes made.`)
  }
  const missing = expectedIndexes.filter(expected => !indexes.some(index => index.name === expected.name)).map(index => index.name)
  const hasRecords = Boolean(await store.findOne({}, { projection: { _id: 1 }, ...readOptions }))
  return { database: db.databaseName, collection: collectionName, exists: true, hasRecords, indexes,
    expectedIndexes, missing, verified: missing.length === 0 }
}

export const provisionAcquisitionRunIndexes = async (db, { apply = false, database } = {}) => {
  if (apply && (!database || database !== db.databaseName)) throw new Error('Exact configured database acknowledgement required; no changes made.')
  let before = await inspectAcquisitionRunIndexes(db)
  if (!apply || before.verified) return { mode: apply ? 'apply' : 'dry-run', changed: false, before, after: before }
  if (before.hasRecords) throw new Error('Populated acquisition collection lacks required indexes; separate review required.')
  let changed = false
  if (!before.exists) {
    try { await db.createCollection(collectionName, writeOptions); changed = true }
    catch (error) { if (error.code !== 48) throw error }
    // Inspect race-created collection/options/indexes and records before DDL.
    const current = await inspectAcquisitionRunIndexes(db)
    if (!current.exists || current.hasRecords && !current.verified) throw new Error('Acquisition collection changed during provision; readiness unverified.')
    if (current.verified) return { mode: 'apply', changed, before, after: current }
    before = { ...before, missing: current.missing }
  }
  const missing = expectedIndexes.filter(index => before.missing.includes(index.name))
  await db.collection(collectionName).createIndexes(missing, writeOptions)
  changed = true
  const after = await inspectAcquisitionRunIndexes(db)
  if (!after.verified) throw new Error('Acquisition index readiness unverified after provision. Run dry-run before further action.')
  return { mode: 'apply', changed, before, after }
}

const main = async () => {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const dbArgument = args.find(argument => argument.startsWith('--database='))
  if (args.some(argument => argument !== '--apply' && !argument.startsWith('--database='))) throw new Error('Supported arguments: --apply --database=exact-name')
  await connectDb({ autoIndex: false })
  try {
    console.log(JSON.stringify(await provisionAcquisitionRunIndexes(mongoose.connection.db,
      { apply, database: dbArgument?.slice('--database='.length) }), null, 2))
  } finally { await mongoose.disconnect() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('Acquisition index readiness unverified:', error.message); process.exitCode = 1 })
}
