import { describe, expect, test } from '@jest/globals'
import FrameworkPackage from '../models/FrameworkPackage.js'
import { discoveryPolicySchema, inspectDiscoveryPolicy, discoveryPolicyReadinessDetails, discoveryPolicySnapshot, resolvePackageDiscoveryPolicy,
  permitsLocalDiscoveryCandidateAcquisition } from '../services/discoveryPolicyContract.js'
import { normalizeRuntimeActivationReadiness } from '../services/runtimeActivation/runtimeActivationService.js'

const identity = () => ({ contractVersion: 'framework-package-discovery-policy-v1', policyKey: 'discovery-test', policyVersion: '1.0.0' })
const policy = () => ({ ...identity(), evidencePolicy: { ownerMappings: [{ mappingKey: 'evidence', vmfCapabilityRef: 'unconfirmed-evidence', ownerRuntime: 'unconfirmed-owner', resultType: 'unconfirmed-result' }] } })
const packageInput = (status = 'DRAFT') => ({ frameworkKey: 'TEST', frameworkName: 'Test', version: '1.0.0', packageKey: 'test-1-0-0', status, createdBy: '507f1f77bcf86cd799439011', updatedBy: '507f1f77bcf86cd799439011', discoveryPolicy: policy() })

describe('installed local candidate acquisition boundary', () => {
  const resolution = { status: 'CONFIGURED_LOCAL', resolvedReferences: [{ path: 'discoveryPolicy.evidencePolicy.ownerMappings.0' }], unresolvedReferences: [] }
  const allowed = changes => permitsLocalDiscoveryCandidateAcquisition({ frameworkPackage: { discoveryPolicy: { ...policy(), ...changes } }, resolution })
  test('only the minimal quality binding permits the existing candidate producer', () => {
    expect(allowed({})).toBe(true)
    expect(permitsLocalDiscoveryCandidateAcquisition({ frameworkPackage: { discoveryPolicy: policy() }, resolution: { ...resolution, status: 'BLOCKED' } })).toBe(false)
    expect(allowed({ evidencePolicy: { ...policy().evidencePolicy, categories: ['CUSTOM'] } })).toBe(false)
  })
  test.each(['sourcePolicy', 'sectionMapping', 'readinessPolicy', 'advisoryInterpretation', 'claimPolicy', 'contradictionPolicy', 'postLockDiscoveryPolicy'])(
    'configured %s does not acquire authority from the quality binding', key => expect(allowed({ [key]: {} })).toBe(false))
  test.each(['minimumRuntimeCompatibilityVersion', 'migrationIdentity'])('unsupported compatibility %s blocks acquisition', key => {
    expect(allowed({ compatibility: { packageContractVersion: 'framework-package-discovery-policy-v1', [key]: 'unimplemented' } })).toBe(false)
  })
})

describe('Discovery Policy package envelope', () => {
  const veReference = () => ({ mappingKey: 'evidence-quality', vmfCapabilityRef: 'VE02', ownerRuntime: 'VE02 / Bundle 02',
    sourceRef: 'https://drive.google.com/file/d/17rkALp4x5q5VByzIn9adocJM3YtqdMgN/view',
    sourceVersion: 'Bundle 02 v1.4 / STATE v1.6 / DDS v1.8 — VE02RC001',
    resultType: 'VMF.VE02.EvidenceAssessmentResult', resultContractVersion: '1.0',
    implementationRef: 'validation-evidence-quality-check', implementationVersion: '1' })
  const vePolicy = (changes = {}) => ({ ...identity(), evidencePolicy: { ownerMappings: [{ ...veReference(), ...changes }] } })
  test('verified successor source does not certify installation or implementation', () => {
    const value = vePolicy()
    const before = JSON.stringify(value)
    const report = inspectDiscoveryPolicy(value)
    expect(report.status).toBe('UNRESOLVED')
    expect(report.unresolvedReferences[0].semanticTarget).toMatchObject({ capability: 'VE02', owner: 'VE02 / Bundle 02',
      resultContract: 'VMF.VE02.EvidenceAssessmentResult', schemaVersion: '1.0',
      expectedSourceHash: 'c9c1b6e824af3f97177129dcf9a4ee5e1a3a9ab55976a32db095febda5ac4cf4',
      relationshipStatus: 'SUPPORTED', policyBindingStatus: 'CONFIRMED', machineContractStatus: 'SOURCE_VERIFIED',
      sourceVerificationStatus: 'VERIFIED', installationStatus: 'NOT_CHECKED', implementationStatus: 'UNVERIFIED' })
    expect(report.unresolvedReferences[0].question).not.toContain('no authoritative machine')
    expect(report.unresolvedReferences[0].question).not.toContain('which governing method')
    expect(discoveryPolicyReadinessDetails(value)).not.toEqual({})
    expect(JSON.stringify(value)).toBe(before)
    expect(discoveryPolicySnapshot(value).discoveryPolicyHash).toBe(report.policyHash)
    expect(inspectDiscoveryPolicy(JSON.parse(before)).policyHash).toBe(report.policyHash)
  })
  test.each([{ ownerRuntime: 'CR' }, { ownerRuntime: 'VE' }, { vmfCapabilityRef: 'VE03' }, { sourceVersion: 'other' },
    { resultContractVersion: '2.0' }, { sourceRef: 'https://drive.google.com/file/d/1ZEevzhzIJ4ggDJ86oYdBpCe1pcrHhcVB/view' },
    { sourceRef: undefined }, { implementationRef: 'skill-evidence-quality-validator' }])('conflicting or incomplete VE02 policy binding remains unverified %j', (changes) => {
    expect(inspectDiscoveryPolicy(vePolicy(changes)).unresolvedReferences[0].semanticTarget.policyBindingStatus).toBe('UNVERIFIED')
  })
  test('caller result proposals cannot certify the announced machine contract', () => {
    const report = inspectDiscoveryPolicy(vePolicy({ resultType: 'VE02-result-proposal', resultContractVersion: '1' }))
    expect(report.status).toBe('UNRESOLVED')
    expect(report.unresolvedReferences[0].semanticTarget.machineContractStatus).toBe('SOURCE_VERIFIED')
    expect(report.unresolvedReferences[0].semanticTarget.policyBindingStatus).toBe('UNVERIFIED')
    expect(discoveryPolicySchema.safeParse(vePolicy({ semanticTarget: { relationshipStatus: 'SUPPORTED' } })).success).toBe(false)
  })
  test('Drive sharing parameters do not change authoritative source identity', () => {
    const value = vePolicy({ sourceRef: `${veReference().sourceRef}?usp=drivesdk` })
    expect(inspectDiscoveryPolicy(value).unresolvedReferences[0].semanticTarget.policyBindingStatus).toBe('CONFIRMED')
  })
  test('readiness short-circuits configured unresolved policy without runtime-local fallback', async () => {
    const { evaluateDiscoveryContractRuntime } = await import('../services/discoveryContractRuntimeService.js')
    const result = evaluateDiscoveryContractRuntime({
      frameworkPackage: { _id: 'one', frameworkKey: 'TEST', packageKey: 'test', version: '1.0.0', discoveryPolicy: policy() },
      runtimeInstance: { id: 'runtime-one', packageId: 'one', frameworkKey: 'TEST', packageKey: 'test', packageVersion: '1.0.0', framework_state: {
        evidence_pack: { sourceRegistry: [{ sourceId: 'recorded-source', sourceRef: 'fixture:document', restrictions: ['Review required.'] }] },
        policy: { discoveryContract: { status: 'RESOLVED' } },
      } },
      rebuildGraph: true,
      policyResolver: () => { throw new Error('Legacy policy resolver must not execute.') },
    })
    expect(result.package_discovery_policy.status).toBe('BLOCKED')
    expect(result.package_discovery_policy).not.toHaveProperty('unresolvedReferences')
    expect(result.runtime_intelligence_graph).toMatchObject({ rebuilt: false, analysisSkipped: true })
    expect(result.canonical_revision_readiness.readiness.state).toBe('UNRESOLVED')
    expect(result.source_registry).toEqual([{ sourceId: 'recorded-source', sourceRef: 'fixture:document', restrictions: ['Review required.'] }])
    expect(result.section_coverage).toEqual([])
  })
  test('truthful partial references survive draft parsing and identify missing semantic fields', () => {
    const value = { ...identity(), evidencePolicy: { ownerMappings: [{ mappingKey: 'evidence-quality', vmfCapabilityRef: 'validation-evidence-quality-check' }] } }
    expect(discoveryPolicySchema.parse(value)).toEqual(value)
    const report = inspectDiscoveryPolicy(value)
    expect(report.status).toBe('UNRESOLVED')
    expect(report.unresolvedReferences[0].question).toContain('the VMF capability is VE02')
    expect(report.unresolvedReferences[0].semanticTarget.policyBindingStatus).toBe('UNVERIFIED')
    expect(report.unresolvedReferences[0].semanticTarget.machineContractStatus).toBe('SOURCE_VERIFIED')
    expect(report.unresolvedReferences[0]).not.toHaveProperty('ownerRuntime')
  })
  test('selected package resolver exposes legacy fallback and never replaces a mismatched package', () => {
    const frameworkPackage = { _id: 'package-one', frameworkKey: 'TEST', packageKey: 'test', version: '1.0.0' }
    const runtimeInstance = { packageId: 'package-one', frameworkKey: 'TEST', packageKey: 'test', packageVersion: '1.0.0' }
    expect(resolvePackageDiscoveryPolicy({ frameworkPackage, runtimeInstance }).status).toBe('LEGACY_FALLBACK')
    expect(resolvePackageDiscoveryPolicy({ frameworkPackage, runtimeInstance: { ...runtimeInstance, packageKey: 'other' } }).reason).toBe('DISCOVERY_POLICY_PACKAGE_IDENTITY_MISMATCH')
    expect(resolvePackageDiscoveryPolicy({ runtimeInstance }).reason).toBe('DISCOVERY_POLICY_PACKAGE_MISSING')
  })
  test('configured execution binds the captured snapshot and remains blocked on semantics', () => {
    const frameworkPackage = { _id: 'one', packageKey: 'test', frameworkKey: 'TEST', version: '1.0.0', discoveryPolicy: policy(), dependencyLock: { snapshotId: 'snapshot-one', snapshotHash: 'snapshot-hash', ...discoveryPolicySnapshot(policy()) } }
    const runtimeInstance = { packageId: 'one', packageKey: 'test', frameworkKey: 'TEST', packageVersion: '1.0.0', dependencyLockId: 'snapshot-one', evidence: { dependencySnapshotHash: 'snapshot-hash' }, framework_state: { policy: { discoveryContract: { status: 'RESOLVED' } } } }
    expect(resolvePackageDiscoveryPolicy({ frameworkPackage, runtimeInstance })).toMatchObject({ status: 'BLOCKED', reason: 'DISCOVERY_POLICY_MAPPING_UNVERIFIED', policyHash: inspectDiscoveryPolicy(policy()).policyHash })
    expect(resolvePackageDiscoveryPolicy({ frameworkPackage, runtimeInstance: { ...runtimeInstance, dependencyLockId: 'other' } }).reason).toBe('DISCOVERY_POLICY_CAPTURED_BINDING_MISMATCH')
  })
  test('legacy absence remains absent and produces no snapshot additions', () => {
    expect(inspectDiscoveryPolicy(undefined).status).toBe('LEGACY_FALLBACK')
    expect(discoveryPolicySnapshot(undefined)).toEqual({})
    expect(new FrameworkPackage({}).toObject()).not.toHaveProperty('discoveryPolicy')
  })
  test.each([
    { ...identity(), status: 'ACTIVE' }, { ...identity(), policyHash: 'caller-proof' },
    { ...identity(), contractVersion: 'unknown' }, { ...identity(), policyKey: 'x'.repeat(181) },
    { ...identity(), evidencePolicy: { ownerMappings: [{ ...policy().evidencePolicy.ownerMappings[0], verified: true }] } },
    { ...identity(), evidencePolicy: { ownerMappings: [policy().evidencePolicy.ownerMappings[0], policy().evidencePolicy.ownerMappings[0]] } },
    { ...identity(), postLockDiscoveryPolicy: { enabled: true, mutateLockedRevision: true } },
  ])('rejects malformed or authored governance envelope %#', (value) => {
    expect(discoveryPolicySchema.safeParse(value).success).toBe(false)
  })
  test('draft roundtrip preserves references and source identifiers without claiming verification', async () => {
    const input = packageInput()
    Object.assign(input.discoveryPolicy.evidencePolicy.ownerMappings[0], {
      sourceRef: 'proposed-source', sourceVersion: '1', resultContractVersion: '1', implementationRef: 'skill-name', implementationVersion: '1',
    })
    const doc = new FrameworkPackage(input)
    await doc.validate()
    expect(doc.toObject().discoveryPolicy).toEqual(input.discoveryPolicy)
    const report = inspectDiscoveryPolicy(doc.discoveryPolicy)
    expect(report.status).toBe('UNRESOLVED')
    expect(report.unresolvedReferences[0]).toMatchObject({ path: 'discoveryPolicy.evidencePolicy.ownerMappings.0', mappingKey: 'evidence' })
    expect(report.unresolvedReferences[0].question).toContain('unconfirmed-evidence')
  })
  test('canonical hash ignores object key ordering and changes with policy configuration', () => {
    const input = policy()
    expect(inspectDiscoveryPolicy(input).policyHash).toBe(inspectDiscoveryPolicy({ evidencePolicy: input.evidencePolicy, ...identity() }).policyHash)
    expect(inspectDiscoveryPolicy({ ...input, label: 'changed' }).policyHash).not.toBe(inspectDiscoveryPolicy(input).policyHash)
  })
  test.each([
    identity(), { ...identity(), sectionMapping: { mode: 'proposal', algorithm: 'proposal', requireMappingReceipt: true, rules: [] } },
    { ...identity(), advisoryInterpretation: { enabled: true, lenses: [] } },
    { ...identity(), postLockDiscoveryPolicy: { enabled: true, mutateLockedRevision: false, references: [] } },
    { ...identity(), readinessPolicy: { readinessEvaluations: [] } },
  ])('empty required references cannot bypass readiness %#', (value) => {
    expect(Object.keys(discoveryPolicyReadinessDetails(value)).length).toBeGreaterThan(0)
  })
  test('validated persistence rejects unresolved mappings', async () => {
    await expect(new FrameworkPackage(packageInput('VALIDATED')).validate()).rejects.toThrow(/governing method source/)
  })
  test('activation rejects unresolved policy even with a stale prior checkpoint pass', () => {
    const frameworkPackage = { ...packageInput('VALIDATED'), lastCheckpointStatus: 'PASS', runtimeVerdict: { result: 'ALLOW', auditPersisted: true, dependencyLockState: 'LOCKED', lastValidatedAt: new Date() }, dependencyLock: { status: 'PASS', references: [{ id: 'existing' }] } }
    const readiness = normalizeRuntimeActivationReadiness({ frameworkPackage })
    expect(readiness.ready).toBe(false)
    expect(readiness.blockingReasons).toContain('DISCOVERY_POLICY_MAPPING_UNVERIFIED')
  })
  test('dependency snapshot retains policy bytes and hash through model casting', () => {
    const snapshot = { snapshotId: 'policy-lock', status: 'PASS', packageKey: 'test', packageVersion: '1.0.0', ...discoveryPolicySnapshot(policy()) }
    const doc = new FrameworkPackage({ dependencyLock: snapshot })
    expect(doc.dependencyLock.toObject().discoveryPolicy).toEqual(policy())
    expect(doc.dependencyLock.toObject().discoveryPolicyHash).toBe(inspectDiscoveryPolicy(policy()).policyHash)
  })
})
