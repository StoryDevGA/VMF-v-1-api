import { User } from '../models/index.js'

// Prefetch unique first reads, retaining document save hooks and ordered writes.
// Repeated IDs must read again after the preceding item has succeeded or failed.
export const buildBulkUserReader = async (ids) => {
  let initial
  try {
    const rows = await User.find({ _id: { $in: [...new Set(ids.map(String))] } })
    initial = new Map(rows.map((row) => [String(row._id), row]))
  } catch {
    // A batch failure still gets the existing per-item error/result semantics.
    return (id) => User.findById(id)
  }
  const seen = new Set()
  return (id) => {
    const key = String(id)
    if (seen.has(key)) return User.findById(id)
    seen.add(key)
    const value = initial.get(key) || null
    initial.delete(key)
    return value
  }
}
