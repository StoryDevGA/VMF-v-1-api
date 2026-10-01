import env from './env.js'
import { createOpenAiOutcomeStudioProviderAdapter } from '../services/openAiOutcomeStudioProviderAdapter.js'
import { createOpenAiOutcomeFrameworkGuidanceProviderAdapter } from '../services/openAiOutcomeFrameworkGuidanceProviderAdapter.js'
import { createOpenAiOutcomeWorkingDraftProviderAdapter } from '../services/openAiOutcomeWorkingDraftProviderAdapter.js'
import { createOpenAiOutcomeArlMeaningReviewProviderAdapter } from '../services/openAiOutcomeArlMeaningReviewProviderAdapter.js'
import { createOpenAiOutcomeRenderedExpressionRlProviderAdapter } from '../services/openAiOutcomeRenderedExpressionRlProviderAdapter.js'

const STABLE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,138}[a-z0-9])?$/
const LIVE_TEST_APP_ENVIRONMENTS = new Set(['development', 'test'])
const GOVERNED_OUTCOME_STUDIO_MODEL = 'gpt-5.2'

const normalizedText = (value) => String(value || '').trim()

export const buildOutcomeStudioProviderRuntime = ({
  config = env,
  fetchImpl = globalThis.fetch,
  sleep,
} = {}) => {
  const disabledRuntime = (reason) => ({
    deps: { executionMode: 'LIVE_TEST' },
    status: { configured: false, reason },
  })

  if (config.outcomeStudioProviderEnabled !== true) {
    return disabledRuntime('PROVIDER_DISABLED')
  }
  const appEnvironment = normalizedText(config.appEnv).toLowerCase()
  if (config.isAppProduction === true || !LIVE_TEST_APP_ENVIRONMENTS.has(appEnvironment)) {
    return disabledRuntime('PRODUCTION_NOT_AUTHORIZED')
  }

  const providerKey = normalizedText(config.outcomeStudioProviderKey).toLowerCase()
  const model = normalizedText(config.outcomeStudioProviderModel)
  const apiKey = normalizedText(config.outcomeStudioProviderApiKey)
  if (providerKey !== 'openai'
    || !STABLE_KEY_PATTERN.test(providerKey)
    || !model
    || model.length > 160
    || !apiKey) {
    return disabledRuntime('PROVIDER_CONFIGURATION_INCOMPLETE')
  }
  if (model !== GOVERNED_OUTCOME_STUDIO_MODEL) {
    return disabledRuntime('PROVIDER_CONFIGURATION_UNSUPPORTED_MODEL')
  }

  const providerDescriptor = {
    providerKey,
    model,
    providerMode: 'LIVE_TEST',
    environment: 'TEST',
    safeContextPolicyKey: 'OUTCOME_STUDIO_PROVIDER_SAFE_CONTEXT_V1',
    failurePosture: 'FAIL_CLOSED',
  }
  const providerAdapter = createOpenAiOutcomeStudioProviderAdapter({
    apiKey,
    fetchImpl,
    maxOutputTokens: config.outcomeStudioProviderMaxOutputTokens,
    maxRetries: config.outcomeStudioProviderMaxRetries,
    model,
    providerKey,
    sleep,
    timeoutMs: config.outcomeStudioProviderTimeoutMs,
  })
  const frameworkGuidanceProviderAdapterFactory = ({ outputContract }) => (
    createOpenAiOutcomeFrameworkGuidanceProviderAdapter({
      apiKey,
      completionTimeoutMs: config.outcomeFrameworkGuidanceProviderCompletionTimeoutMs,
      fetchImpl,
      maxOutputTokens: config.outcomeStudioProviderMaxOutputTokens,
      maxRetries: config.outcomeStudioProviderMaxRetries,
      model,
      outputContract,
      providerKey,
      sleep,
      timeoutMs: config.outcomeStudioProviderTimeoutMs,
    })
  )
  const workingDraftProviderAdapterFactory = () => createOpenAiOutcomeWorkingDraftProviderAdapter({
      apiKey,
      completionTimeoutMs: 300000,
      fetchImpl,
      maxOutputTokens: 8000,
      maxRetries: 0,
      model,
      pollIntervalMs: 1000,
      providerKey,
      sleep,
      timeoutMs: 60000,
    })
  const arlMeaningReviewProviderAdapterFactory = () => createOpenAiOutcomeArlMeaningReviewProviderAdapter({
    apiKey,
    completionTimeoutMs: 300000,
    fetchImpl,
    maxOutputTokens: 4000,
    maxRetries: 0,
    model,
    pollIntervalMs: 1000,
    providerKey,
    sleep,
    timeoutMs: 60000,
  })
  const renderedExpressionRlProviderAdapterFactory = () => createOpenAiOutcomeRenderedExpressionRlProviderAdapter({
    apiKey,
    completionTimeoutMs: 300000,
    fetchImpl,
    maxOutputTokens: 4000,
    maxRetries: 0,
    model,
    pollIntervalMs: 1000,
    providerKey,
    sleep,
    timeoutMs: 60000,
  })

  return {
    deps: {
      executionMode: 'LIVE_TEST',
      providerAdapter,
      providerDescriptor,
      renderedExpressionRlProviderAdapterFactory,
      frameworkGuidanceProviderAdapterFactory,
      workingDraftProviderAdapterFactory,
      arlMeaningReviewProviderAdapterFactory,
    },
    status: {
      configured: true,
      reason: 'LIVE_TEST_PROVIDER_CONFIGURED',
      providerKey,
      model,
    },
  }
}

export default buildOutcomeStudioProviderRuntime
