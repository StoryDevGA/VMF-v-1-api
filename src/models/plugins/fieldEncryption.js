/**
 * Mongoose Field Encryption Plugin
 *
 * Adds transparent encrypt-on-save / decrypt-on-read behaviour to
 * specified schema fields.  Optionally creates HMAC blind indexes
 * for searchable encrypted fields (e.g. email).
 *
 * Usage:
 *   import fieldEncryption from './plugins/fieldEncryption.js'
 *
 *   userSchema.plugin(fieldEncryption, {
 *     fields: ['email', 'name'],
 *     blindIndexFields: ['email'],
 *   })
 *
 * The plugin is a no-op when `env.fieldEncryptionEnabled` is false,
 * allowing gradual rollout.
 *
 * @module models/plugins/fieldEncryption
 */

import fieldEncryptionService from '../../services/fieldEncryptionService.js'
import env from '../../config/env.js'

/**
 * @param {import('mongoose').Schema} schema
 * @param {Object} options
 * @param {string[]} options.fields           — fields to encrypt/decrypt
 * @param {string[]} [options.blindIndexFields=[]] — subset of fields that
 *   need a deterministic blind index for equality lookups
 */
function fieldEncryption(schema, options = {}) {
  const { fields = [], blindIndexFields = [] } = options

  if (fields.length === 0) return

  /* ---- Add blind-index paths to the schema ---- */
  for (const field of blindIndexFields) {
    const indexPath = `${field}BlindIndex`
    schema.add({
      [indexPath]: {
        type: String,
        index: true,
      },
    })
  }

  /* ---- Pre-save: encrypt & compute blind indexes ---- */
  schema.pre('save', function encryptFields(next) {
    if (!env.fieldEncryptionEnabled) return next()

    try {
      for (const field of fields) {
        const value = this.get(field)
        if (value && !fieldEncryptionService.isEncrypted(value)) {
          this.set(field, fieldEncryptionService.encrypt(value))
        }
      }

      for (const field of blindIndexFields) {
        const raw = this.get(field)
        // Decrypt first if already encrypted so the blind index is
        // always derived from the plaintext value.
        const plain = fieldEncryptionService.isEncrypted(raw)
          ? fieldEncryptionService.decrypt(raw)
          : raw
        if (plain) {
          this.set(
            `${field}BlindIndex`,
            fieldEncryptionService.createBlindIndex(plain),
          )
        }
      }

      next()
    } catch (err) {
      next(err)
    }
  })

  /* ---- Post-read hooks: decrypt transparently ---- */

  const decryptDoc = (doc) => {
    if (!env.fieldEncryptionEnabled || !doc) return
    for (const field of fields) {
      const value = doc.get ? doc.get(field) : doc[field]
      if (value && fieldEncryptionService.isEncrypted(value)) {
        if (doc.set) {
          doc.set(field, fieldEncryptionService.decrypt(value))
        } else {
          doc[field] = fieldEncryptionService.decrypt(value)
        }
      }
    }
  }

  schema.post('init', decryptDoc)

  schema.post('find', (docs) => {
    if (!Array.isArray(docs)) return
    for (const doc of docs) decryptDoc(doc)
  })

  schema.post('findOne', decryptDoc)
  schema.post('findOneAndUpdate', decryptDoc)

  /* ---- Static helper: look up by blind index ---- */

  /**
   * Find a document by a blind-indexed field value.
   *
   * @param {string} field     — the field name (must be in blindIndexFields)
   * @param {string} plaintext — the plaintext value to search for
   * @returns {import('mongoose').Query}
   */
  schema.statics.findByBlindIndex = function findByBlindIndex(field, plaintext) {
    const hash = fieldEncryptionService.createBlindIndex(plaintext)
    return this.findOne({ [`${field}BlindIndex`]: hash })
  }
}

export default fieldEncryption
