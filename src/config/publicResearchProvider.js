import { publicResearchOperatingPolicySchema, publicResearchFailure } from '../services/publicResearchContract.js'

// Privileged server configuration only. Reading availability never resolves keys
// when operating configuration is missing, invalid or expired.
export const readPublicResearchOperatingPolicy = (values = process.env) => {
  if (values.APP_ENV !== 'development' || !values.PUBLIC_RESEARCH_OPERATING_POLICY) return null
  try {
    const raw = values.PUBLIC_RESEARCH_OPERATING_POLICY
    if (Buffer.byteLength(raw) > 32768) return null
    const parsed = publicResearchOperatingPolicySchema.safeParse(JSON.parse(raw))
    return parsed.success && Date.parse(parsed.data.expiresAt) > Date.now() ? parsed.data : null
  } catch { return null }
}
export const resolvePublicResearchCredential = (operation, values = process.env) => {
  const key = operation === 'TAVILY_SEARCH' ? 'TAVILY_API_KEY'
    : operation === 'COMPANIES_HOUSE_PROFILE' ? 'COMPANIES_HOUSE_API_KEY' : null
  if (!key || typeof values[key] !== 'string' || !values[key].trim()) publicResearchFailure('PUBLIC_RESEARCH_CREDENTIAL_UNAVAILABLE')
  return values[key]
}
