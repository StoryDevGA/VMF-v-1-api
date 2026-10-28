import fs from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { randomUUID, createHash } from 'node:crypto'
import mongoose from 'mongoose'
import env from '../config/env.js'
import Event, { assertSyntheticOutcomeRunEvent } from '../models/SyntheticOutcomeRunEvent.js'
import Audit from '../models/AuditLog.js'
import Stage from '../models/OutcomeQualityStageExecution.js'
import Grr from '../models/GovernedReasoningExecution.js'
import Artifact from '../models/GovernedRuntimeArtifact.js'
import Runtime from '../models/RuntimeInstance.js'
import auditService from '../services/auditService.js'
import { hashOutcomeQualityStageValue } from '../services/outcomeQualityStageExecutionService.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'

// Real Event/Audit transactions, signatures and unique indexes. Exact previously
// verified synthetic rows are copied into a fresh isolated database. Authorization,
// lock/plan admission and the recursive source-reader are explicit component seams;
// stage/provider owners deliberately stop before generation. No native acceptance.
const database = process.env.VMF_SYNTHETIC_COMPLETION_RECOVERY_DB
const run = database ? describe : describe.skip
run('isolated Narrative reference recovery real journal', () => {
  let owned = false, fixture, owner, args, createRevision, buildRevision
  const names = [Event, Audit, Stage, Grr, Artifact, Runtime].map(model => model.collection.name)
  const guarded = name => {
    if (!owned || mongoose.connection.name !== database || !/^ss044_[a-f0-9]{32}$/.test(database) || !names.includes(name)) throw Error('Owned isolated namespace required')
    return mongoose.connection.db.collection(name)
  }
  const presentationMode = () => fixture.mode === 'EXPRESSION_PRESENTATION'
  const overlayMode = () => fixture.mode === 'EXPRESSION_OVERLAY' || presentationMode()
  const readableMode = () => fixture.mode === 'EXPRESSION_READABLE' || overlayMode()
  const contractMode = () => fixture.mode === 'EXPRESSION_CONTRACT' || readableMode()
  const faithfulMode = () => fixture.mode === 'EXPRESSION_FAITHFUL' || contractMode()
  const followupMode = () => fixture.mode === 'EXPRESSION_FOLLOWUP' || faithfulMode()
  const expressionMode = () => fixture.mode === 'EXPRESSION' || followupMode()
  const rlMode = () => fixture.mode === 'RL_PERSISTENCE'
  const titleMode = () => fixture.mode === 'TITLE' || rlMode() || expressionMode()
  const phase = () => presentationMode() ? 'COMPLETION_EXPRESSION_PRESENTATION_RESULT' : overlayMode() ? 'COMPLETION_EXPRESSION_OVERLAY_RESULT' : readableMode() ? 'COMPLETION_EXPRESSION_READABLE_RESULT' : contractMode() ? 'COMPLETION_EXPRESSION_CONTRACT_RESULT' : faithfulMode() ? 'COMPLETION_EXPRESSION_FAITHFUL_RESULT' : followupMode() ? 'COMPLETION_EXPRESSION_FOLLOWUP_RESULT' : expressionMode() ? 'COMPLETION_EXPRESSION_REPAIR_RESULT' : rlMode() ? 'COMPLETION_RL_PERSISTENCE_RESULT' : titleMode() ? 'COMPLETION_TITLE_RESULT' : 'COMPLETION_REFERENCE_RESULT'
  const saved = key => key === 'audits' && !fixture.allAuditsIncluded ? [...fixture.native.audits, ...fixture.stageAudits] : fixture.native[key]
  const groups = () => [[Event, 'rows'], [Audit, 'audits'], [Stage, 'stages'], [Grr, 'grr'], [Artifact, 'artifacts'], [Runtime, 'roots']]
  const unchanged = async () => {
    for (const [model, key] of groups()) for (const old of saved(key)) {
      const actual = await guarded(model.collection.name).findOne({ _id: old._id })
      expect(membershipHash(actual)).toBe(membershipHash(old))
    }
  }
  beforeAll(async () => {
    const file = process.env.VMF_SYNTHETIC_COMPLETION_RECOVERY_FIXTURE || ''
    if (!/^ss044_[a-f0-9]{32}$/.test(database) || !file.replaceAll('\\', '/').startsWith('C:/Dev/StoryLineOS/VMF-Evidence/')) throw Error('Fresh isolated database and external verified fixture required')
    fixture = mongoose.mongo.BSON.EJSON.parse(fs.readFileSync(file, 'utf8'), { relaxed: true })
    expect(fixture.native.rows).toHaveLength(presentationMode() ? 56 : overlayMode() ? 54 : readableMode() ? 52 : contractMode() ? 50 : faithfulMode() ? 48 : followupMode() ? 46 : expressionMode() ? 44 : rlMode() ? 42 : titleMode() ? 40 : 38)
    expect(fixture.native.audits).toHaveLength(presentationMode() ? 125 : overlayMode() ? 120 : readableMode() ? 115 : contractMode() ? 110 : faithfulMode() ? 105 : followupMode() ? 100 : expressionMode() ? 95 : rlMode() ? 92 : titleMode() ? 88 : 60)
    for (const row of fixture.native.rows) assertSyntheticOutcomeRunEvent(row)
    expect(fixture.stageAudits).toHaveLength(presentationMode() ? 40 : overlayMode() ? 38 : readableMode() ? 36 : contractMode() ? 34 : faithfulMode() ? 32 : followupMode() ? 30 : expressionMode() ? 28 : rlMode() ? 27 : titleMode() ? 26 : 25)
    for (const row of saved('audits')) expect(Audit.hydrate(row).verifySignature()).toBe(true)
    await mongoose.connect(env.mongoUri, { dbName: database, autoCreate: false, autoIndex: false, maxPoolSize: 3, serverSelectionTimeoutMS: 10000 })
    expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toEqual(expect.any(String))
    const reuseFile = process.env.VMF_SYNTHETIC_COMPLETION_RECOVERY_REUSE_APPROVAL
    if (reuseFile) {
      expect(reuseFile.replaceAll('\\', '/').startsWith('C:/Dev/StoryLineOS/VMF-Evidence/')).toBe(true)
      const read = name => JSON.parse(fs.readFileSync(name, 'utf8').replace(/^\uFEFF/, ''))
      const approval = read(reuseFile)
      const manifest = read(new URL('./owned-qa-backup-manifest.json', 'file:///' + reuseFile.replaceAll('\\', '/')))
      const lease = read(new URL('./qa-reuse-exclusive-lease.json', 'file:///' + reuseFile.replaceAll('\\', '/')))
      expect(approval.verdict).toBe('PASS'); expect(approval.dbName).toBe(database)
      expect(lease.dbName).toBe(database); expect(lease.backupSha256).toBe(approval.backupSha256)
      expect(lease.operatorSha256).toBe(approval.operatorSha256); expect(lease.restoreRequired).toBe(true)
      expect(fs.existsSync(new URL('./qa-reuse-restoration.json', 'file:///' + reuseFile.replaceAll('\\', '/')))).toBe(false)
      expect(database).toBe('ss044_896f0dbc2e654666b1833039f5b04dae')
      expect(approval.backupSha256).toBe(manifest.backupSha256)
      expect(createHash('sha256').update(fs.readFileSync(manifest.backupFile)).digest('hex')).toBe(manifest.backupSha256)
      expect((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort()).toEqual([...names].sort())
      for (const name of names) {
        const collection = mongoose.connection.db.collection(name)
        const rows = await collection.find({}).sort({ _id: 1 }).toArray()
        const indexes = await collection.listIndexes().toArray()
        expect(membershipHash({ rows, indexes })).toBe(manifest.collectionMaterialHashes[name])
      }
    } else expect(await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).toHaveLength(0)
    owned = true
    if (!reuseFile) {
      for (const name of names) await mongoose.connection.db.createCollection(name)
      await Event.createIndexes()
    }
    const original = await import('../services/isolatedSyntheticOutcomeService.js')
    const parent = fixture.native.rows.find(row => row.phase === 'COMPLETION_CLAIM')
    const auth = { runtime: fixture.native.roots.find(row => String(row._id) === parent.body.classification.runtimeInstanceId),
      basis: parent.body.basis, classification: parent.body.classification }
    jest.unstable_mockModule('../services/isolatedSyntheticOutcomeService.js', () => ({ ...original,
      isolatedSyntheticOutcomeInternals: { ...original.isolatedSyntheticOutcomeInternals,
        authorize: async () => auth, readPlan: async () => fixture.native.plan, revisionIndexReady: async () => {} } }))
    owner = await import('../services/isolatedSyntheticOutcomeCompletionService.js')
    const quality = await import('../services/outcomePostArlQualityChainService.js')
    createRevision = quality.createOutcomeShapedCandidateRevision
    buildRevision = quality.buildOutcomeShapedCandidateRevisionOutput
  }, 30000)
  beforeEach(async () => {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        for (const [model, key] of groups()) {
          await guarded(model.collection.name).deleteMany({}, { session })
          await guarded(model.collection.name).insertMany(saved(key), { session })
        }
      })
    } finally { await session.endSession() }
    const claim = fixture.native.rows.find(row => row.phase === 'COMPLETION_CLAIM')
    const result = fixture.native.rows.find(row => row.phase === 'COMPLETION_RESULT')
    const titleClaim = fixture.native.rows.find(row => row.phase === 'COMPLETION_REFERENCE_CLAIM')
    const titleResult = fixture.native.rows.find(row => row.phase === 'COMPLETION_REFERENCE_RESULT')
    const narrative = titleMode() ? titleResult.body.stageRefs[0] : null
    const draft = titleMode() ? fixture.native.stages.find(row => row.stageKey === 'WORKING_DRAFT'
      && row.stageExecutionId === titleClaim.body.completionSource.workingDraftStageExecutionId) : null
    const rlClaim = fixture.native.rows.find(row => row.phase === 'COMPLETION_TITLE_CLAIM')
    const rlResult = fixture.native.rows.find(row => row.phase === 'COMPLETION_TITLE_RESULT')
    const planQuery = () => ({ sort() { return this }, session() { return this }, lean: async () => fixture.native.plan })
    args = { actorUserId: claim.body.actorUserId, runtimeInstanceId: claim.body.classification.runtimeInstanceId,
      scopes: { customer: { _id: claim.body.classification.customerId }, tenant: { _id: claim.body.classification.tenantId } },
      auditRequest: { requestId: 'isolated-reference-' + randomUUID() }, payload: {
        requestKey: randomUUID(), requestId: claim.body.plan.requestId, planId: claim.body.plan.planId,
        expectedPlanFingerprint: claim.body.plan.planFingerprint, completionSource: claim.body.completionSource,
        referenceRecovery: { claimEventId: claim.eventId, claimBodyHash: claim.bodyHash, resultEventId: result.eventId, resultBodyHash: result.bodyHash },
        ...(titleMode() ? { titleRecovery: { claimEventId: titleClaim.eventId, claimBodyHash: titleClaim.bodyHash,
          resultEventId: titleResult.eventId, resultBodyHash: titleResult.bodyHash,
          narrativeStageExecutionId: narrative.stageExecutionId, narrativeMaterialHash: narrative.materialHash,
          titleHash: membershipHash(draft.outputSnapshot.title) } } : {}),
        ...((rlMode() || expressionMode()) ? { rlPersistenceRecovery: { claimEventId: rlClaim.eventId, claimBodyHash: rlClaim.bodyHash,
          resultEventId: rlResult.eventId, resultBodyHash: rlResult.bodyHash, shapingStageExecutionId: rlResult.body.stageRefs[1].stageExecutionId,
          shapingMaterialHash: rlResult.body.stageRefs[1].materialHash, executionId: rlResult.body.grrRefs[0].executionId,
          runtimeArtifactId: rlResult.body.grrRefs[0].runtimeArtifactId, executionHash: rlResult.body.grrRefs[0].executionHash,
          artifactHash: rlResult.body.grrRefs[0].artifactHash } } : {}) },
      deps: { readSourceRun: async () => fixture.source,
        createNarrativePlan: jest.fn(async () => { throw Object.assign(new Error('Explicit test owner gate'), { code: 'QA_REFERENCE_OWNER_GATE' }) }),
        createShapedCandidate: jest.fn(async () => { throw Object.assign(new Error('Explicit Shaping test gate'), { code: 'QA_TITLE_OWNER_GATE' }) }),
        executeRenderedExpressionRl: jest.fn(), auditService,
        rlRecoveryDeps: { stageDeps: { OutcomeKnowledgeCompositionPlan: { findOne: planQuery },
          readOutcomeEvidenceContractSnapshot: async () => JSON.parse(fixture.native.plan.payload.evidenceToMeaning.contractJson).inputs.sourceSnapshot,
          auditService } } }, providerRuntimeDeps: {} }
    if (expressionMode()) {
      const priorClaim = fixture.native.rows.find(row => row.phase === 'COMPLETION_RL_PERSISTENCE_CLAIM')
      const priorResult = fixture.native.rows.find(row => row.phase === 'COMPLETION_RL_PERSISTENCE_RESULT')
      const refs = priorResult.body.stageRefs, pair = priorResult.body.grrRefs[0]
      args.payload.expressionRepair = { claimEventId: priorClaim.eventId, claimBodyHash: priorClaim.bodyHash,
        resultEventId: priorResult.eventId, resultBodyHash: priorResult.bodyHash, narrativeStageExecutionId: refs[0].stageExecutionId,
        narrativeMaterialHash: refs[0].materialHash, shapingStageExecutionId: refs[1].stageExecutionId, shapingMaterialHash: refs[1].materialHash,
        failedRlStageExecutionId: refs[2].stageExecutionId, failedRlMaterialHash: refs[2].materialHash,
        executionId: pair.executionId, runtimeArtifactId: pair.runtimeArtifactId, executionHash: pair.executionHash, artifactHash: pair.artifactHash,
        expressionProfileVersion: 'outcome-readable-expression.v2' }
      if (followupMode()) {
        const previousClaim = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_REPAIR_CLAIM')
        const previousResult = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_REPAIR_RESULT')
        const previousRefs = previousResult.body.stageRefs, previousPair = previousResult.body.grrRefs[0]
        const original = previousRefs.map(ref => fixture.native.stages.find(stage => stage.stageExecutionId === ref.stageExecutionId))
        const artifact = fixture.native.artifacts.find(row => row.runtimeArtifactId === previousPair.runtimeArtifactId)
        const previousReviewFingerprint = faithfulMode()
          ? fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_FOLLOWUP_CLAIM').body.expressionFollowup.reviewedOutputFingerprint
          : fixture.reviewedOutputFingerprint
        expect(previousReviewFingerprint).toMatch(/^[a-f0-9]{64}$/)
        const reviewed = buildRevision({ plan: fixture.native.plan, narrativePlanStage: original[0], priorCandidateStage: original[1],
          failedRlStage: original[2], rlArtifact: artifact, title: original[1].outputSnapshot.title,
          expressionProfileVersion: 'outcome-readable-expression.v3' })
        expect(hashOutcomeQualityStageValue(reviewed)).toBe(previousReviewFingerprint)
        args.payload.expressionFollowup = { claimEventId: previousClaim.eventId, claimBodyHash: previousClaim.bodyHash,
          resultEventId: previousResult.eventId, resultBodyHash: previousResult.bodyHash,
          narrativeStageExecutionId: previousRefs[0].stageExecutionId, narrativeMaterialHash: previousRefs[0].materialHash,
          shapingStageExecutionId: previousRefs[1].stageExecutionId, shapingMaterialHash: previousRefs[1].materialHash,
          failedRlStageExecutionId: previousRefs[2].stageExecutionId, failedRlMaterialHash: previousRefs[2].materialHash,
          executionId: previousPair.executionId, runtimeArtifactId: previousPair.runtimeArtifactId,
          executionHash: previousPair.executionHash, artifactHash: previousPair.artifactHash,
          expressionProfileVersion: 'outcome-readable-expression.v3', reviewedOutputFingerprint: previousReviewFingerprint }
      }
      if (faithfulMode()) {
        const previousClaim = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_FOLLOWUP_CLAIM')
        const previousResult = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_FOLLOWUP_RESULT')
        const previousRefs = previousResult.body.stageRefs, previousPair = previousResult.body.grrRefs[0]
        const original = previousRefs.map(ref => fixture.native.stages.find(stage => stage.stageExecutionId === ref.stageExecutionId))
        const artifact = fixture.native.artifacts.find(row => row.runtimeArtifactId === previousPair.runtimeArtifactId)
        expect(fixture.reviewedOutputFingerprint).toMatch(/^[a-f0-9]{64}$/)
        const reviewed = buildRevision({ plan: fixture.native.plan, narrativePlanStage: original[0], priorCandidateStage: original[1],
          failedRlStage: original[2], rlArtifact: artifact, title: original[1].outputSnapshot.title,
          expressionProfileVersion: 'outcome-readable-expression.v4' })
        const faithfulFingerprint = contractMode()
          ? fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_FAITHFUL_CLAIM').body.expressionFaithful.reviewedOutputFingerprint
          : fixture.reviewedOutputFingerprint
        expect(hashOutcomeQualityStageValue(reviewed)).toBe(faithfulFingerprint)
        args.payload.expressionFaithful = { claimEventId: previousClaim.eventId, claimBodyHash: previousClaim.bodyHash,
          resultEventId: previousResult.eventId, resultBodyHash: previousResult.bodyHash,
          narrativeStageExecutionId: previousRefs[0].stageExecutionId, narrativeMaterialHash: previousRefs[0].materialHash,
          shapingStageExecutionId: previousRefs[1].stageExecutionId, shapingMaterialHash: previousRefs[1].materialHash,
          failedRlStageExecutionId: previousRefs[2].stageExecutionId, failedRlMaterialHash: previousRefs[2].materialHash,
          executionId: previousPair.executionId, runtimeArtifactId: previousPair.runtimeArtifactId,
          executionHash: previousPair.executionHash, artifactHash: previousPair.artifactHash,
          expressionProfileVersion: 'outcome-readable-expression.v4', reviewedOutputFingerprint: faithfulFingerprint }
      }
      if (contractMode()) {
        const previousClaim = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_FAITHFUL_CLAIM')
        const previousResult = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_FAITHFUL_RESULT')
        const previousRefs = previousResult.body.stageRefs, previousPair = previousResult.body.grrRefs[0]
        const original = previousRefs.map(ref => fixture.native.stages.find(stage => stage.stageExecutionId === ref.stageExecutionId))
        const artifact = fixture.native.artifacts.find(row => row.runtimeArtifactId === previousPair.runtimeArtifactId)
        expect(fixture.reviewedOutputFingerprint).toMatch(/^[a-f0-9]{64}$/)
        const reviewed = buildRevision({ plan: fixture.native.plan, narrativePlanStage: original[0], priorCandidateStage: original[1],
          failedRlStage: original[2], rlArtifact: artifact, title: original[1].outputSnapshot.title,
          expressionProfileVersion: 'outcome-commercial-expression.v1' })
        const contractFingerprint = readableMode()
          ? fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_CONTRACT_CLAIM').body.expressionContract.reviewedOutputFingerprint
          : fixture.reviewedOutputFingerprint
        expect(hashOutcomeQualityStageValue(reviewed)).toBe(contractFingerprint)
        args.payload.expressionContract = { claimEventId: previousClaim.eventId, claimBodyHash: previousClaim.bodyHash,
          resultEventId: previousResult.eventId, resultBodyHash: previousResult.bodyHash,
          narrativeStageExecutionId: previousRefs[0].stageExecutionId, narrativeMaterialHash: previousRefs[0].materialHash,
          shapingStageExecutionId: previousRefs[1].stageExecutionId, shapingMaterialHash: previousRefs[1].materialHash,
          failedRlStageExecutionId: previousRefs[2].stageExecutionId, failedRlMaterialHash: previousRefs[2].materialHash,
          executionId: previousPair.executionId, runtimeArtifactId: previousPair.runtimeArtifactId,
          executionHash: previousPair.executionHash, artifactHash: previousPair.artifactHash,
          expressionProfileVersion: 'outcome-commercial-expression.v1', reviewedOutputFingerprint: contractFingerprint }
      }
      if (readableMode()) {
        const previousClaim = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_CONTRACT_CLAIM')
        const previousResult = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_CONTRACT_RESULT')
        const previousRefs = previousResult.body.stageRefs, previousPair = previousResult.body.grrRefs[0]
        const original = previousRefs.map(ref => fixture.native.stages.find(stage => stage.stageExecutionId === ref.stageExecutionId))
        const artifact = fixture.native.artifacts.find(row => row.runtimeArtifactId === previousPair.runtimeArtifactId)
        expect(fixture.reviewedOutputFingerprint).toMatch(/^[a-f0-9]{64}$/)
        const reviewed = buildRevision({ plan: fixture.native.plan, narrativePlanStage: original[0], priorCandidateStage: original[1],
          failedRlStage: original[2], rlArtifact: artifact, title: original[1].outputSnapshot.title,
          expressionProfileVersion: 'outcome-commercial-expression.v2' })
        const readableFingerprint = overlayMode()
          ? fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_READABLE_CLAIM').body.expressionReadable.reviewedOutputFingerprint
          : fixture.reviewedOutputFingerprint
        expect(hashOutcomeQualityStageValue(reviewed)).toBe(readableFingerprint)
        args.payload.expressionReadable = { claimEventId: previousClaim.eventId, claimBodyHash: previousClaim.bodyHash,
          resultEventId: previousResult.eventId, resultBodyHash: previousResult.bodyHash,
          narrativeStageExecutionId: previousRefs[0].stageExecutionId, narrativeMaterialHash: previousRefs[0].materialHash,
          shapingStageExecutionId: previousRefs[1].stageExecutionId, shapingMaterialHash: previousRefs[1].materialHash,
          failedRlStageExecutionId: previousRefs[2].stageExecutionId, failedRlMaterialHash: previousRefs[2].materialHash,
          executionId: previousPair.executionId, runtimeArtifactId: previousPair.runtimeArtifactId,
          executionHash: previousPair.executionHash, artifactHash: previousPair.artifactHash,
          expressionProfileVersion: 'outcome-commercial-expression.v2', reviewedOutputFingerprint: readableFingerprint }
      }
      if (overlayMode()) {
        const previousClaim = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_READABLE_CLAIM')
        const previousResult = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_READABLE_RESULT')
        const refs = previousResult.body.stageRefs, pair = previousResult.body.grrRefs[0]
        const original = refs.map(ref => fixture.native.stages.find(stage => stage.stageExecutionId === ref.stageExecutionId))
        const reviewed = buildRevision({ plan: fixture.native.plan, narrativePlanStage: original[0], priorCandidateStage: original[1],
          failedRlStage: original[2], rlArtifact: fixture.native.artifacts.find(row => row.runtimeArtifactId === pair.runtimeArtifactId),
          expressionProfileVersion: 'outcome-commercial-expression.v3', styleSource: fixture.styleSource })
        const overlayFingerprint = presentationMode()
          ? fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_OVERLAY_CLAIM').body.expressionOverlay.reviewedOutputFingerprint
          : fixture.reviewedOutputFingerprint
        expect(hashOutcomeQualityStageValue(reviewed)).toBe(overlayFingerprint)
        args.payload.expressionOverlay = { claimEventId: previousClaim.eventId, claimBodyHash: previousClaim.bodyHash,
          resultEventId: previousResult.eventId, resultBodyHash: previousResult.bodyHash,
          narrativeStageExecutionId: refs[0].stageExecutionId, narrativeMaterialHash: refs[0].materialHash,
          shapingStageExecutionId: refs[1].stageExecutionId, shapingMaterialHash: refs[1].materialHash,
          failedRlStageExecutionId: refs[2].stageExecutionId, failedRlMaterialHash: refs[2].materialHash,
          executionId: pair.executionId, runtimeArtifactId: pair.runtimeArtifactId, executionHash: pair.executionHash, artifactHash: pair.artifactHash,
          expressionProfileVersion: 'outcome-commercial-expression.v3', reviewedOutputFingerprint: overlayFingerprint }
        // Registry currentness is a declared component seam in this isolated
        // six-collection test. Native execution separately reads the real source.
        args.deps.loadPackContent = jest.fn(async input => {
          expect(input.packId).toBe(fixture.styleSource.packId); expect(input.versionId).toBe(fixture.styleSource.versionId)
          return fixture.styleSource
        })
        args.deps.rlRecoveryDeps.stageDeps.loadPackContent = args.deps.loadPackContent
      }
      if (presentationMode()) {
        const previousClaim = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_OVERLAY_CLAIM')
        const previousResult = fixture.native.rows.find(row => row.phase === 'COMPLETION_EXPRESSION_OVERLAY_RESULT')
        const refs = previousResult.body.stageRefs, pair = previousResult.body.grrRefs[0]
        const original = refs.map(ref => fixture.native.stages.find(stage => stage.stageExecutionId === ref.stageExecutionId))
        const reviewed = buildRevision({ plan: fixture.native.plan, narrativePlanStage: original[0], priorCandidateStage: original[1],
          failedRlStage: original[2], rlArtifact: fixture.native.artifacts.find(row => row.runtimeArtifactId === pair.runtimeArtifactId),
          expressionProfileVersion: 'outcome-commercial-expression.v4', styleSource: fixture.styleSource })
        expect(hashOutcomeQualityStageValue(reviewed)).toBe(fixture.reviewedOutputFingerprint)
        args.payload.expressionPresentation = { claimEventId: previousClaim.eventId, claimBodyHash: previousClaim.bodyHash,
          resultEventId: previousResult.eventId, resultBodyHash: previousResult.bodyHash,
          narrativeStageExecutionId: refs[0].stageExecutionId, narrativeMaterialHash: refs[0].materialHash,
          shapingStageExecutionId: refs[1].stageExecutionId, shapingMaterialHash: refs[1].materialHash,
          failedRlStageExecutionId: refs[2].stageExecutionId, failedRlMaterialHash: refs[2].materialHash,
          executionId: pair.executionId, runtimeArtifactId: pair.runtimeArtifactId, executionHash: pair.executionHash, artifactHash: pair.artifactHash,
          expressionProfileVersion: 'outcome-commercial-expression.v4', reviewedOutputFingerprint: fixture.reviewedOutputFingerprint }
        // Registry currentness is a declared component seam in this isolated
        // six-collection test. Native execution separately reads the real source.
        args.deps.loadPackContent = jest.fn(async input => {
          expect(input.packId).toBe(fixture.styleSource.packId); expect(input.versionId).toBe(fixture.styleSource.versionId)
          return fixture.styleSource
        })
        args.deps.rlRecoveryDeps.stageDeps.loadPackContent = args.deps.loadPackContent
      }
      args.deps.expressionQualityDeps = { OutcomeKnowledgeCompositionPlan: { findOne: planQuery },
        // Permission tables are intentionally outside this six-collection QA fixture.
        // Assert the exact native admission request without claiming auth integration.
        assertRuntimePermission: jest.fn(async request => {
          expect(request).toEqual({ actorUserId: args.actorUserId, scopes: args.scopes,
            customerId: String(claim.body.classification.customerId), tenantId: String(claim.body.classification.tenantId), permission: 'VMF_UPDATE' })
          expect(String(request.scopes.customer._id)).toBe(String(claim.body.classification.customerId))
          expect(String(request.scopes.tenant._id)).toBe(String(claim.body.classification.tenantId))
        }),
        stageDeps: args.deps.rlRecoveryDeps.stageDeps, ...(overlayMode() ? { loadPackContent: args.deps.loadPackContent } : {}) }
      args.deps.createShapedCandidateRevision = jest.fn(input => createRevision(input))
      args.deps.executeRenderedExpressionRl = jest.fn(async () => { throw Object.assign(new Error('Explicit QA review owner gate'), { code: 'QA_EXPRESSION_RL_GATE' }) })
      args.providerRuntimeDeps = { executionMode: 'LIVE_TEST', providerDescriptor: { providerKey: 'openai' },
        renderedExpressionRlProviderAdapterFactory: jest.fn(() => jest.fn()) }
    }
  }, 30000)
  test('required claim/event/terminal audit failures roll back and uncertain claims stay passive', async () => {
    for (const fault of ['audit', 'event']) {
      args.deps.auditService = fault === 'audit' ? { ...auditService, log: async (value, options) => {
        await auditService.log(value, options); throw Error('reference audit rollback') } } : auditService
      args.deps.models = fault === 'event' ? { SyntheticOutcomeRunEvent: { collection: Event.collection,
        findOne: (...value) => Event.findOne(...value), create: async () => { throw Error('reference event rollback') } } } : undefined
      await expect(owner.completeIsolatedSyntheticOutcome(args)).rejects.toThrow('reference ' + fault + ' rollback')
      expect(await Event.countDocuments({})).toBe(saved('rows').length); expect(await Audit.countDocuments({})).toBe(saved('audits').length)
      await unchanged()
    }
    args.deps.models = undefined
    args.deps.auditService = { ...auditService, log: async (value, options) => {
      const result = await auditService.log(value, options)
      if (value.diff?.phase === phase()) throw Error('reference terminal audit rollback')
      return result
    } }
    await expect(owner.completeIsolatedSyntheticOutcome(args)).rejects.toThrow('reference terminal audit rollback')
    expect(await Event.countDocuments({})).toBe(saved('rows').length + 1); expect(await Audit.countDocuments({})).toBe(saved('audits').length + ((rlMode() || expressionMode()) ? 2 : 1))
    args.deps.auditService = auditService
    expect((await owner.completeIsolatedSyntheticOutcome(args)).run.status).toBe('UNKNOWN')
    expect(args.deps.createNarrativePlan).toHaveBeenCalledTimes(titleMode() ? 0 : 1)
    expect(args.deps.createShapedCandidate).toHaveBeenCalledTimes((rlMode() || expressionMode()) ? 0 : titleMode() ? 1 : 0)
    if (expressionMode()) {
      expect(args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
      expect(args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
      expect(await Stage.countDocuments({})).toBe(fixture.native.stages.length + 1)
    } else expect(args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    await unchanged()
  }, 120000)
  test('concurrent identical requests commit one signed winner and passive retries preserve history', async () => {
    await Promise.all([owner.completeIsolatedSyntheticOutcome(args), owner.completeIsolatedSyntheticOutcome(args)])
    const read = await owner.readLatestIsolatedSyntheticOutcome(args)
    expect(read.run).toMatchObject(expressionMode() ? { status: 'UNKNOWN', failure: { failureCode: 'QA_EXPRESSION_RL_GATE' } } : rlMode() ? { status: 'FAILED', failure: { failureCode: 'RENDERED_EXPRESSION_RL_REQUIRED_CHANGE' } }
      : { status: 'UNKNOWN', failure: { failureCode: titleMode() ? 'QA_TITLE_OWNER_GATE' : 'QA_REFERENCE_OWNER_GATE' } })
    expect(read.sourceRun.status).toBe('ARL_PASSED')
    if (expressionMode()) {
      expect(read.priorRuns.at(-1).status).toBe('FAILED')
      expect(read.run.stageRefs.at(-1).stageKey).toBe('OUTPUT_SHAPING')
      expect(read.stages.at(-1).attemptNumber).toBe(presentationMode() ? 8 : overlayMode() ? 7 : readableMode() ? 6 : contractMode() ? 5 : faithfulMode() ? 4 : followupMode() ? 3 : 2)
      expect(await Stage.countDocuments({ stageKey: 'OUTCOME_NARRATIVE_PLAN' })).toBe(1)
      expect(await Stage.countDocuments({})).toBe(fixture.native.stages.length + 1)
      expect(await Grr.countDocuments({})).toBe(fixture.native.grr.length)
    } else if (rlMode()) {
      expect(read.priorRuns.at(-1).failure.failureCode).toBe('EVIDENCE_TO_MEANING_CLARIFICATION_REQUIRED')
      expect(read.run.stageRefs.at(-1).status).toBe('FAILED')
      expect(read.run.grrRefs.at(-1).stageLinkage).toBe('LINKED')
      expect(await Stage.countDocuments({ stageKey: 'RENDERED_EXPRESSION_RL' })).toBe(1)
      expect(await Grr.countDocuments({})).toBe(fixture.native.grr.length)
    } else if (titleMode()) {
      expect(read.priorRuns.at(-1).failure.message).toBe('The exact Outcome Narrative Plan is unavailable for shaping.')
      expect(read.run.stageRefs.at(-1).stageExecutionId).toBe(args.payload.titleRecovery.narrativeStageExecutionId)
      expect(args.deps.createShapedCandidate.mock.calls[0][0].title).toBe('Working Draft')
      expect(await Stage.countDocuments({ stageKey: 'OUTCOME_NARRATIVE_PLAN' })).toBe(1)
    } else expect(read.priorRuns.at(-1).failure.details.field).toBe('output.sections[0].truthReferences')
    expect(await Event.countDocuments({})).toBe(saved('rows').length + 2); expect(await Audit.countDocuments({})).toBe(saved('audits').length + ((rlMode() || expressionMode()) ? 3 : 2))
    await owner.completeIsolatedSyntheticOutcome(args)
    await expect(owner.completeIsolatedSyntheticOutcome({ ...args, payload: { ...args.payload, requestKey: randomUUID() } }))
      .rejects.toMatchObject({ details: { reason: 'COMPLETION_ALREADY_CLAIMED' } })
    expect(args.deps.createNarrativePlan).toHaveBeenCalledTimes(titleMode() ? 0 : 1)
    expect(args.deps.createShapedCandidate).toHaveBeenCalledTimes((rlMode() || expressionMode()) ? 0 : titleMode() ? 1 : 0)
    if (expressionMode()) {
      expect(args.deps.createShapedCandidateRevision).toHaveBeenCalledTimes(1)
      expect(args.deps.executeRenderedExpressionRl).toHaveBeenCalledTimes(1)
      expect(args.providerRuntimeDeps.renderedExpressionRlProviderAdapterFactory).toHaveBeenCalledTimes(1)
    } else expect(args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    for (const row of await Event.find({}).lean()) assertSyntheticOutcomeRunEvent(row)
    for (const row of await Audit.find({})) expect(row.verifySignature()).toBe(true)
    await unchanged()
  }, 120000)
  test('real stage and signed audit roll back together without touching provider or source history', async () => {
    if (!rlMode() && !expressionMode()) return
    const selectedStageDeps = expressionMode() ? args.deps.expressionQualityDeps.stageDeps : args.deps.rlRecoveryDeps.stageDeps
    const faultAudit = jest.fn(async (entry, options) => {
      await auditService.log(entry, options)
      throw Error('RL stage audit rollback')
    })
    selectedStageDeps.auditService = { ...auditService, log: faultAudit }
    const response = await owner.completeIsolatedSyntheticOutcome(args)
    expect(response.run).toMatchObject({ status: 'UNKNOWN', failure: { failureCode: 'OUTCOME_QUALITY_STAGE_AUDIT_FAILED' } })
    expect(faultAudit).toHaveBeenCalledTimes(1)
    expect(faultAudit.mock.calls[0][0]).toMatchObject({ action: auditService.AUDIT_ACTIONS.OUTCOME_QUALITY_STAGE_RECORDED,
      diff: { stageKey: expressionMode() ? 'OUTPUT_SHAPING' : 'RENDERED_EXPRESSION_RL', attemptNumber: presentationMode() ? 8 : overlayMode() ? 7 : readableMode() ? 6 : contractMode() ? 5 : faithfulMode() ? 4 : followupMode() ? 3 : expressionMode() ? 2 : 1 } })
    expect(faultAudit.mock.calls[0][1]).toMatchObject({ throwOnError: true, session: expect.any(Object) })
    expect(await Stage.countDocuments({})).toBe(fixture.native.stages.length)
    expect(await Audit.countDocuments({})).toBe(saved('audits').length + 2)
    expect(await Event.countDocuments({})).toBe(saved('rows').length + 2)
    expect(await Grr.countDocuments({})).toBe(fixture.native.grr.length)
    selectedStageDeps.auditService = auditService
    await owner.completeIsolatedSyntheticOutcome(args)
    expect(await Stage.countDocuments({})).toBe(fixture.native.stages.length)
    expect(args.deps.executeRenderedExpressionRl).not.toHaveBeenCalled()
    await unchanged()
  }, 120000)
  afterAll(async () => { if (owned) await mongoose.disconnect() })
})
