import env from '../config/env.js'

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '')

const buildAuthLink = (rawToken) => {
  const base = trimTrailingSlash(env.appBaseUrl || 'http://localhost:8000')
  return `${base}/api/v1/super-admin/invitations/auth/${rawToken}`
}

const computeExpiryDate = () => {
  const ttlMs = env.invitationExpiryHours * 60 * 60 * 1000
  return new Date(Date.now() + ttlMs)
}

const buildIdentityPlusRedirectUrl = (invitationId) => {
  const fallback = `${trimTrailingSlash(env.clientBaseUrl || 'http://localhost:5173')}/invitation-auth`
  const base = env.identityPlusAuthUrl || fallback

  try {
    const url = new URL(base)
    url.searchParams.set('invitationId', invitationId.toString())
    return url.toString()
  } catch {
    return `${fallback}?invitationId=${encodeURIComponent(invitationId.toString())}`
  }
}

const buildInvitationErrorUrl = (reason) => {
  const base = trimTrailingSlash(env.clientBaseUrl || 'http://localhost:5173')
  return `${base}/invitation-error?reason=${encodeURIComponent(reason)}`
}

const invitationService = {
  buildAuthLink,
  computeExpiryDate,
  buildIdentityPlusRedirectUrl,
  buildInvitationErrorUrl,
}

export default invitationService
