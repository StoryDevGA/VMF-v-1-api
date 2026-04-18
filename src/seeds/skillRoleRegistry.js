import SkillRoleRegistry, { SKILL_ROLE_REGISTRY_STATUSES } from '../models/SkillRoleRegistry.js'

export const skillRoleRegistrySeeds = Object.freeze([
  Object.freeze({
    roleKey: 'READER',
    label: 'Reader',
    description: 'Reads runtime state without mutation.',
    status: SKILL_ROLE_REGISTRY_STATUSES.ACTIVE,
    isSystem: true,
  }),
  Object.freeze({
    roleKey: 'WRITER',
    label: 'Writer',
    description: 'Writes or updates runtime state.',
    status: SKILL_ROLE_REGISTRY_STATUSES.ACTIVE,
    isSystem: true,
  }),
  Object.freeze({
    roleKey: 'VALIDATOR',
    label: 'Validator',
    description: 'Evaluates correctness or completeness of state.',
    status: SKILL_ROLE_REGISTRY_STATUSES.ACTIVE,
    isSystem: true,
  }),
  Object.freeze({
    roleKey: 'TRANSFORMER',
    label: 'Transformer',
    description: 'Transforms or reshapes data.',
    status: SKILL_ROLE_REGISTRY_STATUSES.ACTIVE,
    isSystem: true,
  }),
  Object.freeze({
    roleKey: 'ANALYZER',
    label: 'Analyzer',
    description: 'Performs reasoning or evaluation.',
    status: SKILL_ROLE_REGISTRY_STATUSES.ACTIVE,
    isSystem: true,
  }),
  Object.freeze({
    roleKey: 'RESOLVER',
    label: 'Resolver',
    description: 'Determines decisions or next actions.',
    status: SKILL_ROLE_REGISTRY_STATUSES.ACTIVE,
    isSystem: true,
  }),
  Object.freeze({
    roleKey: 'RENDERER',
    label: 'Renderer',
    description: 'Produces user-facing outputs.',
    status: SKILL_ROLE_REGISTRY_STATUSES.ACTIVE,
    isSystem: true,
  }),
])

export const seedSkillRoleRegistry = async ({ actorUserId } = {}) => {
  if (!actorUserId) {
    throw new Error('seedSkillRoleRegistry requires actorUserId')
  }

  const seeded = []

  for (const seedEntry of skillRoleRegistrySeeds) {
    const existing = await SkillRoleRegistry.findOne({ roleKey: seedEntry.roleKey })

    if (existing) {
      console.log(`  [seed] Skill role already exists: ${seedEntry.roleKey}`)
      seeded.push(existing)
      continue
    }

    const created = await SkillRoleRegistry.create({
      ...seedEntry,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    console.log(`  [seed] Created skill role: ${created.roleKey}`)
    seeded.push(created)
  }

  return seeded
}

