import { readFileSync } from 'node:fs'
import { RUNTIME_VALIDATION_CODES, buildRuntimeValidationIssue } from './runtimeValidationCodes.js'

const lifecycleTransitionMatrix = JSON.parse(
  readFileSync(new URL('../../runtime-config/lifecycle-transition-matrix.json', import.meta.url), 'utf8'),
)

const normalizeStage = (value) => String(value || '').trim().toUpperCase()

export const validateRuntimeLifecycleTransition = ({ lifecycleStage, targetLifecycleStage }) => {
  const fromStage = normalizeStage(lifecycleStage)
  const toStage = normalizeStage(targetLifecycleStage)

  if (!fromStage || !toStage) {
    return [buildRuntimeValidationIssue({
      code: RUNTIME_VALIDATION_CODES.LIFECYCLE_TRANSITION_INVALID,
      severity: 'BLOCKING',
      message: 'Lifecycle transition validation requires both lifecycleStage and targetLifecycleStage.',
      path: !fromStage ? 'lifecycleStage' : 'targetLifecycleStage',
      source: 'runtime-transition-validator',
    })]
  }

  const allowedTargets = lifecycleTransitionMatrix[fromStage]
  if (!Array.isArray(allowedTargets)) {
    return [buildRuntimeValidationIssue({
      code: RUNTIME_VALIDATION_CODES.LIFECYCLE_TRANSITION_INVALID,
      severity: 'BLOCKING',
      message: `Lifecycle stage "${fromStage}" is not registered in the transition matrix.`,
      path: 'lifecycleStage',
      source: 'runtime-transition-validator',
    })]
  }

  if (!allowedTargets.includes(toStage)) {
    return [buildRuntimeValidationIssue({
      code: RUNTIME_VALIDATION_CODES.LIFECYCLE_TRANSITION_INVALID,
      severity: 'BLOCKING',
      message: `Lifecycle transition ${fromStage} -> ${toStage} is not allowed.`,
      path: 'targetLifecycleStage',
      source: 'runtime-transition-validator',
    })]
  }

  return []
}
