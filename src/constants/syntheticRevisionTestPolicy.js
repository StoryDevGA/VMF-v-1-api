import { SYNTHETIC_TEST_DISPOSITION_POLICY as amendment } from './syntheticTestDispositionPolicy.js'

// Prospective implementation scope supplied by the Product Owner. This is not
// a human disposition, an official assessor delegation or execution approval.
export const SYNTHETIC_REVISION_TEST_POLICY = Object.freeze({
  reference: 'ss044-r3-synthetic-test-binding.2026-10-20.v1', version: 1,
  scopeBindingHash: 'faafbec1723e46a95553fb8a7fcef5808840aa479e7118df6df606606944676e',
  amendmentReference: amendment.reference, amendmentHash: amendment.documentHash,
  classification: 'NON_AUTHORITATIVE_SYNTHETIC_DEV_TEST',
  customerId: '6a6c75f2cace7a21bd41ef98', tenantId: '6a6c76e3cace7a21bd41eff9',
  runtimeInstanceId: '6ad715c91f39fea112115875',
  runtimeInstanceKey: 'ss044-disposable-synthetic-20261013-r1-rev-2-0f316453-rev-3-12115875',
  parentRuntimeId: '6ad4b3cab439648c0f316453', rootRuntimeId: '6ace5ee09bd4472c6be0cb07',
  revisionNumber: 3, initialStateVersion: 'rsv2:1844649e-4a5d-450f-b694-60c64088d67b',
  initialUpdatedAt: '2026-10-20T07:30:45.246Z',
  initialMaterialHash: '10fd82a165c119ea03c65457be73909044ad81fb02211fc02fe22b4d52fc9ddf',
  contradictionId: 'contradiction_8d1dc05d4ca9',
  rootEvidencePairHash: 'sha256:433db4bbdfb61df8b936b7c2cbcecd9dac5095ac88a84f37b80b29305ccff8da',
  recorderUserId: amendment.recorderUserId,
})
export const isSyntheticRevisionTestRuntime = runtime => String(runtime?._id || runtime?.id || '')
  === SYNTHETIC_REVISION_TEST_POLICY.runtimeInstanceId
