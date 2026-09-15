export const AUDIT_SIGNATURE_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const invalidKeyring = () => new Error('Invalid environment configuration: AUDIT_SIGNATURE_KEYRING')
const invalidActiveKey = () => new Error('Invalid environment configuration: AUDIT_SIGNATURE_ACTIVE_KEY_ID')

export const parseAuditSigningConfig = (source) => {
  let keyring = {}
  const raw = source.AUDIT_SIGNATURE_KEYRING
  if (raw !== undefined && raw !== '') {
    try {
      keyring = JSON.parse(raw)
    } catch { throw invalidKeyring() }
    if (!keyring || Array.isArray(keyring) || Object.getPrototypeOf(keyring) !== Object.prototype
      || Object.entries(keyring).some(([id, secret]) => !AUDIT_SIGNATURE_KEY_ID_PATTERN.test(id)
        || typeof secret !== 'string' || secret.trim().length < 32)) {
      throw invalidKeyring()
    }
  }
  const activeKeyId = source.AUDIT_SIGNATURE_ACTIVE_KEY_ID || undefined
  if (activeKeyId !== undefined && (!AUDIT_SIGNATURE_KEY_ID_PATTERN.test(activeKeyId)
    || !Object.hasOwn(keyring, activeKeyId))) throw invalidActiveKey()
  return { keyring, activeKeyId }
}
