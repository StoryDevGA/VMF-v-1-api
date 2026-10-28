import { createHash } from 'node:crypto'

// This is an import contract for one already approved document, not an authority generator.
export const RUNTIME_PRODUCT_AUTHORITY_POLICY = Object.freeze({
  contractVersion: 'runtime-product-authority-receipt.v1',
  approvalReference: 'ss044-temporary-synthetic-product-authority.2026-10-16.v1',
  version: 1,
  documentHash: 'f8db0fe0dec87691843987132ef3a4e449c64313e11e7755282e5d15742f71b8',
  documentBytes: 7143,
  reviewerUserId: '6a6c763dcace7a21bd41efa9',
})

export const parseApprovedProductAuthority = text => {
  const policy = RUNTIME_PRODUCT_AUTHORITY_POLICY
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') !== policy.documentBytes
    || createHash('sha256').update(text, 'utf8').digest('hex') !== policy.documentHash)
    throw new Error('The exact approved authority document is required.')
  return JSON.parse(text)
}
