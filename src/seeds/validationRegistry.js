import {
  VALIDATION_REGISTRY_CATEGORIES,
  VALIDATION_REGISTRY_SEVERITIES,
  VALIDATION_REGISTRY_STATUSES,
} from '../models/ValidationRegistry.js'

export const VALIDATION_REGISTRY_SEED_STAGES = Object.freeze({
  MVP: 'mvp',
})

export const validationRegistrySeedsByStage = Object.freeze({
  [VALIDATION_REGISTRY_SEED_STAGES.MVP]: Object.freeze([
    Object.freeze({
      key: 'required-sections-check',
      label: 'Required Sections Check',
      description: 'Checks whether all required framework sections exist.',
      status: VALIDATION_REGISTRY_STATUSES.ACTIVE,
      supportedFrameworkKeys: Object.freeze(['VMF']),
      category: VALIDATION_REGISTRY_CATEGORIES.COMPLETENESS,
      severity: VALIDATION_REGISTRY_SEVERITIES.BLOCKING,
      producerSkillId: 'skill-vmf-required-sections-validator',
      outputPath: 'framework_state.validation.required_sections',
      passFieldPath: 'framework_state.validation.required_sections.is_valid',
      detailsFieldPath: 'framework_state.validation.required_sections.missing_sections',
      policyUsable: true,
      packageUsable: true,
      freshnessDefaultMinutes: 30,
      blockingDefault: true,
      warningOnlyDefault: false,
    }),
    Object.freeze({
      key: 'contract-schema-check',
      label: 'Contract Schema Check',
      description: 'Validates the contract schema output meets the required structure.',
      status: VALIDATION_REGISTRY_STATUSES.ACTIVE,
      supportedFrameworkKeys: Object.freeze(['VMF']),
      category: VALIDATION_REGISTRY_CATEGORIES.SCHEMA,
      severity: VALIDATION_REGISTRY_SEVERITIES.ERROR,
      producerSkillId: 'skill-vmf-contract-schema-validator',
      outputPath: 'framework_state.validation.contract_schema',
      passFieldPath: 'framework_state.validation.contract_schema.is_valid',
      detailsFieldPath: '',
      policyUsable: true,
      packageUsable: true,
      freshnessDefaultMinutes: 30,
      blockingDefault: true,
      warningOnlyDefault: false,
    }),
    Object.freeze({
      key: 'governance-completeness-check',
      label: 'Governance Completeness Check',
      description: 'Checks governance completeness requirements for the current framework state.',
      status: VALIDATION_REGISTRY_STATUSES.ACTIVE,
      supportedFrameworkKeys: Object.freeze(['VMF']),
      category: VALIDATION_REGISTRY_CATEGORIES.GOVERNANCE,
      severity: VALIDATION_REGISTRY_SEVERITIES.ERROR,
      producerSkillId: 'skill-vmf-governance-completeness-validator',
      outputPath: 'framework_state.validation.governance_completeness',
      passFieldPath: 'framework_state.validation.governance_completeness.is_valid',
      detailsFieldPath: '',
      policyUsable: true,
      packageUsable: true,
      freshnessDefaultMinutes: 60,
      blockingDefault: true,
      warningOnlyDefault: false,
    }),
  ]),
})

export const validationRegistrySeeds =
  validationRegistrySeedsByStage[VALIDATION_REGISTRY_SEED_STAGES.MVP]
