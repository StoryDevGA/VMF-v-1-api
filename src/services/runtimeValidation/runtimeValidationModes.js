export const RUNTIME_VALIDATION_MODES = Object.freeze({
  STRICT: 'STRICT',
  WARN_ONLY: 'WARN_ONLY',
  AUDIT_ONLY: 'AUDIT_ONLY',
  DISABLED: 'DISABLED',
})

export const normalizeRuntimeValidationMode = (value) => {
  const normalized = String(value || RUNTIME_VALIDATION_MODES.STRICT).trim().toUpperCase()
  return Object.values(RUNTIME_VALIDATION_MODES).includes(normalized)
    ? normalized
    : RUNTIME_VALIDATION_MODES.STRICT
}
