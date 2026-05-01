export const DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES = Object.freeze({
  compatibleWorkflowKeys: 'compatibleWorkflowKeys is deprecated. Use workflowBindings instead.',
  defaultAgentIds: 'defaultAgentIds is deprecated. Agents are assigned through workflow policies.',
  requiredSkillIds: 'requiredSkillIds is deprecated. Skills are resolved through workflow policies.',
  validationRules: 'validationRules is deprecated. Use sections and validationBindings instead.',
  validationConfig: 'validationConfig is deprecated. Use validationBindings instead.',
  workflowPolicyConfig: 'workflowPolicyConfig is deprecated. Use workflowBindings instead.',
})

export const DEPRECATED_FRAMEWORK_PACKAGE_FIELDS = Object.freeze(
  Object.keys(DEPRECATED_FRAMEWORK_PACKAGE_FIELD_MESSAGES),
)
