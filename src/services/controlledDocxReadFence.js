// The finite read worker owns this driver instance; never install in the normal API process.
import { APPROVED_DOCX_OPERATION_LIMITS, APPROVED_DOCX_READ_SELECTION } from './approvedDocxReadProfile.js'

export const installControlledDocxReadFence = (driver, { database, onReject = () => {}, nativeRecorderId = null, readPurpose = null }) => {
  const clients = new WeakSet(), names = new Set()
  const nativeClients = new WeakSet(), nativeRoles = new WeakMap()
  const nativeSingleReads = new WeakMap()
  let reads = 0
  const reject = () => { onReject(); throw new Error('CONTROLLED_READ_FENCE') }
  if (readPurpose !== null && (typeof readPurpose !== 'string' || !Object.hasOwn(APPROVED_DOCX_OPERATION_LIMITS, readPurpose)
    || database !== 'ss044_1619d7db635949898c9abb4592d10bcf'
    || nativeRecorderId !== APPROVED_DOCX_READ_SELECTION.recorderUserId)) return reject()
  const methodCallLimit = readPurpose === null ? 10000 : APPROVED_DOCX_OPERATION_LIMITS[readPurpose].methodCalls
  const readable = target => clients.has(target.client)
    && (target.dbName || target.databaseName) === database
    && (!target.collectionName || names.has(target.collectionName))
  const writes = value => value && typeof value === 'object'
    && Object.entries(value).some(([key, item]) => ['$out', '$merge'].includes(key) || writes(item))
  const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
  const projection = (value, keys) => exact(value, keys) && keys.every(key => value[key] === 1)
  const nativeRead = (target, method, original, args) => {
    const [query, options] = args
    if (args.length !== 2 || !exact(options, ['projection', 'maxTimeMS']) || options.maxTimeMS !== 3000) return reject()
    if (target.collectionName === 'users' && method === 'find') {
      const delegated = nativeSingleReads.get(target)
      if (!delegated || delegated.used || delegated.query !== query || delegated.options !== options) return reject()
      delegated.used = true
      return original.apply(target, args)
    }
    if (target.collectionName === 'users' && method === 'findOne') {
      if (!exact(query, ['_id']) || !(query._id instanceof driver.ObjectId) || query._id.toHexString() !== nativeRecorderId
        || !projection(options.projection, ['_id', 'isActive', 'memberships']) || nativeSingleReads.has(target)) return reject()
      nativeRoles.delete(target.client)
      // The installed driver calls this.find synchronously, before awaiting its
      // single result. No delegation remains available during that await.
      let pending
      nativeSingleReads.set(target, { query, options, used: false })
      try { pending = original.apply(target, args) } finally { nativeSingleReads.delete(target) }
      return Promise.resolve(pending).then(user => {
        if (user && String(user._id) === nativeRecorderId && Array.isArray(user.memberships) && user.memberships.length <= 128) {
          const memberships = user.memberships.filter(item => item && item.customerId == null)
          if (memberships.some(item => !Array.isArray(item.roles) || item.roles.some(role => typeof role !== 'string'))) return reject()
          const keys = [...new Set(memberships.flatMap(item => item.roles.map(role => role.trim().toUpperCase()).filter(Boolean)))]
            .sort((a, b) => a.localeCompare(b))
          if (keys.length > 128 || keys.some(key => !/^[A-Z][A-Z0-9_]{0,139}$/.test(key))) return reject()
          nativeRoles.set(target.client, keys)
        }
        return user
      })
    }
    const keys = nativeRoles.get(target.client)
    if (target.collectionName !== 'roles' || method !== 'find' || !keys || !exact(query, ['key', 'scope'])
      || query.scope !== 'PLATFORM' || !exact(query.key, ['$in']) || !Array.isArray(query.key.$in)
      || JSON.stringify(query.key.$in) !== JSON.stringify(keys)
      || !projection(options.projection, ['key', 'scope', 'permissions', 'isActive'])) return reject()
    const cursor = original.apply(target, args)
    let limited = false, consumed = false
    // Only the default native authority reader's bounded cursor protocol exists.
    const facade = Object.freeze({ limit: value => {
      if (limited || consumed || value !== 129) return reject()
      limited = true; cursor.limit(129); return facade
    }, toArray: () => {
      if (!limited || consumed) return reject()
      consumed = true; return cursor.toArray()
    } })
    return facade
  }
  if (nativeRecorderId !== null) {
    if (nativeRecorderId !== '698b3800f83b3257365fd7a3') return reject()
    const connect = driver.MongoClient.prototype.connect
    driver.MongoClient.prototype.connect = async function (...args) {
      if (this.options.dbName === 'test') {
        if (args.length || this.options.maxPoolSize !== 1 || ['serverSelectionTimeoutMS', 'connectTimeoutMS', 'socketTimeoutMS']
          .some(key => this.options[key] !== 3000)) return reject()
        const result = await connect.apply(this, args)
        nativeClients.add(this); return result
      }
      return connect.apply(this, args)
    }
  }
  const protect = (prototype, allowed) => {
    for (const [method, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(prototype))) {
      if (method === 'constructor' || typeof descriptor.value !== 'function') continue
      const original = descriptor.value
      if (allowed.has(method)) prototype[method] = function (...args) {
        if (++reads > methodCallLimit || writes(args[0])) return reject()
        if (prototype === driver.Collection.prototype && nativeClients.has(this.client)
          && this.dbName === 'test') return nativeRead(this, method, original, args)
        if (!readable(this)) return reject()
        return original.apply(this, args)
      }
      else if (!(prototype === driver.Db.prototype && method === 'collection')) prototype[method] = reject
    }
  }
  protect(driver.Collection.prototype, new Set(['find', 'findOne', 'aggregate', 'listIndexes', 'indexes', 'countDocuments', 'estimatedDocumentCount', 'distinct']))
  protect(driver.Db.prototype, new Set(['listCollections', 'aggregate', 'collections', 'collectionExists']))
  for (const method of ['bulkWrite', 'watch']) if (driver.MongoClient.prototype[method]) driver.MongoClient.prototype[method] = reject
  if (driver.Admin) for (const [method, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(driver.Admin.prototype))) {
    if (method !== 'constructor' && typeof descriptor.value === 'function') driver.Admin.prototype[method] = reject
  }
  return {
    observation: () => ({ methodCalls: reads, methodCallLimit, readPurpose: readPurpose || 'LEGACY' }),
    register: client => clients.add(client),
    addNames: values => {
      if (!Array.isArray(values) || values.length > 80 || values.some(value => typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,140}$/.test(value))) return reject()
      values.forEach(value => names.add(value))
    },
  }
}
