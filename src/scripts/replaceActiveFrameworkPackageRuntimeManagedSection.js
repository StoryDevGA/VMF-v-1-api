import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { fileURLToPath } from 'node:url'
import { connectDb, disconnectDb } from '../config/db.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import UIContract from '../models/UIContract.js'
import RuntimePathRegistry from '../models/RuntimePathRegistry.js'
import WorkflowPolicy from '../models/WorkflowPolicy.js'
import RuntimeActivationSnapshot from '../models/RuntimeActivationSnapshot.js'
import RuntimeDeployment from '../models/RuntimeDeployment.js'
import { validateRuntimeManagedSectionDeclarations } from '../services/runtimeManagedSectionContract.js'

const DEFAULT_PACKAGE_KEY = 'standard-package-value-mapping-framework-3-1-6-runtime-knowledge-model'
const DEFAULT_UI_CONTRACT_KEY = 'standard-ui-contract-vmf-3-1-1-rkm-canonical'
const OUTPUT_SECTION_KEY = 'output-requirements'

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = { apply: false, json: false, seedDir: '', packageKey: DEFAULT_PACKAGE_KEY, uiContractKey: DEFAULT_UI_CONTRACT_KEY }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--json') args.json = true
    else if (arg === '--seed-dir') args.seedDir = path.resolve(argv[++index] || '')
    else if (arg === '--package-key') args.packageKey = String(argv[++index] || '').trim()
    else if (arg === '--ui-contract-key') args.uiContractKey = String(argv[++index] || '').trim()
    else if (arg === '--help' || arg === '-h') args.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!args.help && !args.seedDir) throw new Error('--seed-dir is required.')
  return args
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const plain = (value) => value?.toObject ? value.toObject({ depopulate: true }) : value
const canonical = (value) => JSON.stringify(value, (key, entry) => {
  if (['createdAt', 'updatedAt', 'lockedAt', 'resolvedAt', 'activatedAt', 'lastActivatedAt'].includes(key)) return undefined
  return entry
})
const hash = (value) => crypto.createHash('sha256').update(canonical(value)).digest('hex')
const collectionFingerprint = (rows = []) => hash(rows
  .map((row) => plain(row))
  .sort((left, right) => String(left?._id || '').localeCompare(String(right?._id || ''))))
const sectionByKey = (record, sectionKey) => record?.sections?.find((section) => section.sectionKey === sectionKey)
const identity = (record) => ({
  id: String(record?._id || ''),
  packageKey: record?.packageKey,
  frameworkKey: record?.frameworkKey,
  version: record?.version,
  status: record?.status,
  versionStatus: record?.versionStatus,
  isDefault: record?.isDefault,
  isLocked: record?.isLocked,
  uiContractKey: record?.uiContractKey,
  dependencySnapshotId: record?.dependencyLock?.snapshotId,
  dependencySnapshotHash: record?.dependencyLock?.snapshotHash,
})

const captureProtectedState = async ({ packageId, session } = {}) => {
  const query = (model, filter = {}) => {
    const request = model.find(filter).lean()
    return session ? request.session(session) : request
  }
  const [runtimePaths, workflowPolicies, activationSnapshots, deployments] = await Promise.all([
    query(RuntimePathRegistry),
    query(WorkflowPolicy),
    query(RuntimeActivationSnapshot, { packageId }),
    query(RuntimeDeployment, { packageId }),
  ])
  return {
    runtimePathCount: runtimePaths.length,
    runtimePathHash: collectionFingerprint(runtimePaths),
    workflowPolicyCount: workflowPolicies.length,
    workflowPolicyHash: collectionFingerprint(workflowPolicies),
    activationSnapshotCount: activationSnapshots.length,
    activationSnapshotHash: collectionFingerprint(activationSnapshots),
    deploymentCount: deployments.length,
    deploymentHash: collectionFingerprint(deployments),
  }
}

const assertProtectedStateUnchanged = (before, after) => {
  const fields = [
    'runtimePathCount', 'runtimePathHash',
    'workflowPolicyCount', 'workflowPolicyHash',
    'activationSnapshotCount', 'activationSnapshotHash',
    'deploymentCount', 'deploymentHash',
  ]
  const changed = fields.filter((field) => before[field] !== after[field])
  if (changed.length > 0) throw new Error(`Protected runtime state changed during bounded replacement: ${changed.join(', ')}`)
}

const loadSeed = (seedDir) => {
  const packageRecord = readJson(path.join(seedDir, '02_seed_data/framework_package.json'))
  const uiContract = readJson(path.join(seedDir, '02_seed_data/ui_contract.json'))
  const outputSection = sectionByKey(packageRecord, OUTPUT_SECTION_KEY)
  const outputUiSection = sectionByKey(uiContract, OUTPUT_SECTION_KEY)
  if (!outputSection || !outputUiSection) throw new Error('Seed does not contain Output Requirements in both package and UI contract.')
  validateRuntimeManagedSectionDeclarations(packageRecord)
  if (outputSection.required !== true || outputSection.sectionMode !== 'RUNTIME_MANAGED' || outputSection.runtimeRole !== 'OUTPUT') {
    throw new Error('Seed Output Requirements does not satisfy the runtime-managed package contract.')
  }
  if (outputUiSection.isVisible !== false || outputUiSection.isEditable !== false || outputUiSection.isReadOnlyDisplay !== true) {
    throw new Error('Seed Output Requirements UI contract is not hidden, non-editable and read-only.')
  }
  return { packageRecord, uiContract, outputSection, outputUiSection }
}

const assertTarget = ({ packageRecord, uiContract, targetPackage, targetUiContract, options }) => {
  if (!targetPackage) throw new Error(`Target package not found: ${options.packageKey}`)
  if (!targetUiContract) throw new Error(`Target UI Contract not found: ${options.uiContractKey}`)
  if (targetPackage.packageKey !== options.packageKey || packageRecord.packageKey !== options.packageKey) throw new Error('Package identity does not match the requested target.')
  if (targetPackage.frameworkKey !== packageRecord.frameworkKey || targetPackage.version !== packageRecord.version) throw new Error('Framework/version identity drift detected.')
  if (targetPackage.status !== 'ACTIVE' || targetPackage.isLocked !== true) throw new Error('Target package must remain ACTIVE and locked.')
  if (uiContract.uiContractKey !== options.uiContractKey || targetUiContract.uiContractKey !== options.uiContractKey) throw new Error('UI Contract identity does not match the requested target.')
  if (targetPackage.uiContractKey !== options.uiContractKey) throw new Error('Target package UI Contract binding is not the requested canonical identity.')
}

const buildPlan = ({ seed, targetPackage, targetUiContract, options }) => {
  const beforePackage = plain(targetPackage)
  const beforeUiContract = plain(targetUiContract)
  const nextPackageSections = beforePackage.sections.map((section) => section.sectionKey === OUTPUT_SECTION_KEY ? seed.outputSection : section)
  const nextUiSections = beforeUiContract.sections.map((section) => section.sectionKey === OUTPUT_SECTION_KEY ? seed.outputUiSection : section)
  const nextPackage = { ...beforePackage, sections: nextPackageSections }
  const nextUiContract = { ...beforeUiContract, sections: nextUiSections }
  const changedPackageFields = Object.keys(beforePackage).filter((field) => hash(beforePackage[field]) !== hash(nextPackage[field]))
  const changedUiFields = Object.keys(beforeUiContract).filter((field) => hash(beforeUiContract[field]) !== hash(nextUiContract[field]))
  if (changedPackageFields.some((field) => field !== 'sections') || changedUiFields.some((field) => field !== 'sections')) throw new Error('Bounded replacement would change fields outside sections.')
  const beforeGuided = beforePackage.sections.filter((section) => section.sectionKey !== OUTPUT_SECTION_KEY)
  const afterGuided = nextPackage.sections.filter((section) => section.sectionKey !== OUTPUT_SECTION_KEY)
  if (hash(beforeGuided) !== hash(afterGuided)) throw new Error('Guided package sections changed unexpectedly.')
  if (hash(beforePackage.reasoningArtefacts) !== hash(nextPackage.reasoningArtefacts)) throw new Error('Package reasoning artefacts changed unexpectedly.')
  if (hash(beforePackage.dependencyLock) !== hash(nextPackage.dependencyLock)) throw new Error('Dependency lock would change; refusing bounded replacement.')
  return {
    mode: 'dry-run',
    seedDir: options.seedDir,
    target: identity(targetPackage),
    uiContract: { id: String(targetUiContract._id), key: targetUiContract.uiContractKey, status: targetUiContract.status, versionStatus: targetUiContract.versionStatus },
    changedPackageFields,
    changedUiFields,
    beforeOutputSection: sectionByKey(beforePackage, OUTPUT_SECTION_KEY),
    afterOutputSection: seed.outputSection,
    beforeOutputUiSection: sectionByKey(beforeUiContract, OUTPUT_SECTION_KEY),
    afterOutputUiSection: seed.outputUiSection,
    dependencyLockPreserved: true,
    activationMetadataPreserved: true,
    writes: ['FrameworkPackage.sections[output-requirements]', 'UIContract.sections[output-requirements]'],
    prohibitedWrites: ['RuntimePathRegistry', 'WorkflowPolicy', 'dependencyLock', 'runtimeActivation', 'runtimeActivationSnapshot', 'RuntimeDeployment'],
    expectedPackageHash: hash(beforePackage),
    expectedUiContractHash: hash(beforeUiContract),
  }
}

const replaceActiveRuntimeManagedSection = async ({ apply = false, json = false, logger = console.log, ...options } = {}) => {
  const seed = loadSeed(options.seedDir)
  await connectDb()
  try {
    const targetPackage = await FrameworkPackage.findOne({ packageKey: options.packageKey }).lean()
    const targetUiContract = await UIContract.findOne({ uiContractKey: options.uiContractKey }).lean()
    assertTarget({ packageRecord: seed.packageRecord, uiContract: seed.uiContract, targetPackage, targetUiContract, options })
    const plan = buildPlan({ seed, targetPackage, targetUiContract, options })
    const protectedBefore = await captureProtectedState({ packageId: targetPackage._id })
    if (apply) {
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          const currentPackageLean = await FrameworkPackage.findOne({ packageKey: options.packageKey }).session(session).lean()
          const currentUiContractLean = await UIContract.findOne({ uiContractKey: options.uiContractKey }).session(session).lean()
          if (!currentPackageLean || !currentUiContractLean || hash(currentPackageLean) !== plan.expectedPackageHash || hash(currentUiContractLean) !== plan.expectedUiContractHash) {
            throw new Error('Target drifted after dry-run; bounded replacement aborted.')
          }
          const currentPackage = await FrameworkPackage.findOne({ packageKey: options.packageKey }).session(session)
          const currentUiContract = await UIContract.findOne({ uiContractKey: options.uiContractKey }).session(session)
          currentPackage.sections = currentPackage.sections.map((section) => section.sectionKey === OUTPUT_SECTION_KEY ? seed.outputSection : section)
          currentUiContract.sections = currentUiContract.sections.map((section) => section.sectionKey === OUTPUT_SECTION_KEY ? seed.outputUiSection : section)
          currentPackage.$locals.allowLockedRuntimeControlWrite = true
          currentUiContract.$locals.allowLockedRuntimeControlWrite = true
          await currentPackage.save({ session })
          await currentUiContract.save({ session })
          const protectedAfter = await captureProtectedState({ packageId: currentPackage._id, session })
          assertProtectedStateUnchanged(protectedBefore, protectedAfter)
        })
      } finally {
        await session.endSession()
      }
    }
    const protectedAfter = await captureProtectedState({ packageId: targetPackage._id })
    if (apply) assertProtectedStateUnchanged(protectedBefore, protectedAfter)
    const result = {
      ...plan,
      mode: apply ? 'apply' : 'dry-run',
      applied: apply,
      protectedStateBefore: protectedBefore,
      protectedStateAfter: protectedAfter,
      protectedStatePreserved: true,
      transactionRollbackOnProtectedStateDrift: true,
    }
    logger(json ? JSON.stringify(result, null, 2) : `${apply ? 'Applied' : 'Planned'} bounded Runtime-Managed section replacement for ${options.packageKey}.`)
    return result
  } finally {
    await disconnectDb()
  }
}

const main = () => {
  const options = parseArgs()
  if (options.help) {
    console.log('Usage: node replaceActiveFrameworkPackageRuntimeManagedSection.js --seed-dir <dir> [--apply] [--json]')
    return
  }
  replaceActiveRuntimeManagedSection(options).catch((error) => { console.error(error.message); process.exitCode = 1 })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

export { buildPlan, loadSeed, parseArgs, replaceActiveRuntimeManagedSection }
