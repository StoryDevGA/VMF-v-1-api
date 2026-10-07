import { makeSs040Fixture } from './ss040EvidenceToMeaningFixtures.js'
import { assembleOutcomeEvidenceInventory } from '../../utils/outcomeEvidenceSnapshot.js'
import { EVIDENCE_TO_DRAFT_INPUT_VERSION } from '../../services/outcomeEvidenceToDraftContractService.js'

export const freezeSs041Snapshot = async (input, { inventoryCount = input.sourceSnapshot.evidenceObjects.length,
  extraReferences = [], allSelected = false, scopeOverride = {}, sourceSections = null } = {}) => {
  const scope = { customerId: 'customer', tenantId: 'tenant', runtimeInstanceId: input.composition.runtimeBinding.runtimeInstanceId, stateVersion: 'ss041-frozen', ...scopeOverride }
  const evidence = input.sourceSnapshot.evidenceObjects.map((row, index) => ({ ...row, ...scope,
    _id: String(index).padStart(6, '0') }))
  while (evidence.length < inventoryCount) evidence.push({ ...scope, _id: String(evidence.length).padStart(6, '0'),
    evidenceObjectId: `inventory-${evidence.length}`, sourceId: 'source-1', extractedFact: 'Inventory metadata only.', proofDependency: [] })
  const sources = input.sourceSnapshot.sourceRegistry.map((row, index) => ({ ...row, ...scope, _id: `source-${index}` }))
  const target = input.selectedTarget.receipt.targetSections
  const sections = sourceSections || [...target.required, ...target.optional].map((section) => ({ sectionKey: section.targetSectionKey,
    references: [...input.composition.businessFactLedger.facts.filter((fact) => fact.sectionKeys.includes(section.targetSectionKey)).map((fact) => fact.evidenceObjectId),
      ...input.composition.businessFactLedger.omitted.filter((fact) => fact.sectionKeys.includes(section.targetSectionKey)).map((fact) => fact.reference),
      ...extraReferences.filter((entry) => entry.sectionKey === section.targetSectionKey).map((entry) => entry.reference),
      ...(allSelected && section === target.required[0] ? evidence.map((row) => row.evidenceObjectId) : [])] }))
  const rows = { evidence, sources }
  const result = await assembleOutcomeEvidenceInventory({ scope, sections,
    contradictionReferences: (input.sourceSnapshot.discoveryHealth?.contradictionCandidates || []).flatMap((entry) => entry.evidenceObjectIds),
    readPage: async (kind, after, limit) => rows[kind].filter((row) => after === null || row._id > after).slice(0, limit),
    count: async (kind) => rows[kind].length, validateRows: () => {} })
  input.sourceSnapshot = { ...input.sourceSnapshot, evidenceObjects: result.evidenceObjects,
    sourceRegistry: result.sourceRegistry, inventoryReceipt: result.receipt }
  return input
}

export const makeSs041Fixture = async (options = {}) => {
  const scenarios = {
    Parlon: { required: ['Executive Summary', 'Evidence Boundary'], domain: 'decision-process' },
    'StorylineOS internal VMF': { required: ['Runtime Governance', 'Evidence Boundary'], domain: 'runtime-governance' },
    BuildQM: { required: ['Quality Context', 'Validation Boundary'], domain: 'quality-management' },
    CodeKarma: { required: ['Engineering Context', 'Delivery Constraints'], domain: 'engineering-delivery' },
    Routeability: { required: ['Routing Context', 'Service Boundaries'], optional: ['Economics'], domain: 'routing-service' },
    IdentityPlus: { required: ['Identity Context', 'Access Constraints'], domain: 'identity-access' },
  }
  const scenario = options.required ? {} : scenarios[options.name] || {}
  const input = makeSs040Fixture({ ...scenario, ...options })
  input.composition.contractVersion = EVIDENCE_TO_DRAFT_INPUT_VERSION
  input.sourceSnapshot.evidenceObjects.forEach((row) => Object.assign(row, {
    claimStatus: 'SOURCE_PRESENTED', sourceLocation: 'source-1#documented-decision',
    scope: { organisation: options.name || 'Synthetic', domain: scenario.domain || 'decision-process' },
    time: { from: '2026-01-01', to: '2026-10-01' }, materiality: 'SOURCE_RECORDED',
    proofOrderDisposition: 'NOT_ESTABLISHED', proofRequirementCodes: ['ATTRIBUTION'],
  }))
  if (options.name === 'CodeKarma') input.sourceSnapshot.evidenceObjects.forEach((row) => Object.assign(row, {
    claimStatus: 'ESTABLISHED', independentValidation: { reference: 'synthetic-verification-record', validatedBy: 'synthetic-independent-reviewer' } }))
  if (options.name === 'Routeability') input.composition.businessFactLedger.omitted.push({
    reference: 'scoped_view', sectionKeys: ['economics'], reason: 'REFERENCE_UNRESOLVED' })
  if (options.name === 'BuildQM') {
    input.sourceSnapshot.evidenceObjects[1].qualificationOf = 'evidence-0'
    input.sourceSnapshot.discoveryHealth.contradictionCandidates = [{ contradictionId: 'synthetic-quality-qualification',
      evidenceObjectIds: ['evidence-0', 'evidence-1'], basis: 'Explicit source qualification', domain: 'quality-management' }]
  }
  if (options.name === 'IdentityPlus') {
    input.sourceSnapshot.evidenceObjects[1].validationStatus = 'REQUIRES_VALIDATION'
    const fact = input.composition.businessFactLedger.facts.find((entry) => entry.evidenceObjectId === 'evidence-1')
    input.composition.businessFactLedger.facts = input.composition.businessFactLedger.facts.filter((entry) => entry !== fact)
    input.composition.businessFactLedger.omitted.push({ reference: 'evidence-1', sectionKeys: fact.sectionKeys, reason: 'EVIDENCE_NOT_VALIDATED' })
  }
  return freezeSs041Snapshot(input, options)
}
