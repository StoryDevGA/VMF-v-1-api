import crypto from 'node:crypto'

import Ajv from 'ajv'

export const REASONING_ARTEFACT_CONTRACT_VERSION = 'reasoning-artefact-runtime.v1'

export const REASONING_ARTEFACT_LIFECYCLE_STAGES = Object.freeze({
  GENERATED: 'GENERATED',
})

export const REASONING_ARTEFACT_CURRENTNESS_FIELDS = Object.freeze([
  'packageVersion',
  'inputHash',
  'evidenceHash',
  'dependencyHash',
  'sectionContractHash',
  'generatedAt',
])

const TOKEN_PATTERN = /^[a-z][a-z0-9-]*$/
const ARTEFACT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/
const ACTION_PATTERN = /^[A-Z][A-Z0-9_]*$/
const WRITE_PATH_PATTERN = /^framework_state\.sections\.([a-z][a-z0-9_-]*)\.(generated|accepted)\.reasoningArtefacts\.([A-Za-z][A-Za-z0-9_-]*)$/
const SOURCE_PATH_PATTERN = /^(?:sectionIntelligence|reasoningArtefacts)(?:\.[a-zA-Z][a-zA-Z0-9_-]*)+$/
const HANDOFF_TARGET_PATH_PATTERN = /^outcome_studio\.intermediate_reasoning\.[A-Za-z][A-Za-z0-9_-]*$/
const DEFAULT_MAX_BYTES = 64 * 1024
const MAX_DECLARATIONS = 100
const HASH_CURRENTNESS_FIELDS = new Set(['inputHash', 'evidenceHash', 'dependencyHash', 'sectionContractHash'])
const MAX_SCHEMA_BYTES = 16 * 1024
const MAX_SCHEMA_DEPTH = 6
const MAX_SCHEMA_ENTRIES = 100
const SCHEMA_KEYS = new Set([
  'type',
  'title',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'pattern',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
])

const isObject = (value) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && !(value instanceof Date)

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

const text = (value) => String(value ?? '').trim()
const token = (value) => text(value).toLowerCase()
const sectionToken = (value) => token(value).replace(/-/g, '_')
const actionToken = (value) => text(value).toUpperCase()
const lastPathSegment = (value, fallback = '') => {
  const segments = text(value).split('.').map((segment) => segment.trim()).filter(Boolean)
  return segments.at(-1) || text(fallback)
}

const hash = (value) => crypto.createHash('sha256')
  .update(JSON.stringify(value), 'utf8')
  .digest('hex')

const contractError = (reason, message, details = {}) => {
  const error = new Error(message)
  error.status = 409
  error.code = 'REASONING_ARTEFACT_CONTRACT_INVALID'
  error.reason = reason
  error.details = { contractVersion: REASONING_ARTEFACT_CONTRACT_VERSION, ...details }
  return error
}

const declarationList = (frameworkPackageOrDeclarations) => {
  if (Array.isArray(frameworkPackageOrDeclarations)) return frameworkPackageOrDeclarations
  return frameworkPackageOrDeclarations?.reasoningArtefacts
}

const normalizeDeclaration = (raw, index) => {
  if (!isObject(raw)) {
    throw contractError('DECLARATION_MALFORMED', 'Reasoning artefact declaration must be an object.', { index })
  }

  const artefactKey = text(raw.artefactKey || raw.key)
  const sectionKeys = [...new Set((Array.isArray(raw.sectionKeys) ? raw.sectionKeys : [raw.sectionKey])
    .map(sectionToken).filter(Boolean))]
  const workflowActionKeys = [...new Set((Array.isArray(raw.workflowActionKeys) ? raw.workflowActionKeys : [])
    .map(actionToken).filter(Boolean))]
  const lifecycleStage = text(raw.lifecycleStage || REASONING_ARTEFACT_LIFECYCLE_STAGES.GENERATED).toUpperCase()
  const sourcePath = text(raw.sourcePath)
  const writePath = text(raw.writePath)
  const validation = isObject(raw.validation) ? raw.validation : {}
  const currentnessFields = [...new Set((Array.isArray(validation.currentnessFields)
    ? validation.currentnessFields
    : REASONING_ARTEFACT_CURRENTNESS_FIELDS)
    .map(text).filter(Boolean))]
  const handoff = isObject(raw.handoff) ? raw.handoff : {}
  const normalized = {
    artefactKey,
    label: text(raw.label),
    purpose: text(raw.purpose),
    required: raw.required !== false,
    lifecycleStage,
    sectionKeys,
    workflowActionKeys,
    sourcePath,
    writePath,
    schema: clone(raw.schema),
    validation: {
      currentnessFields,
      maxAgeSeconds: validation.maxAgeSeconds === undefined || validation.maxAgeSeconds === null
        ? null
        : Number(validation.maxAgeSeconds),
      maxBytes: validation.maxBytes === undefined ? DEFAULT_MAX_BYTES : Number(validation.maxBytes),
    },
    handoff: {
      eligible: handoff.eligible === true,
      mappingKey: token(handoff.mappingKey || handoff.key),
      targetPath: text(handoff.targetPath),
    },
  }
  return normalized
}

const assertSchemaNumber = (value, field, index) => {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', `Reasoning artefact schema ${field} must be a non-negative finite number.`, { index, field })
  }
}

const assertSchemaNode = (schema, index, depth, state, path = 'schema') => {
  if (!isObject(schema)) {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema nodes must be objects.', { index, path })
  }
  if (depth > MAX_SCHEMA_DEPTH) {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema exceeds the nesting bound.', { index, path, maxDepth: MAX_SCHEMA_DEPTH })
  }
  if (state.seen.has(schema)) {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema must not contain cycles.', { index, path })
  }
  state.seen.add(schema)
  state.entries += Object.keys(schema).length
  if (state.entries > MAX_SCHEMA_ENTRIES) {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema exceeds the entry bound.', { index, maxEntries: MAX_SCHEMA_ENTRIES })
  }
  if (Object.keys(schema).some((key) => !SCHEMA_KEYS.has(key))) {
    throw contractError('DECLARATION_SCHEMA_UNSUPPORTED', 'Reasoning artefact schema contains an unsupported keyword.', { index, path })
  }
  if (typeof schema.type !== 'string') {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema nodes require a JSON Schema type.', { index, path })
  }
  if (!['object', 'array', 'string', 'number', 'integer', 'boolean'].includes(schema.type)) {
    throw contractError('DECLARATION_SCHEMA_UNSUPPORTED', 'Reasoning artefact schema type is not supported.', { index, type: schema.type, path })
  }
  if (schema.type === 'object') {
    if (!isObject(schema.properties) || Object.keys(schema.properties).length === 0) {
      throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Object reasoning artefact schemas require bounded properties.', { index, path })
    }
    if (schema.required !== undefined
      && (!Array.isArray(schema.required)
        || schema.required.some((key) => typeof key !== 'string' || !Object.hasOwn(schema.properties, key)))) {
      throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema required fields must name declared properties.', { index, path })
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
      throw contractError('DECLARATION_SCHEMA_UNSUPPORTED', 'Reasoning artefact schema additionalProperties must be boolean.', { index, path })
    }
    Object.entries(schema.properties).forEach(([key, child]) => {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
        throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema property names are invalid.', { index, path: `${path}.properties` })
      }
      assertSchemaNode(child, index, depth + 1, state, `${path}.properties.${key}`)
    })
  } else if (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined) {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Only object reasoning artefact schemas may declare properties or required fields.', { index, path })
  }
  if (schema.type === 'array') {
    if (!isObject(schema.items)) {
      throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Array reasoning artefact schemas require an item schema.', { index, path })
    }
    assertSchemaNode(schema.items, index, depth + 1, state, `${path}.items`)
  } else if (schema.items !== undefined) {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Only array reasoning artefact schemas may declare items.', { index, path })
  }
  ;['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum'].forEach((field) => assertSchemaNumber(schema[field], field, index))
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length > 50)) {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema enum values must be a bounded array.', { index, path })
  }
  if (schema.pattern !== undefined) {
    try { new RegExp(schema.pattern) } catch {
      throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema pattern is invalid.', { index, path })
    }
  }
  state.seen.delete(schema)
}

export const validateReasoningArtefactSchema = (schema, { index = 0 } = {}) => {
  let serialized
  try {
    serialized = JSON.stringify(schema)
  } catch {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema must be serializable JSON.', { index })
  }
  if (typeof serialized !== 'string') {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema must be a JSON object.', { index })
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SCHEMA_BYTES) {
    throw contractError('DECLARATION_SCHEMA_MALFORMED', 'Reasoning artefact schema exceeds the byte bound.', { index, maxBytes: MAX_SCHEMA_BYTES })
  }
  assertSchemaNode(schema, index, 0, { entries: 0, seen: new WeakSet() })
  return schema
}

const assertSerializableSchema = (schema, index) => validateReasoningArtefactSchema(schema, { index })

const packageSections = (frameworkPackage = {}) => new Set(
  (Array.isArray(frameworkPackage.sections) ? frameworkPackage.sections : [])
    .map((section) => sectionToken(section?.sectionKey || section?.key))
    .filter(Boolean),
)

export const validateReasoningArtefactDeclarations = ({
  frameworkPackage = {},
  declarations = declarationList(frameworkPackage),
} = {}) => {
  if (declarations === undefined || declarations === null) return []
  if (!Array.isArray(declarations)) {
    throw contractError('DECLARATIONS_NOT_ARRAY', 'Framework Package reasoningArtefacts must be an array.')
  }
  if (declarations.length > MAX_DECLARATIONS) {
    throw contractError('DECLARATIONS_TOO_MANY', 'Framework Package reasoningArtefacts exceed the declaration limit.', { max: MAX_DECLARATIONS })
  }

  const knownSections = packageSections(frameworkPackage)
  const hasPackageSectionContext = Array.isArray(frameworkPackage?.sections)
  const seenKeys = new Set()
  const seenSourcePaths = new Set()
  const seenPaths = new Set()
  const seenMappings = new Set()
  const normalized = declarations.map((raw, index) => {
    const declaration = normalizeDeclaration(raw, index)
    if (!ARTEFACT_KEY_PATTERN.test(declaration.artefactKey)) {
      throw contractError('DECLARATION_KEY_INVALID', 'Reasoning artefact key must use letters, numbers, underscores or hyphens.', { index, artefactKey: declaration.artefactKey })
    }
    if (seenKeys.has(declaration.artefactKey)) {
      throw contractError('DECLARATION_DUPLICATE_KEY', 'Reasoning artefact keys must be unique.', { artefactKey: declaration.artefactKey })
    }
    seenKeys.add(declaration.artefactKey)
    if (!declaration.label || !declaration.purpose) {
      throw contractError('DECLARATION_IDENTITY_MISSING', 'Reasoning artefact label and purpose are required.', { artefactKey: declaration.artefactKey })
    }
    if (!Object.values(REASONING_ARTEFACT_LIFECYCLE_STAGES).includes(declaration.lifecycleStage)) {
      throw contractError('DECLARATION_LIFECYCLE_INVALID', 'Reasoning artefact lifecycleStage is invalid.', { artefactKey: declaration.artefactKey, lifecycleStage: declaration.lifecycleStage })
    }
    if (declaration.sectionKeys.length !== 1
      || (hasPackageSectionContext && (knownSections.size === 0 || !knownSections.has(declaration.sectionKeys[0])))) {
      throw contractError('DECLARATION_SECTION_SCOPE_INVALID', 'Reasoning artefact must target one known Framework Package section.', { artefactKey: declaration.artefactKey, sectionKeys: declaration.sectionKeys })
    }
    if (declaration.workflowActionKeys.some((key) => !ACTION_PATTERN.test(key))) {
      throw contractError('DECLARATION_WORKFLOW_SCOPE_INVALID', 'Reasoning artefact workflowActionKeys must use uppercase action tokens.', { artefactKey: declaration.artefactKey })
    }
    if (!SOURCE_PATH_PATTERN.test(declaration.sourcePath)) {
      throw contractError('DECLARATION_SOURCE_PATH_INVALID', 'Reasoning artefact sourcePath must be rooted at sectionIntelligence or reasoningArtefacts.', { artefactKey: declaration.artefactKey, sourcePath: declaration.sourcePath })
    }
    if (seenSourcePaths.has(declaration.sourcePath)) {
      throw contractError('DECLARATION_DUPLICATE_SOURCE_PATH', 'Reasoning artefact source paths must be unique.', { sourcePath: declaration.sourcePath })
    }
    seenSourcePaths.add(declaration.sourcePath)
    const [, writeSection, writeStage, writeKey] = declaration.writePath.match(WRITE_PATH_PATTERN) || []
    if (!writeSection || sectionToken(writeSection) !== declaration.sectionKeys[0]
      || writeStage !== declaration.lifecycleStage.toLowerCase()
      || writeKey !== declaration.artefactKey) {
      throw contractError('DECLARATION_WRITE_PATH_INVALID', 'Reasoning artefact writePath must exactly bind the scoped section, lifecycle stage and artefact key.', { artefactKey: declaration.artefactKey, writePath: declaration.writePath })
    }
    if (seenPaths.has(declaration.writePath)) {
      throw contractError('DECLARATION_DUPLICATE_PATH', 'Reasoning artefact write paths must be unique.', { writePath: declaration.writePath })
    }
    seenPaths.add(declaration.writePath)
    assertSerializableSchema(declaration.schema, index)
    if (declaration.validation.currentnessFields.length === 0
      || declaration.validation.currentnessFields.some((field) => !REASONING_ARTEFACT_CURRENTNESS_FIELDS.includes(field))) {
      throw contractError('DECLARATION_CURRENTNESS_INVALID', 'Reasoning artefact currentnessFields contain an unsupported field.', { artefactKey: declaration.artefactKey })
    }
    if (!Number.isInteger(declaration.validation.maxBytes)
      || declaration.validation.maxBytes < 1
      || declaration.validation.maxBytes > DEFAULT_MAX_BYTES) {
      throw contractError('DECLARATION_SIZE_BOUND_INVALID', 'Reasoning artefact maxBytes must be a positive bounded integer.', { artefactKey: declaration.artefactKey })
    }
    if (declaration.validation.maxAgeSeconds !== null
      && (!Number.isInteger(declaration.validation.maxAgeSeconds) || declaration.validation.maxAgeSeconds < 1)) {
      throw contractError('DECLARATION_AGE_BOUND_INVALID', 'Reasoning artefact maxAgeSeconds must be null or a positive integer.', { artefactKey: declaration.artefactKey })
    }
    if (declaration.handoff.eligible) {
      if (!TOKEN_PATTERN.test(declaration.handoff.mappingKey)
        || !HANDOFF_TARGET_PATH_PATTERN.test(declaration.handoff.targetPath)) {
        throw contractError('DECLARATION_HANDOFF_MAPPING_INVALID', 'Handoff-eligible reasoning artefacts require a mappingKey and targetPath.', { artefactKey: declaration.artefactKey })
      }
      const targetMappingKey = token(lastPathSegment(declaration.handoff.targetPath))
      if (targetMappingKey !== declaration.handoff.mappingKey) {
        throw contractError('DECLARATION_HANDOFF_MAPPING_INVALID', 'Handoff targetPath must end with the declared mappingKey.', { artefactKey: declaration.artefactKey, mappingKey: declaration.handoff.mappingKey, targetPath: declaration.handoff.targetPath })
      }
      if (seenMappings.has(declaration.handoff.mappingKey)) {
        throw contractError('DECLARATION_DUPLICATE_HANDOFF_MAPPING', 'Handoff mapping keys must be unique.', { mappingKey: declaration.handoff.mappingKey })
      }
      seenMappings.add(declaration.handoff.mappingKey)
    }
    return declaration
  })

  return normalized
}

export const resolvePackageReasoningArtefacts = ({
  frameworkPackage = {},
  sectionKey,
  actionKey,
  lifecycleStage = REASONING_ARTEFACT_LIFECYCLE_STAGES.GENERATED,
} = {}) => {
  const declarations = validateReasoningArtefactDeclarations({ frameworkPackage })
  const normalizedSectionKey = sectionToken(sectionKey)
  const normalizedActionKey = actionToken(actionKey)
  const normalizedStage = text(lifecycleStage).toUpperCase()
  return declarations.filter((declaration) => declaration.lifecycleStage === normalizedStage
    && declaration.sectionKeys.includes(normalizedSectionKey)
    && (!normalizedActionKey || declaration.workflowActionKeys.length === 0 || declaration.workflowActionKeys.includes(normalizedActionKey)))
}

const pathValue = (value, path) => path.split('.').reduce((current, key) => {
  if (current === null || current === undefined) return undefined
  return current[key]
}, value)

const sourceValue = (candidate, sourcePath, artefactKey = '') => {
  const direct = pathValue(candidate, sourcePath)
  if (direct !== undefined) return direct
  if (sourcePath.startsWith('sectionIntelligence.')) {
    const nested = pathValue(candidate, sourcePath.slice('sectionIntelligence.'.length))
    if (nested !== undefined) return nested
  }
  if (sourcePath.startsWith('reasoningArtefacts.')) {
    const nested = pathValue(candidate, sourcePath.slice('reasoningArtefacts.'.length))
    if (nested !== undefined) return nested
  }
  if (artefactKey) return pathValue(candidate, artefactKey)
  return undefined
}

const buildAjv = () => new Ajv({ allErrors: true, strict: false, removeAdditional: false })

export const buildReasoningArtefactOutputs = ({
  candidate,
  declarations = [],
  packageKey,
  packageVersion,
  sectionKey,
  stateSectionKey,
  inputHash = '',
  evidenceHash = '',
  dependencyHash = '',
  sectionContractHash = '',
  generatedAt = '',
  now = generatedAt || new Date().toISOString(),
  validateCurrentness = true,
} = {}) => {
  const normalizedSectionKey = sectionToken(sectionKey)
  const normalizedStateSectionKey = sectionToken(stateSectionKey || sectionKey)
  const normalizedDeclarations = validateReasoningArtefactDeclarations({ declarations })
  const values = {}
  const receipts = {}
  const ajv = buildAjv()
  const context = { packageVersion: text(packageVersion), inputHash: text(inputHash), evidenceHash: text(evidenceHash), dependencyHash: text(dependencyHash), sectionContractHash: text(sectionContractHash), generatedAt: text(generatedAt) }
  normalizedDeclarations.forEach((declaration) => {
    if (!declaration.sectionKeys.includes(normalizedSectionKey)) return
    const value = sourceValue(candidate, declaration.sourcePath, declaration.artefactKey)
    if (value === undefined || value === null) {
      if (declaration.required) throw contractError('REASONING_ARTEFACT_REQUIRED_MISSING', 'A required package-declared reasoning artefact is missing.', { artefactKey: declaration.artefactKey, sectionKey: normalizedSectionKey })
      return
    }
    let valid = false
    try { valid = ajv.compile(declaration.schema)(value) } catch { valid = false }
    if (!valid) throw contractError('REASONING_ARTEFACT_SCHEMA_INVALID', 'A generated reasoning artefact failed its package-declared schema.', { artefactKey: declaration.artefactKey, errors: ajv.errorsText() })
    const outputHash = hash(value)
    const byteLength = Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (byteLength > declaration.validation.maxBytes) throw contractError('REASONING_ARTEFACT_TOO_LARGE', 'A generated reasoning artefact exceeded its package-declared size bound.', { artefactKey: declaration.artefactKey, byteLength, maxBytes: declaration.validation.maxBytes })
    const statePath = `framework_state.sections.${normalizedStateSectionKey}.${declaration.lifecycleStage.toLowerCase()}.reasoningArtefacts.${declaration.artefactKey}`
    if (statePath !== declaration.writePath) throw contractError('REASONING_ARTEFACT_WRONG_PATH', 'A reasoning artefact resolved to a path different from its package declaration.', { artefactKey: declaration.artefactKey, statePath, writePath: declaration.writePath })
    const receipt = {
      contractVersion: REASONING_ARTEFACT_CONTRACT_VERSION,
      artefactKey: declaration.artefactKey,
      declarationHash: hash(declaration),
      outputHash,
      packageKey: text(packageKey),
      packageVersion: text(packageVersion),
      sectionKey: normalizedSectionKey,
      lifecycleStage: declaration.lifecycleStage,
      statePath,
      generatedAt: text(generatedAt),
      inputHash: text(inputHash),
      evidenceHash: text(evidenceHash),
      dependencyHash: text(dependencyHash),
      sectionContractHash: text(sectionContractHash),
      currentnessStatus: 'CURRENT',
      handoffEligible: declaration.handoff.eligible,
      mappingKey: declaration.handoff.mappingKey,
    }
    if (validateCurrentness && declaration.validation.currentnessFields.some((field) => !context[field])) {
      throw contractError('REASONING_ARTEFACT_CURRENTNESS_MISSING', 'A reasoning artefact is missing a package-declared currentness field.', { artefactKey: declaration.artefactKey })
    }
    if (validateCurrentness) {
      const malformedCurrentnessField = declaration.validation.currentnessFields.find((field) => {
        if (field === 'generatedAt') return !Number.isFinite(Date.parse(context[field]))
        if (HASH_CURRENTNESS_FIELDS.has(field)) return !/^[a-f0-9]{64}$/i.test(context[field])
        return false
      })
      if (malformedCurrentnessField) {
        throw contractError('REASONING_ARTEFACT_CURRENTNESS_INVALID', 'A reasoning artefact currentness field has an invalid format.', { artefactKey: declaration.artefactKey, field: malformedCurrentnessField })
      }
    }
    if (validateCurrentness && declaration.validation.maxAgeSeconds !== null && generatedAt) {
      const ageSeconds = (new Date(now).getTime() - new Date(generatedAt).getTime()) / 1000
      if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > declaration.validation.maxAgeSeconds) {
        throw contractError('REASONING_ARTEFACT_STALE', 'A reasoning artefact is stale under its package-declared age bound.', { artefactKey: declaration.artefactKey, ageSeconds, maxAgeSeconds: declaration.validation.maxAgeSeconds })
      }
    }
    values[declaration.artefactKey] = clone(value)
    receipts[declaration.artefactKey] = receipt
  })
  return { values, receipts }
}

export const validateReasoningArtefactCandidate = ({ candidate, declarations = [] } = {}) => {
  const ajv = buildAjv()
  const normalizedDeclarations = validateReasoningArtefactDeclarations({ declarations })
  normalizedDeclarations.forEach((declaration) => {
    const value = sourceValue(candidate, declaration.sourcePath, declaration.artefactKey)
    if (value === undefined || value === null) {
      if (declaration.required) throw contractError('REASONING_ARTEFACT_REQUIRED_MISSING', 'A required package-declared reasoning artefact is missing from provider output.', { artefactKey: declaration.artefactKey })
      return
    }
    let valid = false
    try { valid = ajv.compile(declaration.schema)(value) } catch { valid = false }
    if (!valid) throw contractError('REASONING_ARTEFACT_SCHEMA_INVALID', 'A provider reasoning artefact failed its package-declared schema.', { artefactKey: declaration.artefactKey, errors: ajv.errorsText() })
    const byteLength = Buffer.byteLength(JSON.stringify(value), 'utf8')
    if (byteLength > declaration.validation.maxBytes) throw contractError('REASONING_ARTEFACT_TOO_LARGE', 'A provider reasoning artefact exceeded its package-declared size bound.', { artefactKey: declaration.artefactKey, byteLength, maxBytes: declaration.validation.maxBytes })
  })
  return candidate
}

export const projectHandoffReasoningArtefacts = ({
  frameworkPackage = {},
  sectionKey,
  actionKey = 'GENERATE_SECTION',
  acceptedSection = {},
  now = new Date().toISOString(),
} = {}) => {
  const declarations = resolvePackageReasoningArtefacts({ frameworkPackage, sectionKey, actionKey, lifecycleStage: REASONING_ARTEFACT_LIFECYCLE_STAGES.GENERATED })
  const values = isObject(acceptedSection.reasoningArtefacts) ? acceptedSection.reasoningArtefacts : {}
  const receipts = isObject(acceptedSection.reasoningArtefactReceipts) ? acceptedSection.reasoningArtefactReceipts : {}
  const projected = {}
  const projectedReceipts = {}
  validateReasoningArtefactCandidate({
    candidate: { reasoningArtefacts: values, sectionIntelligence: values },
    declarations,
  })
  declarations.forEach((declaration) => {
    if (!declaration.handoff.eligible) return
    if (values[declaration.artefactKey] === undefined || !receipts[declaration.artefactKey]) {
      if (declaration.required) throw contractError('REASONING_ARTEFACT_HANDOFF_MISSING', 'A required handoff-eligible reasoning artefact is missing from accepted truth.', { artefactKey: declaration.artefactKey, sectionKey })
      return
    }
    const receipt = receipts[declaration.artefactKey]
    const expectedStatePath = `framework_state.sections.${sectionToken(sectionKey)}.${declaration.lifecycleStage.toLowerCase()}.reasoningArtefacts.${declaration.artefactKey}`
    if (receipt.currentnessStatus !== 'CURRENT' || receipt.handoffEligible !== true) {
      throw contractError('REASONING_ARTEFACT_HANDOFF_INELIGIBLE', 'A reasoning artefact is not current and handoff-eligible.', { artefactKey: declaration.artefactKey })
    }
    if (declaration.validation.maxAgeSeconds !== null) {
      const ageSeconds = (new Date(now).getTime() - new Date(receipt.generatedAt).getTime()) / 1000
      if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > declaration.validation.maxAgeSeconds) {
        throw contractError('REASONING_ARTEFACT_STALE', 'A handoff reasoning artefact is stale under its package-declared age bound.', { artefactKey: declaration.artefactKey, ageSeconds, maxAgeSeconds: declaration.validation.maxAgeSeconds })
      }
    }
    if (receipt.statePath !== expectedStatePath || receipt.statePath !== declaration.writePath) {
      throw contractError('REASONING_ARTEFACT_WRONG_PATH', 'A handoff reasoning artefact receipt points outside its package-declared state path.', { artefactKey: declaration.artefactKey })
    }
    const acceptedCurrentness = {
      packageVersion: frameworkPackage?.version,
      inputHash: acceptedSection.inputHash,
      evidenceHash: acceptedSection.evidenceHash,
      dependencyHash: acceptedSection.dependencyHash,
      sectionContractHash: acceptedSection.sectionContractHash || acceptedSection.generator?.sectionContractHash,
      generatedAt: acceptedSection.generatedAt || acceptedSection.sourceGeneratedAt,
    }
    const currentnessMissing = declaration.validation.currentnessFields.find((field) => (
      acceptedCurrentness[field] === undefined
      || acceptedCurrentness[field] === null
      || !text(acceptedCurrentness[field])
    ))
    if (currentnessMissing) {
      throw contractError('REASONING_ARTEFACT_CURRENTNESS_MISSING', 'Accepted truth is missing a package-declared reasoning artefact currentness field.', { artefactKey: declaration.artefactKey, field: currentnessMissing })
    }
    const currentnessMismatch = declaration.validation.currentnessFields.find((field) => (
      acceptedCurrentness[field] !== undefined
      && acceptedCurrentness[field] !== null
      && text(acceptedCurrentness[field])
      && text(receipt[field]) !== text(acceptedCurrentness[field])
    ))
    if (currentnessMismatch) {
      throw contractError('REASONING_ARTEFACT_CURRENTNESS_MISMATCH', 'A handoff reasoning artefact receipt does not match accepted truth currentness.', { artefactKey: declaration.artefactKey, field: currentnessMismatch })
    }
    if (receipt.outputHash !== hash(values[declaration.artefactKey])
      || receipt.declarationHash !== hash(declaration)
      || receipt.packageVersion !== text(frameworkPackage?.version)
      || receipt.sectionKey !== sectionToken(sectionKey)) {
      throw contractError('REASONING_ARTEFACT_CURRENTNESS_MISMATCH', 'A handoff reasoning artefact receipt no longer matches the active package or accepted value.', { artefactKey: declaration.artefactKey })
    }
    projected[declaration.handoff.mappingKey] = clone(values[declaration.artefactKey])
    projectedReceipts[declaration.handoff.mappingKey] = clone(receipt)
  })
  return { values: projected, receipts: projectedReceipts, declarations }
}

export default {
  REASONING_ARTEFACT_CONTRACT_VERSION,
  REASONING_ARTEFACT_CURRENTNESS_FIELDS,
  REASONING_ARTEFACT_LIFECYCLE_STAGES,
  buildReasoningArtefactOutputs,
  validateReasoningArtefactCandidate,
  projectHandoffReasoningArtefacts,
  resolvePackageReasoningArtefacts,
  validateReasoningArtefactSchema,
  validateReasoningArtefactDeclarations,
}
