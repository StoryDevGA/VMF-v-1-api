// Metadata/decoder projections only; generic pixels are not persistence or review evidence.
import { createHash } from 'node:crypto'
import { CORRECTED_DOCX_IDENTITY as fixed, CORRECTED_DOCX_HASHES as hashes, controlledScope } from '../../services/controlledDocxReadContract.js'
const masterBinding = {
  "contractVersion": "master-linked-private-docx-binding.v2",
  "masterReference": {
    "storageId": "6ae391015d71cde1230052af",
    "masterId": "meaning_master_7f34d431-6640-482e-8695-75cd6f76883c",
    "version": 1,
    "scope": {
      "tenantId": "6a6c76e3cace7a21bd41eff9",
      "customerId": "6a6c75f2cace7a21bd41ef98",
      "runtimeInstanceId": "6ad715c91f39fea112115875"
    },
    "bodyFingerprint": "9fa90c527e0f797223d12997136d702e617232f22aac7e7f1b64846688f43581",
    "sourceFingerprint": "51cc8bf0b164db4e60438cb1559e62bf9a19b3cb2ebff4ffb0522f3ea57a9891",
    "sourceProjectionFingerprint": "f19cee55729177ec3a64df33835b5f70f9b215e958df7e71b85f3e45fddb0e96",
    "auditId": "6ae391015d71cde1230052b0",
    "auditSignatureVersion": 3
  },
  "expressionOrigin": "VERSIONED_COMMERCIAL_CORRECTION_UNREVIEWED",
  "wrapperFingerprint": "0858b508a14a19b84a5e98de101a3cb05a78ab11552bbbfc7db312a167f891ee",
  "correctionReference": {
    "predecessor": {
      "candidateId": "docx_candidate_45e4cd08-6750-4ebf-88d2-a97c81dc3d4b",
      "inputFingerprint": "c5a0f6039a2296619188388d8506dc2fd6fd97ba5799a89d31e6b7fec87d6d37",
      "outputChecksum": "sha256:a97d7831465cf5f13dab5acee6946d31d6acce00c93214619cfa09657800ff00",
      "failedReviewExecutionId": "master_docx_result_5766391dc7a21de7c6dfcb591a0c5bc2ef98909f",
      "failedReviewResultFingerprint": "d1156af367532dbdcdfecedd7c32bb04142aa765f389efbeb77a892b1f34606f"
    },
    "predecessorBodyFingerprint": "3c7aae91beb489a300a64a82ea69d24dc6edb18907e6b2246ab9e3bdb38a52be"
  }
}
const flags = { classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST', authoritative: false, officialUse: false,
  normalOutputAvailable: false, authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false }
export const correctedReadListFixture = () => ({ scope: controlledScope(), sourceFingerprint: hashes.sourceFingerprint, candidates: [{
  ...flags, contractVersion: 'private-docx-candidate.v2', candidateId: fixed.candidateId, status: 'PRIVATE_UNREVIEWED',
  sourceFingerprint: hashes.sourceFingerprint, inputFingerprint: hashes.inputFingerprint, bodyFingerprint: hashes.bodyFingerprint,
  masterBindingFingerprint: hashes.masterBindingFingerprint, masterBinding: JSON.parse(JSON.stringify(masterBinding)), renderer: { version: '0.1.3' },
  artifact: { format: 'DOCX', byteLength: 13688, outputChecksum: hashes.outputChecksum },
}] })
export const correctedReadBundleFixture = () => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  const bytes = Buffer.from(base64, 'base64'), candidate = correctedReadListFixture().candidates[0]
  const conversion = { contractVersion: 'DOCX_PAGE_PREVIEW_V1', docxChecksum: hashes.outputChecksum,
    pages: Array.from({ length: 7 }, (_, index) => ({ number: index + 1, width: 1, height: 1, byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') })) }
  return { preview: { ...flags, contractVersion: 'private-docx-page-preview.v2', status: 'PRIVATE_PREVIEW_ONLY',
    previewId: fixed.previewId, candidateId: fixed.candidateId, scope: controlledScope(), renderer: candidate.renderer,
    sourceFingerprint: hashes.sourceFingerprint, inputFingerprint: hashes.inputFingerprint, candidateBodyFingerprint: hashes.bodyFingerprint,
    masterBindingFingerprint: hashes.masterBindingFingerprint, conversion,
    conversionFingerprint: createHash('sha256').update(JSON.stringify(conversion)).digest('hex') },
    pages: conversion.pages.map(page => ({ number: page.number, mimeType: 'image/png', base64 })),
    document: { title: 'Generic unit projection', markdown: '# Generic unit projection', inputFingerprint: hashes.inputFingerprint } }
}

