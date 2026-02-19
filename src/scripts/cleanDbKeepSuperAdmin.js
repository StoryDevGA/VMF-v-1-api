import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import { User } from '../models/index.js'

const USERS_COLLECTION = 'users'
const ROLES_COLLECTION = 'roles'

const buildSuperAdminSelector = () => {
  const configuredEmail = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase()
  const platformSuperAdminSelector = {
    memberships: { $elemMatch: { customerId: null, roles: 'SUPER_ADMIN' } },
  }

  if (!configuredEmail) return platformSuperAdminSelector

  return {
    $or: [
      { email: configuredEmail },
      platformSuperAdminSelector,
    ],
  }
}

const isSystemCollection = (name) =>
  name.startsWith('system.')

const getFilterForCollection = (name, superAdminIds) => {
  if (name === USERS_COLLECTION) {
    return { _id: { $nin: superAdminIds } }
  }
  if (name === ROLES_COLLECTION) {
    // Preserve built-in platform role definitions.
    return { isSystem: { $ne: true } }
  }
  return {}
}

const cleanDbKeepSuperAdmin = async ({ dryRun = false } = {}) => {
  await connectDb()

  const superAdmins = await User.find(buildSuperAdminSelector())
    .select('_id email memberships')
    .lean()

  if (superAdmins.length === 0) {
    throw new Error(
      'No super admin user found. Aborting to avoid removing login credentials.',
    )
  }

  const superAdminIds = superAdmins.map((admin) => admin._id)
  const superAdminEmails = superAdmins.map((admin) => admin.email)
  console.log(`Keeping ${superAdmins.length} super admin user(s): ${superAdminEmails.join(', ')}`)

  const db = mongoose.connection.db
  const collections = await db.listCollections().toArray()
  const summary = []

  for (const { name } of collections) {
    if (isSystemCollection(name)) continue

    const collection = db.collection(name)
    const filter = getFilterForCollection(name, superAdminIds)
    const matchedCount = await collection.countDocuments(filter)

    if (matchedCount === 0) {
      summary.push({ collection: name, deletedCount: 0, mode: dryRun ? 'dry-run' : 'clean' })
      continue
    }

    if (dryRun) {
      summary.push({ collection: name, deletedCount: matchedCount, mode: 'dry-run' })
      continue
    }

    const { deletedCount = 0 } = await collection.deleteMany(filter)
    summary.push({ collection: name, deletedCount, mode: 'clean' })
  }

  const totalDeleted = summary.reduce((acc, item) => acc + item.deletedCount, 0)
  const modeLabel = dryRun ? 'DRY RUN' : 'CLEAN COMPLETE'

  console.log(`\n${modeLabel}`)
  for (const row of summary) {
    console.log(`- ${row.collection}: ${row.deletedCount}`)
  }
  console.log(`Total deleted: ${totalDeleted}`)
}

const runFromCli = async () => {
  const dryRun = process.argv.includes('--dry-run')
  try {
    await cleanDbKeepSuperAdmin({ dryRun })
    await disconnectDb()
    process.exit(0)
  } catch (err) {
    console.error(`Failed to clean database: ${err.message}`)
    try {
      await disconnectDb()
    } catch {
      // ignore disconnect errors in failure path
    }
    process.exit(1)
  }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] === thisFile) {
  runFromCli()
}

export default cleanDbKeepSuperAdmin
