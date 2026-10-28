import mongoose from 'mongoose'
import { createHash } from 'node:crypto'
import { membershipJson } from './runtimeEvidenceSnapshotContract.js'

// Only one callback attempt on one real session may share an immutable read.
// No preflight or prior transaction result is eligible for reuse.
const attempts = new WeakMap()
const copy = value => mongoose.mongo.BSON.EJSON.parse(mongoose.mongo.BSON.EJSON.stringify(value))

export const withSyntheticOutcomeTransactionReads = async (session, operation) => {
  attempts.set(session, new Map())
  try { return await operation() }
  finally { attempts.delete(session) }
}

export const invalidateSyntheticOutcomeTransactionReads = session => attempts.get(session)?.clear()

export const readSyntheticOutcomeQuery = async (query, session) => {
  const execute = () => query?.lean ? query.lean() : query
  const cache = session && attempts.get(session)
  if (!cache || !['find', 'findOne'].includes(query?.op) || !query.model
    || !query.getFilter || !query.getOptions || !query.projection || !query.mongooseOptions) return execute()
  let key
  try {
    const { session: querySession, ...options } = query.getOptions()
    if (querySession !== session) return execute()
    const shape = { operation: query.op, filter: query.getFilter(), projection: query.projection(),
      options, mongooseOptions: query.mongooseOptions() }
    membershipJson(shape) // Reject functions, accessors and unsupported prototypes.
    // BSON types and key order matter for embedded equality and ordered sorting.
    key = createHash('sha256').update(mongoose.mongo.BSON.EJSON.stringify(shape)).digest('hex')
  } catch {
    // Unrecognised query options must read normally, never alias another read.
    return execute()
  }
  let modelReads = cache.get(query.model)
  if (!modelReads) { modelReads = new Map(); cache.set(query.model, modelReads) }
  if (!modelReads.has(key)) modelReads.set(key, Promise.resolve().then(execute))
  return copy(await modelReads.get(key))
}
