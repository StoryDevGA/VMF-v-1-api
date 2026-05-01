import { isDeepStrictEqual } from 'node:util'
import UIContract, {
  UI_CONTRACT_SECTION_SOURCES,
  UI_CONTRACT_STATUSES,
} from '../models/UIContract.js'
import FrameworkPackage, { FRAMEWORK_PACKAGE_STATUSES } from '../models/FrameworkPackage.js'
import auditService from '../services/auditService.js'
import {
  buildInactiveFrameworkKeyMessage,
  buildUnknownFrameworkKeyMessage,
  resolveKnownFrameworkKeys,
} from '../services/frameworkRegistryService.js'
import { escapeRegex, serializeUserSummary } from '../utils/controllerUtils.js'

const UI_CONTRACT_NOT_FOUND_MESSAGE = 'UI Contract was not found.'
const DUPLICATE_UI_CONTRACT_KEY_MESSAGE = 'UI Contract key must be unique.'

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value._id && typeof value._id.toString === 'function') return value._id.toString()
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const cloneAuditValue = (value) => {
  if (value === undefined) return value
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.parse(JSON.stringify(value))
}

const buildActorSummary = (req) => {
  const actor = req.scopes?.user
  const id = toIdString(actor?.id || actor?._id || req.context?.userId || req.userId)
  if (!id) return null
  return {
    id,
    ...(actor?.name ? { name: actor.name } : {}),
    ...(actor?.email ? { email: actor.email } : {}),
  }
}

const serializeUIContract = (uiContract, { fallbackUpdatedBy = null } = {}) => {
  const plain = typeof uiContract?.toJSON === 'function'
    ? uiContract.toJSON()
    : { ...uiContract }

  if (!plain.id && plain.stableId) plain.id = plain.stableId

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

const buildListFilter = ({ q, status, frameworkKey }) => {
  const filter = {}
  if (status) filter.status = status
  if (frameworkKey) filter.frameworkKeys = frameworkKey

  const normalizedQuery = String(q || '').trim()
  if (normalizedQuery) {
    const regex = new RegExp(escapeRegex(normalizedQuery), 'i')
    filter.$or = [
      { stableId: regex },
      { uiContractKey: regex },
      { name: regex },
      { description: regex },
      { frameworkKeys: regex },
      { compatibilityTags: regex },
      { sourcePackageKey: regex },
      { sourcePackageVersion: regex },
      { sourceFrameworkKey: regex },
      { 'sections.sectionKey': regex },
      { 'sections.runtimePath': regex },
      { 'sections.label': regex },
      { 'lifecycleStages.stageKey': regex },
      { 'lifecycleStages.label': regex },
      { 'actions.actionKey': regex },
      { 'actions.governedAction': regex },
      { 'actions.buttonLabel': regex },
    ]
  }

  return filter
}

const sendValidationFailed = (res, req, details, message = 'Please check the form for errors.') =>
  res.status(422).json({
    error: {
      code: 'VALIDATION_FAILED',
      message,
      details,
      requestId: req.requestId,
    },
  })

const sendConflict = (res, req, message, details = {}) =>
  res.status(409).json({
    error: {
      code: 'CONFLICT',
      message,
      ...(Object.keys(details).length > 0 ? { details } : {}),
      requestId: req.requestId,
    },
  })

const validateFrameworkKeys = async (frameworkKeys = []) => {
  const { missingKeys, inactiveKeys } = await resolveKnownFrameworkKeys(frameworkKeys, undefined, { requireActive: true })
  const details = {}
  if (missingKeys.length > 0) {
    details.frameworkKeys = buildUnknownFrameworkKeyMessage(missingKeys)
  } else if (inactiveKeys.length > 0) {
    details.frameworkKeys = buildInactiveFrameworkKeyMessage(inactiveKeys)
  }
  return details
}

const normalizeSectionKey = (value) => String(value || '').trim().toLowerCase()
const normalizeRuntimePath = (value) => String(value || '').trim()

const isCustomSection = (section = {}) =>
  section?.isCustom === true
  || String(section?.source || '').trim().toUpperCase() === UI_CONTRACT_SECTION_SOURCES.CUSTOM

const appendSectionIssue = (issues, issue) => {
  if (issue) issues.push(issue)
}

const validateUIContractSectionMapping = ({ sections = [], sourcePackage = null }) => {
  const details = {}
  const issues = []
  const uiSections = Array.isArray(sections) ? sections : []
  const packageBackedSections = uiSections.filter((section) => !isCustomSection(section))

  if (!sourcePackage) {
    if (packageBackedSections.length > 0) {
      details.sections = 'Package-backed UI Contract sections require a source package.'
    }
    return details
  }

  const packageSections = Array.isArray(sourcePackage.sections) ? sourcePackage.sections : []
  const packageSectionByKey = new Map()
  packageSections.forEach((section) => {
    const sectionKey = normalizeSectionKey(section?.sectionKey)
    if (sectionKey) packageSectionByKey.set(sectionKey, section)
  })

  const mappedSectionKeys = new Set()
  const emptyRuntimePathKeys = []
  const orphanedSectionKeys = []
  const runtimePathMismatches = []

  packageBackedSections.forEach((section) => {
    const sectionKey = normalizeSectionKey(section?.sectionKey)
    if (!sectionKey) return

    const runtimePath = normalizeRuntimePath(section?.runtimePath)
    if (!runtimePath) {
      emptyRuntimePathKeys.push(sectionKey)
      return
    }

    const packageSection = packageSectionByKey.get(sectionKey)
    if (!packageSection) {
      orphanedSectionKeys.push(sectionKey)
      return
    }

    const expectedRuntimePath = normalizeRuntimePath(packageSection?.runtimePath)
    if (runtimePath !== expectedRuntimePath) {
      runtimePathMismatches.push(`${sectionKey} expected ${expectedRuntimePath || '(empty)'}`)
      return
    }

    mappedSectionKeys.add(sectionKey)
  })

  const missingRequiredSectionKeys = packageSections
    .filter((section) => section?.required === true)
    .map((section) => normalizeSectionKey(section?.sectionKey))
    .filter((sectionKey) => sectionKey && !mappedSectionKeys.has(sectionKey))

  appendSectionIssue(
    issues,
    emptyRuntimePathKeys.length > 0
      ? `Package-backed UI Contract sections require runtime paths: ${emptyRuntimePathKeys.join(', ')}.`
      : '',
  )
  appendSectionIssue(
    issues,
    orphanedSectionKeys.length > 0
      ? `UI Contract sections must exist in the source package unless marked custom: ${orphanedSectionKeys.join(', ')}.`
      : '',
  )
  appendSectionIssue(
    issues,
    runtimePathMismatches.length > 0
      ? `UI Contract section runtime paths must match the source package: ${runtimePathMismatches.join(', ')}.`
      : '',
  )
  appendSectionIssue(
    issues,
    missingRequiredSectionKeys.length > 0
      ? `Required package sections must have mapped UI Contract sections: ${missingRequiredSectionKeys.join(', ')}.`
      : '',
  )

  if (issues.length > 0) {
    details.sections = issues.join(' ')
  }

  return details
}

const resolveSourcePackage = async ({
  sourcePackageKey = '',
  sourcePackageVersion = '',
  sourceFrameworkKey = '',
  frameworkKeys = [],
  status = UI_CONTRACT_STATUSES.DRAFT,
}) => {
  const normalizedSourcePackageKey = String(sourcePackageKey || '').trim().toLowerCase()
  const normalizedSourceFrameworkKey = String(sourceFrameworkKey || '').trim().toUpperCase()
  const normalizedSourcePackageVersion = String(sourcePackageVersion || '').trim()
  if (!normalizedSourcePackageKey && !normalizedSourceFrameworkKey && !normalizedSourcePackageVersion) {
    return { details: {}, sourcePackage: null }
  }

  let sourcePackage = null

  if (normalizedSourcePackageKey) {
    sourcePackage = await FrameworkPackage.findOne({ packageKey: normalizedSourcePackageKey })
      .select('packageKey version frameworkKey status sections.sectionKey sections.runtimePath sections.required')
      .lean()
  }

  if (!sourcePackage && normalizedSourceFrameworkKey && normalizedSourcePackageVersion) {
    sourcePackage = await FrameworkPackage.findOne({
      frameworkKey: normalizedSourceFrameworkKey,
      version: normalizedSourcePackageVersion,
    })
      .select('packageKey version frameworkKey status sections.sectionKey sections.runtimePath sections.required')
      .lean()
  }

  if (!sourcePackage) {
    const packageReference = normalizedSourcePackageKey
      || [normalizedSourceFrameworkKey, normalizedSourcePackageVersion].filter(Boolean).join(' ')
    return {
      details: { sourcePackageKey: `Framework Package "${packageReference}" was not found.` },
      sourcePackage: null,
    }
  }

  const allowedStatuses = new Set([
    FRAMEWORK_PACKAGE_STATUSES.VALIDATED,
    FRAMEWORK_PACKAGE_STATUSES.ACTIVE,
  ])
  if (status === UI_CONTRACT_STATUSES.DRAFT) {
    allowedStatuses.add(FRAMEWORK_PACKAGE_STATUSES.DRAFT)
  }

  if (!allowedStatuses.has(sourcePackage.status)) {
    return {
      details: {
        sourcePackageKey:
          `Framework Package "${normalizedSourcePackageKey}" must be VALIDATED or ACTIVE${status === UI_CONTRACT_STATUSES.DRAFT ? ', or DRAFT while the UI Contract is DRAFT' : ''}.`,
      },
      sourcePackage: null,
    }
  }

  if (normalizedSourceFrameworkKey && normalizedSourceFrameworkKey !== sourcePackage.frameworkKey) {
    return {
      details: {
        sourceFrameworkKey: `Source framework key must match package framework "${sourcePackage.frameworkKey}".`,
      },
      sourcePackage: null,
    }
  }

  const normalizedFrameworkKeys = Array.isArray(frameworkKeys)
    ? frameworkKeys.map((key) => String(key || '').trim().toUpperCase())
    : []
  if (!normalizedFrameworkKeys.includes(sourcePackage.frameworkKey)) {
    return {
      details: {
        sourcePackageKey: `Framework Package "${normalizedSourcePackageKey}" is not compatible with selected framework keys.`,
      },
      sourcePackage: null,
    }
  }

  if (normalizedSourcePackageVersion && normalizedSourcePackageVersion !== sourcePackage.version) {
    return {
      details: {
        sourcePackageVersion: `Source package version must match package version "${sourcePackage.version}".`,
      },
      sourcePackage: null,
    }
  }

  return { details: {}, sourcePackage }
}

const findUIContractById = (uiContractId) => {
  const normalized = String(uiContractId || '').trim()
  if (normalized.startsWith('ui-contract-')) {
    return UIContract.findByStableId(normalized)
  }
  return UIContract.findById(normalized)
}

export const listUIContracts = async (req, res, next) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
    const filter = buildListFilter(req.query)
    const total = await UIContract.countDocuments(filter)
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const normalizedPage = Math.min(pageNum, totalPages)

    const rows = await UIContract.find(filter)
      .sort({ status: 1, updatedAt: -1, uiContractKey: 1 })
      .skip((normalizedPage - 1) * limit)
      .limit(limit)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .lean()

    return res.status(200).json({
      data: rows.map((row) => serializeUIContract(row)),
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

export const createUIContract = async (req, res, next) => {
  try {
    const frameworkDetails = await validateFrameworkKeys(req.body.frameworkKeys)
    if (Object.keys(frameworkDetails).length > 0) {
      return sendValidationFailed(res, req, frameworkDetails)
    }

    const sourcePackageResult = await resolveSourcePackage({
      sourcePackageKey: req.body.sourcePackageKey,
      sourcePackageVersion: req.body.sourcePackageVersion,
      sourceFrameworkKey: req.body.sourceFrameworkKey,
      frameworkKeys: req.body.frameworkKeys,
      status: req.body.status,
    })
    const sourcePackageDetails = sourcePackageResult.details
    if (Object.keys(sourcePackageDetails).length > 0) {
      return sendValidationFailed(res, req, sourcePackageDetails)
    }

    const sectionMappingDetails = validateUIContractSectionMapping({
      sections: req.body.sections,
      sourcePackage: sourcePackageResult.sourcePackage,
    })
    if (Object.keys(sectionMappingDetails).length > 0) {
      return sendValidationFailed(res, req, sectionMappingDetails)
    }

    const existing = await UIContract.findOne({ uiContractKey: req.body.uiContractKey }).select('_id')
    if (existing) {
      return sendConflict(res, req, DUPLICATE_UI_CONTRACT_KEY_MESSAGE, {
        field: 'uiContractKey',
        reason: 'UI_CONTRACT_KEY_CONFLICT',
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const uiContract = new UIContract({
      ...req.body,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await uiContract.save()
    await uiContract.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'updatedBy', select: 'name email' },
    ])

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.UI_CONTRACT_CREATED,
      resourceType: auditService.RESOURCE_TYPES.UIContract,
      resourceId: uiContract._id,
      scope: { frameworkKey: uiContract.frameworkKeys?.[0] },
      display: { resourceLabel: uiContract.uiContractKey },
      diff: cloneAuditValue(uiContract),
    })

    return res.status(201).json({
      data: serializeUIContract(uiContract, { fallbackUpdatedBy: buildActorSummary(req) }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.code === 11000) {
      return sendConflict(res, req, DUPLICATE_UI_CONTRACT_KEY_MESSAGE, {
        field: 'uiContractKey',
        reason: 'UI_CONTRACT_KEY_CONFLICT',
      })
    }
    next(err)
  }
}

export const getUIContract = async (req, res, next) => {
  try {
    const uiContract = await findUIContractById(req.params.uiContractId)
    if (!uiContract) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: UI_CONTRACT_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    await uiContract.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'updatedBy', select: 'name email' },
    ])

    return res.status(200).json({
      data: serializeUIContract(uiContract),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const updateUIContract = async (req, res, next) => {
  try {
    const uiContract = await findUIContractById(req.params.uiContractId)
    if (!uiContract) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: UI_CONTRACT_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    if (uiContract.isLocked || uiContract.isProtected) {
      return sendConflict(res, req, 'Locked or protected UI Contracts cannot be edited directly.', {
        field: uiContract.isLocked ? 'isLocked' : 'isProtected',
        reason: 'UI_CONTRACT_LOCKED',
      })
    }

    const nextFrameworkKeys = req.body.frameworkKeys ?? uiContract.frameworkKeys
    const frameworkDetails = await validateFrameworkKeys(nextFrameworkKeys)
    if (Object.keys(frameworkDetails).length > 0) {
      return sendValidationFailed(res, req, frameworkDetails)
    }

    const nextSourcePackageKey = req.body.sourcePackageKey ?? uiContract.sourcePackageKey
    const nextSourcePackageVersion = req.body.sourcePackageVersion ?? uiContract.sourcePackageVersion
    const nextSourceFrameworkKey = req.body.sourceFrameworkKey ?? uiContract.sourceFrameworkKey
    const nextSections = req.body.sections ?? uiContract.sections

    const sourcePackageResult = await resolveSourcePackage({
      sourcePackageKey: nextSourcePackageKey,
      sourcePackageVersion: nextSourcePackageVersion,
      sourceFrameworkKey: nextSourceFrameworkKey,
      frameworkKeys: nextFrameworkKeys,
      status: req.body.status ?? uiContract.status,
    })
    const sourcePackageDetails = sourcePackageResult.details
    if (Object.keys(sourcePackageDetails).length > 0) {
      return sendValidationFailed(res, req, sourcePackageDetails)
    }

    const sectionMappingDetails = validateUIContractSectionMapping({
      sections: nextSections,
      sourcePackage: sourcePackageResult.sourcePackage,
    })
    if (Object.keys(sectionMappingDetails).length > 0) {
      return sendValidationFailed(res, req, sectionMappingDetails)
    }

    const diff = {}
    const fields = [
      'name',
      'description',
      'status',
      'frameworkKeys',
      'introducedInVersion',
      'deprecatedInVersion',
      'compatibilityTags',
      'compatibilityMode',
      'sourcePackageKey',
      'sourcePackageVersion',
      'sourceFrameworkKey',
      'sections',
      'lifecycleStages',
      'actions',
      'isSystem',
      'isProtected',
      'isLocked',
      'clonedFromStableId',
    ]

    for (const field of fields) {
      if (req.body[field] === undefined) continue
      const previousValue = cloneAuditValue(uiContract[field])
      const nextValue = cloneAuditValue(req.body[field])
      if (isDeepStrictEqual(previousValue, nextValue)) continue
      diff[field] = { from: previousValue, to: nextValue }
      uiContract[field] = req.body[field]
    }

    uiContract.updatedBy = req.context?.userId || req.userId
    await uiContract.save()
    await uiContract.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'updatedBy', select: 'name email' },
    ])

    if (Object.keys(diff).length > 0) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.UI_CONTRACT_UPDATED,
        resourceType: auditService.RESOURCE_TYPES.UIContract,
        resourceId: uiContract._id,
        scope: { frameworkKey: uiContract.frameworkKeys?.[0] },
        display: { resourceLabel: uiContract.uiContractKey },
        diff,
      })
    }

    return res.status(200).json({
      data: serializeUIContract(uiContract, { fallbackUpdatedBy: buildActorSummary(req) }),
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const getUIContractDependencies = async (req, res, next) => {
  try {
    const uiContract = await findUIContractById(req.params.uiContractId)
    if (!uiContract) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: UI_CONTRACT_NOT_FOUND_MESSAGE,
          requestId: req.requestId,
        },
      })
    }

    const frameworkPackages = await FrameworkPackage.find({ uiContractKey: uiContract.uiContractKey })
      .select('_id frameworkKey version packageName status')
      .lean()
    const activePackages = frameworkPackages.filter((pkg) => pkg.status === 'ACTIVE')

    return res.status(200).json({
      data: {
        uiContractKey: uiContract.uiContractKey,
        dependencies: {
          frameworkPackages,
          summary: {
            frameworkPackages: frameworkPackages.length,
            activeFrameworkPackages: activePackages.length,
            total: frameworkPackages.length,
          },
          hasDependencies: frameworkPackages.length > 0,
          hasActiveDependencies: activePackages.length > 0,
        },
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    next(err)
  }
}

export const activateUIContract = async (req, res, next) => {
  req.body = { status: UI_CONTRACT_STATUSES.ACTIVE }
  return updateUIContract(req, res, next)
}

export const deprecateUIContract = async (req, res, next) => {
  req.body = { status: UI_CONTRACT_STATUSES.DEPRECATED }
  return updateUIContract(req, res, next)
}
