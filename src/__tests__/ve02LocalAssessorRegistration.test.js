import { jest } from '@jest/globals'
import env from '../config/env.js'
import { assertVE02LocalEnvironment, buildVE02LocalActivation, VE02_LOCAL_ASSESSOR } from '../services/runtimeValidation/ve02LocalAssessorRegistration.js'
import { executeVE02LocalAssessment } from '../services/runtimeValidation/ve02LocalAssessment.js'

test('local assessor is independently default-off before any provider or native access', async () => {
  const previous = process.env.VE02_LOCAL_ASSESSMENT_ENABLED
  delete process.env.VE02_LOCAL_ASSESSMENT_ENABLED
  const classify = jest.fn(), resolveContext = jest.fn()
  try {
    await expect(executeVE02LocalAssessment({ input: {}, dependencies: { classify, resolveContext } }))
      .rejects.toMatchObject({ code: 'VE02_LOCAL_ASSESSOR_DISABLED', status: 403 })
    expect(classify).not.toHaveBeenCalled()
    expect(resolveContext).not.toHaveBeenCalled()
  } finally {
    if (previous === undefined) delete process.env.VE02_LOCAL_ASSESSMENT_ENABLED
    else process.env.VE02_LOCAL_ASSESSMENT_ENABLED = previous
  }
})
test.each(['production', 'staging', 'unknown'])('environment %s cannot activate the provisional assessor', value => {
  const previous = env.appEnv
  env.appEnv = value
  try { expect(() => assertVE02LocalEnvironment(true)).toThrow() } finally { env.appEnv = previous }
})
test('production rejects an internal enable flag even if the application environment says test', () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try { expect(() => assertVE02LocalEnvironment(true)).toThrow() } finally { process.env.NODE_ENV = previous }
})
const args = () => ({ query: { frameworkKey: 'QMF', packageKey: VE02_LOCAL_ASSESSOR.packageKey, packageVersion: '0.38.1' },
  binding: { activation: { activationId: 'active', versionId: 'installed', contentHash: 'content' }, source: { contentHash: 'content' } },
  classifierVersion: 'classifier-v1', model: 'gpt-4.1-mini' })
test.each(['frameworkKey', 'packageKey', 'packageVersion', 'model', 'binding'])('local activation rejects changed %s', field => {
  const input = args()
  if (field === 'binding') input.binding.activation.contentHash = 'changed'
  else if (field === 'model') input.model = 'other'
  else input.query[field] = 'other'
  expect(() => buildVE02LocalActivation(input)).toThrow()
})
test('activation identity binds installed version, model, classifier and Gary decision', () => {
  const input = args()
  const original = buildVE02LocalActivation(input)
  expect(original.authorityClass).toBe('STORYLINEOS_PROVISIONAL')
  expect(original.decisionRef).toBe(VE02_LOCAL_ASSESSOR.decisionRef)
  expect(buildVE02LocalActivation({ ...input, classifierVersion: 'classifier-v2' }).bindingHash).not.toBe(original.bindingHash)
  input.binding.activation.versionId = 'successor'
  expect(buildVE02LocalActivation(input).bindingHash).not.toBe(original.bindingHash)
})
