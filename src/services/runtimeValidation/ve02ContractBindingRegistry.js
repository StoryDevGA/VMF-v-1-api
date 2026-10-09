import { createHash } from 'node:crypto'
import KnowledgePackVersion from '../../models/KnowledgePackVersion.js'
import { resolveKnowledgePackManifest } from '../knowledgePackResolverService.js'
import { VE02_CONSUMER_VERSION, VE02_RESULT_CONTRACT_ID } from './ve02EvidenceAssessmentResultContract.js'

// Code-owned registration of the implemented consumer, never assessment-producer proof.
export const VE02_CONSUMER_REGISTRATION = Object.freeze({
  implementationRef: 'runtime-validation-ve02-result-consumer',
  implementationVersion: VE02_CONSUMER_VERSION,
  role: 'CONTRACT_CONSUMER', contractId: VE02_RESULT_CONTRACT_ID, schemaVersion: '1.0',
  module: 'runtimeValidation/runtimeValidationEngine.js', operationType: 'OUTPUT_VALIDATION',
  assessmentProducerStatus: 'UNVERIFIED',
})

export const VE02_SOURCE_BINDING = Object.freeze({
  sourceDocumentId: '17rkALp4x5q5VByzIn9adocJM3YtqdMgN',
  sourceHash: 'c9c1b6e824af3f97177129dcf9a4ee5e1a3a9ab55976a32db095febda5ac4cf4',
  contentHash: 'sha256:4aa45260e65231e17233f1a439427e151e80bafb5aa947b2b21a77cc74e76437',
  governingRuntimeVersion: 'VMF Bundle 02 v1.4 / STATE v1.6 / DDS v1.8 — VE02RC001',
  packType: 'VALIDATION_EVIDENCE', packKey: 've02-evidence-assessment-result',
})

export const VE02_GRADING_BINDING = Object.freeze({
  sourceDocumentId: '1nJy3IJ3cS7IwnS7P_e59N34Enb2r-Qu2',
  sourceHash: 'f196f30f418dd079d19a93a4147783605274108ed01b580b3e26be6dc4583d8a',
  contentHash: 'sha256:a55ad3dd674df5459d08f05ec29c714b964c89432c45096310c5892c727e83d8',
  governingRuntimeVersion: 'VE02-GRADE-001 v1.0',
  packType: 'VALIDATION_EVIDENCE', packKey: 've02-grading-aggregation',
})

export const VE02_COMPOSITION_BINDING = Object.freeze({
  sourceDocumentId: 'storylineos-ve02-contract-grading-composition-v1.1.0',
  sourceHash: 'e655adf0da5275ae38fceefcd0696f2875904ca306cf6d2da6cfa3a2d6fe4f4d',
  contentHash: 'sha256:e655adf0da5275ae38fceefcd0696f2875904ca306cf6d2da6cfa3a2d6fe4f4d',
  governingRuntimeVersion: VE02_SOURCE_BINDING.governingRuntimeVersion,
  packType: VE02_SOURCE_BINDING.packType, packKey: VE02_SOURCE_BINDING.packKey,
  contractSource: VE02_SOURCE_BINDING, gradingSource: VE02_GRADING_BINDING,
  compositionOrder: ['CONTRACT', 'GRADING'], separator: '\n\n---\n\n',
})

const resolvePinnedBinding = async ({ query, session = null, dependencies = {}, binding }) => {
  const packResolver = dependencies.packResolver || resolveKnowledgePackManifest
  const versionReader = dependencies.versionReader || ((versionId) => KnowledgePackVersion.findOne({ versionId }).select('+content').session(session).lean())
  const resolved = await packResolver({ session, query, manifest: {
    status: 'VALIDATED', validationPacks: [{ packType: binding.packType, packKey: binding.packKey,
      executionMode: 'SYSTEM_ONLY' }],
  } })
  const activation = resolved.activePacks.find((pack) => pack.packType === binding.packType && pack.packKey === binding.packKey)
  if (!activation) return undefined
  const version = await versionReader(activation.versionId)
  const sourceDocument = version?.sourceDocuments?.find((document) => document.sourceDocumentId === binding.sourceDocumentId)
  if (!sourceDocument || sourceDocument.sourceHash !== binding.contentHash
    || version.contentHash !== binding.contentHash || activation.contentHash !== binding.contentHash
    || `sha256:${createHash('sha256').update(String(version.content || '')).digest('hex')}` !== binding.contentHash) return undefined
  return { activation, source: binding }
}

export const resolveVE02ContractBinding = async (options) => {
  const resolved = await resolvePinnedBinding({ ...options, binding: VE02_SOURCE_BINDING })
    || await resolvePinnedBinding({ ...options, binding: VE02_COMPOSITION_BINDING })
  return resolved && { ...resolved, consumer: VE02_CONSUMER_REGISTRATION }
}
export const resolveVE02GradingBinding = (options) => resolvePinnedBinding({ ...options, binding: VE02_COMPOSITION_BINDING })
