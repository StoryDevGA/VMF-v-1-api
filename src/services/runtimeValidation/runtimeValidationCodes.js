export const RUNTIME_VALIDATION_CODES = Object.freeze({
  SCOPE_OUTSIDE_ALLOWED: 'RVL-SCOPE-001',
  PATH_INVALID: 'RVL-PATH-002',
  OUTPUT_CONTRACT_INVALID: 'RVL-OUTPUT-003',
  LIFECYCLE_TRANSITION_INVALID: 'RVL-LIFECYCLE-004',
  WORKFLOW_INVALID: 'RVL-WORKFLOW-005',
  AGENT_INVALID: 'RVL-AGENT-006',
  SKILL_INVALID: 'RVL-SKILL-007',
  DEPENDENCY_INVALID: 'RVL-DEPENDENCY-008',
  EXECUTION_INVALID: 'RVL-EXECUTION-009',
  STATE_INVALID: 'RVL-STATE-010',
})

export const RUNTIME_VALIDATION_MESSAGES = Object.freeze({
  [RUNTIME_VALIDATION_CODES.SCOPE_OUTSIDE_ALLOWED]: 'Runtime operation is outside the actor scope boundary.',
  [RUNTIME_VALIDATION_CODES.PATH_INVALID]: 'Runtime path is not valid for this operation.',
  [RUNTIME_VALIDATION_CODES.OUTPUT_CONTRACT_INVALID]: 'Runtime output does not match the declared output contract.',
  [RUNTIME_VALIDATION_CODES.LIFECYCLE_TRANSITION_INVALID]: 'Lifecycle transition is not allowed.',
  [RUNTIME_VALIDATION_CODES.WORKFLOW_INVALID]: 'Workflow execution is not valid.',
  [RUNTIME_VALIDATION_CODES.AGENT_INVALID]: 'Agent action is not valid.',
  [RUNTIME_VALIDATION_CODES.SKILL_INVALID]: 'Skill execution is not valid.',
  [RUNTIME_VALIDATION_CODES.DEPENDENCY_INVALID]: 'Runtime dependency state is not valid.',
  [RUNTIME_VALIDATION_CODES.EXECUTION_INVALID]: 'Runtime execution is not valid.',
  [RUNTIME_VALIDATION_CODES.STATE_INVALID]: 'Runtime state mutation is not valid.',
})

export const buildRuntimeValidationIssue = ({
  code,
  severity = 'ERROR',
  message,
  path = '',
  source = 'runtime-validation',
}) => ({
  code,
  severity,
  message: message || RUNTIME_VALIDATION_MESSAGES[code] || 'Runtime validation issue detected.',
  path,
  source,
})
