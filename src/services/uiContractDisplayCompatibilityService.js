import { isDeepStrictEqual } from 'node:util'
import { isRuntimeReleaseJsonValue } from './runtimeReleaseCompatibilityService.js'

const metadata = new Set([
  '_id', 'id', '__v', 'stableId', 'uiContractKey', 'name', 'description', 'createdAt', 'updatedAt',
  'createdBy', 'updatedBy', 'resolvedAt', 'componentVersion', 'versionStatus', 'lineageId',
  'clonedFromStableId', 'supersedesStableId', 'supersededByStableId', 'isSystem', 'isProtected', 'isLocked', 'lockedAt',
  'lockedBy', 'lockedReason', 'lockedByPackageKeys',
])
const presentation = {
  sections: ['label', 'shortLabel', 'helpText', 'placeholder', 'displayOrder', 'isVisible', 'isEditable',
    'isRequiredDisplay', 'isReadOnlyDisplay', 'isCollapsedByDefault', 'sectionGroup', 'iconKey', 'presentationKey'],
  lifecycleStages: ['label', 'description', 'badgeLabel', 'displayOrder', 'isVisible', 'badgePresentationKey'],
  actions: ['buttonLabel', 'confirmationTitle', 'confirmationMessage', 'successMessage', 'failureMessage',
    'loadingMessage', 'displayOrder', 'isVisible', 'presentationKey'],
}
const identities = { sections: 'sectionKey', lifecycleStages: 'stageKey', actions: 'actionKey' }
const omit = (value, fields) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.has(key)))
const orderedKeys = (rows, key) => [...rows].sort((a, b) => a.displayOrder - b.displayOrder).map((row) => row[key])

// Complete JSON records only: unrecognized authored fields remain in the comparison.
export const compareUIContractDisplay = (source, candidate) => {
  const fail = (reason) => ({ compatible: false, reason })
  if (![source, candidate].every((value) => value && !Array.isArray(value) && isRuntimeReleaseJsonValue(value))) {
    return fail('INVALID_UI_CONTRACT_JSON')
  }
  const projections = []
  for (const contract of [source, candidate]) {
    const projected = omit(contract, metadata)
    for (const [field, key] of Object.entries(identities)) {
      const rows = contract[field]
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row[key] !== 'string' || !row[key]
        || !Number.isInteger(row.displayOrder) || row.displayOrder < 0 || row.displayOrder > 10000)
        || new Set(rows.map((row) => row[key])).size !== rows.length) {
        return fail('INVALID_UI_CONTRACT_ROWS')
      }
      const orderedRows = field === 'sections' ? rows.filter((row) => row.isVisible !== false) : rows
      if (new Set(orderedRows.map((row) => row.displayOrder)).size !== orderedRows.length) return fail('INVALID_UI_CONTRACT_ORDER')
      projected[field] = rows.map((row) => omit(row, new Set(presentation[field])))
        .sort((a, b) => a[key].localeCompare(b[key]))
    }
    projections.push(projected)
  }
  if (!isDeepStrictEqual(...projections)) return fail('UI_CONTRACT_STRUCTURAL_CHANGE')
  for (const field of ['lifecycleStages', 'actions']) {
    if (!isDeepStrictEqual(orderedKeys(source[field], identities[field]), orderedKeys(candidate[field], identities[field]))) {
      return fail('UI_CONTRACT_ORDER_CHANGE')
    }
  }
  return { compatible: true, reason: null }
}
