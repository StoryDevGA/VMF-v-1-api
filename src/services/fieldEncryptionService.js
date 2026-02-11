/**
 * Field-Level Encryption Service
 *
 * Provides AES-256-GCM encryption / decryption for PII fields and
 * HMAC-SHA256 blind indexes for searchable encrypted lookups.
 *
 * Encrypted values are stored in the format:
 *   `enc:v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>`
 *
 * Environment:
 *   FIELD_ENCRYPTION_KEY — 64-character hex string (32 bytes)
 *   FIELD_ENCRYPTION_ENABLED — boolean flag (default false)
 *
 * @module services/fieldEncryptionService
 */

import crypto from 'crypto'
import env from '../config/env.js'

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96 bits — recommended for GCM
const TAG_LENGTH = 16 // 128 bits — default for GCM
const PREFIX = 'enc:v1:'

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

class FieldEncryptionService {
  constructor() {
    /** @type {Buffer|null} */
    this._keyBuffer = null
  }

  /* ---- Key management ---- */

  /**
   * Derive the 32-byte AES key from the hex environment variable.
   * Throws if the key is missing or malformed.
   * @param {string} [keyOverride] — hex key override for testing
   * @returns {Buffer}
   */
  _getKey(keyOverride) {
    if (keyOverride) return Buffer.from(keyOverride, 'hex')
    if (this._keyBuffer) return this._keyBuffer

    const hex = env.fieldEncryptionKey
    if (!hex || hex.length !== 64) {
      throw new Error(
        'FIELD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
      )
    }
    this._keyBuffer = Buffer.from(hex, 'hex')
    return this._keyBuffer
  }

  /**
   * Clear the cached key buffer (for testing / key rotation).
   */
  clearKeyCache() {
    this._keyBuffer = null
  }

  /* ---- Encryption ---- */

  /**
   * Encrypt a plaintext string using AES-256-GCM.
   *
   * @param {string} plaintext — value to encrypt
   * @param {string} [keyHex]  — optional hex key override
   * @returns {string} Encrypted string in `enc:v1:...` format, or the
   *   original value if it is falsy or already encrypted.
   */
  encrypt(plaintext, keyHex) {
    if (!plaintext || typeof plaintext !== 'string') return plaintext
    if (this.isEncrypted(plaintext)) return plaintext

    const key = this._getKey(keyHex)
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_LENGTH,
    })

    let ciphertext = cipher.update(plaintext, 'utf8')
    ciphertext = Buffer.concat([ciphertext, cipher.final()])
    const tag = cipher.getAuthTag()

    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
  }

  /* ---- Decryption ---- */

  /**
   * Decrypt an encrypted string previously produced by {@link encrypt}.
   *
   * @param {string} encrypted — value in `enc:v1:...` format
   * @param {string} [keyHex]  — optional hex key override
   * @returns {string} Original plaintext, or the input unchanged if it
   *   is falsy or not in the encrypted format.
   * @throws {Error} If the ciphertext has been tampered with (GCM auth failure).
   */
  decrypt(encrypted, keyHex) {
    if (!encrypted || typeof encrypted !== 'string') return encrypted
    if (!this.isEncrypted(encrypted)) return encrypted

    const key = this._getKey(keyHex)
    const payload = encrypted.slice(PREFIX.length)
    const parts = payload.split(':')

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format — expected 3 segments after prefix')
    }

    const [ivB64, tagB64, cipherB64] = parts
    const iv = Buffer.from(ivB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    const ciphertext = Buffer.from(cipherB64, 'base64')

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_LENGTH,
    })
    decipher.setAuthTag(tag)

    let plaintext = decipher.update(ciphertext, null, 'utf8')
    plaintext += decipher.final('utf8')

    return plaintext
  }

  /* ---- Detection ---- */

  /**
   * Check whether a value is in the encrypted format.
   * @param {*} value
   * @returns {boolean}
   */
  isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX)
  }

  /* ---- Blind index ---- */

  /**
   * Create a deterministic HMAC-SHA256 blind index for a value.
   * Used for equality lookups on encrypted fields (e.g. email).
   *
   * The input is lowercased and trimmed before hashing to ensure
   * case-insensitive matching.
   *
   * @param {string} value   — plaintext to index
   * @param {string} [keyHex] — optional hex key override
   * @returns {string|null} 64-character hex hash, or null for falsy input
   */
  createBlindIndex(value, keyHex) {
    if (!value || typeof value !== 'string') return null
    const key = this._getKey(keyHex)
    return crypto
      .createHmac('sha256', key)
      .update(value.toLowerCase().trim())
      .digest('hex')
  }

  /* ---- Utility ---- */

  /**
   * Generate a random 32-byte hex key suitable for FIELD_ENCRYPTION_KEY.
   * @returns {string} 64-character hex string
   */
  static generateKey() {
    return crypto.randomBytes(32).toString('hex')
  }
}

export default new FieldEncryptionService()
export { FieldEncryptionService }
