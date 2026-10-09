import { z } from 'zod'
import env from '../../config/env.js'
import { generateChecksum } from '../governanceAudit/checksumService.js'

// Gary's reversible StorylineOS decision. This is not VMF producer certification.
export const VE02_LOCAL_ASSESSOR = Object.freeze({
  authorityClass: 'STORYLINEOS_PROVISIONAL',
  implementationRef: 'validation-evidence-quality-check',
  implementationVersion: 'storylineos-ve02-local-assessor-v1',
  decisionRef: 'gary-storylineos-ve02-provisional-2026-10-09',
  model: 'gpt-4.1-mini',
  frameworkKey: 'QMF', packageKey: 'ss038-synthetic-qmf-0-38-1', packageVersion: '0.38.1',
})
export const VE02_LOCAL_RESULT_RESTRICTION = 'STORYLINEOS_PROVISIONAL_ASSESSMENT'
const ref = z.string().min(1).max(2000)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const ve02ProducerBindingSchema = z.object({
  authorityClass: z.literal(VE02_LOCAL_ASSESSOR.authorityClass),
  implementationRef: z.literal(VE02_LOCAL_ASSESSOR.implementationRef),
  implementationVersion: z.literal(VE02_LOCAL_ASSESSOR.implementationVersion),
  decisionRef: z.literal(VE02_LOCAL_ASSESSOR.decisionRef),
  model: z.literal(VE02_LOCAL_ASSESSOR.model), classifierVersion: ref,
  activationBindingHash: hash, gradingContentHash: ref, evidenceRevisionRef: ref,
  claimPlanId: ref, claimKey: ref, claimContractHash: ref, sourceReviewFingerprint: hash,
}).strict()

export const assertVE02LocalEnvironment = (enabled = process.env.VE02_LOCAL_ASSESSMENT_ENABLED === 'true') => {
  if (!enabled || env.isProduction || env.isAppProduction || process.env.NODE_ENV === 'production'
    || process.env.APP_ENV === 'production' || !['development', 'test'].includes(env.appEnv)) {
    throw Object.assign(new Error('Provisional StorylineOS VE02 assessment is disabled.'), {
      code: 'VE02_LOCAL_ASSESSOR_DISABLED', status: 403,
    })
  }
}
export const buildVE02LocalActivation = ({ query, binding, classifierVersion, model }) => {
  if (['frameworkKey', 'packageKey', 'packageVersion'].some(key => query[key] !== VE02_LOCAL_ASSESSOR[key])
    || model !== VE02_LOCAL_ASSESSOR.model || !binding?.activation?.activationId
    || !binding.activation.versionId || binding.activation.contentHash !== binding.source?.contentHash) {
    throw Object.assign(new Error('Provisional VE02 controlled activation does not match.'), {
      code: 'VE02_LOCAL_ACTIVATION_UNAVAILABLE', status: 403,
    })
  }
  const decision = { ...VE02_LOCAL_ASSESSOR, classifierVersion,
    installedActivationId: binding.activation.activationId, installedVersionId: binding.activation.versionId,
    gradingContentHash: binding.source.contentHash }
  return { ...decision, bindingHash: generateChecksum(decision) }
}
