import { connectDb } from '../config/db.js'
import { seedSystemRoles } from './systemRoles.js'
import { seedFrameworkRegistry } from './frameworkRegistry.js'
import { seedSuperAdmin } from './superAdmin.js'
import { seedDefaultLicenseLevel } from './licenseLevels.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import {
  RuntimeAgent,
  RuntimePathRegistry,
  RuntimeSkill,
  SkillRoleRegistry,
  UIContract,
  ValidationRegistry,
  WorkflowPolicy,
} from '../models/index.js'
import { importFrameworkSeed } from '../scripts/importFrameworkSeed.js'

const RUNTIME_CONTROL_BOOTSTRAP_MODELS = Object.freeze([
  RuntimePathRegistry,
  SkillRoleRegistry,
  RuntimeSkill,
  ValidationRegistry,
  RuntimeAgent,
  WorkflowPolicy,
  UIContract,
  FrameworkPackage,
])

const seedFrameworkRuntimeControlIfEmpty = async () => {
  const counts = await Promise.all(
    RUNTIME_CONTROL_BOOTSTRAP_MODELS.map(async (model) => ({
      collection: model.collection.name,
      count: await model.estimatedDocumentCount(),
    })),
  )
  const total = counts.reduce((sum, row) => sum + row.count, 0)

  if (total > 0) {
    const emptyCollections = counts.filter((row) => row.count === 0).map((row) => row.collection)
    if (emptyCollections.length > 0) {
      throw new Error(
        '[seed] Runtime Control collections are partially populated. '
        + `Empty collections: ${emptyCollections.join(', ')}. `
        + 'Run framework-seed:import manually with an explicit reset/import plan before bootstrapping.',
      )
    }
    return
  }

  console.log('[seed] Runtime Control collections are empty; importing VMF framework seed data...')
  const { payload, hasErrors } = await importFrameworkSeed({
    apply: true,
    manageConnection: false,
    noEditorContract: true,
    noReport: true,
  })

  if (hasErrors) {
    throw new Error('VMF framework seed import failed during database bootstrap.')
  }

  const imported = payload.summary.collections
    .map((row) => `${row.label}: ${row.created} created`)
    .join('; ')
  console.log(`[seed] VMF framework seed import completed. ${imported}`)
}

export const runSeeds = async () => {
  console.log('[seed] Starting database seeding...')

  try {
    // Ensure DB connection (no-op if already connected)
    await connectDb()

    // Run seeds in order
    await seedSystemRoles()
    const superAdmin = await seedSuperAdmin()
    await seedFrameworkRegistry({ actorUserId: superAdmin?._id })
    await seedFrameworkRuntimeControlIfEmpty()
    await seedDefaultLicenseLevel({ actorUserId: superAdmin?._id })

    console.log('[seed] Database seeding completed successfully.')
  } catch (error) {
    console.error('[seed] Database seeding failed:', error.message)
    throw error
  }
}

// Allow running seeds directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  runSeeds()
    .then(() => {
      console.log('Seeding completed')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Seeding failed:', error)
      process.exit(1)
    })
}
