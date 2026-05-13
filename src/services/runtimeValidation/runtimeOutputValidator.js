import Ajv from 'ajv'
import { RUNTIME_VALIDATION_CODES, buildRuntimeValidationIssue } from './runtimeValidationCodes.js'

const isPlainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const normalizePayloadPath = (instancePath = '') => {
  const normalizedPath = String(instancePath || '')
    .replace(/^\//, '')
    .replace(/\//g, '.')
  return normalizedPath ? `payload.${normalizedPath}` : 'payload'
}

const buildOutputIssuePath = (error = {}) => {
  const basePath = normalizePayloadPath(error.instancePath)
  const additionalProperty = error.params?.additionalProperty
  if (error.keyword === 'additionalProperties' && additionalProperty) {
    return `${basePath}.${additionalProperty}`
  }

  const missingProperty = error.params?.missingProperty
  if (error.keyword === 'required' && missingProperty) {
    return `${basePath}.${missingProperty}`
  }

  return basePath
}

export const validateRuntimeOutputContract = ({ outputContract, payload }) => {
  if (!isPlainObject(outputContract) || Object.keys(outputContract).length === 0) {
    return []
  }

  try {
    const ajv = new Ajv({
      allErrors: true,
      strict: false,
    })
    const validate = ajv.compile(outputContract)
    const valid = validate(payload)
    if (valid) return []

    const errors = validate.errors || []
    const issues = errors.slice(0, 10).map((error) => buildRuntimeValidationIssue({
      code: RUNTIME_VALIDATION_CODES.OUTPUT_CONTRACT_INVALID,
      severity: 'BLOCKING',
      message: error.message
        ? `Runtime output ${error.instancePath || '/'} ${error.message}.`
        : 'Runtime output does not match the declared output contract.',
      path: buildOutputIssuePath(error),
      source: 'runtime-output-validator',
    }))

    if (errors.length > issues.length) {
      issues.push(buildRuntimeValidationIssue({
        code: RUNTIME_VALIDATION_CODES.OUTPUT_CONTRACT_INVALID,
        severity: 'WARN',
        message: `Runtime output has ${errors.length - issues.length} additional schema violation${errors.length - issues.length === 1 ? '' : 's'} not shown.`,
        path: 'payload',
        source: 'runtime-output-validator',
      }))
    }

    return issues
  } catch (error) {
    return [buildRuntimeValidationIssue({
      code: RUNTIME_VALIDATION_CODES.OUTPUT_CONTRACT_INVALID,
      severity: 'BLOCKING',
      message: `Output contract schema is invalid: ${error.message}`,
      path: 'outputContract',
      source: 'runtime-output-validator',
    })]
  }
}
