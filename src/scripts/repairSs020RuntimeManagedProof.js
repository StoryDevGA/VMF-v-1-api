import crypto from 'node:crypto'
import path from 'node:path'
import mongoose from 'mongoose'
import { fileURLToPath } from 'node:url'
import { connectDb, disconnectDb } from '../config/db.js'
import FrameworkPackage from '../models/FrameworkPackage.js'
import RuntimeStateSection from '../models/RuntimeStateSection.js'
import RuntimeInstance from '../models/RuntimeInstance.js'
import {
  buildRuntimeManagedSourceReceipt,
  evaluateRuntimeManagedSections,
} from '../services/runtimeManagedSectionService.js'
import { buildAcceptedSectionTruth } from '../services/runtimeStateMutationService.js'
import {
  buildReasoningArtefactOutputs,
  resolvePackageReasoningArtefacts,
} from '../services/reasoningArtefactContractService.js'
import { validateRuntimeManagedSectionDeclarations } from '../services/runtimeManagedSectionContract.js'
import { evaluateRuntimeSectionTruthReadiness } from '../services/runtimeSectionTruthReadinessService.js'

const DEFAULT_RUNTIME_KEY = 'ss020-parlon-v316-smoke-mtshxqn6'
const SOURCE_KEYS = new Set(['strategic-objectives', 'current-state-assessment', 'evidence-register'])
const PROOF_FIELDS = new Set(['runtimeManagedSourceReceipt', 'reasoningArtefactReceipts'])
const ACCEPTED_PROOF_FIELDS = new Set(['truthHash', 'reasoningArtefactReceipts'])

const parseArgs = (argv = process.argv.slice(2)) => {
  const options = { runtimeKey: DEFAULT_RUNTIME_KEY, apply: false, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--runtime-key') options.runtimeKey = String(argv[++index] || '').trim()
    else if (arg === '--apply') options.apply = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

const clone = (value) => JSON.parse(JSON.stringify(value))
const canonical = (value) => JSON.stringify(value ?? null, (_key, entry) => entry instanceof mongoose.Types.ObjectId ? String(entry) : entry)
const hash = (value) => crypto.createHash('sha256').update(canonical(value)).digest('hex')
const digestRows = (rows = []) => hash([...rows]
  .map((row) => {
    const next = clone(row)
    delete next.createdAt
    delete next.updatedAt
    delete next.__v
    return next
  })
  .sort((left, right) => String(left._id).localeCompare(String(right._id))))
const sectionStateKey = (section) => String(section.runtimePath || section.sectionKey || '').split('.').at(-1)
const normalizedSectionKey = (value) => String(value || '').trim().toLowerCase().replaceAll('_', '-')
const isSourceRow = (row) => SOURCE_KEYS.has(normalizedSectionKey(row?.sectionKey))
const outputSection = (frameworkPackage) => frameworkPackage.sections.find((section) => section.sectionKey === 'output-requirements')

const stripProofFields = (value, fields) => {
  const next = clone(value)
  for (const field of fields) delete next[field]
  return next
}

const buildPlan = ({ runtime, frameworkPackage }) => {
  const managed = validateRuntimeManagedSectionDeclarations(frameworkPackage)
  const output = outputSection(frameworkPackage)
  if (!output?.runtimeManagedCompletion) throw new Error('The active package has no runtime-managed completion declaration.')
  const declaredSources = new Set(output.runtimeManagedCompletion.sourceSectionKeys)
  if (declaredSources.size !== SOURCE_KEYS.size || [...declaredSources].some((key) => !SOURCE_KEYS.has(key))) {
    throw new Error('SS-020 proof repair is bounded to the three declared 3.1.6 source sections.')
  }
  const beforeState = clone(runtime.framework_state || {})
  const nextState = clone(beforeState)
  const changes = []
  for (const section of frameworkPackage.sections.filter((item) => declaredSources.has(item.sectionKey))) {
    const stateKey = sectionStateKey(section)
    const current = nextState.sections?.[stateKey]
    const generated = current?.generated
    const accepted = current?.accepted
    if (!generated || !accepted || current.review?.status !== 'ACCEPTED') {
      throw new Error(`Source section ${section.sectionKey} is not already accepted and cannot be proof-repaired.`)
    }
    const declarations = resolvePackageReasoningArtefacts({
      frameworkPackage,
      sectionKey: section.sectionKey,
      actionKey: 'GENERATE_SECTION',
    })
    const artefacts = buildReasoningArtefactOutputs({
      candidate: {
        sectionIntelligence: generated.sectionIntelligence || generated.reasoningArtefacts,
        reasoningArtefacts: generated.reasoningArtefacts,
      },
      declarations,
      packageKey: frameworkPackage.packageKey,
      packageVersion: frameworkPackage.version,
      sectionKey: section.sectionKey,
      stateSectionKey: stateKey,
      inputHash: generated.inputHash,
      evidenceHash: generated.evidenceHash,
      dependencyHash: generated.dependencyHash,
      sectionContractHash: generated.generator?.sectionContractHash,
      generatedAt: generated.generatedAt,
      now: generated.generatedAt,
    })
    const nextGenerated = {
      ...generated,
      sectionIntelligence: {
        ...(generated.sectionIntelligence || {}),
        ...(generated.reasoningArtefacts || {}),
      },
      reasoningArtefactReceipts: artefacts.receipts,
    }
    nextGenerated.runtimeManagedSourceReceipt = buildRuntimeManagedSourceReceipt({
      frameworkPackage,
      frameworkState: nextState,
      section,
      generated: nextGenerated,
    })
    const nextAccepted = buildAcceptedSectionTruth({
      actorUserId: accepted.acceptedBy,
      acceptedAt: accepted.acceptedAt,
      generated: nextGenerated,
      sectionKey: section.sectionKey,
      runtimePath: section.runtimePath,
    })
    nextAccepted.revisions = accepted.revisions || []
    nextState.sections[stateKey] = {
      ...current,
      generated: nextGenerated,
      accepted: nextAccepted,
      state: {
        ...current.state,
        acceptedTruthHash: nextAccepted.truthHash,
        acceptedSourceGeneratedAt: nextAccepted.sourceGeneratedAt,
      },
    }
    changes.push({
      sectionKey: section.sectionKey,
      artefactKeys: Object.keys(artefacts.receipts).sort(),
      generatedAt: generated.generatedAt,
      sourceReceiptHash: hash(nextGenerated.runtimeManagedSourceReceipt),
      acceptedTruthHash: nextAccepted.truthHash,
    })
  }
  const beforeProtected = {
    status: runtime.status,
    executionStatus: runtime.executionStatus,
    packageId: String(runtime.packageId),
    packageKey: runtime.packageKey,
    packageVersion: runtime.packageVersion,
    lifecycle: beforeState.lifecycle,
    readiness: beforeState.readiness,
    publish: beforeState.publish,
    lock: beforeState.lock,
    nonSourceState: Object.fromEntries(Object.entries(beforeState).filter(([key]) => key !== 'sections')),
  }
  const afterProtected = {
    ...beforeProtected,
    nonSourceState: Object.fromEntries(Object.entries(nextState).filter(([key]) => key !== 'sections')),
  }
  if (hash(beforeProtected.nonSourceState) !== hash(afterProtected.nonSourceState)) throw new Error('Proof repair changed a framework_state root outside sections.')
  return { beforeState, nextState, changes, beforeProtected }
}

const buildV2Plan = ({ runtime, currentRows, historicalRows, nextState }) => {
  const stateVersion = String(runtime.stateVersion || '').trim()
  if (!stateVersion) throw new Error('SS-020 proof repair requires a runtime state version.')
  if (!Array.isArray(currentRows) || currentRows.length === 0) {
    throw new Error('SS-020 proof repair requires current Runtime State V2 section rows.')
  }
  if (currentRows.some((row) => row.current !== true
    || String(row.stateVersion || '') !== stateVersion
    || String(row.sourceStateVersion || '') !== stateVersion
    || row.projectionReceipt?.sourceHash !== row.sourceHash
    || row.projectionReceipt?.stateVersion !== row.stateVersion)) {
    throw new Error('SS-020 proof repair found contradictory current Runtime State V2 section lineage.')
  }

  const sourceRows = currentRows.filter(isSourceRow)
  if (sourceRows.length !== SOURCE_KEYS.size) {
    throw new Error('SS-020 proof repair requires exactly the three declared source rows in Runtime State V2.')
  }

  const nextRows = sourceRows.map((row) => {
    const nextSection = nextState.sections?.[row.sectionKey]
    if (!nextSection) throw new Error(`Runtime State V2 source row ${row.sectionKey} has no repaired legacy section.`)
    const nextDetail = {
      ...clone(row.sectionDetail || {}),
      ...clone(nextSection),
    }
    const accepted = nextDetail.accepted || {}
    const generated = nextDetail.generated || {}
    return {
      ...clone(row),
      stateStatus: 'ACCEPTED',
      truthStatus: String(accepted.truthStatus || row.truthStatus || '').trim().toUpperCase(),
      truthHash: accepted.truthHash || row.truthHash || '',
      contentHash: accepted.contentHash || generated.contentHash || row.contentHash || '',
      summary: accepted.summary || generated.summary || row.summary || '',
      sectionDetail: nextDetail,
    }
  })

  return {
    stateVersion,
    beforeDigest: digestRows(sourceRows),
    afterDigest: digestRows(nextRows),
    historicalDigest: digestRows((historicalRows || []).filter((row) => row.current !== true)),
    currentRowCount: currentRows.length,
    changes: nextRows.map((row) => ({
      _id: String(row._id),
      sectionKey: row.sectionKey,
      beforeTruthHash: sourceRows.find((before) => String(before._id) === String(row._id))?.truthHash || '',
      afterTruthHash: row.truthHash,
      beforeSectionDetailHash: hash(sourceRows.find((before) => String(before._id) === String(row._id))?.sectionDetail || {}),
      afterSectionDetailHash: hash(row.sectionDetail || {}),
    })),
    nextRows,
  }
}

const repair = async ({ runtimeKey = DEFAULT_RUNTIME_KEY, apply = false, json = false, logger = console.log } = {}) => {
  await connectDb()
  try {
    const runtime = await RuntimeInstance.findOne({ runtimeInstanceKey: runtimeKey }).lean()
    if (!runtime) throw new Error(`Runtime not found: ${runtimeKey}`)
    const frameworkPackage = await FrameworkPackage.findById(runtime.packageId).lean()
    if (!frameworkPackage) throw new Error(`Framework Package not found for runtime: ${runtimeKey}`)
    if (frameworkPackage.version !== '3.1.6' || frameworkPackage.frameworkKey !== 'VMF') throw new Error('SS-020 proof repair requires the VMF 3.1.6 runtime package.')
    const plan = buildPlan({ runtime, frameworkPackage })
    const allV2Rows = await RuntimeStateSection.find({ runtimeInstanceId: runtime._id }).lean()
    const currentV2Rows = allV2Rows.filter((row) => row.current === true)
    const v2Plan = buildV2Plan({
      runtime,
      currentRows: currentV2Rows,
      historicalRows: allV2Rows,
      nextState: plan.nextState,
    })
    if (apply) {
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          const current = await RuntimeInstance.findOne({ runtimeInstanceKey: runtimeKey }).session(session).lean()
          if (!current || hash(current.framework_state) !== hash(plan.beforeState)) throw new Error('Runtime drifted after dry-run; proof repair aborted.')
          const currentV2RowsInTransaction = await RuntimeStateSection.find({
            runtimeInstanceId: current._id,
            current: true,
          }).session(session).lean()
          const currentV2AllRowsInTransaction = await RuntimeStateSection.find({
            runtimeInstanceId: current._id,
          }).session(session).lean()
          if (digestRows(currentV2RowsInTransaction.filter(isSourceRow)) !== v2Plan.beforeDigest
            || digestRows(currentV2AllRowsInTransaction.filter((row) => row.current !== true)) !== v2Plan.historicalDigest) {
            throw new Error('Runtime State V2 drifted after dry-run; proof repair aborted.')
          }
          for (const nextRow of v2Plan.nextRows) {
            const document = await RuntimeStateSection.findOne({
              _id: nextRow._id,
              runtimeInstanceId: current._id,
              stateVersion: v2Plan.stateVersion,
              sourceStateVersion: v2Plan.stateVersion,
              current: true,
            }).session(session)
            if (!document || hash(document.toObject({ depopulate: true })) !== hash(currentV2RowsInTransaction.find((row) => String(row._id) === String(nextRow._id)))) {
              throw new Error(`Runtime State V2 row ${nextRow.sectionKey} drifted during proof repair.`)
            }
            document.set({
              stateStatus: nextRow.stateStatus,
              truthStatus: nextRow.truthStatus,
              truthHash: nextRow.truthHash,
              contentHash: nextRow.contentHash,
              summary: nextRow.summary,
              sectionDetail: nextRow.sectionDetail,
            })
            await document.save({ session })
          }
          const document = await RuntimeInstance.findOne({ runtimeInstanceKey: runtimeKey }).session(session)
          document.framework_state = plan.nextState
          await document.save({ session })
          const after = await RuntimeInstance.findOne({ runtimeInstanceKey: runtimeKey }).session(session).lean()
          if (!after || hash(after.framework_state) !== hash(plan.nextState)) throw new Error('Proof repair readback mismatch; transaction rolled back.')
          const afterV2RowsInTransaction = await RuntimeStateSection.find({
            runtimeInstanceId: current._id,
            current: true,
          }).session(session).lean()
          const afterV2AllRowsInTransaction = await RuntimeStateSection.find({
            runtimeInstanceId: current._id,
          }).session(session).lean()
          if (digestRows(afterV2RowsInTransaction.filter(isSourceRow)) !== v2Plan.afterDigest
            || digestRows(afterV2AllRowsInTransaction.filter((row) => row.current !== true)) !== v2Plan.historicalDigest) {
            throw new Error('Runtime State V2 proof repair readback mismatch; transaction rolled back.')
          }
        })
      } finally {
        await session.endSession()
      }
    }
    const readback = await RuntimeInstance.findOne({ runtimeInstanceKey: runtimeKey }).lean()
    const readbackPackage = await FrameworkPackage.findById(readback.packageId).lean()
    const readiness = evaluateRuntimeSectionTruthReadiness({
      frameworkPackage: readbackPackage,
      frameworkState: apply ? readback.framework_state : plan.nextState,
    })
    const result = {
      mode: apply ? 'apply' : 'dry-run',
      applied: apply,
      runtimeKey,
      runtimeId: String(runtime._id),
      packageKey: frameworkPackage.packageKey,
      packageVersion: frameworkPackage.version,
      changes: plan.changes,
      runtimeStateV2: {
        stateVersion: v2Plan.stateVersion,
        currentRowCount: v2Plan.currentRowCount,
        beforeDigest: v2Plan.beforeDigest,
        afterDigest: v2Plan.afterDigest,
        historicalDigest: v2Plan.historicalDigest,
        changes: v2Plan.changes,
      },
      readiness: {
        state: readiness.state,
        publishEligible: readiness.publishEligible,
        requiredSectionCount: readiness.requiredSectionCount,
        readySectionCount: readiness.readySectionCount,
        blockingSectionCount: readiness.blockingSectionCount,
        blockers: readiness.blockers,
        runtimeManaged: readiness.runtimeManaged,
      },
      lifecyclePreserved: hash(plan.beforeProtected.lifecycle) === hash(readback.framework_state.lifecycle)
        && hash(plan.beforeProtected.readiness) === hash(readback.framework_state.readiness)
        && hash(plan.beforeProtected.publish) === hash(readback.framework_state.publish)
        && hash(plan.beforeProtected.lock) === hash(readback.framework_state.lock),
      packageIdentityPreserved: String(readback.packageId) === String(runtime.packageId)
        && readback.packageKey === runtime.packageKey
        && readback.packageVersion === runtime.packageVersion,
    }
    logger(json ? JSON.stringify(result, null, 2) : `${apply ? 'Applied' : 'Planned'} SS-020 runtime-managed proof repair for ${runtimeKey}.`)
    return result
  } finally {
    await disconnectDb()
  }
}

const main = () => {
  const options = parseArgs()
  if (options.help) {
    console.log('Usage: node repairSs020RuntimeManagedProof.js [--runtime-key <key>] [--apply] [--json]')
    return
  }
  repair(options).catch((error) => { console.error(error.message); process.exitCode = 1 })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

export { buildPlan, buildV2Plan, parseArgs, repair }
