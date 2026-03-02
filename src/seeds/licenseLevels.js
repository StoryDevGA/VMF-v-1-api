import LicenseLevel from '../models/LicenseLevel.js'

export const LEGACY_DEFAULT_LICENSE_LEVEL_NAME = 'LEGACY_DEFAULT'

const normalizeLicenseLevelName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

const defaultLicenseLevelSeed = Object.freeze({
  name: LEGACY_DEFAULT_LICENSE_LEVEL_NAME,
  description:
    'Default legacy licence level for customers migrated before strict governance rollout.',
  featureEntitlements: [],
  isActive: true,
})

export const seedDefaultLicenseLevel = async ({ actorUserId } = {}) => {
  if (!actorUserId) {
    throw new Error('seedDefaultLicenseLevel requires actorUserId')
  }

  const normalizedName = normalizeLicenseLevelName(defaultLicenseLevelSeed.name)
  const existing = await LicenseLevel.findOne({ nameNormalized: normalizedName })

  if (existing) {
    console.log(`  [seed] License level already exists: ${defaultLicenseLevelSeed.name}`)
    return existing
  }

  const licenseLevel = await LicenseLevel.create({
    ...defaultLicenseLevelSeed,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  })

  console.log(`  [seed] Created license level: ${licenseLevel.name}`)
  return licenseLevel
}
