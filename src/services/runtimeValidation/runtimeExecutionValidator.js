import { RUNTIME_VALIDATION_CODES, buildRuntimeValidationIssue } from './runtimeValidationCodes.js'

export const validateRuntimeExecution = ({ operationType, skillId, actorType }) => {
  const issues = []
  const normalizedOperationType = String(operationType || '').trim().toUpperCase()

  if (normalizedOperationType === 'SKILL_EXECUTION' && !String(skillId || '').trim()) {
    issues.push(buildRuntimeValidationIssue({
      code: RUNTIME_VALIDATION_CODES.SKILL_INVALID,
      severity: 'ERROR',
      message: 'Skill execution validation requires skillId.',
      path: 'skillId',
      source: 'runtime-execution-validator',
    }))
  }

  if ((normalizedOperationType === 'AGENT_ACTION' || normalizedOperationType === 'AGENT_EXECUTION') && String(actorType || '').trim().toUpperCase() !== 'AGENT') {
    issues.push(buildRuntimeValidationIssue({
      code: RUNTIME_VALIDATION_CODES.AGENT_INVALID,
      severity: 'WARN',
      message: 'Agent action validation should identify the runtime actor as AGENT.',
      path: 'actorType',
      source: 'runtime-execution-validator',
    }))
  }

  return issues
}
