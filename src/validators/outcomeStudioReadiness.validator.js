import {
  OUTCOME_STUDIO_READINESS_AUTHORITY_MATRIX,
  OUTCOME_STUDIO_READINESS_DECISION_KEYS,
  OUTCOME_STUDIO_READINESS_ENVIRONMENT,
  OUTCOME_STUDIO_READINESS_LIMITS,
  OUTCOME_STUDIO_READINESS_STATUSES,
  OUTCOME_STUDIO_REFERENCE_FAMILIES,
} from '../constants/outcomeStudioReadiness.js'

const forbiddenKey = /(secret|credential|token|password|connection.?string|api.?key|private.?key|access.?key|env(?:ironment)?Name|alias|binary|base64|file(?:bytes|content|data)?|approvedBy|approvedAt|decidedBy|decidedAt|actor|createdBy|createdAt|updatedAt|verdict|blockers)/i
const urlPattern = /^https?:\/\//i
const base64Pattern = /^(?:[A-Za-z0-9+/]{4}){8,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const sha256Pattern = /^[a-f0-9]{64}$/
const statuses = Object.values(OUTCOME_STUDIO_READINESS_STATUSES)
const stableKeyPattern = /^[a-z0-9](?:[a-z0-9._-]{0,138}[a-z0-9])?$/
const versionPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,78}[A-Za-z0-9])?$/
const controlPattern = /[\u0000-\u001f\u007f]/

const hasMalformedUtf16 = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

const fail = (message, path) => {
  const error = new Error(message)
  error.status = 422
  error.code = 'OUTCOME_STUDIO_READINESS_VALIDATION_FAILED'
  error.details = { path }
  throw error
}

const assertObject = (value, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`, path)
}

const assertKeys = (value, allowed, path) => {
  assertObject(value, path)
  for (const key of Object.keys(value)) {
    if (forbiddenKey.test(key)) fail(`${path}.${key} is server-owned or prohibited.`, `${path}.${key}`)
    if (!allowed.includes(key)) fail(`${path}.${key} is not allowed.`, `${path}.${key}`)
  }
}

const inspectValue = (value, path, depth = 0) => {
  if (depth > OUTCOME_STUDIO_READINESS_LIMITS.MAX_DEPTH) fail(`${path} exceeds maximum depth.`, path)
  if (typeof value === 'string') {
    const limit = path.endsWith('.note') ? OUTCOME_STUDIO_READINESS_LIMITS.MAX_NOTE_LENGTH : OUTCOME_STUDIO_READINESS_LIMITS.MAX_STRING_LENGTH
    if (value.length > limit) fail(`${path} is too long.`, path)
    if (urlPattern.test(value) && !path.endsWith('.provenanceUri')) fail(`${path} cannot contain a URL.`, path)
    if (path.endsWith('.provenanceUri') && value && !value.startsWith('https://')) fail(`${path} must be an HTTPS URI.`, path)
    if (!path.endsWith('.provenanceUri') && !path.endsWith('.sha256') && base64Pattern.test(value.replace(/\s/g, ''))) fail(`${path} cannot contain encoded file data.`, path)
  } else if (Array.isArray(value)) {
    if (value.length > OUTCOME_STUDIO_READINESS_LIMITS.MAX_ARRAY_LENGTH) fail(`${path} has too many items.`, path)
    value.forEach((item, index) => inspectValue(item, `${path}[${index}]`, depth + 1))
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKey.test(key)) fail(`${path}.${key} is server-owned or prohibited.`, `${path}.${key}`)
      inspectValue(nested, `${path}.${key}`, depth + 1)
    }
  }
}

const requiredText = (value, path) => {
  if (typeof value !== 'string' || !value.trim()) fail(`${path} is required.`, path)
}

const optionalText = (value, path) => {
  if (typeof value !== 'string') fail(`${path} must be a string.`, path)
}

export const validateOutcomeStudioReadinessPayload = (body) => {
  assertKeys(body, ['expectedRevision', 'references', 'rubric', 'providerPosture', 'decisions'], 'body')
  inspectValue(body, 'body')
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) fail('expectedRevision must be a non-negative integer.', 'body.expectedRevision')

  if (!Array.isArray(body.references) || body.references.length !== OUTCOME_STUDIO_REFERENCE_FAMILIES.length) fail('All reference families are required.', 'body.references')
  const families = new Set()
  body.references.forEach((reference, index) => {
    const path = `body.references[${index}]`
    assertKeys(reference, ['family', 'status', 'title', 'sha256', 'provenanceUri'], path)
    if (!OUTCOME_STUDIO_REFERENCE_FAMILIES.includes(reference.family) || families.has(reference.family)) fail('Reference families must be unique and server-recognized.', `${path}.family`)
    families.add(reference.family)
    if (!statuses.includes(reference.status)) fail('Reference status must be OPEN, APPROVED, or REJECTED.', `${path}.status`)
    optionalText(reference.title, `${path}.title`)
    optionalText(reference.sha256, `${path}.sha256`)
    optionalText(reference.provenanceUri, `${path}.provenanceUri`)
    if (reference.sha256 && !sha256Pattern.test(reference.sha256)) fail('Reference sha256 must be 64 lowercase hexadecimal characters.', `${path}.sha256`)
    if (reference.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED) {
      requiredText(reference.title, `${path}.title`)
      requiredText(reference.sha256, `${path}.sha256`)
      requiredText(reference.provenanceUri, `${path}.provenanceUri`)
    }
  })

  assertKeys(body.rubric, ['status', 'threshold', 'primaryReviewer', 'provenanceUri'], 'body.rubric')
  if (!statuses.includes(body.rubric.status)) fail('Rubric status must be OPEN, APPROVED, or REJECTED.', 'body.rubric.status')
  if (body.rubric.threshold !== null && (typeof body.rubric.threshold !== 'number' || body.rubric.threshold < 0 || body.rubric.threshold > 100)) fail('Rubric threshold must be null or between 0 and 100.', 'body.rubric.threshold')
  assertKeys(body.rubric.primaryReviewer, ['name', 'role'], 'body.rubric.primaryReviewer')
  optionalText(body.rubric.primaryReviewer.name, 'body.rubric.primaryReviewer.name')
  optionalText(body.rubric.primaryReviewer.role, 'body.rubric.primaryReviewer.role')
  optionalText(body.rubric.provenanceUri, 'body.rubric.provenanceUri')
  if (body.rubric.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED) {
    if (!Number.isFinite(body.rubric.threshold)) fail('Approved rubric threshold is required.', 'body.rubric.threshold')
    requiredText(body.rubric.primaryReviewer.name, 'body.rubric.primaryReviewer.name')
    requiredText(body.rubric.primaryReviewer.role, 'body.rubric.primaryReviewer.role')
    requiredText(body.rubric.provenanceUri, 'body.rubric.provenanceUri')
  }

  assertKeys(body.providerPosture, ['vendor', 'model', 'costBoundary', 'privacyPosture', 'dataRegion', 'failurePosture', 'environment'], 'body.providerPosture')
  for (const field of ['vendor', 'model', 'costBoundary', 'privacyPosture', 'dataRegion']) optionalText(body.providerPosture[field], `body.providerPosture.${field}`)
  if (body.providerPosture.failurePosture !== 'FAIL_CLOSED') fail('Provider failurePosture must be FAIL_CLOSED.', 'body.providerPosture.failurePosture')
  if (body.providerPosture.environment !== OUTCOME_STUDIO_READINESS_ENVIRONMENT) fail('Provider environment must be TEST.', 'body.providerPosture.environment')

  if (!Array.isArray(body.decisions) || body.decisions.length !== Object.keys(OUTCOME_STUDIO_READINESS_AUTHORITY_MATRIX).length) fail('All readiness decisions are required.', 'body.decisions')
  const decisions = new Set()
  body.decisions.forEach((decision, index) => {
    const path = `body.decisions[${index}]`
    assertKeys(decision, ['decisionKey', 'authorities', 'note'], path)
    if (!Object.values(OUTCOME_STUDIO_READINESS_DECISION_KEYS).includes(decision.decisionKey) || decisions.has(decision.decisionKey)) fail('Decision keys must be unique and server-recognized.', `${path}.decisionKey`)
    decisions.add(decision.decisionKey)
    const required = OUTCOME_STUDIO_READINESS_AUTHORITY_MATRIX[decision.decisionKey]
    if (!Array.isArray(decision.authorities) || decision.authorities.length !== required.length) fail('Every required authority must be recorded independently.', `${path}.authorities`)
    const authorities = new Set()
    decision.authorities.forEach((entry, authorityIndex) => {
      const authorityPath = `${path}.authorities[${authorityIndex}]`
      assertKeys(entry, ['authority', 'status', 'provenanceUri'], authorityPath)
      if (!required.includes(entry.authority) || authorities.has(entry.authority)) fail('Authority is duplicated or not required for this decision.', `${authorityPath}.authority`)
      authorities.add(entry.authority)
      if (!statuses.includes(entry.status)) fail('Authority status must be OPEN, APPROVED, or REJECTED.', `${authorityPath}.status`)
      optionalText(entry.provenanceUri, `${authorityPath}.provenanceUri`)
      if (entry.status === OUTCOME_STUDIO_READINESS_STATUSES.APPROVED) requiredText(entry.provenanceUri, `${authorityPath}.provenanceUri`)
    })
    if (decision.note !== undefined && typeof decision.note !== 'string') fail('Decision note is invalid.', `${path}.note`)
  })
  return body
}

const normalizedText = (value, path, { min = 0, max }) => {
  if (typeof value !== 'string') fail(`${path} must be a string.`, path)
  const normalized = value.trim()
  if (normalized.length < min || normalized.length > max) fail(`${path} must contain ${min} to ${max} characters.`, path)
  if (controlPattern.test(normalized) || hasMalformedUtf16(normalized)) fail(`${path} contains prohibited characters.`, path)
  return normalized
}

const validateProductDecision = (value, path) => {
  assertKeys(value, ['status', 'productApproverName', 'productApproverRole', 'rationale'], path)
  if (!statuses.includes(value.status)) fail(`${path}.status must be OPEN, APPROVED, or REJECTED.`, `${path}.status`)
  const open = value.status === OUTCOME_STUDIO_READINESS_STATUSES.OPEN
  const min = open ? 0 : 1
  const decision = {
    status: value.status,
    productApproverName: normalizedText(value.productApproverName, `${path}.productApproverName`, { min, max: 160 }),
    productApproverRole: normalizedText(value.productApproverRole, `${path}.productApproverRole`, { min, max: 160 }),
    rationale: normalizedText(value.rationale, `${path}.rationale`, { min, max: 1000 }),
  }
  if (open && (decision.productApproverName || decision.productApproverRole || decision.rationale)) {
    fail(`${path} OPEN decision fields must be empty.`, path)
  }
  return decision
}

export const validateOutcomeStudioDevelopmentTestReadinessPayload = (body) => {
  assertKeys(body, ['expectedRevision', 'rubric', 'providerPolicy', 'testingApproval'], 'body')
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) fail('body.expectedRevision must be a non-negative safe integer.', 'body.expectedRevision')

  assertKeys(body.rubric, ['rubricKey', 'rubricVersion', 'threshold', 'decision'], 'body.rubric')
  const rubricKey = normalizedText(body.rubric.rubricKey, 'body.rubric.rubricKey', { min: 1, max: 140 }).toLowerCase()
  if (!stableKeyPattern.test(rubricKey)) fail('body.rubric.rubricKey must be a stable lowercase key.', 'body.rubric.rubricKey')
  const rubricVersion = normalizedText(body.rubric.rubricVersion, 'body.rubric.rubricVersion', { min: 1, max: 80 })
  if (!versionPattern.test(rubricVersion)) fail('body.rubric.rubricVersion is invalid.', 'body.rubric.rubricVersion')
  if (!Number.isFinite(body.rubric.threshold) || body.rubric.threshold < 0 || body.rubric.threshold > 100) fail('body.rubric.threshold must be a finite number from 0 to 100.', 'body.rubric.threshold')

  assertKeys(body.providerPolicy, ['providerKey', 'model', 'decision'], 'body.providerPolicy')
  const providerKey = normalizedText(body.providerPolicy.providerKey, 'body.providerPolicy.providerKey', { min: 1, max: 140 }).toLowerCase()
  if (!stableKeyPattern.test(providerKey)) fail('body.providerPolicy.providerKey must be a stable lowercase key.', 'body.providerPolicy.providerKey')
  const model = normalizedText(body.providerPolicy.model, 'body.providerPolicy.model', { min: 1, max: 160 })

  assertKeys(body.testingApproval, ['decision'], 'body.testingApproval')

  return {
    expectedRevision: body.expectedRevision,
    rubric: {
      rubricKey,
      rubricVersion,
      threshold: body.rubric.threshold,
      decision: validateProductDecision(body.rubric.decision, 'body.rubric.decision'),
    },
    providerPolicy: {
      providerKey,
      model,
      decision: validateProductDecision(body.providerPolicy.decision, 'body.providerPolicy.decision'),
    },
    testingApproval: {
      decision: validateProductDecision(body.testingApproval.decision, 'body.testingApproval.decision'),
    },
  }
}

export const validateOutcomeStudioReadinessPut = (req, res, next) => {
  try {
    if (Number(req.get('content-length') || 0) > OUTCOME_STUDIO_READINESS_LIMITS.MAX_BODY_BYTES) fail('Readiness payload is too large.', 'body')
    req.validatedOutcomeStudioReadiness = validateOutcomeStudioReadinessPayload(req.body)
    next()
  } catch (error) {
    res.status(422).json({ error: { code: error.code, message: error.message, details: error.details, requestId: req.requestId } })
  }
}

export const validateOutcomeStudioDevelopmentTestReadinessPut = (req, res, next) => {
  try {
    if (Number(req.get('content-length') || 0) > OUTCOME_STUDIO_READINESS_LIMITS.MAX_BODY_BYTES) fail('Readiness payload is too large.', 'body')
    req.validatedOutcomeStudioDevelopmentTestReadiness = validateOutcomeStudioDevelopmentTestReadinessPayload(req.body)
    next()
  } catch (error) {
    res.status(422).json({ error: { code: error.code, message: error.message, details: error.details, requestId: req.requestId } })
  }
}

export const validateOutcomeStudioReadinessHistory = (req, res, next) => {
  if (Object.keys(req.query).some((key) => !['page', 'pageSize'].includes(key))) return res.status(422).json({ error: { code: 'OUTCOME_STUDIO_READINESS_VALIDATION_FAILED', message: 'Unknown history query field.', requestId: req.requestId } })
  next()
}
