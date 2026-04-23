import { isDeepStrictEqual } from 'node:util'
import ValidationRegistry, {
  VALIDATION_REGISTRY_CATEGORIES,
  VALIDATION_REGISTRY_SEVERITIES,
  VALIDATION_REGISTRY_STATUSES,
} from '../models/ValidationRegistry.js'
import RuntimeSkill, { RUNTIME_SKILL_STATUSES } from '../models/RuntimeSkill.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import WorkflowPolicy from '../models/WorkflowPolicy.js'
import RuntimePathRegistry, { RUNTIME_PATH_REGISTRY_SCOPES } from '../models/RuntimePathRegistry.js'
import auditService from '../services/auditService.js'
import {
  buildInactiveFrameworkKeyMessage,
  buildUnknownFrameworkKeyMessage,
  normalizeFrameworkKeyList,
  resolveKnownFrameworkKeys,
} from '../services/frameworkRegistryService.js'
import { resolveRuntimePathSelections } from '../services/runtimePathRegistryService.js'
import { escapeRegex, serializeUserSummary } from '../utils/controllerUtils.js'

const VALIDATION_NOT_FOUND_MESSAGE = 'Validation was not found.'
const DUPLICATE_VALIDATION_KEY_MESSAGE = 'Validation key must be unique.'

const cloneAuditValue = (value) => {
  if (value === undefined) return value
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.parse(JSON.stringify(value))
}

const serializeValidation = (validation, { fallbackUpdatedBy = null } = {}) => {
  const plain = typeof validation?.toJSON === 'function'
    ? validation.toJSON()
    : { ...validation }

  if (!plain.id && plain.stableId) {
    plain.id = plain.stableId
  }

  delete plain._id
  delete plain.__v
  delete plain.stableId

  const serializedUpdatedBy = serializeUserSummary(plain.updatedBy)
  plain.createdBy = serializeUserSummary(plain.createdBy)
  plain.updatedBy =
    (serializedUpdatedBy?.name || serializedUpdatedBy?.email)
      ? serializedUpdatedBy
      : (fallbackUpdatedBy || serializedUpdatedBy)

  return plain
}

const buildSearchClauses = (query) => {
  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) return []

  const regex = new RegExp(escapeRegex(normalizedQuery), 'i')
  const normalizedQueryUpper = normalizedQuery.toUpperCase()
  const clauses = [
    { stableId: regex },
    { key: regex },
    { label: regex },
    { description: regex },
    { producerSkillId: regex },
    { outputPath: regex },
  ]

  if (Object.values(VALIDATION_REGISTRY_STATUSES).includes(normalizedQueryUpper)) {
    clauses.push({ status: normalizedQueryUpper })
  }

  if (Object.values(VALIDATION_REGISTRY_CATEGORIES).includes(normalizedQueryUpper)) {
    clauses.push({ category: normalizedQueryUpper })
  }

  if (Object.values(VALIDATION_REGISTRY_SEVERITIES).includes(normalizedQueryUpper)) {
    clauses.push({ severity: normalizedQueryUpper })
  }

  return clauses
}

const parseCsv = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const buildListFilter = ({ q, keys, status, frameworkKey, frameworkKeys, category, severity, policyUsable, packageUsable }) => {
  const filter = {}

  const normalizedKeys = Array.isArray(keys) ? keys : parseCsv(keys)
  const uniqueKeys = [...new Set(
    normalizedKeys
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  )]
  if (uniqueKeys.length > 0) {
    filter.key = { $in: uniqueKeys }
  }

  const normalizedStatus = String(status || '').trim().toUpperCase()
  if (normalizedStatus) {
    filter.status = normalizedStatus
  }

  const normalizedFrameworkKey = String(frameworkKey || '').trim().toUpperCase()
  const normalizedFrameworkKeys = Array.isArray(frameworkKeys)
    ? frameworkKeys
    : parseCsv(frameworkKeys)
  const frameworks = [
    ...(normalizedFrameworkKey ? [normalizedFrameworkKey] : []),
    ...normalizedFrameworkKeys.map((value) => String(value).trim().toUpperCase()).filter(Boolean),
  ]
  const uniqueFrameworks = [...new Set(frameworks)]

  if (uniqueFrameworks.length === 1) {
    filter.supportedFrameworkKeys = uniqueFrameworks[0]
  } else if (uniqueFrameworks.length > 1) {
    // Require the validation to be compatible with every selected framework.
    filter.supportedFrameworkKeys = { $all: uniqueFrameworks }
  }

  const normalizedCategory = String(category || '').trim().toUpperCase()
  if (normalizedCategory) {
    filter.category = normalizedCategory
  }

  const normalizedSeverity = String(severity || '').trim().toUpperCase()
  if (normalizedSeverity) {
    filter.severity = normalizedSeverity
  }

  if (policyUsable !== undefined && policyUsable !== null && String(policyUsable).trim() !== '') {
    const normalized = String(policyUsable).trim().toLowerCase()
    if (normalized === 'true') filter.policyUsable = true
    if (normalized === 'false') filter.policyUsable = false
  }

  if (packageUsable !== undefined && packageUsable !== null && String(packageUsable).trim() !== '') {
    const normalized = String(packageUsable).trim().toLowerCase()
    if (normalized === 'true') filter.packageUsable = true
    if (normalized === 'false') filter.packageUsable = false
  }

  const searchClauses = buildSearchClauses(q)
  if (searchClauses.length > 0) {
    filter.$or = searchClauses
  }

  return filter
}

const buildSort = ({ sortBy, sortOrder }) => {
  const normalizedSortBy = String(sortBy || '').trim()
  const normalizedSortOrder = String(sortOrder || '').trim().toLowerCase() === 'asc' ? 1 : -1

  if (normalizedSortBy === 'label') {
    return { label: normalizedSortOrder, key: 1 }
  }

  if (normalizedSortBy === 'updatedAt') {
    return { updatedAt: normalizedSortOrder, key: 1 }
  }

  return { status: 1, updatedAt: -1, key: 1 }
}

const isDuplicateKeyError = (err) => err?.code === 11000

const validateSupportedFrameworkKeys = async (supportedFrameworkKeys = []) => {
  const normalized = normalizeFrameworkKeyList(supportedFrameworkKeys)
  const { missingKeys, inactiveKeys } = await resolveKnownFrameworkKeys(normalized, undefined, { requireActive: true })

  return {
    supportedFrameworkKeys: normalized,
    missingKeys,
    inactiveKeys,
  }
}

const buildPathDescendantError = (outputPath, fieldPath, label) => {
  if (!fieldPath) return null
  const prefix = `${outputPath}.`
  if (String(fieldPath).startsWith(prefix)) return null
  return `${label} must be inside the selected Output Path.`
}

const resolveRuntimePathRows = async ({ outputPath, passFieldPath, detailsFieldPath, frameworkKeys }) => {
  const requested = [
    outputPath,
    passFieldPath,
    detailsFieldPath,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  const selections = await resolveRuntimePathSelections({
    pathKeys: requested,
    frameworkKeys,
    operation: null,
    requireActive: true,
    forbidProtectedWrites: false,
  })

  const byKey = new Map(
    (Array.isArray(selections.rows) ? selections.rows : []).map((row) => [row.pathKey, row]),
  )

  const scopeErrors = requested.filter((key) => {
    const row = byKey.get(key)
    return row && String(row.scope || '').toUpperCase() !== RUNTIME_PATH_REGISTRY_SCOPES.VALIDATION_RESULT
  })

  return {
    selections,
    byKey,
    scopeErrors,
  }
}

const appendRuntimePathErrors = (details, { outputPath, passFieldPath, detailsFieldPath, resolution }) => {
  const check = (field, value) => {
    if (!value) return

    if (resolution.selections.missing.includes(value)) {
      details[field] = `Unknown runtime path "${value}".`
      return
    }

    if (resolution.selections.inactive.includes(value)) {
      details[field] = `Runtime path "${value}" is not ACTIVE.`
      return
    }

    if (resolution.selections.incompatibleFramework.includes(value)) {
      details[field] = `Runtime path "${value}" is not compatible with the selected frameworks.`
      return
    }

    if (resolution.scopeErrors.includes(value)) {
      details[field] = `Runtime path "${value}" must be a VALIDATION_RESULT path.`
    }
  }

  check('outputPath', outputPath)
  check('passFieldPath', passFieldPath)
  check('detailsFieldPath', detailsFieldPath)
}

const resolveProducerSkill = async (producerSkillId) => {
  if (!producerSkillId) return null
  return RuntimeSkill.findByStableId(producerSkillId)
    .select('stableId key name status supportedFrameworkKeys')
    .lean()
}

export const listValidations = async (req, res, next) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const filter = buildListFilter(req.query)
    const total = await ValidationRegistry.countDocuments(filter)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const normalizedPage = Math.min(pageNum, totalPages)
    const skip = (normalizedPage - 1) * limit

    const items = await ValidationRegistry.find(filter)
      .sort(buildSort(req.query))
      .maxTimeMS(3000)
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .lean()

    return res.status(200).json({
      data: items.map((item) => serializeValidation(item)),
      meta: {
        page: normalizedPage,
        pageSize: limit,
        total,
        totalPages,
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}

export const createValidation = async (req, res, next) => {
  try {
    const actorId = req.context?.userId || req.userId
    const body = req.body || {}
    const details = {}

    const nextBlockingDefault = body.blockingDefault === undefined ? true : Boolean(body.blockingDefault)
    const nextWarningOnlyDefault = body.warningOnlyDefault === undefined ? false : Boolean(body.warningOnlyDefault)
    if (nextBlockingDefault && nextWarningOnlyDefault) {
      details.warningOnlyDefault = 'Blocking Default and Warning Only Default cannot both be true.'
    }

    const frameworkDetails = await validateSupportedFrameworkKeys(body.supportedFrameworkKeys)
    if (frameworkDetails.missingKeys.length > 0) {
      details.supportedFrameworkKeys = buildUnknownFrameworkKeyMessage(frameworkDetails.missingKeys)
    } else if (frameworkDetails.inactiveKeys.length > 0) {
      details.supportedFrameworkKeys = buildInactiveFrameworkKeyMessage(frameworkDetails.inactiveKeys)
    }

    const producer = await resolveProducerSkill(body.producerSkillId)
    if (!producer) {
      details.producerSkillId = 'Producer skill was not found.'
    } else if (
      String(body.status || '').trim().toUpperCase() === VALIDATION_REGISTRY_STATUSES.ACTIVE
      && String(producer.status || '').trim().toUpperCase() !== RUNTIME_SKILL_STATUSES.ACTIVE
    ) {
      details.producerSkillId = 'Producer skill must be ACTIVE when the validation is ACTIVE.'
    }

    if (producer && Array.isArray(body.supportedFrameworkKeys) && body.supportedFrameworkKeys.length > 0) {
      const producerFrameworks = Array.isArray(producer.supportedFrameworkKeys) ? producer.supportedFrameworkKeys : []
      const required = normalizeFrameworkKeyList(body.supportedFrameworkKeys)
      const missing = required.filter((key) => !producerFrameworks.includes(key))
      if (missing.length > 0) {
        details.producerSkillId = `Producer skill does not support framework${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`
      }
    }

    const outputPath = String(body.outputPath || '').trim()
    const passFieldPath = String(body.passFieldPath || '').trim()
    const detailsFieldPath = String(body.detailsFieldPath || '').trim()

    if (outputPath && passFieldPath) {
      const err = buildPathDescendantError(outputPath, passFieldPath, 'Pass Field Path')
      if (err) details.passFieldPath = err
    }

    if (outputPath && detailsFieldPath) {
      const err = buildPathDescendantError(outputPath, detailsFieldPath, 'Details Field Path')
      if (err) details.detailsFieldPath = err
    }

    const runtimePathResolution = await resolveRuntimePathRows({
      outputPath,
      passFieldPath,
      detailsFieldPath,
      frameworkKeys: frameworkDetails.supportedFrameworkKeys,
    })

    appendRuntimePathErrors(details, {
      outputPath,
      passFieldPath,
      detailsFieldPath,
      resolution: runtimePathResolution,
    })

    if (Object.keys(details).length > 0) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Please check the form for errors.',
          details,
          requestId: req.requestId,
        },
      })
    }

    const created = new ValidationRegistry({
      key: body.key,
      label: body.label,
      description: body.description,
      status: body.status,
      supportedFrameworkKeys: frameworkDetails.supportedFrameworkKeys,
      category: body.category,
      severity: body.severity,
      producerSkillId: body.producerSkillId,
      outputPath,
      passFieldPath,
      detailsFieldPath,
      policyUsable: body.policyUsable === undefined ? true : Boolean(body.policyUsable),
      packageUsable: body.packageUsable === undefined ? true : Boolean(body.packageUsable),
      freshnessDefaultMinutes: body.freshnessDefaultMinutes,
      blockingDefault: nextBlockingDefault,
      warningOnlyDefault: nextWarningOnlyDefault,
      createdBy: actorId,
      updatedBy: actorId,
    })

    await created.save()
    await created.populate('createdBy', 'name email')
    await created.populate('updatedBy', 'name email')

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.VALIDATION_REGISTRY_CREATED,
      resourceType: auditService.RESOURCE_TYPES.ValidationRegistry,
      resourceId: created._id,
      display: { resourceLabel: created.key },
      diff: { created: cloneAuditValue(created.toJSON()) },
    })

    return res.status(201).json({
      data: serializeValidation(created),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: DUPLICATE_VALIDATION_KEY_MESSAGE,
          requestId: req.requestId,
          details: { key: DUPLICATE_VALIDATION_KEY_MESSAGE },
        },
      })
    }

    next(err)
  }
}

export const getValidation = async (req, res, next) => {
  try {
    const validation = await ValidationRegistry.findByStableId(req.params.validationId)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')

    if (!validation) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: VALIDATION_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    return res.status(200).json({
      data: serializeValidation(validation),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const updateValidation = async (req, res, next) => {
  try {
    const validation = await ValidationRegistry.findByStableId(req.params.validationId)

    if (!validation) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: VALIDATION_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (req.body.key !== undefined && String(req.body.key).trim().toLowerCase() !== validation.key) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed.',
          details: { key: 'Key is immutable and cannot be changed after creation.' },
          requestId: req.requestId,
        },
      })
    }

    const diff = {}
    const mutableFields = [
      'label',
      'description',
      'status',
      'supportedFrameworkKeys',
      'category',
      'severity',
      'producerSkillId',
      'outputPath',
      'passFieldPath',
      'detailsFieldPath',
      'policyUsable',
      'packageUsable',
      'freshnessDefaultMinutes',
      'blockingDefault',
      'warningOnlyDefault',
    ]

    const nextFrameworkKeys = req.body.supportedFrameworkKeys === undefined
      ? validation.supportedFrameworkKeys
      : req.body.supportedFrameworkKeys

    const frameworkDetails = await validateSupportedFrameworkKeys(nextFrameworkKeys)
    const details = {}

    if (frameworkDetails.missingKeys.length > 0) {
      details.supportedFrameworkKeys = buildUnknownFrameworkKeyMessage(frameworkDetails.missingKeys)
    } else if (frameworkDetails.inactiveKeys.length > 0) {
      details.supportedFrameworkKeys = buildInactiveFrameworkKeyMessage(frameworkDetails.inactiveKeys)
    }

    const nextStatus = req.body.status === undefined ? validation.status : req.body.status
    const nextProducerSkillId = req.body.producerSkillId === undefined ? validation.producerSkillId : req.body.producerSkillId
    const nextBlockingDefault = req.body.blockingDefault === undefined ? validation.blockingDefault : Boolean(req.body.blockingDefault)
    const nextWarningOnlyDefault = req.body.warningOnlyDefault === undefined ? validation.warningOnlyDefault : Boolean(req.body.warningOnlyDefault)
    if (nextBlockingDefault && nextWarningOnlyDefault) {
      details.warningOnlyDefault = 'Blocking Default and Warning Only Default cannot both be true.'
    }

    const producer = await resolveProducerSkill(nextProducerSkillId)
    if (!producer) {
      details.producerSkillId = 'Producer skill was not found.'
    } else if (
      String(nextStatus || '').trim().toUpperCase() === VALIDATION_REGISTRY_STATUSES.ACTIVE
      && String(producer.status || '').trim().toUpperCase() !== RUNTIME_SKILL_STATUSES.ACTIVE
    ) {
      details.producerSkillId = 'Producer skill must be ACTIVE when the validation is ACTIVE.'
    }

    if (producer && Array.isArray(frameworkDetails.supportedFrameworkKeys) && frameworkDetails.supportedFrameworkKeys.length > 0) {
      const producerFrameworks = Array.isArray(producer.supportedFrameworkKeys) ? producer.supportedFrameworkKeys : []
      const missing = frameworkDetails.supportedFrameworkKeys.filter((key) => !producerFrameworks.includes(key))
      if (missing.length > 0) {
        details.producerSkillId = `Producer skill does not support framework${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`
      }
    }

    const outputPath = req.body.outputPath === undefined ? validation.outputPath : String(req.body.outputPath || '').trim()
    const passFieldPath = req.body.passFieldPath === undefined ? validation.passFieldPath : String(req.body.passFieldPath || '').trim()
    const detailsFieldPath = req.body.detailsFieldPath === undefined ? validation.detailsFieldPath : String(req.body.detailsFieldPath || '').trim()

    if (outputPath && passFieldPath) {
      const err = buildPathDescendantError(outputPath, passFieldPath, 'Pass Field Path')
      if (err) details.passFieldPath = err
    }

    if (outputPath && detailsFieldPath) {
      const err = buildPathDescendantError(outputPath, detailsFieldPath, 'Details Field Path')
      if (err) details.detailsFieldPath = err
    }

    const runtimePathResolution = await resolveRuntimePathRows({
      outputPath,
      passFieldPath,
      detailsFieldPath,
      frameworkKeys: frameworkDetails.supportedFrameworkKeys,
    })

    appendRuntimePathErrors(details, {
      outputPath,
      passFieldPath,
      detailsFieldPath,
      resolution: runtimePathResolution,
    })

    if (Object.keys(details).length > 0) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Please check the form for errors.',
          details,
          requestId: req.requestId,
        },
      })
    }

    for (const field of mutableFields) {
      if (req.body[field] === undefined) continue

      const previousValue = cloneAuditValue(validation[field])
      const nextValue = cloneAuditValue(req.body[field])

      if (isDeepStrictEqual(previousValue, nextValue)) {
        continue
      }

      diff[field] = { from: previousValue, to: nextValue }
      validation[field] = req.body[field]
    }

    validation.supportedFrameworkKeys = frameworkDetails.supportedFrameworkKeys
    validation.updatedBy = req.context?.userId || req.userId
    await validation.save()
    await validation.populate('createdBy', 'name email')
    await validation.populate('updatedBy', 'name email')

    if (Object.keys(diff).length > 0) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.VALIDATION_REGISTRY_UPDATED,
        resourceType: auditService.RESOURCE_TYPES.ValidationRegistry,
        resourceId: validation._id,
        display: { resourceLabel: validation.key },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeValidation(validation),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

const fetchValidationDependencies = async (validationKey) => {
  const [workflowPolicies, frameworkPackages] = await Promise.all([
    WorkflowPolicy.find({ requiredValidationKeys: validationKey })
      .select('stableId key name status')
      .lean(),
    FrameworkPackage.find({
      $or: [
        { 'validationRules.requiredSections': validationKey },
        { 'validationRules.publishChecks': validationKey },
      ],
    })
      .select('frameworkKey frameworkName version status')
      .lean(),
  ])

  return {
    workflowPolicies: workflowPolicies.map((policy) => ({
      id: policy.stableId,
      key: policy.key,
      name: policy.name,
      status: policy.status,
    })),
    frameworkPackages: frameworkPackages.map((pkg) => ({
      id: pkg._id,
      frameworkKey: pkg.frameworkKey,
      frameworkName: pkg.frameworkName,
      version: pkg.version,
      status: pkg.status,
    })),
    summary: {
      workflowPolicies: workflowPolicies.length,
      frameworkPackages: frameworkPackages.length,
    },
  }
}

const fetchRuntimePathSummaries = async (pathKeys) => {
  const unique = [...new Set((Array.isArray(pathKeys) ? pathKeys : []).map((value) => String(value || '').trim()).filter(Boolean))]
  if (unique.length === 0) return []

  const rows = await RuntimePathRegistry.find({ pathKey: { $in: unique } })
    .select('stableId pathKey label status scope isProtected')
    .lean()

  const byKey = new Map(rows.map((row) => [row.pathKey, row]))

  return unique.map((key) => {
    const row = byKey.get(key)
    return row
      ? {
          id: row.stableId,
          pathKey: row.pathKey,
          label: row.label,
          status: row.status,
          scope: row.scope,
          isProtected: Boolean(row.isProtected),
        }
      : { id: '', pathKey: key, label: key, status: 'MISSING', scope: '', isProtected: false }
  })
}

export const getValidationDependencies = async (req, res, next) => {
  try {
    const validation = await ValidationRegistry.findByStableId(req.params.validationId)
      .select('stableId key producerSkillId outputPath passFieldPath detailsFieldPath')

    if (!validation) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: VALIDATION_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const [producerSkill, runtimePaths, deps] = await Promise.all([
      resolveProducerSkill(validation.producerSkillId),
      fetchRuntimePathSummaries([validation.outputPath, validation.passFieldPath, validation.detailsFieldPath]),
      fetchValidationDependencies(validation.key),
    ])

    return res.status(200).json({
      data: {
        id: validation.stableId,
        key: validation.key,
        producerSkill: producerSkill
          ? { id: producerSkill.stableId, key: producerSkill.key, name: producerSkill.name, status: producerSkill.status }
          : null,
        runtimePaths,
        dependencies: deps,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const __testables = Object.freeze({
  buildListFilter,
  buildSearchClauses,
  buildSort,
  parseCsv,
})
