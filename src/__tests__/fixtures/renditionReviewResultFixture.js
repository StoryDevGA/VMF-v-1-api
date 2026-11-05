import { visualReviewOutput } from './docxVisualReviewFixture.js'
import { createOpenAiDocxRenditionReviewProviderAdapter } from '../../services/openAiDocxRenditionReviewProviderAdapter.js'

// Fake fetch and optional fake acknowledgements only; never a genuine review.
export const makeSimulatedOwnedReview = async (transport, failed = false, callbacks = {}) => {
  let clock = Date.parse('2026-10-28T19:10:00.000Z')
  const adapter = createOpenAiDocxRenditionReviewProviderAdapter({ apiKey: 'isolated-fake-key', now: () => clock,
    reserveDispatch: async binding => ({ ...binding, state: 'DURABLE_DISPATCH_RESERVED' }),
    recordResponseIdentity: async identity => ({ ...identity, state: 'DURABLE_RESPONSE_ID_RECORDED' }),
    fetchImpl: async () => { clock += 12; return { ok: true, status: 200, headers: { get: () => 'req_result_test' },
      text: async () => JSON.stringify({ id: 'resp_result_test', status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(visualReviewOutput(failed)) }] }] }) } }, ...callbacks })
  return adapter(transport)
}

