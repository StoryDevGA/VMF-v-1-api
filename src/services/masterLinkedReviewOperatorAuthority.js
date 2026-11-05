import mongoose from 'mongoose'
import env from '../config/env.js'
import tokenService, { isTokenAuthenticationError } from './tokenService.js'
import { resolveRolePermissions } from './rolePermissionResolutionService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'

export const MASTER_REVIEW_OPERATOR_REALM = 'native-application-test.v1'
export const MASTER_REVIEW_DATABASE = 'ss044_1619d7db635949898c9abb4592d10bcf'
export const releaseNeed = (condition, reason, status = 409) => {
  if (!condition) throw Object.assign(new Error('The controlled document review release is held.'), {
    code: 'MASTER_DOCX_RELEASE_HELD', status, details: { reason, dispatchAvailable: false, approvalAvailable: false, finalisationAvailable: false },
  })
}
const objectId = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const nativeReads = client => Object.freeze({
  readUser: id => {
    releaseNeed(objectId(id), 'NATIVE_OPERATOR_CONTEXT')
    return client.db('test').collection('users').findOne({ _id: new mongoose.Types.ObjectId(id) }, {
      projection: { _id: 1, isActive: 1, memberships: 1 }, maxTimeMS: 3000,
    })
  },
  readPlatformRoles: keys => {
    releaseNeed(Array.isArray(keys) && keys.length <= 128 && keys.every(key => typeof key === 'string'
      && /^[A-Z][A-Z0-9_]{0,139}$/.test(key)), 'NATIVE_OPERATOR_ROLES_INVALID')
    return client.db('test').collection('roles').find({ key: { $in: keys }, scope: 'PLATFORM' }, {
      projection: { key: 1, scope: 1, permissions: 1, isActive: 1 }, maxTimeMS: 3000,
    }).limit(129).toArray()
  },
})
const accessIdentity = async token => {
  let decoded
  try { decoded = await tokenService.verifyAccessToken(token) } catch (error) {
    if (isTokenAuthenticationError(error)) releaseNeed(false, 'OPERATOR_AUTHENTICATION_REQUIRED', 401)
    throw error
  }
  releaseNeed(decoded?.type === 'access' && objectId(decoded.userId), 'OPERATOR_ACCESS_TOKEN_REQUIRED', 401)
  return decoded.userId
}

// The identity owner is the normal application's test store. Never create a
// counterpart user, role or password in the isolated document store.
export const readMasterReviewNativeOperator = async operatorUserId => {
  releaseNeed(env.nodeEnv !== 'production' && env.appEnv === 'development' && objectId(operatorUserId), 'NATIVE_OPERATOR_CONTEXT')
  const deadline = Date.now() + 12000
  const alive = () => releaseNeed(Date.now() < deadline, 'NATIVE_OPERATOR_DEADLINE', 503)
  const client = new mongoose.mongo.MongoClient(env.mongoUri, { dbName: 'test', maxPoolSize: 1,
    serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000, socketTimeoutMS: 3000 })
  try {
    await client.connect()
    alive()
    const reads = nativeReads(client), user = await reads.readUser(operatorUserId)
    alive()
    releaseNeed(String(user?._id) === operatorUserId && user.isActive === true
      && Array.isArray(user.memberships) && user.memberships.length <= 128, 'NATIVE_OPERATOR_INACTIVE', 403)
    const platformUser = { _id: user._id, memberships: user.memberships.filter(value => value.customerId == null) }
    const resolved = await resolveRolePermissions({ user: platformUser, tenantMemberships: [], log: null,
      roleModel: { find: query => reads.readPlatformRoles(query.key.$in).then(rows => {
        releaseNeed(rows.length <= 128 && rows.some(role => role.key === 'SUPER_ADMIN'
          && role.scope === 'PLATFORM' && role.isActive === true), 'NATIVE_OPERATOR_ROLES_INVALID'); return rows
      }) },
    })
    alive()
    releaseNeed(resolved.platform.roleKeys.includes('SUPER_ADMIN'), 'NATIVE_OPERATOR_NOT_AUTHORISED', 403)
    return { realm: MASTER_REVIEW_OPERATOR_REALM, operatorUserId,
      fingerprint: membershipHash({ realm: MASTER_REVIEW_OPERATOR_REALM, operatorUserId, active: true, platform: resolved.platform }) }
  } finally { await client.close() }
}

export const authenticateMasterReviewNativeOperator = async authorization => {
  releaseNeed(typeof authorization === 'string' && /^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(authorization), 'OPERATOR_AUTHENTICATION_REQUIRED', 401)
  const token = authorization.slice(7)
  const operatorUserId = await accessIdentity(token)
  releaseNeed(await tokenService.isTokenBlacklisted(token) === false, 'OPERATOR_TOKEN_REVOKED', 401)
  const authority = await readMasterReviewNativeOperator(operatorUserId)
  releaseNeed(await tokenService.isTokenBlacklisted(token) === false, 'OPERATOR_TOKEN_REVOKED', 401)
  releaseNeed(await accessIdentity(token) === operatorUserId, 'OPERATOR_CHANGED', 401)
  return authority
}
