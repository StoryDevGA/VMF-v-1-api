import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import performanceCacheService from '../services/performanceCacheService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const apiRoot = path.resolve(__dirname, '../..')
const workspaceRoot = path.resolve(apiRoot, '..')

export const RESET_PLAN_SCHEMA_VERSION = 'storylineos.development-customer-vmf-reset-plan.v4'
export const BACKUP_MANIFEST_SCHEMA_VERSION = 'storylineos.database-backup-manifest.v1'
export const DELETE_CONFIRMATION = '--confirm-development-customer-vmf-reset'
export const WRITE_PAUSE_CONFIRMATION = '--confirm-maintenance-write-pause'
export const RESTORE_CONFIRMATION = '--confirm-restore-verified'
export const APPLICATION_CREDENTIAL_RISK_CONFIRMATION = '--confirm-application-credential-read-only-risk'
export const BACKUP_SKIP_CONFIRMATION = '--confirm-backup-verification-skipped'
export const AUDITLOGS_DELETE_CONFIRMATION = '--confirm-auditlogs-delete'
export const MAX_BACKUP_AGE_MS = 24 * 60 * 60 * 1000
export const MAX_QUERY_TIME_MS = 30_000
export const READ_BATCH_SIZE = 25
export const SOCKET_TIMEOUT_MS = 120_000
export const MAX_PACKAGE_LOCK_MUTATION_DOCUMENTS = 1000
export const ALLOWED_TARGET = Object.freeze({
  nodeEnv: 'development',
  databaseName: 'test',
  hostSha256: '2737439b57e4f8276959c1cee6fdc4ad09a3eea489a77d4115125f44f3329922',
})
export const APPLY_CREDENTIAL_ROLE = 'storylineosDevelopmentCustomerVmfReset'
export const DRY_RUN_CREDENTIAL_ROLE = 'storylineosDevelopmentCustomerVmfResetRead'

export const DISPOSABLE_COLLECTIONS = Object.freeze([
  Object.freeze({ key: 'RuntimeGraphRelationship', collection: 'runtime_graph_relationships', root: 'runtime' }),
  Object.freeze({ key: 'TruthSignature', collection: 'truth_signatures', root: 'runtime' }),
  Object.freeze({ key: 'RuntimeOutputAsset', collection: 'runtime_output_assets', root: 'runtime' }),
  Object.freeze({ key: 'RuntimeOutputRequest', collection: 'runtime_output_requests', root: 'runtime' }),
  Object.freeze({ key: 'OutcomeDraftIteration', collection: 'outcome_draft_iterations', root: 'runtime' }),
  Object.freeze({ key: 'OutcomeDraft', collection: 'outcome_drafts', root: 'runtime' }),
  Object.freeze({ key: 'OutcomeAssetVersion', collection: 'outcome_asset_versions', root: 'runtime' }),
  Object.freeze({ key: 'OutcomeAsset', collection: 'outcome_assets', root: 'runtime' }),
  Object.freeze({ key: 'OutcomeQualityStageExecution', collection: 'outcome_quality_stage_executions', root: 'runtime' }),
  Object.freeze({ key: 'OutcomeKnowledgeCompositionPlan', collection: 'outcome_knowledge_composition_plans', root: 'runtime' }),
  Object.freeze({ key: 'GovernedRuntimeArtifact', collection: 'governed_runtime_artifacts', root: 'runtime' }),
  Object.freeze({ key: 'GovernedReasoningExecution', collection: 'governed_reasoning_executions', root: 'runtime' }),
  Object.freeze({ key: 'OutcomeMessage', collection: 'outcome_messages', root: 'runtime' }),
  Object.freeze({ key: 'OutcomeSession', collection: 'outcome_sessions', root: 'runtime' }),
  Object.freeze({ key: 'Deal', collection: 'deals', root: 'vmf' }),
  Object.freeze({ key: 'RuntimeInstance', collection: 'runtime_instances', root: 'runtime-root' }),
  Object.freeze({ key: 'VMF', collection: 'vmfs', root: 'vmf-root' }),
  Object.freeze({ key: 'RuntimeDeployment', collection: 'runtime_deployments', root: 'package' }),
  Object.freeze({ key: 'RuntimeActivationSnapshot', collection: 'runtime_activation_snapshots', root: 'package' }),
  Object.freeze({ key: 'FrameworkPackage', collection: 'frameworkpackages', root: 'package-root' }),
  Object.freeze({ key: 'AuditLog', collection: 'auditlogs', root: 'auditlog-root' }),
])

export const PROTECTED_COLLECTIONS = Object.freeze([
  'customers',
  'tenants',
  'users',
  'roles',
  'licenselevels',
  'licencelevels',
  'invitations',
  'datadeletionrequests',
  'knowledge_packs',
  'knowledge_pack_versions',
  'knowledge_pack_activations',
  'knowledge_pack_manifests',
  'frameworkregistries',
  'runtimeagents',
  'runtimeskills',
  'runtimepathregistries',
  'skillroleregistries',
  'validationregistries',
  'workflowpolicies',
  'uicontracts',
  'systemversioningpolicies',
  'outcomestudioreadinessrevisions',
  'outcomestudioreadinesspointers',
  'outcome_studio_test_reference_objects',
  'outcome_studio_test_reference_revisions',
  'outcome_studio_test_reference_pointers',
  'runtime_validation_audit',
  'runtimevalidationaudits',
])

export const MUTABLE_RETAINED_LOCK_COLLECTIONS = Object.freeze([
  'runtimeagents',
  'runtimepathregistries',
  'runtimeskills',
  'skillroleregistries',
  'uicontracts',
  'validationregistries',
  'workflowpolicies',
])
const MUTABLE_RETAINED_LOCK_COLLECTION_SET = new Set(MUTABLE_RETAINED_LOCK_COLLECTIONS)
const UPDATABLE_COLLECTION_NAME_SET = new Set(['users', ...MUTABLE_RETAINED_LOCK_COLLECTIONS])
const PACKAGE_LOCK_FIELDS = Object.freeze([
  'lockedByPackageKeys',
  'isLocked',
  'lockedBy',
  'lockedAt',
  'lockedReason',
])

const KNOWN_COLLECTIONS = new Set([
  ...PROTECTED_COLLECTIONS,
  ...DISPOSABLE_COLLECTIONS.map(({ collection }) => collection),
])
const DISPOSABLE_COLLECTION_NAME_SET = new Set(
  DISPOSABLE_COLLECTIONS.map(({ collection }) => collection),
)
const AUDITLOGS_COLLECTION = 'auditlogs'
const BROAD_ROLE_NAMES = new Set([
  'atlasadmin',
  'root',
  'dbowner',
  'readwriteanydatabase',
  'dbadminanydatabase',
  'useradminanydatabase',
  'clusteradmin',
])
const ALLOWED_PRIVILEGE_ACTIONS = new Set(['find', 'listCollections', 'remove', 'update'])
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i

export class ResetError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ResetError'
    this.code = code
    this.details = details
    this.committed = Boolean(details.committed)
  }
}

const normalizeText = (value) => String(value ?? '').trim()
const normalizeLower = (value) => normalizeText(value).toLowerCase()
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort()

export const stringifyId = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value.toHexString === 'function') return value.toHexString()
  if (value.$oid) return String(value.$oid)
  return String(value)
}

const canonicalize = (value) => {
  if (value === null || value === undefined) return value ?? null
  if (value instanceof Date) return { $date: value.toISOString() }
  if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') }
  if (typeof value?.toHexString === 'function') return { $oid: value.toHexString() }
  if (value instanceof RegExp) return { $regex: value.source, $options: value.flags }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'bigint') return { $numberLong: value.toString() }
  if (typeof value === 'object') {
    if (value._bsontype && typeof value.toString === 'function') {
      return { [`$${normalizeLower(value._bsontype)}`]: value.toString() }
    }
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

export const canonicalJson = (value) => JSON.stringify(canonicalize(value))
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
export const hashCanonical = (value) => sha256(canonicalJson(value))

const readFlagValue = (argv, index, flagName) => {
  const value = argv[index + 1]
  if (!value || String(value).startsWith('--')) {
    throw new ResetError('ARGUMENT_REQUIRED', `${flagName} requires a value.`)
  }
  return value
}

export const parseArgs = (argv = process.argv.slice(2)) => {
  const args = {
    allCustomers: false,
    apply: false,
    confirmAuditLogsDelete: false,
    confirmBackupVerificationSkipped: false,
    backupManifest: '',
    backupSha256: '',
    confirmDelete: false,
    confirmApplicationCredentialReadOnlyRisk: false,
    confirmRestore: false,
    confirmWritePause: false,
    evidenceDir: '',
    help: false,
    planSha256: '',
    privatePlan: '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--all-customers') args.allCustomers = true
    else if (arg === '--apply') args.apply = true
    else if (arg === DELETE_CONFIRMATION) args.confirmDelete = true
    else if (arg === APPLICATION_CREDENTIAL_RISK_CONFIRMATION) args.confirmApplicationCredentialReadOnlyRisk = true
    else if (arg === BACKUP_SKIP_CONFIRMATION) args.confirmBackupVerificationSkipped = true
    else if (arg === AUDITLOGS_DELETE_CONFIRMATION) args.confirmAuditLogsDelete = true
    else if (arg === WRITE_PAUSE_CONFIRMATION) args.confirmWritePause = true
    else if (arg === RESTORE_CONFIRMATION) args.confirmRestore = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--private-plan') {
      args.privatePlan = path.resolve(readFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--plan-sha256') {
      args.planSha256 = normalizeLower(readFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--backup-manifest') {
      args.backupManifest = path.resolve(readFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--backup-sha256') {
      args.backupSha256 = normalizeLower(readFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--evidence-dir') {
      args.evidenceDir = path.resolve(readFlagValue(argv, index, arg))
      index += 1
    } else {
      throw new ResetError('UNKNOWN_ARGUMENT', `Unknown argument: ${arg}`)
    }
  }

  if (args.help) return args
  if (!args.allCustomers) {
    throw new ResetError('ALL_CUSTOMERS_REQUIRED', '--all-customers is required before any database connection.')
  }
  if (!args.privatePlan) {
    throw new ResetError('PRIVATE_PLAN_REQUIRED', '--private-plan is required for dry-run and apply.')
  }
  if (args.apply && args.confirmApplicationCredentialReadOnlyRisk) {
    throw new ResetError(
      'APPLICATION_CREDENTIAL_APPLY_REJECTED',
      `${APPLICATION_CREDENTIAL_RISK_CONFIRMATION} is permitted only for a read-only dry-run.`,
    )
  }
  if (!args.apply && args.confirmAuditLogsDelete) {
    throw new ResetError('AUDITLOGS_DELETE_APPLY_ONLY', `${AUDITLOGS_DELETE_CONFIRMATION} is permitted only for apply.`)
  }

  if (args.apply) {
    const missing = []
    if (!args.confirmDelete) missing.push(DELETE_CONFIRMATION)
    if (!args.confirmWritePause) missing.push(WRITE_PAUSE_CONFIRMATION)
    if (!args.confirmRestore) missing.push(RESTORE_CONFIRMATION)
    if (!args.confirmAuditLogsDelete) missing.push(AUDITLOGS_DELETE_CONFIRMATION)
    if (!args.planSha256) missing.push('--plan-sha256')
    const hasBackupManifest = Boolean(args.backupManifest)
    const hasBackupSha256 = Boolean(args.backupSha256)
    const hasCompleteBackupPair = hasBackupManifest && hasBackupSha256
    const hasPartialBackupPair = hasBackupManifest !== hasBackupSha256
    if (hasPartialBackupPair) {
      throw new ResetError('BACKUP_ARGUMENTS_INCOMPLETE', '--backup-manifest and --backup-sha256 must be supplied together.')
    }
    if (!args.confirmBackupVerificationSkipped && !hasCompleteBackupPair) {
      missing.push(`--backup-manifest/--backup-sha256 or ${BACKUP_SKIP_CONFIRMATION}`)
    }
    if (args.confirmBackupVerificationSkipped && (hasBackupManifest || hasBackupSha256)) {
      throw new ResetError('BACKUP_MODES_CONFLICT', `${BACKUP_SKIP_CONFIRMATION} cannot be combined with backup manifest arguments.`)
    }
    if (!args.evidenceDir) missing.push('--evidence-dir')
    if (missing.length > 0) {
      throw new ResetError('APPLY_GATES_REQUIRED', `Apply requires: ${missing.join(', ')}`)
    }
    if (!SHA256_PATTERN.test(args.planSha256)) {
      throw new ResetError('INVALID_SHA256', 'Plan SHA-256 values must be 64 hexadecimal characters.')
    }
    if (hasCompleteBackupPair && !SHA256_PATTERN.test(args.backupSha256)) {
      throw new ResetError('INVALID_SHA256', 'Backup SHA-256 values must be 64 hexadecimal characters.')
    }
  } else if (args.confirmBackupVerificationSkipped) {
    throw new ResetError('BACKUP_SKIP_APPLY_ONLY', `${BACKUP_SKIP_CONFIRMATION} is permitted only for apply.`)
  }

  return args
}

export const parseMongoTarget = (uri) => {
  const normalizedUri = normalizeText(uri)
  const match = normalizedUri.match(/^mongodb(?:\+srv)?:\/\/([^/]+)(?:\/([^?]*))?(?:\?.*)?$/i)
  if (!match) throw new ResetError('RESET_URI_INVALID', 'MONGODB_RESET_URI is not a valid MongoDB URI.')

  const authorityWithoutCredentials = match[1].includes('@')
    ? match[1].slice(match[1].lastIndexOf('@') + 1)
    : match[1]
  const hosts = authorityWithoutCredentials
    .split(',')
    .map(normalizeLower)
    .filter(Boolean)
    .sort()
  const databaseName = decodeURIComponent(match[2] || '').trim()
  if (hosts.length === 0 || !databaseName) {
    throw new ResetError('RESET_URI_TARGET_REQUIRED', 'MONGODB_RESET_URI must explicitly name its host and database.')
  }

  return {
    databaseName,
    hostSha256: sha256(hosts.join(',')),
  }
}

export const assertAllowedTarget = ({ nodeEnv, databaseName, hostSha256 }) => {
  const actual = {
    nodeEnv: normalizeLower(nodeEnv),
    databaseName: normalizeText(databaseName),
    hostSha256: normalizeLower(hostSha256),
  }
  if (
    actual.nodeEnv !== ALLOWED_TARGET.nodeEnv
    || actual.databaseName !== ALLOWED_TARGET.databaseName
    || actual.hostSha256 !== ALLOWED_TARGET.hostSha256
  ) {
    throw new ResetError('TARGET_NOT_ALLOWLISTED', 'The reset target does not match the code-owned Development/Test allowlist.', {
      actual,
      expected: ALLOWED_TARGET,
    })
  }
  if (/prod|production|live/i.test(actual.databaseName)) {
    throw new ResetError('PRODUCTION_TARGET_REJECTED', 'Production-looking database names are never allowed.')
  }
  return actual
}

const isPathInside = (candidate, root) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export const assertPrivatePath = (candidate, { mustBeDirectory = false } = {}) => {
  const resolved = path.resolve(normalizeText(candidate))
  if (!path.isAbsolute(resolved) || isPathInside(resolved, workspaceRoot)) {
    throw new ResetError('PRIVATE_PATH_REQUIRED', 'Private plan, backup, and evidence paths must be outside the repository.')
  }
  if (mustBeDirectory && !normalizeText(candidate)) throw new ResetError('EVIDENCE_DIRECTORY_REQUIRED', '--evidence-dir is required.')
  return resolved
}

const durableWriteJson = async (filePath, value, fsPromises = fs.promises) => {
  const handle = await fsPromises.open(filePath, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' })
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const hashFile = async (filePath) => new Promise((resolve, reject) => {
  const digest = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  stream.on('error', reject)
  stream.on('data', (chunk) => digest.update(chunk))
  stream.on('end', () => resolve(digest.digest('hex')))
})

const toObjectIds = (ids) => ids.map((id) => {
  if (!OBJECT_ID_PATTERN.test(id)) {
    throw new ResetError('INVALID_OBJECT_ID', 'The private reset plan contains a non-ObjectId target.')
  }
  return new mongoose.Types.ObjectId(id)
})

const collectionDocuments = async (database, collectionName, filter = {}, options = {}) => {
  const cursor = database.collection(collectionName).find(filter, {
    ...(options.session ? { session: options.session } : {}),
    ...(options.projection ? { projection: options.projection } : {}),
    batchSize: READ_BATCH_SIZE,
    maxTimeMS: MAX_QUERY_TIME_MS,
  })
  const sorted = typeof cursor.sort === 'function' ? cursor.sort({ _id: 1 }) : cursor
  const documents = await sorted.toArray()
  return Array.isArray(documents) ? documents : []
}

const digestDocuments = (documents) => hashCanonical(
  [...documents]
    .sort((left, right) => stringifyId(left?._id).localeCompare(stringifyId(right?._id)))
    .map(canonicalize),
)

const AUDIT_SIGNATURE_PATTERN = /^[a-f0-9]{64}$/
const SUPPORTED_AUDIT_SIGNATURE_VERSIONS = new Set([1, 2, 3])
const AUDIT_HMAC_IDENTITY_PROJECTION = Object.freeze({
  _id: 1,
  ts: 1,
  signatureVersion: 1,
  signature: 1,
})

const buildAuditLogIdentityRows = (documents) => {
  const identities = []
  const seenIds = new Set()
  for (const document of documents) {
    if (!(document?._id instanceof mongoose.Types.ObjectId)) {
      throw new ResetError('AUDIT_IDENTITY_INVALID', 'AuditLog signed identity contains a non-ObjectId identifier.')
    }
    const id = stringifyId(document?._id)
    if (!OBJECT_ID_PATTERN.test(id) || seenIds.has(id)) {
      throw new ResetError('AUDIT_IDENTITY_INVALID', 'AuditLog signed identity contains an invalid or duplicate ObjectId.')
    }
    seenIds.add(id)
    if (!(document.ts instanceof Date) || !Number.isFinite(document.ts.getTime())) {
      throw new ResetError('AUDIT_TIMESTAMP_INVALID', 'AuditLog signed identity contains an invalid timestamp.')
    }
    const signatureVersion = document.signatureVersion === null || document.signatureVersion === undefined
      ? 1
      : document.signatureVersion
    if (
      typeof signatureVersion !== 'number'
      || !Number.isInteger(signatureVersion)
      || !SUPPORTED_AUDIT_SIGNATURE_VERSIONS.has(signatureVersion)
    ) {
      throw new ResetError('AUDIT_SIGNATURE_VERSION_INVALID', 'AuditLog signed identity contains an unsupported signature version.')
    }
    if (typeof document.signature !== 'string' || !AUDIT_SIGNATURE_PATTERN.test(document.signature)) {
      throw new ResetError('AUDIT_SIGNATURE_INVALID', 'AuditLog signed identity contains a malformed signature.')
    }
    identities.push({
      id,
      ts: document.ts.toISOString(),
      signatureVersion,
      signature: document.signature,
    })
  }
  identities.sort((left, right) => left.id.localeCompare(right.id))
  return identities
}

export const buildAuditLogProtectedState = (documents) => {
  const identities = buildAuditLogIdentityRows(documents)
  return {
    collection: 'auditlogs',
    count: identities.length,
    digestMode: 'AUDIT_HMAC_IDENTITY_V1',
    sha256: hashCanonical(identities),
  }
}

const buildAuditLogDeleteEntry = (documents) => {
  const identities = buildAuditLogIdentityRows(documents)
  return entryForIds({
    key: 'AuditLog',
    collection: AUDITLOGS_COLLECTION,
    ids: identities.map(({ id }) => id),
    identities,
  })
}

const normalizePackageKey = (value) => {
  if (typeof value !== 'string') {
    throw new ResetError('PACKAGE_KEY_INVALID', 'Framework Package keys must be canonical non-empty strings.')
  }
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized !== value) {
    throw new ResetError('PACKAGE_KEY_INVALID', 'Framework Package keys must already be trimmed and lowercase.')
  }
  return normalized
}

const hasOwn = (value, field) => Object.prototype.hasOwnProperty.call(value, field)

const canonicalLockKeyArray = (value) => {
  if (!Array.isArray(value)) {
    throw new ResetError('PACKAGE_LOCK_STATE_INVALID', 'lockedByPackageKeys must be a canonical array.')
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== 'string' || !entry || entry !== entry.trim() || entry !== entry.toLowerCase()) {
      throw new ResetError('PACKAGE_LOCK_STATE_INVALID', 'lockedByPackageKeys contains a non-canonical key.')
    }
    return entry
  })
  if (new Set(normalized).size !== normalized.length) {
    throw new ResetError('PACKAGE_LOCK_STATE_INVALID', 'lockedByPackageKeys contains duplicate keys.')
  }
  return normalized
}

const typedLockFieldState = (document, field) => {
  if (!hasOwn(document, field)) return { present: false }
  const value = document[field]
  if (field === 'lockedByPackageKeys') {
    return { present: true, type: 'array', value: canonicalLockKeyArray(value) }
  }
  if (value === null) return { present: true, type: 'null', value: null }
  if (field === 'isLocked' && typeof value === 'boolean') {
    return { present: true, type: 'boolean', value }
  }
  if (field === 'lockedReason' && typeof value === 'string') {
    return { present: true, type: 'string', value }
  }
  if (field === 'lockedAt' && value instanceof Date && Number.isFinite(value.getTime())) {
    return { present: true, type: 'date', value: value.toISOString() }
  }
  if (field === 'lockedBy' && value instanceof mongoose.Types.ObjectId) {
    return { present: true, type: 'objectId', value: stringifyId(value) }
  }
  throw new ResetError('PACKAGE_LOCK_STATE_INVALID', `${field} contains an unsupported persisted type.`)
}

const typedLockState = (document) => Object.fromEntries(
  PACKAGE_LOCK_FIELDS.map((field) => [field, typedLockFieldState(document, field)]),
)

const afterLockState = (before, targetPackageKeySet) => {
  const currentKeys = before.lockedByPackageKeys.value
  const remainingKeys = currentKeys.filter((key) => !targetPackageKeySet.has(key))
  if (remainingKeys.length > 0) {
    return {
      ...before,
      lockedByPackageKeys: { present: true, type: 'array', value: remainingKeys },
    }
  }
  return {
    lockedByPackageKeys: { present: true, type: 'array', value: [] },
    isLocked: { present: true, type: 'boolean', value: false },
    lockedBy: { present: true, type: 'null', value: null },
    lockedAt: { present: true, type: 'null', value: null },
    lockedReason: { present: true, type: 'string', value: '' },
  }
}

const stripPackageLockFields = (document) => Object.fromEntries(
  Object.entries(document).filter(([field]) => !PACKAGE_LOCK_FIELDS.includes(field)),
)

const buildPackageLockCollectionState = ({ collection, documents, targetPackageKeySet }) => {
  const rows = documents
    .map((document) => {
      if (!(document?._id instanceof mongoose.Types.ObjectId)) {
        throw new ResetError('PACKAGE_LOCK_STATE_INVALID', `${collection} contains a non-ObjectId identifier.`)
      }
      const id = stringifyId(document._id)
      const before = typedLockState(document)
      const containsTarget = before.lockedByPackageKeys.value.some((key) => targetPackageKeySet.has(key))
      const after = containsTarget ? afterLockState(before, targetPackageKeySet) : before
      return { id, before, after, containsTarget }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  const mutations = rows
    .filter(({ containsTarget }) => containsTarget)
    .map(({ id, before, after }) => ({
      id,
      before,
      after,
      beforeLockSha256: hashCanonical(before),
      afterLockSha256: hashCanonical(after),
    }))
  return {
    collection,
    documentCount: rows.length,
    mutationCount: mutations.length,
    beforeCollectionLockSha256: hashCanonical(rows.map(({ id, before }) => ({ id, lockState: before }))),
    afterCollectionLockSha256: hashCanonical(rows.map(({ id, after }) => ({ id, lockState: after }))),
    mutationBeforeSha256: hashCanonical(mutations.map(({ id, beforeLockSha256 }) => ({ id, beforeLockSha256 }))),
    mutationAfterSha256: hashCanonical(mutations.map(({ id, afterLockSha256 }) => ({ id, afterLockSha256 }))),
    mutations,
  }
}

const entryForIds = ({ key, collection, ids, identities = [] }) => {
  const sortedIds = uniqueSorted(ids)
  return {
    key,
    collection,
    count: sortedIds.length,
    idSha256: hashCanonical(sortedIds),
    identitySha256: hashCanonical(
      [...identities].sort((left, right) => left.id.localeCompare(right.id)),
    ),
    ids: sortedIds,
  }
}

const pairKey = (customerId, tenantId) => `${stringifyId(customerId)}:${stringifyId(tenantId)}`

const assertDocumentScope = ({ document, expected, collection }) => {
  if (!document.customerId || !document.tenantId) {
    throw new ResetError('DESCENDANT_SCOPE_MISSING', `${collection} contains a row without provable customer/tenant scope.`)
  }
  if (document.customerId && stringifyId(document.customerId) !== expected.customerId) {
    throw new ResetError('DESCENDANT_SCOPE_CONFLICT', `${collection} contains a customerId conflicting with its reset root.`)
  }
  if (document.tenantId && stringifyId(document.tenantId) !== expected.tenantId) {
    throw new ResetError('DESCENDANT_SCOPE_CONFLICT', `${collection} contains a tenantId conflicting with its reset root.`)
  }
}

const assertKnownCollections = async (database) => {
  const rows = await database.listCollections({}, { nameOnly: true }).toArray()
  const actual = rows
    .map(({ name }) => name)
    .filter((name) => name && !name.startsWith('system.'))
  const actualSet = new Set(actual)
  const unknown = actual
    .filter((name) => !KNOWN_COLLECTIONS.has(name))
    .sort()
  if (unknown.length > 0) {
    throw new ResetError('UNKNOWN_COLLECTIONS', 'Unreviewed collections exist in the target database.', {
      count: unknown.length,
      collectionNameSha256: hashCanonical(unknown),
    })
  }
  const missing = [...KNOWN_COLLECTIONS].filter((name) => !actualSet.has(name)).sort()
  if (missing.length > 0) {
    throw new ResetError('MISSING_REVIEWED_COLLECTIONS', 'The target database is missing reviewed collection surfaces.', {
      count: missing.length,
      collectionNameSha256: hashCanonical(missing),
    })
  }
}

const buildProtectedState = async ({ database, targetVmfIdSet, session }) => {
  const protectedState = []
  let userGrantState = null

  for (const collectionName of PROTECTED_COLLECTIONS) {
    const documents = await collectionDocuments(database, collectionName, {}, {
      session,
      ...(collectionName === 'auditlogs' ? { projection: AUDIT_HMAC_IDENTITY_PROJECTION } : {}),
    })
    if (collectionName === 'auditlogs') {
      protectedState.push(buildAuditLogProtectedState(documents))
      continue
    }
    if (MUTABLE_RETAINED_LOCK_COLLECTION_SET.has(collectionName)) {
      protectedState.push({
        collection: collectionName,
        count: documents.length,
        digestMode: 'IMMUTABLE_EXCLUDING_PACKAGE_LOCK_V1',
        sha256: digestDocuments(documents.map(stripPackageLockFields)),
      })
      continue
    }
    if (collectionName !== 'users') {
      protectedState.push({
        collection: collectionName,
        count: documents.length,
        sha256: digestDocuments(documents),
      })
      continue
    }

    let matchedUserDocuments = 0
    let targetGrantElements = 0
    const usersWithoutGrants = []
    const nonTargetGrants = []
    const matchedUserIds = []

    for (const user of documents) {
      const { vmfGrants = [], ...userWithoutGrants } = user
      const targetGrants = vmfGrants.filter((grant) => targetVmfIdSet.has(stringifyId(grant?.vmfId)))
      const remainingGrants = vmfGrants.filter((grant) => !targetVmfIdSet.has(stringifyId(grant?.vmfId)))
      usersWithoutGrants.push(userWithoutGrants)
      nonTargetGrants.push({ userId: stringifyId(user._id), grants: remainingGrants })
      if (targetGrants.length > 0) {
        matchedUserDocuments += 1
        targetGrantElements += targetGrants.length
        matchedUserIds.push(stringifyId(user._id))
      }
    }

    const base = {
      collection: collectionName,
      count: documents.length,
      sha256ExcludingVmfGrants: digestDocuments(usersWithoutGrants),
      nonTargetVmfGrantsSha256: hashCanonical(nonTargetGrants),
    }
    protectedState.push(base)
    userGrantState = {
      matchedUserDocuments,
      expectedModifiedUserDocuments: matchedUserDocuments,
      expectedRemovedGrantElements: targetGrantElements,
      matchedUserIds: uniqueSorted(matchedUserIds),
      ...base,
    }
  }

  return { protectedState, userGrantState }
}

export const assertProtectionConfiguration = () => {
  const overlap = PROTECTED_COLLECTIONS.filter((name) => DISPOSABLE_COLLECTION_NAME_SET.has(name))
  const mutableOutsideProtected = MUTABLE_RETAINED_LOCK_COLLECTIONS
    .filter((name) => !PROTECTED_COLLECTIONS.includes(name))
  if (
    overlap.length > 0
    || mutableOutsideProtected.length > 0
    || DISPOSABLE_COLLECTIONS.length !== 21
    || PROTECTED_COLLECTIONS.length !== 28
    || KNOWN_COLLECTIONS.size !== 49
    || DISPOSABLE_COLLECTIONS.at(-1)?.collection !== AUDITLOGS_COLLECTION
  ) {
    throw new ResetError('PROTECTION_CONFIGURATION_INVALID', 'Protected and disposable reset collection configuration is invalid.')
  }
}

const mutationEntry = (entry, index) => {
  const config = DISPOSABLE_COLLECTIONS[index]
  if (!config || config.key !== entry.key || config.collection !== entry.collection) {
    throw new ResetError('PROTECTION_CONFIGURATION_INVALID', 'Reset mutation entries do not match the governed child-first configuration.')
  }
  return {
    order: index,
    key: entry.key,
    collection: entry.collection,
    root: config.root,
    linkField: config.root === 'runtime'
      ? 'runtimeInstanceId'
      : (config.root === 'vmf' ? 'vmfId' : (config.root === 'package' ? 'packageId' : null)),
    count: entry.count,
    idSha256: entry.idSha256,
    identitySha256: entry.identitySha256,
    ids: entry.ids,
  }
}

const requiredCanonicalText = (value, field, { lower = false } = {}) => {
  if (typeof value !== 'string') {
    throw new ResetError('PACKAGE_LINEAGE_INVALID', `${field} must be a non-empty canonical string.`)
  }
  const normalized = lower ? value.trim().toLowerCase() : value.trim()
  if (!normalized || normalized !== value) {
    throw new ResetError('PACKAGE_LINEAGE_INVALID', `${field} must already be canonical.`)
  }
  return normalized
}

const optionalCanonicalText = (value, field) => {
  if (value === null || value === undefined || value === '') return ''
  return requiredCanonicalText(value, field)
}

const buildPackageLineageState = ({ packages, deployments, snapshots }) => {
  const packageById = new Map()
  const packageKeySet = new Set()
  const packageIdentities = []
  for (const document of packages) {
    if (!(document?._id instanceof mongoose.Types.ObjectId)) {
      throw new ResetError('PACKAGE_LINEAGE_INVALID', 'Framework Package contains a non-ObjectId identifier.')
    }
    const id = stringifyId(document._id)
    const packageKey = normalizePackageKey(document.packageKey)
    if (packageById.has(id) || packageKeySet.has(packageKey)) {
      throw new ResetError('PACKAGE_LINEAGE_DUPLICATE', 'Framework Package identifiers and package keys must be unique.')
    }
    const frameworkKey = requiredCanonicalText(document.frameworkKey, 'frameworkpackages.frameworkKey')
    const version = requiredCanonicalText(document.version, 'frameworkpackages.version')
    const identity = {
      id,
      packageKey,
      frameworkKey,
      version,
      status: requiredCanonicalText(document.status, 'frameworkpackages.status'),
      documentSha256: hashCanonical(document),
    }
    packageById.set(id, identity)
    packageKeySet.add(packageKey)
    packageIdentities.push(identity)
  }

  const snapshotByActivationId = new Map()
  const snapshotIdentities = snapshots.map((document) => {
    if (!(document?._id instanceof mongoose.Types.ObjectId) || !(document?.packageId instanceof mongoose.Types.ObjectId)) {
      throw new ResetError('PACKAGE_LINEAGE_INVALID', 'Runtime Activation Snapshot identifiers must be ObjectIds.')
    }
    const id = stringifyId(document._id)
    const packageId = stringifyId(document.packageId)
    const root = packageById.get(packageId)
    if (!root) throw new ResetError('PACKAGE_LINEAGE_ORPHAN', 'Runtime Activation Snapshot is outside the package deletion closure.')
    const activationId = requiredCanonicalText(document.activationId, 'runtime_activation_snapshots.activationId')
    if (snapshotByActivationId.has(activationId)) {
      throw new ResetError('PACKAGE_LINEAGE_DUPLICATE', 'Runtime Activation Snapshot activationId values must be unique.')
    }
    const packageKey = normalizePackageKey(document.packageKey)
    const frameworkKey = requiredCanonicalText(document.frameworkKey, 'runtime_activation_snapshots.frameworkKey')
    const frameworkVersion = requiredCanonicalText(document.frameworkVersion, 'runtime_activation_snapshots.frameworkVersion')
    if (packageKey !== root.packageKey || frameworkKey !== root.frameworkKey || frameworkVersion !== root.version) {
      throw new ResetError('PACKAGE_LINEAGE_MISMATCH', 'Runtime Activation Snapshot package identity conflicts with its Framework Package.')
    }
    const identity = {
      id,
      packageId,
      packageKey,
      frameworkKey,
      frameworkVersion,
      activationId,
      deploymentId: optionalCanonicalText(document.deploymentId, 'runtime_activation_snapshots.deploymentId'),
      supersedesActivationId: optionalCanonicalText(document.supersedesActivationId, 'runtime_activation_snapshots.supersedesActivationId'),
      supersededByActivationId: optionalCanonicalText(document.supersededByActivationId, 'runtime_activation_snapshots.supersededByActivationId'),
      rollbackSourceActivationId: optionalCanonicalText(document.rollbackSourceActivationId, 'runtime_activation_snapshots.rollbackSourceActivationId'),
      documentSha256: hashCanonical(document),
    }
    snapshotByActivationId.set(activationId, identity)
    return identity
  })

  const deploymentById = new Map()
  const deploymentActivationIds = new Set()
  const deploymentIdentities = deployments.map((document) => {
    if (!(document?._id instanceof mongoose.Types.ObjectId) || !(document?.packageId instanceof mongoose.Types.ObjectId)) {
      throw new ResetError('PACKAGE_LINEAGE_INVALID', 'Runtime Deployment identifiers must be ObjectIds.')
    }
    const id = stringifyId(document._id)
    const packageId = stringifyId(document.packageId)
    const root = packageById.get(packageId)
    if (!root) throw new ResetError('PACKAGE_LINEAGE_ORPHAN', 'Runtime Deployment is outside the package deletion closure.')
    const deploymentId = requiredCanonicalText(document.deploymentId, 'runtime_deployments.deploymentId')
    const activationId = requiredCanonicalText(document.activationId, 'runtime_deployments.activationId')
    if (deploymentById.has(deploymentId) || deploymentActivationIds.has(activationId)) {
      throw new ResetError('PACKAGE_LINEAGE_DUPLICATE', 'Runtime Deployment deploymentId and activationId values must be unique.')
    }
    const packageKey = normalizePackageKey(document.packageKey)
    const frameworkKey = requiredCanonicalText(document.frameworkKey, 'runtime_deployments.frameworkKey')
    const frameworkVersion = requiredCanonicalText(document.frameworkVersion, 'runtime_deployments.frameworkVersion')
    if (packageKey !== root.packageKey || frameworkKey !== root.frameworkKey || frameworkVersion !== root.version) {
      throw new ResetError('PACKAGE_LINEAGE_MISMATCH', 'Runtime Deployment package identity conflicts with its Framework Package.')
    }
    const identity = {
      id,
      packageId,
      packageKey,
      frameworkKey,
      frameworkVersion,
      deploymentId,
      activationId,
      supersededByDeploymentId: optionalCanonicalText(document.supersededByDeploymentId, 'runtime_deployments.supersededByDeploymentId'),
      documentSha256: hashCanonical(document),
    }
    deploymentById.set(deploymentId, identity)
    deploymentActivationIds.add(activationId)
    return identity
  })

  for (const deployment of deploymentIdentities) {
    const snapshot = snapshotByActivationId.get(deployment.activationId)
    if (
      !snapshot
      || snapshot.packageId !== deployment.packageId
      || snapshot.packageKey !== deployment.packageKey
      || snapshot.frameworkKey !== deployment.frameworkKey
      || snapshot.frameworkVersion !== deployment.frameworkVersion
    ) {
      throw new ResetError('PACKAGE_LINEAGE_MISMATCH', 'Runtime Deployment activationId does not resolve to a reciprocal targeted snapshot.')
    }
    if (deployment.supersededByDeploymentId && !deploymentById.has(deployment.supersededByDeploymentId)) {
      throw new ResetError('PACKAGE_LINEAGE_OUTSIDE_CLOSURE', 'Runtime Deployment supersession points outside the deletion closure.')
    }
  }
  for (const snapshot of snapshotIdentities) {
    if (snapshot.deploymentId) {
      const deployment = deploymentById.get(snapshot.deploymentId)
      if (
        !deployment
        || deployment.activationId !== snapshot.activationId
        || deployment.packageId !== snapshot.packageId
        || deployment.packageKey !== snapshot.packageKey
        || deployment.frameworkKey !== snapshot.frameworkKey
        || deployment.frameworkVersion !== snapshot.frameworkVersion
      ) {
        throw new ResetError('PACKAGE_LINEAGE_MISMATCH', 'Runtime Activation Snapshot deploymentId is not reciprocal inside the deletion closure.')
      }
    }
    for (const field of ['supersedesActivationId', 'supersededByActivationId', 'rollbackSourceActivationId']) {
      if (snapshot[field] && !snapshotByActivationId.has(snapshot[field])) {
        throw new ResetError('PACKAGE_LINEAGE_OUTSIDE_CLOSURE', `Runtime Activation Snapshot ${field} points outside the deletion closure.`)
      }
    }
  }

  return {
    packageIds: uniqueSorted([...packageById.keys()]),
    packageKeys: uniqueSorted([...packageKeySet]),
    entries: {
      frameworkpackages: entryForIds({
        key: 'FrameworkPackage',
        collection: 'frameworkpackages',
        ids: packageIdentities.map(({ id }) => id),
        identities: packageIdentities,
      }),
      runtime_deployments: entryForIds({
        key: 'RuntimeDeployment',
        collection: 'runtime_deployments',
        ids: deploymentIdentities.map(({ id }) => id),
        identities: deploymentIdentities,
      }),
      runtime_activation_snapshots: entryForIds({
        key: 'RuntimeActivationSnapshot',
        collection: 'runtime_activation_snapshots',
        ids: snapshotIdentities.map(({ id }) => id),
        identities: snapshotIdentities,
      }),
    },
  }
}

const buildResetMutationContext = async ({
  database,
  session = null,
} = {}) => {
  assertProtectionConfiguration()

  const customers = await collectionDocuments(database, 'customers', {}, {
    session,
    projection: { _id: 1 },
  })
  const customerIdSet = new Set(customers.map(({ _id }) => stringifyId(_id)))
  const tenants = await collectionDocuments(database, 'tenants', {}, {
    session,
    projection: { _id: 1, customerId: 1 },
  })
  const tenantPairSet = new Set()
  for (const tenant of tenants) {
    const customerId = stringifyId(tenant.customerId)
    if (!customerIdSet.has(customerId)) {
      throw new ResetError('TENANT_CUSTOMER_ORPHAN', 'A retained Tenant references a missing Customer.')
    }
    tenantPairSet.add(pairKey(customerId, tenant._id))
  }

  const vmfs = await collectionDocuments(database, 'vmfs', {}, {
    session,
    projection: { _id: 1, customerId: 1, tenantId: 1 },
  })
  const vmfScopeById = new Map()
  const vmfIdentities = []
  for (const vmf of vmfs) {
    const id = stringifyId(vmf._id)
    const scope = { customerId: stringifyId(vmf.customerId), tenantId: stringifyId(vmf.tenantId) }
    if (!tenantPairSet.has(pairKey(scope.customerId, scope.tenantId))) {
      throw new ResetError('VMF_SCOPE_INVALID', 'A VMF does not resolve to a retained customer/tenant pair.')
    }
    vmfScopeById.set(id, scope)
    vmfIdentities.push({ id, ...scope })
  }

  const runtimes = await collectionDocuments(database, 'runtime_instances', {}, {
    session,
    projection: { _id: 1, customerId: 1, tenantId: 1 },
  })
  const runtimeScopeById = new Map()
  const runtimeIdentities = []
  for (const runtime of runtimes) {
    const id = stringifyId(runtime._id)
    const scope = { customerId: stringifyId(runtime.customerId), tenantId: stringifyId(runtime.tenantId) }
    if (!tenantPairSet.has(pairKey(scope.customerId, scope.tenantId))) {
      throw new ResetError('RUNTIME_SCOPE_INVALID', 'A Runtime Instance does not resolve to a retained customer/tenant pair.')
    }
    runtimeScopeById.set(id, scope)
    runtimeIdentities.push({ id, ...scope })
  }

  const packages = await collectionDocuments(database, 'frameworkpackages', {}, { session })
  const deployments = await collectionDocuments(database, 'runtime_deployments', {}, { session })
  const activationSnapshots = await collectionDocuments(database, 'runtime_activation_snapshots', {}, { session })
  const packageLineage = buildPackageLineageState({
    packages,
    deployments,
    snapshots: activationSnapshots,
  })
  const targetPackageKeySet = new Set(packageLineage.packageKeys)

  const packageLockState = []
  let totalPackageLockMutations = 0
  for (const collection of MUTABLE_RETAINED_LOCK_COLLECTIONS) {
    const documents = await collectionDocuments(database, collection, {}, {
      session,
      projection: {
        _id: 1,
        lockedByPackageKeys: 1,
        isLocked: 1,
        lockedBy: 1,
        lockedAt: 1,
        lockedReason: 1,
      },
    })
    const state = buildPackageLockCollectionState({ collection, documents, targetPackageKeySet })
    totalPackageLockMutations += state.mutationCount
    packageLockState.push(state)
  }
  if (totalPackageLockMutations > MAX_PACKAGE_LOCK_MUTATION_DOCUMENTS) {
    throw new ResetError('PACKAGE_LOCK_MUTATION_LIMIT_EXCEEDED', 'Package-owned lock mutations exceed the code-owned safety ceiling.', {
      plannedCount: totalPackageLockMutations,
      maximumCount: MAX_PACKAGE_LOCK_MUTATION_DOCUMENTS,
    })
  }

  const entries = []
  for (const config of DISPOSABLE_COLLECTIONS) {
    if (config.root === 'auditlog-root') {
      const auditLogs = await collectionDocuments(database, AUDITLOGS_COLLECTION, {}, {
        session,
        projection: AUDIT_HMAC_IDENTITY_PROJECTION,
      })
      entries.push(buildAuditLogDeleteEntry(auditLogs))
      continue
    }
    if (config.root === 'runtime-root') {
      entries.push(entryForIds({
        ...config,
        ids: [...runtimeScopeById.keys()],
        identities: runtimeIdentities,
      }))
      continue
    }
    if (config.root === 'vmf-root') {
      entries.push(entryForIds({
        ...config,
        ids: [...vmfScopeById.keys()],
        identities: vmfIdentities,
      }))
      continue
    }
    if (config.root === 'package-root' || config.root === 'package') {
      entries.push(packageLineage.entries[config.collection])
      continue
    }

    const linkField = config.root === 'runtime' ? 'runtimeInstanceId' : 'vmfId'
    const rootMap = config.root === 'runtime' ? runtimeScopeById : vmfScopeById
    const documents = await collectionDocuments(database, config.collection, {}, {
      session,
      projection: { _id: 1, [linkField]: 1, customerId: 1, tenantId: 1 },
    })
    const ids = []
    const identities = []
    for (const document of documents) {
      const rootId = stringifyId(document[linkField])
      const expected = rootMap.get(rootId)
      if (!expected) {
        throw new ResetError('DESCENDANT_OUTSIDE_ROOT_CLOSURE', `${config.collection} contains a row outside the exact reset-root closure.`)
      }
      assertDocumentScope({ document, expected, collection: config.collection })
      const id = stringifyId(document._id)
      ids.push(id)
      identities.push({
        id,
        rootId,
        customerId: stringifyId(document.customerId),
        tenantId: stringifyId(document.tenantId),
      })
    }
    entries.push(entryForIds({ ...config, ids, identities }))
  }

  const targetVmfIds = uniqueSorted([...vmfScopeById.keys()])
  const targetRuntimeIds = uniqueSorted([...runtimeScopeById.keys()])
  const targetVmfIdSet = new Set(targetVmfIds)
  const users = await collectionDocuments(database, 'users', {}, {
    session,
    projection: { _id: 1, vmfGrants: 1 },
  })
  const matchedUserIds = []
  let targetGrantElements = 0
  for (const user of users) {
    const matchingGrants = (user.vmfGrants || [])
      .filter((grant) => targetVmfIdSet.has(stringifyId(grant?.vmfId)))
    if (matchingGrants.length > 0) {
      matchedUserIds.push(stringifyId(user._id))
      targetGrantElements += matchingGrants.length
    }
  }
  const sortedMatchedUserIds = uniqueSorted(matchedUserIds)

  return {
    surface: {
      roots: {
        customerCount: customers.length,
        tenantCount: tenants.length,
        vmfIds: targetVmfIds,
        runtimeInstanceIds: targetRuntimeIds,
        packageIds: packageLineage.packageIds,
        packageKeys: packageLineage.packageKeys,
      },
      entries: entries.map(mutationEntry),
      packageLockState,
      userGrants: {
        matchedUserIds: sortedMatchedUserIds,
        matchedUserDocuments: sortedMatchedUserIds.length,
        expectedModifiedUserDocuments: sortedMatchedUserIds.length,
        expectedRemovedGrantElements: targetGrantElements,
      },
    },
    targetVmfIdSet,
  }
}

export const mutationSurfaceFromExactPlan = (exactPlan) => ({
  roots: {
    customerCount: exactPlan.roots.customerCount,
    tenantCount: exactPlan.roots.tenantCount,
    vmfIds: exactPlan.roots.vmfIds,
    runtimeInstanceIds: exactPlan.roots.runtimeInstanceIds,
    packageIds: exactPlan.roots.packageIds,
    packageKeys: exactPlan.roots.packageKeys,
  },
  entries: exactPlan.entries.map(mutationEntry),
  packageLockState: exactPlan.packageLockState,
  userGrants: {
    matchedUserIds: exactPlan.userGrantState.matchedUserIds,
    matchedUserDocuments: exactPlan.userGrantState.matchedUserDocuments,
    expectedModifiedUserDocuments: exactPlan.userGrantState.expectedModifiedUserDocuments,
    expectedRemovedGrantElements: exactPlan.userGrantState.expectedRemovedGrantElements,
  },
})

export const buildResetMutationSurface = async (options = {}) => (
  await buildResetMutationContext(options)
).surface

export const buildResetPlan = async ({
  database,
  session = null,
  target = ALLOWED_TARGET,
  verifyCollections = true,
} = {}) => {
  assertProtectionConfiguration()
  if (verifyCollections) await assertKnownCollections(database)
  const mutationContext = await buildResetMutationContext({ database, session })
  const mutationSurface = mutationContext.surface
  const targetVmfIds = mutationSurface.roots.vmfIds
  const targetRuntimeIds = mutationSurface.roots.runtimeInstanceIds
  const targetPackageKeys = mutationSurface.roots.packageKeys
  const targetVmfIdSet = mutationContext.targetVmfIdSet
  const entries = mutationSurface.entries.map(({ order, root, linkField, ...entry }) => entry)
  const { protectedState, userGrantState } = await buildProtectedState({
    database,
    targetVmfIdSet,
    session,
  })

  const runtimeScopeKeys = targetRuntimeIds.map((id) => `RUNTIME_INSTANCE:${id}`.toUpperCase())
  const runtimeScopedActivations = runtimeScopeKeys.length > 0
    ? await collectionDocuments(database, 'knowledge_pack_activations', {
        scopeType: 'RUNTIME_INSTANCE',
        scopeKey: { $in: runtimeScopeKeys },
      }, { session, projection: { _id: 1 } })
    : []
  const runtimeValidationCount = protectedState
    .filter(({ collection }) => ['runtime_validation_audit', 'runtimevalidationaudits'].includes(collection))
    .reduce((total, entry) => total + entry.count, 0)
  const auditLogsEntry = entries.find(({ collection }) => collection === AUDITLOGS_COLLECTION)
  const uiPackageProvenance = targetPackageKeys.length > 0
    ? await collectionDocuments(database, 'uicontracts', {
        sourcePackageKey: { $in: targetPackageKeys },
      }, { session, projection: { _id: 1 } })
    : []

  const exactPlan = {
    schemaVersion: RESET_PLAN_SCHEMA_VERSION,
    target: {
      nodeEnv: target.nodeEnv,
      databaseName: target.databaseName,
      hostSha256: target.hostSha256,
      allCustomers: true,
    },
    roots: {
      customerCount: mutationSurface.roots.customerCount,
      tenantCount: mutationSurface.roots.tenantCount,
      vmfIds: targetVmfIds,
      runtimeInstanceIds: targetRuntimeIds,
      packageIds: mutationSurface.roots.packageIds,
      packageKeys: targetPackageKeys,
    },
    entries,
    packageLockState: mutationSurface.packageLockState,
    auditLogsDelete: {
      collection: AUDITLOGS_COLLECTION,
      count: auditLogsEntry.count,
      idSha256: auditLogsEntry.idSha256,
      identitySha256: auditLogsEntry.identitySha256,
      digestMode: 'AUDITLOG_DELETE_HMAC_IDENTITY_V1',
    },
    userGrantState,
    protectedState,
    retainedResidue: {
      runtimeValidationAuditCount: runtimeValidationCount,
      runtimeScopedKnowledgePackActivationCount: runtimeScopedActivations.length,
      runtimeScopedKnowledgePackActivationIdSha256: hashCanonical(
        runtimeScopedActivations.map(({ _id }) => stringifyId(_id)).sort(),
      ),
      uiContractPackageProvenanceCount: uiPackageProvenance.length,
      uiContractPackageProvenanceIdSha256: hashCanonical(
        uiPackageProvenance.map(({ _id }) => stringifyId(_id)).sort(),
      ),
    },
  }

  return {
    exactPlan,
    planSha256: hashCanonical(exactPlan),
  }
}

export const sanitizePlan = ({ exactPlan, planSha256 }) => ({
  schemaVersion: exactPlan.schemaVersion,
  mode: 'DRY_RUN',
  target: exactPlan.target,
  planSha256,
  roots: {
    customerCount: exactPlan.roots.customerCount,
    tenantCount: exactPlan.roots.tenantCount,
    vmfCount: exactPlan.roots.vmfIds.length,
    runtimeInstanceCount: exactPlan.roots.runtimeInstanceIds.length,
    frameworkPackageCount: exactPlan.roots.packageIds.length,
  },
  collections: exactPlan.entries.map(({ key, collection, count, idSha256, identitySha256 }) => ({
    key,
    collection,
    count,
    idSha256,
    identitySha256,
  })),
  userGrants: {
    matchedUserDocuments: exactPlan.userGrantState.matchedUserDocuments,
    expectedModifiedUserDocuments: exactPlan.userGrantState.expectedModifiedUserDocuments,
    expectedRemovedGrantElements: exactPlan.userGrantState.expectedRemovedGrantElements,
  },
  packageLocks: exactPlan.packageLockState.map((state) => ({
    collection: state.collection,
    documentCount: state.documentCount,
    mutationCount: state.mutationCount,
    beforeCollectionLockSha256: state.beforeCollectionLockSha256,
    afterCollectionLockSha256: state.afterCollectionLockSha256,
    mutationBeforeSha256: state.mutationBeforeSha256,
    mutationAfterSha256: state.mutationAfterSha256,
  })),
  auditLogsDelete: exactPlan.auditLogsDelete,
  retainedResidue: exactPlan.retainedResidue,
  protected: exactPlan.protectedState.map(({ collection, count, ...digests }) => ({
    collection,
    count,
    ...digests,
  })),
})

const readJsonFile = async (filePath, fsPromises = fs.promises) => {
  const raw = await fsPromises.readFile(filePath, 'utf8')
  try {
    return JSON.parse(raw)
  } catch {
    throw new ResetError('JSON_INVALID', `Invalid JSON file: ${path.basename(filePath)}`)
  }
}

const assertSameCountManifest = (sourceCounts, restoredCounts) => {
  if (!sourceCounts || !restoredCounts || typeof sourceCounts !== 'object' || typeof restoredCounts !== 'object') {
    throw new ResetError('BACKUP_COUNTS_REQUIRED', 'Source and restored per-collection counts are required.')
  }
  const sourceKeys = Object.keys(sourceCounts).filter((key) => !key.startsWith('system.')).sort()
  const restoredKeys = Object.keys(restoredCounts).filter((key) => !key.startsWith('system.')).sort()
  if (canonicalJson(sourceKeys) !== canonicalJson(restoredKeys)) {
    throw new ResetError('BACKUP_COLLECTION_SET_MISMATCH', 'Source and restored collection key sets differ.')
  }
  for (const key of sourceKeys) {
    if (!Number.isSafeInteger(sourceCounts[key]) || sourceCounts[key] < 0 || restoredCounts[key] !== sourceCounts[key]) {
      throw new ResetError('BACKUP_COLLECTION_COUNT_MISMATCH', `Source and restored counts differ for ${key}.`)
    }
  }
}

const collectionCountsFromPlan = (exactPlan) => Object.fromEntries([
  ...exactPlan.entries.map(({ collection, count }) => [collection, count]),
  ...exactPlan.protectedState.map(({ collection, count }) => [collection, count]),
].sort(([left], [right]) => left.localeCompare(right)))

const assertManifestMatchesPlanCounts = (sourceCounts, exactPlan) => {
  if (!exactPlan || exactPlan.schemaVersion !== RESET_PLAN_SCHEMA_VERSION) {
    throw new ResetError('BACKUP_PLAN_REQUIRED', 'The exact reviewed plan is required to verify backup source counts.')
  }
  const expectedCounts = collectionCountsFromPlan(exactPlan)
  if (canonicalJson(sourceCounts) !== canonicalJson(expectedCounts)) {
    throw new ResetError('BACKUP_SOURCE_PLAN_COUNT_MISMATCH', 'Backup source counts differ from the exact reviewed plan.')
  }
}

export const validateBackupManifest = async ({
  manifest,
  exactPlan,
  planSha256,
  backupSha256,
  now = new Date(),
  hashFileFn = hashFile,
} = {}) => {
  if (manifest?.schemaVersion !== BACKUP_MANIFEST_SCHEMA_VERSION) {
    throw new ResetError('BACKUP_SCHEMA_INVALID', 'Backup manifest schemaVersion is invalid.')
  }
  if (normalizeLower(manifest.planSha256) !== normalizeLower(planSha256)) {
    throw new ResetError('BACKUP_PLAN_MISMATCH', 'Backup manifest is not bound to the reviewed plan.')
  }
  if (
    manifest.source?.databaseName !== ALLOWED_TARGET.databaseName
    || normalizeLower(manifest.source?.hostSha256) !== ALLOWED_TARGET.hostSha256
  ) {
    throw new ResetError('BACKUP_TARGET_MISMATCH', 'Backup source does not match the code-owned target.')
  }
  const completedAt = new Date(manifest.source?.completedAt)
  const restoreCompletedAt = new Date(manifest.restore?.completedAt)
  const nowMs = now.getTime()
  if (
    Number.isNaN(completedAt.getTime())
    || completedAt.getTime() > nowMs
    || nowMs - completedAt.getTime() > MAX_BACKUP_AGE_MS
  ) {
    throw new ResetError('BACKUP_TOO_OLD', 'Backup completion must be valid and no more than 24 hours old.')
  }
  if (
    manifest.restore?.verified !== true
    || Number.isNaN(restoreCompletedAt.getTime())
    || restoreCompletedAt <= completedAt
    || restoreCompletedAt.getTime() > nowMs
    || !manifest.restore?.databaseName
    || manifest.restore.databaseName === manifest.source.databaseName
  ) {
    throw new ResetError('BACKUP_RESTORE_INVALID', 'Isolated restore proof is missing, ill-ordered, or not isolated.')
  }
  assertSameCountManifest(manifest.source.collectionCounts, manifest.restore.collectionCounts)
  assertManifestMatchesPlanCounts(manifest.source.collectionCounts, exactPlan)

  const artifactPath = assertPrivatePath(manifest.artifact?.path)
  const manifestSha = normalizeLower(manifest.artifact?.sha256)
  if (!SHA256_PATTERN.test(manifestSha) || manifestSha !== normalizeLower(backupSha256)) {
    throw new ResetError('BACKUP_HASH_MISMATCH', 'Backup manifest and requested backup SHA-256 differ.')
  }
  const actualSha = normalizeLower(await hashFileFn(artifactPath))
  if (actualSha !== manifestSha) {
    throw new ResetError('BACKUP_ARTIFACT_HASH_MISMATCH', 'Backup artifact SHA-256 verification failed.')
  }
  return { artifactPath, backupSha256: actualSha }
}

const protectedStateByCollection = (state) => new Map(
  state.map((entry) => [entry.collection, entry]),
)

const assertProtectedStateEqual = (expected, actual) => {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new ResetError('PROTECTED_STATE_CHANGED', 'Protected collection state changed from the reviewed plan.')
  }
}

const bsonValueFromTypedState = (state) => {
  if (!state?.present) return undefined
  if (state.type === 'null') return null
  if (state.type === 'date') return new Date(state.value)
  if (state.type === 'objectId') return new mongoose.Types.ObjectId(state.value)
  if (['array', 'boolean', 'string'].includes(state.type)) return state.value
  throw new ResetError('PACKAGE_LOCK_STATE_INVALID', 'Private plan contains an unsupported typed lock state.')
}

const exactLockStateFilter = (id, state) => {
  const filter = { _id: new mongoose.Types.ObjectId(id) }
  for (const field of PACKAGE_LOCK_FIELDS) {
    const fieldState = state[field]
    if (!fieldState?.present) filter[field] = { $exists: false }
    else if (fieldState.type === 'null') filter[field] = { $type: 10 }
    else filter[field] = bsonValueFromTypedState(fieldState)
  }
  return filter
}

const packageLockUpdate = ({ before, after }) => {
  const $set = {
    lockedByPackageKeys: bsonValueFromTypedState(after.lockedByPackageKeys),
  }
  for (const field of PACKAGE_LOCK_FIELDS.filter((name) => name !== 'lockedByPackageKeys')) {
    if (canonicalJson(before[field]) !== canonicalJson(after[field])) {
      $set[field] = bsonValueFromTypedState(after[field])
    }
  }
  return { $set }
}

const reconcilePackageLockState = async ({ database, exactPlan, session = null }) => {
  const targetPackageKeySet = new Set(exactPlan.roots.packageKeys)
  for (const expected of exactPlan.packageLockState) {
    const documents = await collectionDocuments(database, expected.collection, {}, {
      session,
      projection: {
        _id: 1,
        lockedByPackageKeys: 1,
        isLocked: 1,
        lockedBy: 1,
        lockedAt: 1,
        lockedReason: 1,
      },
    })
    const actual = buildPackageLockCollectionState({
      collection: expected.collection,
      documents,
      targetPackageKeySet,
    })
    if (
      actual.documentCount !== expected.documentCount
      || actual.mutationCount !== 0
      || actual.beforeCollectionLockSha256 !== expected.afterCollectionLockSha256
    ) {
      throw new ResetError('PACKAGE_LOCK_RECONCILIATION_FAILED', 'Package-owned Runtime Control locks differ from the reviewed after-state.')
    }
  }
}

export const reconcileExactPlan = async ({ database, exactPlan, session = null } = {}) => {
  const residuals = []
  for (const entry of exactPlan.entries) {
    const remaining = await collectionDocuments(database, entry.collection, {}, {
      session,
      projection: { _id: 1 },
    })
    if (remaining.length > 0) residuals.push({ collection: entry.collection, count: remaining.length })
  }

  const auditLogRemaining = await database.collection(AUDITLOGS_COLLECTION).countDocuments({}, {
    ...(session ? { session } : {}),
    maxTimeMS: MAX_QUERY_TIME_MS,
  })
  if (auditLogRemaining !== 0) residuals.push({ collection: AUDITLOGS_COLLECTION, count: auditLogRemaining })

  const targetVmfIdSet = new Set(exactPlan.roots.vmfIds)
  await reconcilePackageLockState({ database, exactPlan, session })
  const { protectedState, userGrantState } = await buildProtectedState({ database, targetVmfIdSet, session })
  if (userGrantState.matchedUserDocuments !== 0 || userGrantState.expectedRemovedGrantElements !== 0) {
    residuals.push({ collection: 'users.vmfGrants', count: userGrantState.expectedRemovedGrantElements })
  }

  const expectedProtected = exactPlan.protectedState.map((entry) => {
    if (entry.collection !== 'users') return entry
    return {
      collection: entry.collection,
      count: entry.count,
      sha256ExcludingVmfGrants: entry.sha256ExcludingVmfGrants,
      nonTargetVmfGrantsSha256: entry.nonTargetVmfGrantsSha256,
    }
  })
  assertProtectedStateEqual(expectedProtected, protectedState)

  if (residuals.length > 0) {
    throw new ResetError('RECONCILIATION_RESIDUE', 'Targeted records remain after reset.', {
      residualCollectionCount: residuals.length,
      residualCount: residuals.reduce((total, row) => total + row.count, 0),
    })
  }

  return {
    targetRecordsRemaining: 0,
    targetGrantElementsRemaining: 0,
    protectedCollectionCount: protectedStateByCollection(protectedState).size,
  }
}

export const reconcileResetMutationSurface = async ({ database, exactPlan, session } = {}) => {
  const residuals = []
  for (const entry of exactPlan.entries) {
    const remaining = await collectionDocuments(database, entry.collection, {}, {
      session,
      projection: { _id: 1 },
    })
    if (remaining.length > 0) residuals.push({ collection: entry.collection, count: remaining.length })
  }

  const auditLogRemaining = await database.collection(AUDITLOGS_COLLECTION).countDocuments({}, {
    session,
    maxTimeMS: MAX_QUERY_TIME_MS,
  })
  if (auditLogRemaining !== 0) residuals.push({ collection: AUDITLOGS_COLLECTION, count: auditLogRemaining })

  const vmfObjectIds = toObjectIds(exactPlan.roots.vmfIds)
  const usersWithTargetGrants = vmfObjectIds.length > 0
    ? await collectionDocuments(database, 'users', {
        'vmfGrants.vmfId': { $in: vmfObjectIds },
      }, {
        session,
        projection: { _id: 1, vmfGrants: 1 },
      })
    : []
  const targetVmfIdSet = new Set(exactPlan.roots.vmfIds)
  const targetGrantElements = usersWithTargetGrants.reduce(
    (total, user) => total + (user.vmfGrants || [])
      .filter((grant) => targetVmfIdSet.has(stringifyId(grant?.vmfId)))
      .length,
    0,
  )
  if (targetGrantElements > 0) {
    residuals.push({ collection: 'users.vmfGrants', count: targetGrantElements })
  }
  await reconcilePackageLockState({ database, exactPlan, session })
  if (residuals.length > 0) {
    throw new ResetError('RECONCILIATION_RESIDUE', 'Targeted records remain inside the reset transaction.', {
      residualCollectionCount: residuals.length,
      residualCount: residuals.reduce((total, row) => total + row.count, 0),
    })
  }
  return {
    targetRecordsRemaining: 0,
    targetGrantElementsRemaining: 0,
  }
}

export const applyExactPlan = async ({ database, exactPlan, session }) => {
  const vmfObjectIds = toObjectIds(exactPlan.roots.vmfIds)
  const expectedGrantState = exactPlan.userGrantState
  const userResult = vmfObjectIds.length > 0
    ? await database.collection('users').updateMany(
        { 'vmfGrants.vmfId': { $in: vmfObjectIds } },
        { $pull: { vmfGrants: { vmfId: { $in: vmfObjectIds } } } },
        { session },
      )
    : { matchedCount: 0, modifiedCount: 0 }
  if (
    userResult.matchedCount !== expectedGrantState.matchedUserDocuments
    || userResult.modifiedCount !== expectedGrantState.expectedModifiedUserDocuments
  ) {
    throw new ResetError('USER_GRANT_UPDATE_MISMATCH', 'User VMF grant update counts differ from the reviewed plan.')
  }

  const packageLockResults = []
  for (const state of exactPlan.packageLockState) {
    if (state.mutationCount === 0) continue
    const operations = state.mutations.map((mutation) => ({
      updateOne: {
        filter: exactLockStateFilter(mutation.id, mutation.before),
        update: packageLockUpdate(mutation),
        upsert: false,
      },
    }))
    const result = await database.collection(state.collection).bulkWrite(operations, {
      ordered: true,
      session,
    })
    if (
      result.matchedCount !== state.mutationCount
      || result.modifiedCount !== state.mutationCount
      || Number(result.upsertedCount || 0) !== 0
    ) {
      throw new ResetError('PACKAGE_LOCK_UPDATE_MISMATCH', `${state.collection} package-lock update counts differ from the reviewed plan.`)
    }
    packageLockResults.push({
      collection: state.collection,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: Number(result.upsertedCount || 0),
    })
  }

  const deletionResults = []
  for (const entry of exactPlan.entries) {
    const ids = toObjectIds(entry.ids)
    const result = ids.length > 0
      ? await database.collection(entry.collection).deleteMany({ _id: { $in: ids } }, { session })
      : { deletedCount: 0 }
    if (result.deletedCount !== entry.count) {
      throw new ResetError('DELETE_COUNT_MISMATCH', `${entry.collection} delete count differs from the reviewed plan.`)
    }
    deletionResults.push({ collection: entry.collection, deletedCount: result.deletedCount })
  }

  await reconcileResetMutationSurface({ database, exactPlan, session })
  return { deletionResults, packageLockResults, userResult }
}

const validatePrivatePlan = async ({
  args,
  fsPromises = fs.promises,
  readJsonFileFn = readJsonFile,
}) => {
  const privatePlanPath = assertPrivatePath(args.privatePlan)
  const exactPlan = await readJsonFileFn(privatePlanPath, fsPromises)
  if (exactPlan?.schemaVersion !== RESET_PLAN_SCHEMA_VERSION) {
    throw new ResetError('PRIVATE_PLAN_SCHEMA_INVALID', 'Private plan schemaVersion is invalid.')
  }
  const actualPlanSha256 = hashCanonical(exactPlan)
  if (actualPlanSha256 !== args.planSha256) {
    throw new ResetError('PRIVATE_PLAN_HASH_MISMATCH', 'Private plan SHA-256 differs from --plan-sha256.')
  }
  return { exactPlan, privatePlanPath }
}

export const connectToResetDatabase = async (uri, { mongooseClient = mongoose } = {}) => {
  await mongooseClient.connect(uri, {
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: SOCKET_TIMEOUT_MS,
    maxPoolSize: 4,
    readConcern: { level: 'majority' },
  })
  return mongooseClient.connection.db
}

const defaultVerifyTransactionTopology = async (database) => {
  const hello = await database.admin().command({ hello: 1 }, { maxTimeMS: MAX_QUERY_TIME_MS })
  if (!hello?.setName || !Number.isFinite(hello?.logicalSessionTimeoutMinutes)) {
    throw new ResetError('TRANSACTION_TOPOLOGY_REQUIRED', 'Apply requires a replica set with transaction sessions.')
  }
  return { setName: hello.setName }
}

const defaultAssertEvidenceDirectory = async (directoryPath) => {
  const stats = await fs.promises.stat(directoryPath)
  if (!stats.isDirectory()) {
    throw new ResetError('EVIDENCE_DIRECTORY_REQUIRED', '--evidence-dir must be an existing directory.')
  }
}

export const verifyCredentialScope = async (
  database,
  { apply = false, allowApplicationCredentialReadOnlyRisk = false } = {},
) => {
  const connectionStatus = await database.admin().command(
    { connectionStatus: 1, showPrivileges: true },
    { maxTimeMS: MAX_QUERY_TIME_MS },
  )
  const roles = Array.isArray(connectionStatus?.authInfo?.authenticatedUserRoles)
    ? connectionStatus.authInfo.authenticatedUserRoles
    : []
  const privileges = Array.isArray(connectionStatus?.authInfo?.authenticatedUserPrivileges)
    ? connectionStatus.authInfo.authenticatedUserPrivileges
    : []
  if (roles.length === 0) {
    throw new ResetError('RESET_CREDENTIAL_UNVERIFIED', 'The authenticated reset credential exposes no verifiable role evidence.')
  }
  if (allowApplicationCredentialReadOnlyRisk) {
    if (apply) {
      throw new ResetError('APPLICATION_CREDENTIAL_APPLY_REJECTED', 'The application credential exception cannot be used for apply.')
    }
    return {
      credentialMode: 'APPLICATION_CREDENTIAL_READ_ONLY_RISK_ACCEPTED',
      roleCount: roles.length,
      roleEvidenceSha256: hashCanonical(roles),
      privilegeEvidenceSha256: hashCanonical(privileges),
      writePrivilegeCollectionCount: null,
    }
  }
  if (roles.some(({ role }) => BROAD_ROLE_NAMES.has(normalizeLower(role)))) {
    throw new ResetError('OVERPRIVILEGED_RESET_CREDENTIAL', 'Broad administrative/database roles cannot be used by the reset script.')
  }
  const requiredRole = apply ? APPLY_CREDENTIAL_ROLE : DRY_RUN_CREDENTIAL_ROLE
  if (roles.length !== 1 || roles[0]?.role !== requiredRole) {
    throw new ResetError(
      apply ? 'APPLY_ROLE_REQUIRED' : 'DRY_RUN_ROLE_REQUIRED',
      `${apply ? 'Apply' : 'Dry-run'} requires only the dedicated ${requiredRole} role.`,
    )
  }

  const removableCollections = new Set()
  const readableCollections = new Set()
  const updatableCollections = new Set()
  let listCollectionsAllowed = false
  for (const privilege of privileges) {
    const resource = privilege?.resource || {}
    const actions = Array.isArray(privilege?.actions) ? privilege.actions : []
    const collectionName = normalizeText(resource.collection)
    if (
      resource.db !== ALLOWED_TARGET.databaseName
      || resource.anyResource
      || resource.cluster
      || actions.length === 0
    ) {
      throw new ResetError('OVERPRIVILEGED_RESET_CREDENTIAL', 'Every reset privilege must have a known action and exact allowlisted database resource.')
    }
    if (!collectionName) {
      if (actions.length !== 1 || actions[0] !== 'listCollections') {
        throw new ResetError('OVERPRIVILEGED_RESET_CREDENTIAL', 'The database resource is reserved exclusively for listCollections.')
      }
      listCollectionsAllowed = true
      continue
    }
    if (!KNOWN_COLLECTIONS.has(collectionName)) {
      throw new ResetError('OVERPRIVILEGED_RESET_CREDENTIAL', 'Reset credential references an unreviewed collection.')
    }
    for (const action of actions) {
      if (!ALLOWED_PRIVILEGE_ACTIONS.has(action)) {
        throw new ResetError('OVERPRIVILEGED_RESET_CREDENTIAL', 'Reset credential contains an action outside the strict privilege allowlist.')
      }
      if (action === 'find') {
        readableCollections.add(collectionName)
        continue
      }
      if (action === 'listCollections') {
        throw new ResetError('OVERPRIVILEGED_RESET_CREDENTIAL', 'listCollections is allowed only on the exact database resource.')
      }
      if (!apply) {
        throw new ResetError('DRY_RUN_WRITE_PRIVILEGES_REJECTED', 'The dry-run credential must not contain update or remove privileges.')
      }
      if (action === 'remove' && DISPOSABLE_COLLECTION_NAME_SET.has(collectionName)) {
        removableCollections.add(collectionName)
        continue
      }
      if (action === 'update' && UPDATABLE_COLLECTION_NAME_SET.has(collectionName)) {
        updatableCollections.add(collectionName)
        continue
      }
      throw new ResetError('OVERPRIVILEGED_RESET_CREDENTIAL', 'Reset credential contains a write action outside the exact mutation allowlist.')
    }
  }

  if (
    !listCollectionsAllowed
    || [...KNOWN_COLLECTIONS].some((name) => !readableCollections.has(name))
  ) {
    throw new ResetError('RESET_READ_PRIVILEGES_INCOMPLETE', 'Reset credential does not provide the exact required read/list coverage.')
  }

  if (apply && (
    [...UPDATABLE_COLLECTION_NAME_SET].some((name) => !updatableCollections.has(name))
    || [...DISPOSABLE_COLLECTION_NAME_SET].some((name) => !removableCollections.has(name))
  )) {
    throw new ResetError('APPLY_PRIVILEGES_INCOMPLETE', 'Dedicated apply privileges do not cover exactly the named reset mutations.')
  }
  return {
    roleCount: roles.length,
    roleNameSha256: hashCanonical(roles.map(({ role, db }) => `${db}:${role}`).sort()),
    readPrivilegeCollectionCount: readableCollections.size,
    writePrivilegeCollectionCount: removableCollections.size + updatableCollections.size,
  }
}

const defaultDependencies = Object.freeze({
  parseMongoTarget,
  assertAllowedTarget,
  connect: connectToResetDatabase,
  disconnect: () => mongoose.disconnect(),
  startSession: () => mongoose.startSession(),
  verifyTransactionTopology: defaultVerifyTransactionTopology,
  verifyCredentialScope,
  assertEvidenceDirectory: defaultAssertEvidenceDirectory,
  invalidatePermissionCache: () => performanceCacheService.invalidateAllUserPermissions(),
  readJsonFile,
  durableWriteJson,
  hashFile,
  now: () => new Date(),
})

const evidenceFilePath = (evidenceDir, kind, planSha256, now) => {
  const timestamp = now.toISOString().replace(/[:.]/g, '-')
  return path.join(evidenceDir, `${timestamp}-${kind}-${planSha256.slice(0, 12)}.json`)
}

export const executeReset = async ({
  args,
  env = process.env,
  dependencies = {},
} = {}) => {
  const deps = { ...defaultDependencies, ...dependencies }
  if (!args?.allCustomers) {
    throw new ResetError('ALL_CUSTOMERS_REQUIRED', '--all-customers is required before any database connection.')
  }
  if (!args?.privatePlan) {
    throw new ResetError('PRIVATE_PLAN_REQUIRED', '--private-plan is required for dry-run and apply.')
  }
  if (args.apply && args.confirmApplicationCredentialReadOnlyRisk) {
    throw new ResetError(
      'APPLICATION_CREDENTIAL_APPLY_REJECTED',
      `${APPLICATION_CREDENTIAL_RISK_CONFIRMATION} is permitted only for a read-only dry-run.`,
    )
  }
  if (!args.apply && args.confirmAuditLogsDelete) {
    throw new ResetError(
      'AUDITLOGS_DELETE_APPLY_ONLY',
      `${AUDITLOGS_DELETE_CONFIRMATION} is permitted only for apply.`,
    )
  }
  if (args.apply) {
    const hasBackupManifest = Boolean(args.backupManifest)
    const hasBackupSha256 = Boolean(args.backupSha256)
    const hasCompleteBackupPair = hasBackupManifest && hasBackupSha256
    const hasPartialBackupPair = hasBackupManifest !== hasBackupSha256
    if (hasPartialBackupPair) {
      throw new ResetError('BACKUP_ARGUMENTS_INCOMPLETE', '--backup-manifest and --backup-sha256 must be supplied together.')
    }
    if (args.confirmBackupVerificationSkipped && (hasBackupManifest || hasBackupSha256)) {
      throw new ResetError('BACKUP_MODES_CONFLICT', `${BACKUP_SKIP_CONFIRMATION} cannot be combined with backup manifest arguments.`)
    }
    if (!args.confirmBackupVerificationSkipped && !hasCompleteBackupPair) {
      throw new ResetError('BACKUP_VERIFICATION_REQUIRED', `Apply requires a verified backup or ${BACKUP_SKIP_CONFIRMATION}.`)
    }
    if (
      !args.confirmDelete
      || !args.confirmWritePause
      || !args.confirmRestore
      || !args.confirmAuditLogsDelete
      || !SHA256_PATTERN.test(args.planSha256 || '')
      || !args.evidenceDir
    ) {
      throw new ResetError('APPLY_GATES_REQUIRED', 'All destructive, write-pause, plan, backup-mode, restore, and evidence gates are required before connection.')
    }
    if (hasCompleteBackupPair && !SHA256_PATTERN.test(args.backupSha256 || '')) {
      throw new ResetError('INVALID_SHA256', 'Backup SHA-256 values must be 64 hexadecimal characters.')
    }
  } else if (args.confirmBackupVerificationSkipped) {
    throw new ResetError('BACKUP_SKIP_APPLY_ONLY', `${BACKUP_SKIP_CONFIRMATION} is permitted only for apply.`)
  }
  const resetUri = normalizeText(env.MONGODB_RESET_URI)
  if (!resetUri) {
    throw new ResetError('RESET_URI_REQUIRED', 'MONGODB_RESET_URI is required; MONGODB_URI is never used by this script.')
  }
  assertPrivatePath(args.privatePlan)
  const parsedTarget = deps.parseMongoTarget(resetUri)
  const target = deps.assertAllowedTarget({ nodeEnv: env.NODE_ENV, ...parsedTarget })

  let connected = false
  let committed = false
  let session = null
  let exactPlan = null
  let planSha256 = ''
  let intentPath = ''
  let operationError = null

  try {
    if (args.apply) {
      const privatePlanState = await validatePrivatePlan({
        args,
        fsPromises: deps.fsPromises,
        readJsonFileFn: deps.readJsonFile,
      })
      exactPlan = privatePlanState.exactPlan
      planSha256 = args.planSha256
      const evidenceDir = assertPrivatePath(args.evidenceDir, { mustBeDirectory: true })
      await deps.assertEvidenceDirectory(evidenceDir)
      const now = deps.now()
      const backupVerification = args.confirmBackupVerificationSkipped
        ? { status: 'SKIPPED_BY_EXPLICIT_ACKNOWLEDGEMENT' }
        : (() => {
          const backupManifestPath = assertPrivatePath(args.backupManifest)
          return { status: 'VERIFIED', manifestPath: backupManifestPath }
        })()
      if (backupVerification.status === 'VERIFIED') {
        const manifest = await deps.readJsonFile(backupVerification.manifestPath, deps.fsPromises)
        await validateBackupManifest({
          manifest,
          exactPlan,
          planSha256,
          backupSha256: args.backupSha256,
          now,
          hashFileFn: deps.hashFile,
        })
      }
      intentPath = evidenceFilePath(evidenceDir, 'pre-apply-intent', planSha256, now)
      await deps.durableWriteJson(intentPath, {
        schemaVersion: 'storylineos.development-customer-vmf-reset-intent.v1',
        createdAt: now.toISOString(),
        target,
        planSha256,
        backupSha256: backupVerification.status === 'VERIFIED' ? args.backupSha256 : null,
        backupVerification: {
          status: backupVerification.status,
          restoreConfirmationSupplied: Boolean(args.confirmRestore),
        },
        confirmations: {
          allCustomers: args.allCustomers,
          destructiveReset: args.confirmDelete,
          maintenanceWritePause: args.confirmWritePause,
          restoreVerified: backupVerification.status === 'VERIFIED' && args.confirmRestore,
          auditLogsDelete: args.confirmAuditLogsDelete,
        },
        auditLogsDelete: {
          status: 'AUDITLOGS_DELETE_EXPLICITLY_ACKNOWLEDGED',
          count: exactPlan.auditLogsDelete.count,
          digestMode: exactPlan.auditLogsDelete.digestMode,
          identitySha256: exactPlan.auditLogsDelete.identitySha256,
        },
      }, deps.fsPromises)
    }

    const database = await deps.connect(resetUri)
    connected = true
    if (database.databaseName !== target.databaseName) {
      throw new ResetError('CONNECTED_DATABASE_MISMATCH', 'Connected database differs from the code-owned target.')
    }
    const credentialEvidence = await deps.verifyCredentialScope(database, {
      apply: Boolean(args.apply),
      allowApplicationCredentialReadOnlyRisk: Boolean(args.confirmApplicationCredentialReadOnlyRisk),
    })

    if (!args.apply) {
      const planned = await buildResetPlan({ database, target })
      exactPlan = planned.exactPlan
      planSha256 = planned.planSha256
      await deps.durableWriteJson(assertPrivatePath(args.privatePlan), exactPlan, deps.fsPromises)
      return {
        ...sanitizePlan(planned),
        credentialMode: credentialEvidence.credentialMode || 'DEDICATED_READ_ROLE',
      }
    }

    await assertKnownCollections(database)
    await deps.verifyTransactionTopology(database)

    const rebuilt = await buildResetPlan({ database, target, verifyCollections: false })
    if (rebuilt.planSha256 !== planSha256 || canonicalJson(rebuilt.exactPlan) !== canonicalJson(exactPlan)) {
      throw new ResetError('STALE_PLAN', 'Database state differs from the reviewed private plan.')
    }
    const expectedMutationSurface = mutationSurfaceFromExactPlan(exactPlan)

    session = await deps.startSession()
    let transactionResult = null
    await session.withTransaction(async () => {
      let liveMutationSurface
      try {
        liveMutationSurface = await buildResetMutationSurface({ database, session })
      } catch (error) {
        throw new ResetError('STALE_PLAN', 'Database mutation surface became invalid after the full plan check.', {
          causeCode: error.code || 'MUTATION_SURFACE_INVALID',
        })
      }
      if (canonicalJson(liveMutationSurface) !== canonicalJson(expectedMutationSurface)) {
        throw new ResetError('STALE_PLAN', 'Database state differs from the reviewed private plan.')
      }
      transactionResult = await applyExactPlan({ database, exactPlan, session })
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority', j: true },
      readPreference: 'primary',
    })
    committed = true

    try {
      await reconcileExactPlan({ database, exactPlan })
    } catch (error) {
      throw new ResetError('COMMITTED_WITH_RECONCILIATION_FAILURE', 'Reset committed, but direct reconciliation failed.', {
        committed: true,
        causeCode: error.code || 'UNKNOWN',
      })
    }

    let cacheResult
    try {
      cacheResult = await deps.invalidatePermissionCache()
      if (cacheResult?.redisPatternDeleteFailed) throw new Error('Redis permission cache invalidation failed.')
    } catch (error) {
      throw new ResetError('COMMITTED_WITH_CACHE_INVALIDATION_FAILURE', 'Reset committed and reconciled, but permission cache invalidation failed.', {
        committed: true,
        cause: error.message,
      })
    }

    const report = {
      schemaVersion: 'storylineos.development-customer-vmf-reset-report.v1',
      status: 'COMMITTED_RECONCILED',
      committedAt: deps.now().toISOString(),
      target,
      planSha256,
      backupSha256: args.confirmBackupVerificationSkipped ? null : args.backupSha256,
      backupVerification: {
        status: args.confirmBackupVerificationSkipped ? 'SKIPPED_BY_EXPLICIT_ACKNOWLEDGEMENT' : 'VERIFIED',
        restoreConfirmationSupplied: Boolean(args.confirmRestore),
      },
      intentFileName: path.basename(intentPath),
      totals: {
        deletedDocuments: exactPlan.entries.reduce((total, entry) => total + entry.count, 0),
        auditLogsDeleted: exactPlan.auditLogsDelete.count,
        modifiedUserDocuments: transactionResult.userResult.modifiedCount,
        removedGrantElements: exactPlan.userGrantState.expectedRemovedGrantElements,
        modifiedPackageLockDocuments: transactionResult.packageLockResults
          .reduce((total, result) => total + result.modifiedCount, 0),
      },
      retainedResidue: exactPlan.retainedResidue,
      auditLogsDelete: {
        status: 'AUDITLOGS_DELETE_EXPLICITLY_ACKNOWLEDGED',
        count: exactPlan.auditLogsDelete.count,
        deletedCount: transactionResult.deletionResults.find(({ collection }) => collection === AUDITLOGS_COLLECTION)?.deletedCount || 0,
        remainingCount: 0,
        digestMode: exactPlan.auditLogsDelete.digestMode,
        identitySha256: exactPlan.auditLogsDelete.identitySha256,
      },
      cache: cacheResult,
    }
    const reportPath = evidenceFilePath(assertPrivatePath(args.evidenceDir, { mustBeDirectory: true }), 'post-commit-report', planSha256, deps.now())
    try {
      await deps.durableWriteJson(reportPath, report, deps.fsPromises)
    } catch (error) {
      throw new ResetError('COMMITTED_WITH_EVIDENCE_FAILURE', 'Reset committed and reconciled, but the operator report could not be stored.', {
        committed: true,
        cause: error.message,
      })
    }
    return report
  } catch (error) {
    operationError = error
    throw error
  } finally {
    const cleanupFailures = []
    if (session) {
      try {
        await session.endSession()
      } catch (error) {
        cleanupFailures.push(`session:${error.message}`)
      }
    }
    if (connected) {
      try {
        await deps.disconnect()
      } catch (error) {
        cleanupFailures.push(`disconnect:${error.message}`)
      }
    }
    if (!operationError && cleanupFailures.length > 0) {
      throw new ResetError(
        committed ? 'COMMITTED_WITH_CONNECTION_CLEANUP_FAILURE' : 'CONNECTION_CLEANUP_FAILURE',
        committed
          ? 'Reset committed, but database session/connection cleanup failed.'
          : 'Database session/connection cleanup failed.',
        { committed, failureCount: cleanupFailures.length },
      )
    }
  }
}

export const usage = () => `
Development customer VMF reset (database execution requires explicit approval)

Dry-run:
  npm run db:reset:development-customer-vmfs -- --all-customers --private-plan <outside-repo-plan.json>

Explicit application-credential exception (read-only dry-run only):
  npm run db:reset:development-customer-vmfs -- --all-customers ${APPLICATION_CREDENTIAL_RISK_CONFIRMATION} --private-plan <outside-repo-plan.json>

Apply with verified backup (only after separate approval and reviewed backup/plan evidence):
  npm run db:reset:development-customer-vmfs -- --apply --all-customers ${DELETE_CONFIRMATION} ${WRITE_PAUSE_CONFIRMATION} ${RESTORE_CONFIRMATION} ${AUDITLOGS_DELETE_CONFIRMATION} --private-plan <plan.json> --plan-sha256 <sha256> --backup-manifest <manifest.json> --backup-sha256 <sha256> --evidence-dir <outside-repo-directory>

Apply with an explicit backup-verification skip (higher residual recovery risk; only after separate approval):
  npm run db:reset:development-customer-vmfs -- --apply --all-customers ${DELETE_CONFIRMATION} ${WRITE_PAUSE_CONFIRMATION} ${RESTORE_CONFIRMATION} ${AUDITLOGS_DELETE_CONFIRMATION} ${BACKUP_SKIP_CONFIRMATION} --private-plan <plan.json> --plan-sha256 <sha256> --evidence-dir <outside-repo-directory>
`

const MONGODB_URI_TEXT_PATTERN = /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi

const credentialSecretsFromUri = (activeUri) => {
  const match = String(activeUri || '').match(/^mongodb(?:\+srv)?:\/\/([^@/]+)@/i)
  if (!match) return []
  const separatorIndex = match[1].indexOf(':')
  if (separatorIndex < 0) return []
  const encodedPassword = match[1].slice(separatorIndex + 1)
  const secrets = new Set([encodedPassword])
  try {
    secrets.add(decodeURIComponent(encodedPassword))
  } catch {
    // Preserve fail-safe redaction of the encoded password when decoding fails.
  }
  return [...secrets].filter(Boolean).sort((first, second) => second.length - first.length)
}

const redactSensitiveText = (value, activeUri = '') => {
  let redacted = String(value ?? '')
  if (activeUri) redacted = redacted.split(activeUri).join('[REDACTED_MONGODB_URI]')
  for (const secret of credentialSecretsFromUri(activeUri)) {
    redacted = redacted.split(secret).join('[REDACTED_CREDENTIAL]')
  }
  return redacted.replace(MONGODB_URI_TEXT_PATTERN, '[REDACTED_MONGODB_URI]')
}

const redactSensitiveValue = (value, activeUri, seen = new WeakSet()) => {
  if (typeof value === 'string') return redactSensitiveText(value, activeUri)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[REDACTED_CIRCULAR_REFERENCE]'
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(entry, activeUri, seen))
  }
  if (value instanceof Error) {
    return {
      name: redactSensitiveText(value.name, activeUri),
      code: redactSensitiveText(value.code || '', activeUri),
      message: redactSensitiveText(value.message, activeUri),
      details: redactSensitiveValue(value.details || {}, activeUri, seen),
      cause: value.cause ? redactSensitiveValue(value.cause, activeUri, seen) : undefined,
    }
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    redactSensitiveValue(entry, activeUri, seen),
  ]))
}

export const serializeErrorForOutput = (error, { activeUri = '' } = {}) => ({
  status: error?.committed ? redactSensitiveText(error.code || 'RESET_FAILED', activeUri) : 'REJECTED',
  code: redactSensitiveText(error?.code || 'RESET_FAILED', activeUri),
  message: redactSensitiveText(error?.message || 'Reset failed.', activeUri),
  committed: Boolean(error?.committed),
  details: redactSensitiveValue(error?.details || {}, activeUri),
  cause: error?.cause ? redactSensitiveValue(error.cause, activeUri) : undefined,
})

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename

if (isDirectExecution) {
  let parsedArgs
  try {
    parsedArgs = parseArgs()
    if (parsedArgs.help) {
      process.stdout.write(usage())
    } else {
      const result = await executeReset({ args: parsedArgs })
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify(serializeErrorForOutput(error, {
      activeUri: process.env.MONGODB_RESET_URI,
    }), null, 2)}\n`)
    process.exitCode = error.committed ? 2 : 1
  }
}
