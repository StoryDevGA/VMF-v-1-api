import semver from 'semver'
import { generateChecksum } from './governanceAudit/checksumService.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import UIContract from '../models/UIContract.js'
import RuntimeSkill from '../models/RuntimeSkill.js'
import RuntimeSupportAsset from '../models/RuntimeSupportAsset.js'
import WorkflowPolicy from '../models/WorkflowPolicy.js'
import RuntimePathRegistry from '../models/RuntimePathRegistry.js'
import { compareUIContractDisplay } from './uiContractDisplayCompatibilityService.js'
import { isRuntimeManagedSection, validateRuntimeManagedSectionDeclarations } from './runtimeManagedSectionContract.js'

const text = (value) => String(value ?? '').trim()
const token = (value) => text(value).toLowerCase()
const sectionKey = (value) => token(value).replace(/-/g, '_')
const json = (value) => JSON.parse(JSON.stringify(value))
const messages = {
  PACKAGE_NOT_ACTIVE_LOCKED: 'The package must be active and locked.',
  SOURCE_UI_CONTRACT_NOT_ACTIVE_LOCKED: 'The current UI Contract must be active and locked.',
  CANDIDATE_UI_CONTRACT_NOT_ACTIVE: 'The selected UI Contract must be active.',
  CANDIDATE_UI_CONTRACT_INCOMPATIBLE: 'The selected UI Contract must support this package, framework and version.',
  INVALID_UI_CONTRACT_JSON: 'The UI Contract contains invalid data.',
  INVALID_UI_CONTRACT_ROWS: 'UI Contract rows require unique identities and whole-number display orders from 0 to 10000.',
  INVALID_UI_CONTRACT_ORDER: 'Display orders must be unique for lifecycle stages, actions and visible sections.',
  UI_CONTRACT_STRUCTURAL_CHANGE: 'The selected UI Contract changes runtime structure rather than display settings alone.',
  UI_CONTRACT_ORDER_CHANGE: 'Lifecycle stage and action order must remain unchanged.',
  RUNTIME_MANAGED_CONTRACT_INVALID: 'The package has incomplete internal section completion declarations.',
  PACKAGE_SECTION_MAPPING_INVALID: 'The package requires unique section mappings.',
  UI_CONTRACT_SECTION_MAPPING_INVALID: 'A section mapping is missing, duplicated, mismatched or exposes an internal section.',
  UI_CONTRACT_ORPHAN_SECTION: 'A UI section does not belong to this package.',
  UI_CONTRACT_ACTION_POLICY_MISSING: 'An action has no active policy in an enabled package workflow binding.',
  UI_CONTRACT_LIFECYCLE_STAGE_INVALID: 'Every lifecycle stage must be declared by the active lifecycle runtime path.',
  PACKAGE_DEPENDENCY_LOCK_INVALID: 'The package dependency lock is missing or does not match this package version.',
  RUNTIME_SKILL_LOCK_MISMATCH: 'A Runtime Skill does not match its locked package reference.',
  RUNTIME_SUPPORT_ASSET_IDENTITY_INVALID: 'A support reference must resolve to exactly one asset for this package version and skill.',
  RUNTIME_SUPPORT_ASSET_OWNER_INVALID: 'A package support asset names a skill outside the locked package dependencies.',
}
const assetId = (value) => `asset-${token(value).replace(/^asset-/, '').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'seed-asset'}`
const compatibleVersion = (pkg, ui) => {
  const version = ui.sourcePackageVersion || ui.introducedInVersion
  if (!semver.valid(pkg.version) || !semver.valid(version)) return false
  if (ui.deprecatedInVersion && (!semver.valid(ui.deprecatedInVersion) || semver.gte(pkg.version, ui.deprecatedInVersion))) return false
  if (ui.compatibilityMode === 'STRICT') return semver.eq(pkg.version, version)
  if (ui.compatibilityMode === 'OPEN') return semver.gte(pkg.version, version)
  return ui.compatibilityMode === 'INHERITED_MINOR' && semver.major(pkg.version) === semver.major(version)
    && semver.gte(pkg.version, version)
}

// Diagnostic only. No audit or checkpoint persistence: PASS is not rebind authority.
export const runUIContractDisplayCheckpoint = async ({ packageId, uiContractKey, session } ) => {
  const observed = []
  const read = async (query) => {
    const value = await (session ? query.session(session) : query).lean()
    observed.push(json(value))
    return value
  }
  const identifier = text(packageId)
  const pkg = await read(/^[a-f\d]{24}$/i.test(identifier)
    ? FrameworkPackage.findById(identifier) : FrameworkPackage.findOne({ packageKey: token(identifier) }))
  if (!pkg) throw Object.assign(new Error('Framework package was not found.'), { status: 404, code: 'NOT_FOUND' })
  const issues = []
  const add = (code, field) => issues.push({ code, field, message: messages[code] })
  const finish = () => ({ status: issues.length ? 'FAIL' : 'PASS', compatible: issues.length === 0,
    persisted: false, packageKey: pkg.packageKey, uiContractKey, issues,
    checkpointHash: generateChecksum({ contract: 'ui-contract-display-checkpoint.v1', observed }) })
  if (pkg.status !== 'ACTIVE' || pkg.isLocked !== true) add('PACKAGE_NOT_ACTIVE_LOCKED', 'packageId')
  const source = await read(UIContract.findOne({ uiContractKey: pkg.uiContractKey }))
  const candidate = await read(UIContract.findOne({ uiContractKey }))
  if (!source || source.status !== 'ACTIVE' || source.versionStatus !== 'ACTIVE' || source.isLocked !== true) {
    add('SOURCE_UI_CONTRACT_NOT_ACTIVE_LOCKED', 'uiContractKey')
  }
  if (!candidate || candidate.status !== 'ACTIVE' || candidate.versionStatus !== 'ACTIVE') {
    add('CANDIDATE_UI_CONTRACT_NOT_ACTIVE', 'uiContractKey')
  }
  if (!source || !candidate) return finish()
  if (!candidate.frameworkKeys?.includes(pkg.frameworkKey)
    || (candidate.sourceFrameworkKey && candidate.sourceFrameworkKey !== pkg.frameworkKey)
    || candidate.sourcePackageKey !== pkg.packageKey || !compatibleVersion(pkg, candidate)) {
    add('CANDIDATE_UI_CONTRACT_INCOMPATIBLE', 'uiContractKey')
  }
  const comparison = compareUIContractDisplay(json(source), json(candidate))
  if (!comparison.compatible) add(comparison.reason, 'uiContractKey')
  try { validateRuntimeManagedSectionDeclarations(pkg) } catch { add('RUNTIME_MANAGED_CONTRACT_INVALID', 'sections') }
  const packageSections = Array.isArray(pkg.sections) ? pkg.sections : []
  const uiSections = Array.isArray(candidate.sections) ? candidate.sections : []
  if (!packageSections.length || new Set(packageSections.map((row) => sectionKey(row.sectionKey))).size !== packageSections.length) {
    add('PACKAGE_SECTION_MAPPING_INVALID', 'sections')
  }
  for (const section of packageSections) {
    const matches = uiSections.filter((row) => sectionKey(row.sectionKey) === sectionKey(section.sectionKey))
    if (!matches.length && isRuntimeManagedSection(section)) continue
    if (matches.length !== 1 || !text(section.runtimePath) || matches[0].runtimePath !== section.runtimePath
      || matches[0].isCustom === true || matches[0].source === 'CUSTOM'
      || (matches[0].sourcePackageKey && matches[0].sourcePackageKey !== pkg.packageKey)
      || (isRuntimeManagedSection(section) && matches[0].isVisible !== false)) {
      add('UI_CONTRACT_SECTION_MAPPING_INVALID', `sections.${section.sectionKey}`)
    }
  }
  for (const section of uiSections) {
    if (!packageSections.some((row) => sectionKey(row.sectionKey) === sectionKey(section.sectionKey))) {
      add('UI_CONTRACT_ORPHAN_SECTION', `sections.${section.sectionKey}`)
    }
  }
  const policyKeys = (pkg.workflowBindings || []).filter((row) => row.enabled === true).map((row) => row.policyKey)
  const policies = await read(WorkflowPolicy.find({ key: { $in: policyKeys }, status: 'ACTIVE' })
    .sort({ key: 1 }))
  for (const action of candidate.actions || []) {
    if (!text(action.governedAction) || !policies.some((policy) => policyKeys.includes(policy.key)
      && policy.status === 'ACTIVE' && policy.governedAction === action.governedAction
      && (!policy.frameworkKeys?.length || policy.frameworkKeys.includes(pkg.frameworkKey)))) {
      add('UI_CONTRACT_ACTION_POLICY_MISSING', `actions.${action.actionKey}`)
    }
  }
  const lifecyclePath = await read(RuntimePathRegistry.findOne({ pathKey: 'framework_state.lifecycle.stage', status: 'ACTIVE', frameworkKeys: pkg.frameworkKey }))
  if (!lifecyclePath || lifecyclePath.status !== 'ACTIVE'
    || !lifecyclePath.frameworkKeys?.includes(pkg.frameworkKey)
    || (candidate.lifecycleStages || []).some((stage) => !lifecyclePath.allowedValues?.includes(stage.stageKey))) {
    add('UI_CONTRACT_LIFECYCLE_STAGE_INVALID', 'lifecycleStages')
  }
  const lock = pkg.dependencyLock
  if (!lock || !['PASS', 'PASS_WITH_WARNINGS'].includes(lock.status) || lock.packageKey !== pkg.packageKey
    || lock.packageVersion !== pkg.version || !Array.isArray(lock.references)) {
    add('PACKAGE_DEPENDENCY_LOCK_INVALID', 'dependencyLock')
    return finish()
  }
  const refs = lock.references.filter((row) => row.collectionKey === 'RuntimeSkill')
  const skills = await read(RuntimeSkill.find({ stableId: { $in: refs.map((row) => row.id) } }).sort({ stableId: 1 }))
  const assets = await read(RuntimeSupportAsset.find({ packageKey: pkg.packageKey, packageVersion: pkg.version,
    ownerType: 'RuntimeSkill', status: 'ACTIVE', runtimeAccessible: true }).select('-content').sort({ assetKey: 1, _id: 1 }))
  for (const asset of assets) {
    if (!refs.some((ref) => ref.key === asset.ownerKey && skills.some((skill) => skill.stableId === ref.id && skill.key === ref.key))) {
      add('RUNTIME_SUPPORT_ASSET_OWNER_INVALID', 'dependencyLock')
    }
  }
  for (const ref of refs) {
    const matches = skills.filter((row) => row.stableId === ref.id)
    const skill = matches[0]
    if (refs.filter((row) => row.id === ref.id).length !== 1 || matches.length !== 1
      || skill.key !== ref.key || skill.status !== 'ACTIVE' || skill.versionStatus !== 'ACTIVE'
      || skill.isLocked !== true || skill.componentVersion !== ref.componentVersion
      || skill.lineageId !== ref.lineageId) {
      add('RUNTIME_SKILL_LOCK_MISMATCH', 'dependencyLock')
      continue
    }
    const references = (skill.referenceAssets || []).filter((row) => row.status === 'ACTIVE'
      && row.isRuntimeAccessible === true && row.isAdminOnly !== true && row.isTestOnly !== true)
    if (!references.length) continue
    for (const reference of references) {
      const filename = token(reference.storageKey).split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '')
      const matched = assets.filter((row) => row.packageKey === pkg.packageKey && row.packageVersion === pkg.version
        && row.ownerType === 'RuntimeSkill' && row.ownerKey === skill.key && row.status === 'ACTIVE'
        && row.runtimeAccessible === true && (text(reference.assetId)
          ? assetId(row.assetKey) === assetId(reference.assetId) : filename && token(row.assetKey) === filename))
      if (matched.length !== 1) add('RUNTIME_SUPPORT_ASSET_IDENTITY_INVALID', `skills.${skill.key}.referenceAssets`)
    }
  }
  return finish()
}
