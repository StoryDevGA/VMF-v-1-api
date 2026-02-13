import { connectDb, disconnectDb } from '../config/db.js'
import Customer from '../models/Customer.js'

const DUPLICATE_SUFFIX_PREFIX = ' [dedupe-'
const DUPLICATE_SUFFIX_END = ']'
const MAX_CUSTOMER_NAME_LENGTH = 255

const normalizeCustomerName = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

const makeDedupedName = (name, id) => {
  const suffix = `${DUPLICATE_SUFFIX_PREFIX}${id}${DUPLICATE_SUFFIX_END}`
  const baseMax = Math.max(1, MAX_CUSTOMER_NAME_LENGTH - suffix.length)
  const base = String(name || '').trim().slice(0, baseMax).trimEnd()
  return `${base}${suffix}`
}

const summarizeGroup = (normalizedName, docs) => {
  const ids = docs.map((doc) => String(doc._id))
  const names = docs.map((doc) => doc.name)
  return { normalizedName, count: docs.length, ids, names }
}

const getDuplicateGroups = (docs) => {
  const map = new Map()
  for (const doc of docs) {
    const normalized = normalizeCustomerName(doc.name)
    if (!map.has(normalized)) map.set(normalized, [])
    map.get(normalized).push(doc)
  }

  return [...map.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([normalizedName, group]) =>
      summarizeGroup(
        normalizedName,
        group.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            || String(a._id).localeCompare(String(b._id)),
        ),
      ),
    )
}

const parseArgs = () => {
  const args = new Set(process.argv.slice(2))
  return {
    apply: args.has('--apply'),
    resolveDuplicates: args.has('--resolve-duplicates'),
  }
}

const run = async () => {
  const { apply, resolveDuplicates } = parseArgs()
  await connectDb()

  const docs = await Customer.find({})
    .select('_id name nameNormalized createdAt')
    .lean()

  const normalizationOps = []
  for (const doc of docs) {
    const normalized = normalizeCustomerName(doc.name)
    if (doc.nameNormalized !== normalized) {
      normalizationOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { nameNormalized: normalized } },
        },
      })
    }
  }

  if (normalizationOps.length > 0) {
    console.log(`Normalization updates needed: ${normalizationOps.length}`)
    if (apply) {
      await Customer.bulkWrite(normalizationOps, { ordered: false })
      console.log('Applied normalization updates.')
    } else {
      console.log('Dry run: normalization updates were not applied. Re-run with --apply.')
    }
  } else {
    console.log('No normalization updates needed.')
  }

  const refreshed = apply
    ? await Customer.find({}).select('_id name createdAt').lean()
    : docs

  let duplicates = getDuplicateGroups(refreshed)
  if (duplicates.length > 0) {
    console.log(`Duplicate normalized names found: ${duplicates.length}`)
    for (const group of duplicates) {
      console.log(`- "${group.normalizedName}" (${group.count})`)
      for (let i = 0; i < group.ids.length; i += 1) {
        console.log(`  ${group.ids[i]} :: ${group.names[i]}`)
      }
    }

    if (resolveDuplicates) {
      const renameOps = []
      for (const group of duplicates) {
        // Keep oldest record unchanged; rename all others deterministically.
        for (let i = 1; i < group.ids.length; i += 1) {
          const id = group.ids[i]
          const originalName = group.names[i]
          const dedupedName = makeDedupedName(originalName, id)
          renameOps.push({
            updateOne: {
              filter: { _id: id },
              update: {
                $set: {
                  name: dedupedName,
                  nameNormalized: normalizeCustomerName(dedupedName),
                },
              },
            },
          })
        }
      }

      if (renameOps.length > 0) {
        console.log(`Duplicate rename operations prepared: ${renameOps.length}`)
        if (apply) {
          await Customer.bulkWrite(renameOps, { ordered: false })
          console.log('Applied duplicate renames.')
          const afterDedup = await Customer.find({}).select('_id name createdAt').lean()
          duplicates = getDuplicateGroups(afterDedup)
        } else {
          console.log('Dry run: duplicate renames were not applied. Re-run with --apply.')
        }
      }
    }
  } else {
    console.log('No duplicate normalized names found.')
  }

  if (duplicates.length > 0) {
    console.log('Unique index not created because duplicates still exist.')
    process.exitCode = 2
    return
  }

  try {
    await Customer.collection.createIndex(
      { nameNormalized: 1 },
      { unique: true, name: 'unique_customer_name_normalized' },
    )
    console.log('Ensured unique index: unique_customer_name_normalized')
  } catch (err) {
    if (err.codeName === 'IndexOptionsConflict') {
      console.log('Index already exists with different options. Please inspect manually.')
      throw err
    }
    throw err
  }
}

run()
  .catch((err) => {
    console.error('Failed to enforce customer name uniqueness:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await disconnectDb()
    } catch {
      // no-op
    }
  })
