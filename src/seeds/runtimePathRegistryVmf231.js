import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RUNTIME_PATH_REGISTRY_CATEGORIES,
  RUNTIME_PATH_REGISTRY_SCOPES,
} from '../models/RuntimePathRegistry.js'

const THIS_DIR = dirname(fileURLToPath(import.meta.url))

const RAW_VMF_231_RUNTIME_PATHS_SEED_PATH = resolve(
  THIS_DIR,
  '../../../docs/temp-docs/vmf-v2-3-1-runtime-paths-seed.mongo.json',
)

const SCOPE_NORMALIZATION = Object.freeze({
  ARTIFACT_OUTPUT: RUNTIME_PATH_REGISTRY_SCOPES.FRAMEWORK_STATE,
})

const CATEGORY_NORMALIZATION = Object.freeze({
  POLICY: RUNTIME_PATH_REGISTRY_CATEGORIES.SYSTEM,
  SECTION: RUNTIME_PATH_REGISTRY_CATEGORIES.SECTION,
  ARTIFACT: RUNTIME_PATH_REGISTRY_CATEGORIES.ARTIFACT,
})

const normalizeUpperToken = (value) => String(value || '').trim().toUpperCase()

const normalizeTokenList = (values, { upper = false } = {}) =>
  [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .map((value) => (upper ? value.toUpperCase() : value))
    .filter(Boolean))]

const loadRawRuntimePathRows = () => {
  let rawText
  try {
    rawText = readFileSync(RAW_VMF_231_RUNTIME_PATHS_SEED_PATH, 'utf8')
  } catch (error) {
    throw new Error(
      `Unable to read VMF v2.3.1 runtime-path seed source at ${RAW_VMF_231_RUNTIME_PATHS_SEED_PATH}: ${error.message}`,
    )
  }

  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    throw new Error(
      `VMF v2.3.1 runtime-path seed source is not valid JSON: ${error.message}`,
    )
  }

  if (!Array.isArray(parsed)) {
    throw new Error('VMF v2.3.1 runtime-path seed source must be a JSON array.')
  }

  return parsed
}

export const normalizeRuntimePathRegistryVmf231Row = (row = {}) => {
  const normalizedScopeToken = normalizeUpperToken(row.scope)
  const normalizedCategoryToken = normalizeUpperToken(row.category)
  const normalizedUiControl = normalizeUpperToken(row.uiControl)

  const normalized = {
    pathKey: String(row.pathKey || '').trim(),
    label: String(row.label || '').trim(),
    description: String(row.description || '').trim(),
    scope: SCOPE_NORMALIZATION[normalizedScopeToken] || normalizedScopeToken,
    allowedOperations: normalizeTokenList(row.allowedOperations, { upper: true }),
    dataType: normalizeUpperToken(row.dataType),
    category: CATEGORY_NORMALIZATION[normalizedCategoryToken] || normalizedCategoryToken,
    sourceType: normalizeUpperToken(row.sourceType),
    isProtected: Boolean(row.isProtected),
    isSystem: row.isSystem !== false,
    introducedInVersion: String(row.introducedInVersion || '').trim() || undefined,
    exampleValue: row.exampleValue ?? null,
    compatibilityTags: normalizeTokenList(row.compatibilityTags),
  }

  if (Array.isArray(row.allowedValues)) {
    normalized.allowedValues = normalizeTokenList(row.allowedValues)
  }

  if (normalizedUiControl) {
    normalized.uiControl = normalizedUiControl
  }

  return Object.freeze(normalized)
}

let cachedRuntimePathRegistryVmf231Seeds = null

export const getRuntimePathRegistryVmf231Seeds = () => {
  if (cachedRuntimePathRegistryVmf231Seeds) {
    return cachedRuntimePathRegistryVmf231Seeds
  }

  const rawRuntimePathRows = loadRawRuntimePathRows()
  cachedRuntimePathRegistryVmf231Seeds = Object.freeze(
    rawRuntimePathRows.map((row) => normalizeRuntimePathRegistryVmf231Row(row)),
  )

  return cachedRuntimePathRegistryVmf231Seeds
}

export const __testables = Object.freeze({
  RAW_VMF_231_RUNTIME_PATHS_SEED_PATH,
  normalizeRuntimePathRegistryVmf231Row,
})
