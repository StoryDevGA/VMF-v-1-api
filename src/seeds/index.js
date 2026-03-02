import { connectDb } from '../config/db.js'
import { seedSystemRoles } from './systemRoles.js'
import { seedSuperAdmin } from './superAdmin.js'
import { seedDefaultLicenseLevel } from './licenseLevels.js'

export const runSeeds = async () => {
  console.log('[seed] Starting database seeding...')

  try {
    // Ensure DB connection (no-op if already connected)
    await connectDb()

    // Run seeds in order
    await seedSystemRoles()
    const superAdmin = await seedSuperAdmin()
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
