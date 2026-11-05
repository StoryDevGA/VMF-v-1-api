import User from '../models/User.js'
import tokenService, { isTokenAuthenticationError } from './tokenService.js'
import { buildUserPermissionsSnapshot } from './performanceCacheService.js'
import { getRuntimeInstanceSummary } from './runtimeInstanceService.js'
import { membershipHash } from './runtimeEvidenceSnapshotContract.js'
import { CONTROLLED_DOCX_IDENTITY as fixed, controlledDocxReadFailure } from './controlledDocxReadContract.js'

const reject = (reason, status = 403) => { throw controlledDocxReadFailure(reason, status) }
const objectId = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string'
  && /^[A-Z][A-Z0-9_]{0,139}$/.test(item)) && new Set(value).size === value.length
const bucket = value => value && strings(value.roleKeys) && strings(value.permissions)
export const assertControlledNativePermissions = (permissions) => {
  if (!permissions || !bucket(permissions.platform) || !Array.isArray(permissions.customers)
    || !Array.isArray(permissions.tenants)
    || permissions.customers.some(value => !bucket(value) || !objectId(value.customerId))
    || permissions.tenants.some(value => !bucket(value) || !objectId(value.customerId) || !objectId(value.tenantId))) reject('NATIVE_PERMISSIONS_INVALID')
  const grants = value => value.roleKeys.length > 0 && value.permissions.includes('VMF_UPDATE')
  if (!permissions.customers.some(value => value.customerId === fixed.customerId && grants(value))
    && !permissions.tenants.some(value => value.customerId === fixed.customerId && value.tenantId === fixed.tenantId && grants(value))) reject('NATIVE_ACCESS_DENIED')
}

// Current native access is separate from the controlled store's source admission.
// No cached successful authority observation is reused across reads or phases.
export const readControlledDocxAuthority = async (args, deps = {}) => {
  const tokens = deps.tokenService || tokenService
  if (typeof args.authorization !== 'string' || !/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(args.authorization)) reject('AUTHENTICATION_REQUIRED', 401)
  let decoded
  try {
    const token = args.authorization.slice(7)
    if (await tokens.isTokenBlacklisted(token)) reject('AUTHENTICATION_REQUIRED', 401)
    decoded = await tokens.verifyAccessToken(token)
  } catch (error) {
    if (error?.code === 'CONTROLLED_DOCX_READ_UNAVAILABLE') throw error
    if (isTokenAuthenticationError(error)) reject('AUTHENTICATION_REQUIRED', 401)
    reject('NATIVE_AUTHORITY_UNAVAILABLE', 503)
  }
  if (decoded?.type !== 'access' || decoded.userId !== fixed.actorUserId || args.actorUserId !== decoded.userId) reject('NATIVE_ACTOR_DENIED')
  try {
    const user = await (deps.readUser || (id => User.findById(id).maxTimeMS(3000)))(decoded.userId)
    if (!user || String(user._id || user.id) !== fixed.actorUserId || user.isActive !== true) reject('AUTHENTICATION_REQUIRED', 401)
    const snapshot = await (deps.buildPermissions || buildUserPermissionsSnapshot)(user)
    assertControlledNativePermissions(snapshot?.resolvedPermissions)
    const scopes = { ...snapshot, user, customer: { _id: fixed.customerId }, tenant: { _id: fixed.tenantId, customerId: fixed.customerId } }
    const runtime = await (deps.readRuntime || getRuntimeInstanceSummary)({ scopes,
      customerId: fixed.customerId, tenantId: fixed.tenantId, runtimeInstanceId: fixed.runtimeInstanceId })
    if (!runtime || runtime.id !== fixed.runtimeInstanceId || runtime.customerId !== fixed.customerId
      || runtime.tenantId !== fixed.tenantId || runtime.runtimeType !== 'VALUE_NARRATIVE' || runtime.status !== 'LOCKED') reject('NATIVE_RUNTIME_DENIED')
    return { actorUserId: decoded.userId, fingerprint: membershipHash({ permissions: snapshot.resolvedPermissions, runtime }) }
  } catch (error) {
    if (error?.code === 'CONTROLLED_DOCX_READ_UNAVAILABLE') throw error
    reject('NATIVE_AUTHORITY_UNAVAILABLE', 503)
  }
}
