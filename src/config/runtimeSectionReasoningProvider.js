import env from './env.js'
import { createOpenAiRuntimeSectionReasoningAdapter } from '../services/openAiRuntimeSectionReasoningAdapter.js'

const LIVE_TEST_APP_ENVIRONMENTS = new Set(['development', 'test'])
const STABLE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,138}[a-z0-9])?$/
const text = (value) => String(value || '').trim()

export const buildRuntimeSectionReasoningProviderRuntime = ({
  config = env,
  fetchImpl = globalThis.fetch,
  sleep,
} = {}) => {
  const disabled = (reason) => ({
    status: { configured: false, reason },
    providerAdapter: null,
    providerDescriptor: null,
  })
  if (config.vmfSectionReasoningProviderEnabled !== true) return disabled('PROVIDER_DISABLED')
  const appEnvironment = text(config.appEnv).toLowerCase()
  if (config.isAppProduction === true || !LIVE_TEST_APP_ENVIRONMENTS.has(appEnvironment)) {
    return disabled('PRODUCTION_NOT_AUTHORIZED')
  }
  const providerKey = text(config.vmfSectionReasoningProviderKey).toLowerCase()
  const model = text(config.vmfSectionReasoningProviderModel)
  const apiKey = text(config.vmfSectionReasoningProviderApiKey)
  if (providerKey !== 'openai' || !STABLE_KEY_PATTERN.test(providerKey) || !model || !apiKey) {
    return disabled('PROVIDER_CONFIGURATION_INCOMPLETE')
  }

  const providerDescriptor = {
    providerKey,
    model,
    providerMode: 'LIVE_TEST',
    environment: 'TEST',
    contractVersion: 'ss-016-vmf-section-reasoning-v1',
    failurePosture: 'FAIL_CLOSED',
  }
  return {
    status: { configured: true, reason: 'LIVE_TEST_PROVIDER_CONFIGURED', providerKey, model },
    providerDescriptor,
    providerAdapter: createOpenAiRuntimeSectionReasoningAdapter({
      apiKey,
      fetchImpl,
      maxOutputTokens: config.vmfSectionReasoningProviderMaxOutputTokens,
      maxRetries: config.vmfSectionReasoningProviderMaxRetries,
      model,
      providerKey,
      sleep,
      timeoutMs: config.vmfSectionReasoningProviderTimeoutMs,
    }),
  }
}

export default buildRuntimeSectionReasoningProviderRuntime
