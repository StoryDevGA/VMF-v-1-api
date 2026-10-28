import { createHash } from 'node:crypto'

// One adopted documentary amendment, never an official VMF adjudication.
export const SYNTHETIC_TEST_DISPOSITION_POLICY = Object.freeze({
  reference: 'ss044-non-authoritative-synthetic-pipeline-amendment.2026-10-16.v1',
  version: 1,
  receiptType: 'NON_AUTHORITATIVE_TEST_DISPOSITION_RECEIPT',
  mode: 'NON_AUTHORITATIVE_TEST_DISPOSITION',
  documentHash: '5f1f39d75a4a1b5b6d32eb9eb8e122d1dd12ccf169c7f0f6e62e6a3de2e4634b',
  documentBytes: 5461,
  recorderUserId: '698b3800f83b3257365fd7a3',
  approvedAt: '2026-10-16T15:27:18Z',
})
export const parseSyntheticTestAmendment = text => {
  const policy = SYNTHETIC_TEST_DISPOSITION_POLICY
  if (typeof text !== 'string' || Buffer.byteLength(text) !== policy.documentBytes
    || createHash('sha256').update(text).digest('hex') !== policy.documentHash)
    throw new Error('The exact adopted synthetic amendment is required.')
  return JSON.parse(text)
}
