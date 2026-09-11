import { beforeAll, afterAll, test, expect, jest } from '@jest/globals'
import mongoose from 'mongoose'
import FrameworkPackage from '../models/FrameworkPackage.js'
import UIContract from '../models/UIContract.js'
import Binding from '../models/FrameworkPackageDisplayBinding.js'
import AuditLog from '../models/AuditLog.js'
import RuntimePathRegistry from '../models/RuntimePathRegistry.js'
import { runUIContractDisplayCheckpoint } from '../services/uiContractDisplayCheckpointService.js'
import { applyFrameworkPackageDisplayBinding as apply, getFrameworkPackageDisplayBinding as get } from '../services/frameworkPackageDisplayBindingService.js'
import { selectRuntimeDisplayPin, resolveRuntimeUIContractKey } from '../services/runtimeDisplayBindingService.js'

const uri = process.env.SS009_TEST_MONGODB_URI
const integration = uri ? test : test.skip
let actor, sequence = 0
beforeAll(async () => {
  if (!uri) return
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/ss009_display_\d+\?replicaSet=ss009_display$/.test(uri)) throw new Error('Synthetic loopback database required')
  process.env.AUDIT_SIGNATURE_SECRET = 'synthetic-ss009-display-audit-secret'
  await mongoose.connect(uri)
  await Binding.init()
  actor = new mongoose.Types.ObjectId()
  await AuditLog.init()
  await RuntimePathRegistry.collection.insertOne({pathKey:'framework_state.lifecycle.stage',status:'ACTIVE',frameworkKeys:['WEBSITE'],allowedValues:[]})
})
afterAll(async () => { if (uri) { jest.restoreAllMocks(); await mongoose.disconnect() } })
const fixture = async () => {
  const key = `website-${++sequence}`
  const pkg = { _id: new mongoose.Types.ObjectId(), packageKey: key, version: `1.0.${sequence}`, frameworkKey: 'WEBSITE',
    status: 'ACTIVE', isLocked: true, uiContractKey: `${key}-old`,
    sections: [{ sectionKey: 'input', runtimePath: 'framework_state.sections.input' }], workflowBindings: [],
    dependencyLock: { status: 'PASS', packageKey: key, packageVersion: `1.0.${sequence}`, references: [] } }
  const source = { _id: new mongoose.Types.ObjectId(), uiContractKey: pkg.uiContractKey, stableId: `${key}-old`, status: 'ACTIVE',
    versionStatus: 'ACTIVE', isLocked: true, frameworkKeys: ['WEBSITE'], sourcePackageKey: key,
    sourcePackageVersion: `1.0.${sequence}`, compatibilityMode: 'STRICT', updatedAt: new Date(),
    sections: [{ sectionKey: 'input', runtimePath: 'framework_state.sections.input', label: 'Input', displayOrder: 0 }], lifecycleStages: [], actions: [] }
  const candidate = { ...source, _id: new mongoose.Types.ObjectId(), uiContractKey: `${key}-new`, stableId: `${key}-new`, isLocked: false,
    sections: [{ ...source.sections[0], label: 'Website input' }] }
  await FrameworkPackage.collection.insertOne(pkg)
  await UIContract.collection.insertMany([source, candidate])
  const checkpoint = await runUIContractDisplayCheckpoint({ packageId: key, uiContractKey: candidate.uiContractKey })
  expect(checkpoint.issues).toEqual([])
  const args = { packageId: key, actorUserId: actor, auditRequest: {}, payload: { uiContractKey: candidate.uiContractKey,
    expectedUiContractKey: source.uiContractKey, checkpointHash: checkpoint.checkpointHash } }
  return { pkg, source, candidate, args }
}
integration('real transaction locks candidate, preserves package/source, pins new only and rejects stale replay', async () => {
  const { pkg, source, candidate, args } = await fixture()
  const before = await FrameworkPackage.collection.findOne({ _id: pkg._id })
  expect((await get({ packageId: pkg.packageKey })).hasOverride).toBe(false)
  const result = await apply(args)
  expect(result).toMatchObject({ hasOverride: true, uiContractKey: candidate.uiContractKey })
  expect(await FrameworkPackage.collection.findOne({ _id: pkg._id })).toEqual(before)
  expect(await UIContract.collection.findOne({ _id: source._id })).toEqual(source)
  expect(await AuditLog.countDocuments({ resourceId: pkg._id, action: 'PACKAGE_METADATA_UPDATED' })).toBe(1)
  const locked = await UIContract.collection.findOne({ _id: candidate._id })
  expect(locked.isLocked).toBe(true)
  expect(locked.lockedByPackageKeys).toEqual([pkg.packageKey])
  expect(locked.updatedAt.getTime()).toBeGreaterThan(candidate.updatedAt.getTime())
  expect(await selectRuntimeDisplayPin({ packageId: pkg._id })).toBe(candidate.uiContractKey)
  expect(resolveRuntimeUIContractKey(pkg, {})).toBe(source.uiContractKey)
  expect(resolveRuntimeUIContractKey(pkg, { uiContractDisplayKey: 'retained-old-pin' })).toBe('retained-old-pin')
  await expect(apply(args)).rejects.toMatchObject({ details: { reason: 'DISPLAY_BINDING_STALE_CHECKPOINT' } })
})
integration('audit failure rolls back candidate lock and first binding insert in MongoDB', async () => {
  const { pkg, candidate, args } = await fixture()
  const original = AuditLog.createLog
  const failure = jest.spyOn(AuditLog, 'createLog').mockImplementationOnce(async function (...values) {
    await original.apply(this, values)
    throw new Error('audit unavailable')
  })
  try { await expect(apply(args)).rejects.toThrow('audit unavailable') } finally { failure.mockRestore() }
  expect(await AuditLog.countDocuments({ resourceId: pkg._id })).toBe(0)
  expect(await Binding.findOne({ packageId: pkg._id }).lean()).toBeNull()
  expect(await UIContract.collection.findOne({ _id: candidate._id })).toEqual(candidate)
})
integration('competing first binds permit exactly one success and preserve unique package identity', async () => {
  const { pkg, args } = await fixture()
  const results = await Promise.allSettled([apply(args), apply(args)])
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
  expect(await Binding.countDocuments({ packageId: pkg._id })).toBe(1)
  await expect(Binding.create({ packageId: pkg._id, uiContractKey: 'duplicate', createdBy: actor, updatedBy: actor })).rejects.toMatchObject({ code: 11000 })
})
integration('candidate changed after checkpoint and stale expected binding fail without writes', async () => {
  const { pkg, candidate, args } = await fixture()
  await expect(apply({ ...args, payload: { ...args.payload, expectedUiContractKey: 'stale-key' } }))
    .rejects.toMatchObject({ details: { reason: 'DISPLAY_BINDING_STALE_BINDING' } })
  await UIContract.collection.updateOne({ _id: candidate._id }, { $set: { name: 'Changed' } })
  await expect(apply(args)).rejects.toMatchObject({ details: { reason: 'DISPLAY_BINDING_STALE_CHECKPOINT' } })
  expect(await Binding.countDocuments({ packageId: pkg._id })).toBe(0)
})

const nextCandidate = async ({ pkg, candidate, args }, suffix) => {
  const next = { ...candidate, _id: new mongoose.Types.ObjectId(), uiContractKey: `${pkg.packageKey}-${suffix}`,
    stableId: `${pkg.packageKey}-${suffix}` }
  await UIContract.collection.insertOne(next)
  const checkpoint = await runUIContractDisplayCheckpoint({ packageId: pkg.packageKey, uiContractKey: next.uiContractKey })
  expect(checkpoint.compatible).toBe(true)
  return { ...args, payload: { uiContractKey: next.uiContractKey, expectedUiContractKey: candidate.uiContractKey,
    checkpointHash: checkpoint.checkpointHash } }
}

integration('competing updates of an existing binding permit one winner and preserve creation provenance', async () => {
  const f = await fixture()
  await apply(f.args)
  const before = await Binding.findOne({ packageId: f.pkg._id }).lean()
  const left = await nextCandidate(f, 'left')
  const right = await nextCandidate(f, 'right')
  const results = await Promise.allSettled([apply(left), apply(right)])
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
  const current = await Binding.findOne({ packageId: f.pkg._id }).lean()
  expect(current.createdAt).toEqual(before.createdAt)
  expect(current.createdBy).toEqual(before.createdBy)
  expect(current.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
  expect(await AuditLog.countDocuments({ resourceId: f.pkg._id })).toBe(2)
})

integration.each(['candidate-cas', 'binding-cas', 'binding-unique-race'])('fails closed for %s after checkpoint validation', async (failure) => {
  const f = await fixture()
  let args = f.args
  if (failure === 'binding-cas') {
    await apply(args)
    args = await nextCandidate(f, 'cas')
  }
  const beforeBinding = await Binding.findOne({ packageId: f.pkg._id }).lean()
  const beforeCandidate = await UIContract.findOne({ uiContractKey: args.payload.uiContractKey }).lean()
  const beforeAudits = await AuditLog.countDocuments({ resourceId: f.pkg._id })
  const spy = failure === 'candidate-cas' ? jest.spyOn(UIContract, 'updateOne').mockResolvedValueOnce({ modifiedCount: 0 })
    : failure === 'binding-cas' ? jest.spyOn(Binding, 'updateOne').mockResolvedValueOnce({ modifiedCount: 0 })
      : jest.spyOn(Binding, 'create').mockRejectedValueOnce(Object.assign(new Error('race'), { code: 11000 }))
  try {
    await expect(apply(args)).rejects.toMatchObject({ status: 409, code: 'CONFLICT', details: {
      reason: failure === 'candidate-cas' ? 'DISPLAY_BINDING_STALE_CANDIDATE' : 'DISPLAY_BINDING_STALE_BINDING',
    } })
  } finally { spy.mockRestore() }
  expect(await Binding.findOne({ packageId: f.pkg._id }).lean()).toEqual(beforeBinding)
  expect(await UIContract.findOne({ uiContractKey: args.payload.uiContractKey }).lean()).toEqual(beforeCandidate)
  expect(await AuditLog.countDocuments({ resourceId: f.pkg._id })).toBe(beforeAudits)
})

integration('rejects incompatible candidate, no change and missing package; no successful audit', async () => {
  const f = await fixture()
  const checkpoint = await runUIContractDisplayCheckpoint({ packageId: f.pkg.packageKey, uiContractKey: f.source.uiContractKey })
  await expect(apply({ ...f.args, payload: { ...f.args.payload, uiContractKey: f.source.uiContractKey,
    checkpointHash: checkpoint.checkpointHash } })).rejects.toMatchObject({ details: { reason: 'DISPLAY_BINDING_NO_CHANGE' } })
  await UIContract.collection.updateOne({ _id: f.candidate._id }, { $set: { 'sections.0.runtimePath': 'framework_state.sections.other' } })
  await expect(apply(f.args)).rejects.toMatchObject({ details: { reason: 'DISPLAY_BINDING_INCOMPATIBLE' } })
  await expect(get({ packageId: 'missing-package' })).rejects.toMatchObject({ status: 404 })
  expect(await AuditLog.countDocuments({ resourceId: f.pkg._id })).toBe(0)
})

integration('unavailable selected display contract fails closed while legacy absence remains valid', async () => {
  const f = await fixture()
  expect(await selectRuntimeDisplayPin({ packageId: f.pkg._id })).toBeUndefined()
  await apply(f.args)
  await UIContract.collection.updateOne({ _id: f.candidate._id }, { $set: { status: 'DEPRECATED' } })
  await expect(selectRuntimeDisplayPin({ packageId: f.pkg._id })).rejects.toMatchObject({ status: 409,
    details: { reason: 'DISPLAY_BINDING_CANDIDATE_UNAVAILABLE' } })
})
