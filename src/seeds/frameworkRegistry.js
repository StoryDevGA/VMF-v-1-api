import FrameworkRegistry, {
  FRAMEWORK_REGISTRY_STATUSES,
  FRAMEWORK_REGISTRY_STRUCTURE_TYPES,
  FRAMEWORK_REGISTRY_TYPES,
} from '../models/FrameworkRegistry.js'

export const frameworkRegistrySeeds = Object.freeze([
  Object.freeze({
    frameworkKey: 'VMF',
    name: 'Value Messaging Framework',
    type: FRAMEWORK_REGISTRY_TYPES.STRUCTURED,
    structureType: FRAMEWORK_REGISTRY_STRUCTURE_TYPES.SECTION_BASED,
    supportedWorkflowKeys: Object.freeze(['vmf-baseline', 'vmf-publish']),
    defaultBehaviorProfile: Object.freeze({
      mode: 'publish-first',
      approvalRequired: true,
      previewMode: true,
    }),
    status: FRAMEWORK_REGISTRY_STATUSES.ACTIVE,
  }),
  Object.freeze({
    frameworkKey: 'RLD',
    name: 'Revenue Lifecycle Design',
    type: FRAMEWORK_REGISTRY_TYPES.STRUCTURED,
    structureType: FRAMEWORK_REGISTRY_STRUCTURE_TYPES.FLOW_BASED,
    supportedWorkflowKeys: Object.freeze(['rld-baseline', 'rld-publish']),
    defaultBehaviorProfile: Object.freeze({
      mode: 'review-led',
      approvalRequired: true,
      previewMode: false,
    }),
    status: FRAMEWORK_REGISTRY_STATUSES.ACTIVE,
  }),
  Object.freeze({
    frameworkKey: 'QMF',
    name: 'Quality Messaging Framework',
    type: FRAMEWORK_REGISTRY_TYPES.HYBRID,
    structureType: FRAMEWORK_REGISTRY_STRUCTURE_TYPES.TEMPLATE_BASED,
    supportedWorkflowKeys: Object.freeze(['qmf-review', 'qmf-release']),
    defaultBehaviorProfile: Object.freeze({
      mode: 'template-led',
      approvalRequired: true,
      previewMode: true,
    }),
    status: FRAMEWORK_REGISTRY_STATUSES.DRAFT,
  }),
  Object.freeze({
    frameworkKey: 'CMF',
    name: 'Customer Messaging Framework',
    type: FRAMEWORK_REGISTRY_TYPES.COMPOSABLE,
    structureType: FRAMEWORK_REGISTRY_STRUCTURE_TYPES.POLICY_BASED,
    supportedWorkflowKeys: Object.freeze(['cmf-intake', 'cmf-publish']),
    defaultBehaviorProfile: Object.freeze({
      mode: 'composable',
      approvalRequired: false,
      previewMode: true,
    }),
    status: FRAMEWORK_REGISTRY_STATUSES.DRAFT,
  }),
  Object.freeze({
    frameworkKey: 'OPS',
    name: 'Operations Messaging Framework',
    type: FRAMEWORK_REGISTRY_TYPES.HYBRID,
    structureType: FRAMEWORK_REGISTRY_STRUCTURE_TYPES.SECTION_BASED,
    supportedWorkflowKeys: Object.freeze(['ops-review']),
    defaultBehaviorProfile: Object.freeze({
      mode: 'operations',
      approvalRequired: true,
      previewMode: false,
    }),
    status: FRAMEWORK_REGISTRY_STATUSES.DEPRECATED,
  }),
])

export const seedFrameworkRegistry = async ({ actorUserId } = {}) => {
  if (!actorUserId) {
    throw new Error('seedFrameworkRegistry requires actorUserId')
  }

  const seededEntries = []

  for (const seedEntry of frameworkRegistrySeeds) {
    const existing = await FrameworkRegistry.findOne({
      frameworkKey: seedEntry.frameworkKey,
    })

    if (existing) {
      console.log(`  [seed] Framework registry already exists: ${seedEntry.frameworkKey}`)
      seededEntries.push(existing)
      continue
    }

    const createdEntry = await FrameworkRegistry.create({
      ...seedEntry,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    console.log(`  [seed] Created framework registry: ${createdEntry.frameworkKey}`)
    seededEntries.push(createdEntry)
  }

  return seededEntries
}
