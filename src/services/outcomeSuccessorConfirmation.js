import { createHmac, randomUUID } from 'node:crypto'
import env from '../config/env.js'
import encryption from './fieldEncryptionService.js'
import { hashOutcomeSuccessorValue, outcomeSuccessorError } from './outcomeSuccessorContract.js'

const PURPOSE = 'outcome-studio.successor-confirmation'
const TTL_MS = 30 * 60 * 1000
export const OUTCOME_SUCCESSOR_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const key = (deps) => {
  const secret = deps.receiptSecret || env.jwtSecret
  if (typeof secret !== 'string' || secret.length < 32) throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONFIRMATION_UNAVAILABLE', 503)
  return createHmac('sha256', secret).update(`${PURPOSE}:encryption:v1`).digest('hex')
}
const now = (deps) => (deps.now || Date.now)()
export const sealOutcomeSuccessorConfirmation = (binding, deps = {}) => {
  const issuedAt = now(deps)
  return encryption.encrypt(JSON.stringify({ purpose: PURPOSE, version: 1, nonce: randomUUID(),
    ...binding, issuedAt, expiresAt: issuedAt + TTL_MS }), key(deps))
}
export const openOutcomeSuccessorConfirmation = (receipt, deps = {}, { allowExpired = false } = {}) => {
  try {
    if (typeof receipt !== 'string' || receipt.length > 32768 || !encryption.isEncrypted(receipt)) throw new Error('shape')
    const binding = JSON.parse(encryption.decrypt(receipt, key(deps)))
    if (binding.purpose !== PURPOSE || binding.version !== 1
      || !OUTCOME_SUCCESSOR_UUID.test(binding.requestId) || !OUTCOME_SUCCESSOR_UUID.test(binding.idempotencyKey)
      || !binding.actorUserId || !binding.source?.sourceHash || !binding.target?.stateVersion
      || !/^[a-f0-9]{64}$/.test(binding.source?.sourceVersionWitnessHash)
      || !/^[a-f0-9]{64}$/.test(binding.metadataFingerprint)
      || !Number.isSafeInteger(binding.issuedAt) || !Number.isSafeInteger(binding.expiresAt)
      || binding.issuedAt > now(deps) || binding.expiresAt - binding.issuedAt !== TTL_MS
      || (!allowExpired && binding.expiresAt <= now(deps))) throw new Error('claims')
    return binding
  } catch { throw outcomeSuccessorError('OUTCOME_SUCCESSOR_CONFIRMATION_INVALID', 403) }
}
export const outcomeSuccessorConfirmationFingerprint = (binding) => hashOutcomeSuccessorValue({
  actorUserId: binding.actorUserId, idempotencyKey: binding.idempotencyKey, requestId: binding.requestId,
  source: binding.source, target: binding.target, metadataFingerprint: binding.metadataFingerprint,
  intentFingerprint: binding.intentFingerprint, contractFingerprint: binding.contractFingerprint,
})
