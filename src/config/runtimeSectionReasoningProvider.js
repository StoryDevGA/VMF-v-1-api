import env from './env.js'
import { createOpenAiRuntimeSectionReasoningAdapter, validateSectionReasoningEffort } from '../services/openAiRuntimeSectionReasoningAdapter.js'
import { VMF_SECTION_REASONING_CONTRACT_VERSION } from '../constants/runtimeSectionReasoningContract.js'

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

  let reasoningEffort
  try {
    reasoningEffort = validateSectionReasoningEffort(model, config.vmfSectionReasoningProviderReasoningEffort)
  } catch {
    return disabled('PROVIDER_REASONING_CONFIGURATION_INVALID')
  }

  const providerDescriptor = {
    providerKey,
    model,
    providerMode: 'LIVE_TEST',
    environment: 'TEST',
    contractVersion: VMF_SECTION_REASONING_CONTRACT_VERSION,
    failurePosture: 'FAIL_CLOSED',
    ...(reasoningEffort ? { reasoningEffort } : {}),
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
      reasoningEffort,
      sleep,
      timeoutMs: config.vmfSectionReasoningProviderTimeoutMs,
    }),
  }
}

// Whitelist the receipt fields: never copy credentials, adapters or extra config.
const safeProviderContext = (descriptor) => {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
    || descriptor.providerKey !== 'openai' || descriptor.providerMode !== 'LIVE_TEST'
    || descriptor.contractVersion !== VMF_SECTION_REASONING_CONTRACT_VERSION
    || typeof descriptor.model !== 'string' || !descriptor.model.trim()
    || descriptor.model !== descriptor.model.trim() || descriptor.model.length > 200) throw new TypeError('Invalid section provider context.')
  if (Object.hasOwn(descriptor, 'reasoningEffort')
    && (typeof descriptor.reasoningEffort !== 'string' || !descriptor.reasoningEffort)) throw new TypeError('Invalid section provider effort receipt.')
  const effort = validateSectionReasoningEffort(descriptor.model, descriptor.reasoningEffort)
  return {
    providerKey: descriptor.providerKey,
    model: descriptor.model,
    providerMode: descriptor.providerMode,
    contractVersion: descriptor.contractVersion,
    ...(effort ? { reasoningEffort: effort } : {}),
  }
}

export const compareSectionProviderContext = ({ previousProvider, currentRuntime } = {}) => {
  const conflict = (code) => Object.assign(new Error('Section provider context cannot be established.'), { code })
  let previousProviderContext
  try { previousProviderContext = safeProviderContext(previousProvider) } catch {
    throw conflict('SECTION_PROVIDER_CONTEXT_INVALID')
  }
  let currentProviderContext
  try {
    if (currentRuntime?.status?.configured !== true) throw new Error('Unavailable')
    currentProviderContext = safeProviderContext(currentRuntime.providerDescriptor)
  } catch { throw conflict('SECTION_PROVIDER_CONTEXT_UNAVAILABLE') }
  return {
    previousProviderContext,
    currentProviderContext,
    changed: JSON.stringify(previousProviderContext) !== JSON.stringify(currentProviderContext),
  }
}

export default buildRuntimeSectionReasoningProviderRuntime
