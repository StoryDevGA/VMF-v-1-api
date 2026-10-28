import { describe, expect, test } from '@jest/globals'
import { makeSs041Fixture, freezeSs041Snapshot } from './fixtures/outcomeEvidenceToDraftFixtures.js'
import { compileEvidenceToMeaningContract } from '../services/outcomeEvidenceToMeaningContractService.js'
import { projectEvidenceToMeaningProviderContract, assertEvidenceToMeaningBoundedProviderOutput } from '../services/outcomeEvidenceToMeaningProviderService.js'
import { WORKING_DRAFT_COMPOSITION_VERSION, WORKING_DRAFT_READER_COMPOSITION_VERSION, WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION, WORKING_DRAFT_METADATA_COMPOSITION_VERSION, WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION, WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION, WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION, WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION, workingDraftReaderHeading, isWorkingDraftCompositionIdentity, composeEvidenceBoundWorkingDraftSections, isWorkingDraftCompositionRevision, isFreshArlAfterCompositionRevision } from '../services/outcomeWorkingDraftCompositionService.js'
import { assertOutcomeQualityStageRetryLineage } from '../services/outcomeQualityStageExecutionService.js'
import { OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS } from '../constants/outcomeGovernedQuality.js'

const fixture = async (required = ['Executive Summary', 'Evidence Boundary']) => {
  const input = await makeSs041Fixture({ required })
  input.composition.businessFactLedger.facts[0].sectionKeys = required.map(value => value.toLowerCase().replace(/ /g, '-'))
  await freezeSs041Snapshot(input)
  const projection = projectEvidenceToMeaningProviderContract(compileEvidenceToMeaningContract(input))
  const content = composeEvidenceBoundWorkingDraftSections(projection)
  const output = { title: 'Working Draft', compositionVersion: WORKING_DRAFT_COMPOSITION_VERSION, assumptions: [], visibleGaps: [],
    sections: projection.sectionLedger.filter(x => x.status === 'SUPPORTED').map((row, i) => ({ sectionKey: row.targetSectionKey, title: row.heading,
      claims: row.claimKeys.map(key => projection.claimProjections.find(x => x.claimKey === key)), content: content[i].content, assumptions: [], gaps: [] })),
    decisionLogic: projection.decisionProjections }
  return { projection, output }
}
describe('exact evidence-bound composition', () => {
  test('quotes once while preserving all placements, qualifications and unranked decisions', async () => {
    const { projection, output } = await fixture(), original = JSON.stringify(projection)
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output })).not.toThrow()
    const statement = projection.claimProjections[0].statement
    expect(output.sections[0].content).toContain(statement)
    expect(output.sections[1].content).not.toContain(statement)
    expect(output.sections[1].content).toContain('not independent corroboration')
    const prose = output.sections.map(x => x.content).join(' ')
    for (const row of Object.values(projection.claimMetadataDictionary)) {
      for (const qualification of row.qualification) expect(prose).toContain(JSON.stringify(qualification).slice(1, -1))
      for (const restriction of row.blockedStrongerClaim) expect(prose).toContain(JSON.stringify(restriction).slice(1, -1))
    }
    expect(prose).toContain('not priority or proof')
    expect(output.decisionLogic.every(x => x.priority === 'NOT_ESTABLISHED' && x.actionAuthorization === 'NONE')).toBe(true)
    expect(JSON.stringify(projection)).toBe(original)
    expect(composeEvidenceBoundWorkingDraftSections(projection)).toEqual(composeEvidenceBoundWorkingDraftSections(projection))
  })
  test.each([
    ['unknown marker', o => { o.compositionVersion = 'future' }],
    ['removed marker', o => { delete o.compositionVersion }],
    ['unsupported prose', o => { o.sections[0].content += ' Benefits are proven.' }],
    ['rewritten claim', o => { o.sections[0].claims[0].statement = 'The trial is authorised.' }],
    ['priority upgrade', o => { o.decisionLogic[0].priority = 'HIGH' }],
    ['permission upgrade', o => { o.decisionLogic[0].actionAuthorization = 'EXECUTE' }],
    ['dropped limitation', o => { o.sections[0].content = o.sections[0].content.split('Exact recorded scope')[0].trim() }],
  ])('rejects %s', async (_name, alter) => {
    const { projection, output } = await fixture(), changed = structuredClone(output); alter(changed)
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output: changed })).toThrow()
  })
  test('reader attribution removes only template claim labels and preserves exact structured records', async () => {
    const { projection, output } = await fixture(), before = structuredClone(output)
    const reader = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_READER_COMPOSITION_VERSION)
    output.compositionVersion = WORKING_DRAFT_READER_COMPOSITION_VERSION
    output.sections.forEach((row, index) => { row.content = reader[index].content })
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output })).not.toThrow()
    for (const [index, row] of output.sections.entries()) {
      expect(row.claims).toEqual(before.sections[index].claims)
      expect({ ...row, content: '' }).toEqual({ ...before.sections[index], content: '' })
      for (const claim of projection.claimProjections) expect(row.content).not.toContain(claim.claimKey)
      const expected = before.sections[index].content.replace(/Attributed statement claim_[a-z0-9]+: /g, 'Attributed statement: ')
        .replace(/Evidence claim_[a-z0-9]+: see its unchanged attributed statement/g, 'See the unchanged attributed statement')
      expect(row.content).toBe(expected)
    }
    expect(output.decisionLogic).toEqual(before.decisionLogic)
    expect(output.sections[0].content).toContain(projection.claimProjections[0].statement)
    expect(output.sections[1].content).toContain('not independent corroboration')
    expect(composeEvidenceBoundWorkingDraftSections(projection)).toEqual(before.sections.map(({ sectionKey, content }) => ({ sectionKey, content })))
    const mismatched = structuredClone(output); mismatched.compositionVersion = WORKING_DRAFT_COMPOSITION_VERSION
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output: mismatched })).toThrow()
    expect(() => composeEvidenceBoundWorkingDraftSections(projection, 'future')).toThrow()
  })
  test('removes only the proven extraction prefix in reader prose, leaving source records exact', async () => {
    const { projection } = await fixture(), key = projection.claimProjections[0].claimKey
    const claim = projection.claimProjections.find(row => row.claimKey === key)
    const recorded = projection.customerClaims.find(row => row.claimKey === key)
    claim.statement = recorded.statement = 'Document Customer Document: Access review remains outstanding. Execution is not authorised.'
    recorded.attribution = { sourceType: 'UPLOADED_DOCUMENT', sourceLabel: 'Customer Document: controlled.txt' }
    const before = JSON.stringify(projection)
    const render = version => composeEvidenceBoundWorkingDraftSections(projection, version)[0].content
    expect(render(WORKING_DRAFT_READER_COMPOSITION_VERSION)).toContain('Attributed statement: Access review remains outstanding. Execution is not authorised.')
    expect(render(WORKING_DRAFT_READER_COMPOSITION_VERSION)).not.toContain('Document Customer Document: ')
    expect(render(WORKING_DRAFT_COMPOSITION_VERSION)).toContain(claim.statement)
    expect(JSON.stringify(projection)).toBe(before)
    recorded.attribution.sourceType = 'WEBSITE'
    expect(render(WORKING_DRAFT_READER_COMPOSITION_VERSION)).toContain(claim.statement)
    recorded.attribution.sourceType = 'UPLOADED_DOCUMENT'; recorded.attribution.sourceLabel = 'Unverified label'
    expect(render(WORKING_DRAFT_READER_COMPOSITION_VERSION)).toContain(claim.statement)
    recorded.attribution.sourceLabel = 'Customer Document: controlled.txt'; claim.statement = 'Authored label: Document Customer Document: must remain.'
    expect(render(WORKING_DRAFT_READER_COMPOSITION_VERSION)).toContain(claim.statement)
  })
  test('composition identity pins both historical and current configurations exactly', () => {
    const old = OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V43_EVIDENCE_BOUND_COMPOSITION
    const current = OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V44_READER_FACING_ATTRIBUTION
    expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_COMPOSITION_VERSION, configurationVersion: old })).toBe(true)
    expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_READER_COMPOSITION_VERSION, configurationVersion: current })).toBe(true)
    expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_COMPOSITION_VERSION, configurationVersion: current })).toBe(false)
    expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_READER_COMPOSITION_VERSION, configurationVersion: old })).toBe(false)
  })
  test('V3 maps only the exact next-action heading and preserves links and historical templates', async () => {
    const { projection, output } = await fixture(['Next legal downstream action', 'Evidence Boundary'])
    const before = structuredClone(projection), v2 = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_READER_COMPOSITION_VERSION)
    const composed = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION)
    output.compositionVersion = WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION
    output.sections.forEach((row, index) => {
      const source = projection.sectionLedger.filter(x => x.status === 'SUPPORTED')[index]
      row.sectionKey = source.targetSectionKey; row.title = workingDraftReaderHeading(source, output.compositionVersion); row.content = composed[index].content
    })
    expect(output.sections[0].title).toBe('Decision gate and outstanding prerequisites')
    expect(output.sections[0].content).toContain('Neither consideration nor this draft authorises execution')
    expect(output.sections[1].content).toContain('Decision gate and outstanding prerequisites')
    expect(output.sections.map(x => x.title + x.content).join(' ')).not.toContain('Next legal downstream action')
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output })).not.toThrow()
    expect(projection).toEqual(before)
    expect(composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_READER_COMPOSITION_VERSION)).toEqual(v2)
    expect(workingDraftReaderHeading(before.sectionLedger[0], WORKING_DRAFT_READER_COMPOSITION_VERSION)).toBe('Next legal downstream action')
    expect(workingDraftReaderHeading({ ...before.sectionLedger[0], heading: 'Authored custom heading' }, output.compositionVersion)).toBe('Authored custom heading')
    expect(workingDraftReaderHeading({ targetSectionKey: 'other', heading: 'Next legal downstream action' }, output.compositionVersion)).toBe('Next legal downstream action')
    for (const alter of [o => { o.sections[0].title = 'Next legal downstream action' }, o => { o.sections[0].title = 'Approved action' }, o => { o.compositionVersion = WORKING_DRAFT_READER_COMPOSITION_VERSION }, o => { o.sections[0].claims[0].statement = 'Execution authorised' }]) {
      const changed = structuredClone(output); alter(changed)
      expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output: changed })).toThrow()
    }
    expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION, configurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V45_DECISION_GATE_WORDING })).toBe(true)
    expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION, configurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V44_READER_FACING_ATTRIBUTION })).toBe(false)
  })
  test('V4 separates proven native inputs in labelled quoted blocks without changing their records', async () => {
    const { projection } = await fixture()
    const base = projection.customerClaims[0], claim = projection.claimProjections.find(x => x.claimKey === base.claimKey)
    const fields = [['input_targetOffer', 'Target Product or Offer', 'Target offer: Bounded trial'], ['input_companyName', 'Company Name', 'Company name: Synthetic Review'], ['input_marketRegion', 'Market / Region', 'Market or region: Internal review']]
    projection.customerClaims = fields.map(([sourceReference, sourceLabel, statement], index) => ({ ...structuredClone(base), claimKey: 'claim_separate' + index, sourceReference, attribution: { sourceType: 'DISCOVERY_NOTES', sourceLabel }, statement }))
    projection.claimProjections = projection.customerClaims.map(row => ({ ...structuredClone(claim), claimKey: row.claimKey, statement: row.statement }))
    projection.sectionLedger.forEach(row => { row.claimKeys = projection.customerClaims.map(x => x.claimKey) })
    const before = structuredClone(projection)
    const sections = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION)
    for (const [, label, statement] of fields) expect(sections[0].content).toContain(`Separately attributed input (${label}):\n\n> ${statement}`)
    expect(sections[0].content).toContain('Bounded trial\n\nSeparately attributed input (Company Name)')
    expect(sections[1].content).toContain('See the unchanged attributed statement')
    expect(projection).toEqual(before)
    const historical = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION)
    expect(historical[0].content).toContain('Attributed statement: Target offer: Bounded trial Attributed statement: Company name: Synthetic Review')
    projection.customerClaims[0].attribution.sourceLabel = 'Unverified label'
    let rendered = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION)[0].content
    expect(rendered).not.toContain('Separately attributed input (Target Product or Offer)')
    expect(rendered).toContain('Attributed statement: Target offer: Bounded trial')
    projection.customerClaims[0].attribution.sourceLabel = 'Target Product or Offer'; projection.customerClaims[0].attribution.sourceType = 'WEBSITE'
    rendered = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION)[0].content
    expect(rendered).not.toContain('Separately attributed input (Target Product or Offer)')
    projection.customerClaims[0].attribution.sourceType = 'DISCOVERY_NOTES'; projection.customerClaims[0].statement = 'Different stored statement'
    expect(composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION)[0].content).not.toContain('Separately attributed input (Target Product or Offer)')
    projection.customerClaims[0].statement = projection.claimProjections[0].statement = 'Target offer: "Quoted" input\nwith qualification'
    expect(composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION)[0].content).toContain('> Target offer: "Quoted" input\n> with qualification')
    expect(workingDraftReaderHeading({ targetSectionKey: 'next-legal-downstream-action', heading: 'Next legal downstream action' }, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION)).toBe('Decision gate and outstanding prerequisites')
  })
  test('V4 exact paragraphs pass the consumer; collapsed or merged attribution fails', async () => {
    const { projection, output } = await fixture()
    const before = structuredClone(output), composed = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION)
    output.compositionVersion = WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION
    output.sections.forEach((row, index) => { row.content = composed[index].content })
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output })).not.toThrow()
    for (const [index, row] of output.sections.entries()) expect({ ...row, content: '' }).toEqual({ ...before.sections[index], content: '' })
    const collapsed = structuredClone(output); collapsed.sections[0].content = collapsed.sections[0].content.replace(/\s+/g, ' ')
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output: collapsed })).toThrow()
  })
  test('legacy unmarked exact-copy validator remains available', async () => {
    const { projection, output } = await fixture(); delete output.compositionVersion
    output.sections.forEach(x => { x.content = x.claims.map(c => c.statement).join(' ') })
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output })).not.toThrow()
  })
})

const lineage = () => {
  const latest = { attemptNumber: 3, stageKey: 'WORKING_DRAFT', status: 'SUCCEEDED', stageExecutionId: 'old-draft', attemptFingerprint: 'd'.repeat(64), outputFingerprint: 'a'.repeat(64), qualityRunId: 'same-run', planFingerprint: 'p', inputFingerprint: 'same-input', inputSnapshot: { sourceStage: { stageExecutionId: 'fg', outputFingerprint: 'g' } } }
  const arl = { stageKey: 'ARL_MEANING_REVIEW', status: 'FAILED', stageExecutionId: 'old-arl', attemptFingerprint: 'b'.repeat(64), planFingerprint: 'p', qualityRunId: 'same-run', failure: { failureCode: 'ARL_MEANING_REVIEW_REQUIRED_CHANGE', retryable: false }, inputSnapshot: { sourceStage: { stageExecutionId: latest.stageExecutionId, attemptFingerprint: latest.attemptFingerprint, outputFingerprint: latest.outputFingerprint } } }
  const revision = { draftStageExecutionId: latest.stageExecutionId, draftOutputFingerprint: latest.outputFingerprint, arlStageExecutionId: arl.stageExecutionId, arlAttemptFingerprint: arl.attemptFingerprint }
  return { latest, arl, revision }
}
describe('corrective draft and fresh ARL lineage', () => {
  test.each([[WORKING_DRAFT_COMPOSITION_VERSION, OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V43_EVIDENCE_BOUND_COMPOSITION], [WORKING_DRAFT_READER_COMPOSITION_VERSION, OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V44_READER_FACING_ATTRIBUTION], [WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION, OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V45_DECISION_GATE_WORDING], [WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION, OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V46_SEPARATE_INPUT_ATTRIBUTION]])('composition %s is eligible only against its exact prior failed meaning review', (version, configurationVersion) => {
    const { latest, arl, revision } = lineage()
    expect(isWorkingDraftCompositionRevision({ latest, remediation: arl, revision })).toBe(true)
    const candidate = { stageKey: 'WORKING_DRAFT', status: 'SUCCEEDED', executionIdentity: { providerConfigurationVersion: configurationVersion }, outputSnapshot: { compositionVersion: version, compositionRevision: revision }, inputSnapshot: latest.inputSnapshot, predecessorStageExecutionId: latest.stageExecutionId, predecessorAttemptFingerprint: latest.attemptFingerprint, qualityRunId: latest.qualityRunId, planFingerprint: latest.planFingerprint, inputFingerprint: latest.inputFingerprint }
    expect(() => assertOutcomeQualityStageRetryLineage({ candidate, latest, remediation: arl })).not.toThrow()
    expect(() => assertOutcomeQualityStageRetryLineage({ candidate, latest, remediation: { ...arl, status: 'SUCCEEDED' } })).toThrow()
  })
  test.each(['draftStageExecutionId', 'draftOutputFingerprint', 'arlStageExecutionId', 'arlAttemptFingerprint'])('rejects changed %s', field => {
    const { latest, arl, revision } = lineage(); revision[field] = 'changed'
    expect(isWorkingDraftCompositionRevision({ latest, remediation: arl, revision })).toBe(false)
  })
  test('one fresh review requires changed output and an exact remedial source link', () => {
    const { latest, arl, revision } = lineage(), source = { ...latest, outputFingerprint: 'new', outputSnapshot: { compositionVersion: WORKING_DRAFT_COMPOSITION_VERSION, compositionRevision: revision } }
    expect(isFreshArlAfterCompositionRevision({ latest: arl, source })).toBe(true)
    expect(isFreshArlAfterCompositionRevision({ latest: arl, source: { ...source, outputFingerprint: latest.outputFingerprint } })).toBe(false)
    expect(isFreshArlAfterCompositionRevision({ latest: { ...arl, status: 'SUCCEEDED' }, source })).toBe(false)
    expect(isFreshArlAfterCompositionRevision({ latest: { ...arl, planFingerprint: 'foreign' }, source })).toBe(false)
  })
})


describe('verbatim metadata presentation', () => {
  test('V5 separates scope and currentness and binds each statement to its exact set without changing metadata', async () => {
    const { projection } = await fixture(['Title and Decision Context', 'Source and Lineage Record'])
    const before = structuredClone(projection)
    const sections = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_METADATA_COMPOSITION_VERSION)
    const content = sections.map(x => x.content).join('\n\n')
    const firstClaim = projection.customerClaims[0]
    const meta = firstClaim.metadataRef ? projection.claimMetadataDictionary[firstClaim.metadataRef] : firstClaim
    expect(content).toContain(`Scope (verbatim):\n\n> ${(typeof meta.scope === 'string' ? meta.scope : JSON.stringify(meta.scope, null, 2)).replace(/\n/g, '\n> ')}`)
    expect(content).toContain(`Time/currentness (verbatim):\n\n> ${(typeof meta.time === 'string' ? meta.time : JSON.stringify(meta.time, null, 2)).replace(/\n/g, '\n> ')}`)
    expect(content).toContain('Recorded qualification set 1 applies to this statement.')
    for (const key of ['qualification', 'blockedStrongerClaim']) for (const value of meta[key]) expect(content).toContain(`> ${value.replace(/\n/g, '\n> ')}`)
    for (const value of firstClaim.evidenceRequiredToSubstantiate) expect(content).toContain(`> ${value.replace(/\n/g, '\n> ')}`)
    expect(content).toContain('not a new current-review or execution decision')
    expect(content).not.toContain('"scope":')
    expect(content).not.toContain('undefined')
    expect(projection).toEqual(before)
  })
  test('V5 preserves multiline quotes, source labels and empty lists without inventing values', async () => {
    const { projection } = await fixture()
    const claim = projection.customerClaims[0], meta = claim.metadataRef ? projection.claimMetadataDictionary[claim.metadataRef] : claim
    meta.scope = 'Synthetic scope "quoted".\nSecond scope line.'
    meta.time = 'Capture time only.\nNo effective date established.'
    meta.qualification = ['Historical R2 finding remains UNREVIEWED in this source record.']
    meta.blockedStrongerClaim = []; claim.evidenceRequiredToSubstantiate = []
    const before = structuredClone(projection), text = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_METADATA_COMPOSITION_VERSION).map(x => x.content).join('\n')
    expect(text).toContain('> Synthetic scope "quoted".\n> Second scope line.')
    expect(text).toContain('Time/currentness (verbatim):\n\n> Capture time only.\n> No effective date established.')
    expect(text).toContain('> Historical R2 finding remains UNREVIEWED in this source record.')
    expect(text).toContain('Prohibited stronger claims (verbatim):\n\n(No items recorded.)')
    expect(text).toContain('Hypothetical substantiation requirements (verbatim):\n\n(No items recorded.)')
    expect(projection).toEqual(before)
  })
  test('V1–V4 retain raw metadata behavior and only V5 uses labelled verbatim groups', async () => {
    const { projection } = await fixture()
    for (const version of [WORKING_DRAFT_COMPOSITION_VERSION, WORKING_DRAFT_READER_COMPOSITION_VERSION, WORKING_DRAFT_DECISION_GATE_COMPOSITION_VERSION, WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION]) {
      const text = composeEvidenceBoundWorkingDraftSections(projection, version).map(x => x.content).join('\n')
      expect(text).toContain('"scope":'); expect(text).not.toContain('Scope (verbatim):')
    }
    expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_METADATA_COMPOSITION_VERSION,
      configurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V47_METADATA_PRESENTATION })).toBe(true)
    expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_SEPARATE_INPUT_COMPOSITION_VERSION,
      configurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V47_METADATA_PRESENTATION })).toBe(false)
  })
  test('consumer accepts exact V5 groups and rejects swapped scope/time or omitted qualification', async () => {
    const { projection, output } = await fixture()
    output.compositionVersion = WORKING_DRAFT_METADATA_COMPOSITION_VERSION
    const sections = composeEvidenceBoundWorkingDraftSections(projection, output.compositionVersion)
    output.sections.forEach((row, index) => { row.content = sections[index].content })
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output })).not.toThrow()
    const limits = output.sections.find(x => x.content.includes('Scope (verbatim):'))
    limits.content = limits.content.replace('Scope (verbatim):', 'Time/currentness (verbatim):')
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output })).toThrow()
    limits.content = sections.find(x => x.sectionKey === limits.sectionKey).content.replace('Recorded qualifications (verbatim):', '')
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output })).toThrow()
  })
})


describe('document-owned qualification presentation', () => {
  const mixedProjection = async () => {
    const { projection } = await fixture(), base = structuredClone(projection.customerClaims[0]), projected = structuredClone(projection.claimProjections[0])
    const old = base.metadataRef ? projection.claimMetadataDictionary[base.metadataRef] : base
    projection.claimMetadataDictionary = { shared: { ...structuredClone(old), qualification: ['DOCUMENT_ONE_ONLY'] }, other: { ...structuredClone(old), qualification: ['DOCUMENT_TWO_ONLY'] } }
    const rows = [
      ['doc-one', 'UPLOADED_DOCUMENT', 'document_one', 'Document one', 'First document statement.', 'shared', 'commercial-diagnosis'],
      ['doc-two', 'UPLOADED_DOCUMENT', 'document_two', 'Document two', 'Second document statement.', 'other', 'decision-requested'],
      ['intake', 'DISCOVERY_NOTES', 'input_companyName', 'Company Name', 'Company name: Synthetic', 'shared', 'title-and-decision-context'],
      ['website', 'WEBSITE', 'website_one', 'Website', 'Website statement.', 'shared', 'title-and-decision-context'],
    ]
    projection.customerClaims = rows.map(([claimKey, sourceType, sourceReference, sourceLabel, statement, metadataRef, section]) => ({ ...structuredClone(base), claimKey, sourceReference,
      evidenceReference: 'evidence_' + claimKey, attribution: { sourceType, sourceLabel }, statement, metadataRef, sectionKeys: [section] }))
    projection.claimProjections = projection.customerClaims.map(row => ({ ...structuredClone(projected), claimKey: row.claimKey, statement: row.statement, truthReferences: row.sectionKeys, evidence: [row.statement, row.attribution.sourceLabel] }))
    projection.sectionLedger = ['title-and-decision-context', 'commercial-diagnosis', 'decision-requested', 'source-and-lineage-record'].map(targetSectionKey => ({ targetSectionKey, heading: targetSectionKey, status: 'SUPPORTED', claimKeys: projection.customerClaims.filter(row => row.sectionKeys.includes(targetSectionKey)).map(row => row.claimKey) }))
    return projection
  }
  test('shared metadata never transfers document qualifications to intake or website claims', async () => {
    const projection = await mixedProjection(), before = structuredClone(projection), rendered = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION)
    const text = key => rendered.find(row => row.sectionKey === key).content
    expect(text('title-and-decision-context')).toContain('User-provided intake (Company Name):\n\n> Company name: Synthetic')
    expect(text('title-and-decision-context')).not.toContain('DOCUMENT_ONE_ONLY')
    expect(text('title-and-decision-context')).not.toContain('Qualifications recorded')
    expect(text('commercial-diagnosis')).toContain('First document statement.\n\nQualifications recorded with this document-derived statement (verbatim):\n\n> DOCUMENT_ONE_ONLY')
    expect(text('commercial-diagnosis')).not.toContain('DOCUMENT_TWO_ONLY')
    expect(text('decision-requested')).toContain('> DOCUMENT_TWO_ONLY')
    expect(text('decision-requested')).not.toContain('DOCUMENT_ONE_ONLY')
    expect(text('source-and-lineage-record')).not.toContain('DOCUMENT_ONE_ONLY')
    expect(rendered.map(row => row.content).join(' ')).not.toContain('Recorded qualification set')
    expect(projection).toEqual(before)
  })
  test('unproven or mismatched source bindings never acquire document qualifications', async () => {
    for (const alter of [
      p => { p.customerClaims[0].attribution.sourceType = 'UNKNOWN' },
      p => { p.customerClaims[0].statement = 'Different stored statement' },
      p => { p.customerClaims[0].sourceReference = '' },
      p => { p.customerClaims[0].evidenceReference = '' },
      p => { p.customerClaims[0].sectionKeys = [] },
      p => { p.claimProjections[0].evidence = ['Unrelated source label'] },
    ]) {
      const projection = await mixedProjection(); alter(projection)
      const text = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION).find(row => row.sectionKey === 'commercial-diagnosis').content
      expect(text).not.toContain('DOCUMENT_ONE_ONLY')
      expect(text).not.toContain('Qualifications recorded')
    }
  })
  test('empty qualifications add no prose; malformed values fail and multiline values remain exact', async () => {
    const projection = await mixedProjection(), metadata = projection.claimMetadataDictionary.shared
    metadata.qualification = []
    const render = () => composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION).find(row => row.sectionKey === 'commercial-diagnosis').content
    expect(render()).not.toContain('Qualifications recorded')
    metadata.qualification = ['Historical "quoted" restriction.\nNo execution authority.']
    expect(render()).toContain('> Historical "quoted" restriction.\n> No execution authority.')
    for (const invalid of [undefined, null, 'not-an-array', [null], ['']]) { metadata.qualification = invalid; expect(render).toThrow('Recorded document qualification is invalid.') }
  })
  test('valid compiled V6 output passes the consumer and injected applicability wording fails', async () => {
    const { projection, output } = await fixture()
    output.compositionVersion = WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION
    const composed = composeEvidenceBoundWorkingDraftSections(projection, output.compositionVersion)
    output.sections.forEach((row, index) => { row.content = composed[index].content })
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output })).not.toThrow()
    output.sections[0].content += '\n\nRecorded qualification set 2 applies to this statement.'
    expect(() => assertEvidenceToMeaningBoundedProviderOutput({ projection, output })).toThrow()
    expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION, configurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V48_DOCUMENT_SCOPED_QUALIFICATIONS })).toBe(true)
    expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_METADATA_COMPOSITION_VERSION, configurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V48_DOCUMENT_SCOPED_QUALIFICATIONS })).toBe(false)
  })
})


test('V7 uses one complete repeated-evidence sentence and preserves first-use material and all structured links', async () => {
  const { projection } = await fixture(), before = JSON.stringify(projection)
  const old = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_SCOPED_QUALIFICATION_COMPOSITION_VERSION)
  const fresh = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION)
  expect(fresh[0]).toEqual(old[0])
  expect(fresh[1].content).toContain('This section repeats previously attributed evidence; repetition does not provide independent corroboration.')
  expect(fresh[1].content).not.toContain('See the unchanged attributed statement in')
  expect(fresh[1].content).not.toMatch(/(?:^|\n)\s*[.;,]/)
  expect(JSON.stringify(projection)).toBe(before)
  expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION,
    configurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V49_COMPLETE_EVIDENCE_REFERENCE })).toBe(true)
  expect(isWorkingDraftCompositionIdentity({ version: WORKING_DRAFT_COMPLETE_REFERENCE_COMPOSITION_VERSION,
    configurationVersion: OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V48_DOCUMENT_SCOPED_QUALIFICATIONS })).toBe(false)
})


describe('whole-section composition', () => {
  const documentProjection = async () => {
    const { projection } = await fixture(['Commercial Diagnosis', 'Source And Lineage Record'])
    const raw = projection.customerClaims[0], claim = projection.claimProjections[0]
    raw.statement = claim.statement = 'Document Customer Document: A possible activity is described.'
    raw.sourceReference = 'document_alpha'; raw.evidenceReference = 'evidence_alpha'
    raw.attribution = { sourceType: 'UPLOADED_DOCUMENT', sourceLabel: 'Customer Document: controlled.txt' }
    claim.evidence = [raw.attribution.sourceLabel]
    projection.customerClaims = [raw]; projection.claimProjections = [claim]
    projection.sectionLedger.forEach(row => { row.claimKeys = [raw.claimKey] })
    return projection
  }
  test('retains exact own quotes in every section and links only their own qualification group', async () => {
    const projection = await documentProjection(), before = JSON.stringify(projection)
    const sections = composeEvidenceBoundWorkingDraftSections(projection, WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION)
    expect(sections).toHaveLength(2)
    for (const section of sections) {
      expect(section.content).toContain('A possible activity is described.')
      expect(section.content).toContain('document qualifications 1 in Source and lineage record')
      expect(section.content).not.toContain('This section repeats previously attributed evidence')
    }
    expect(sections[0].content).toContain('Commercial diagnosis:')
    expect(sections[1].content).toContain('Source record:')
    const raw = projection.customerClaims[0], metadata = raw.metadataRef ? projection.claimMetadataDictionary[raw.metadataRef] : raw
    for (const q of metadata.qualification) expect(sections[1].content).toContain(q)
    expect(JSON.stringify(projection)).toBe(before)
    expect(isWorkingDraftCompositionIdentity({version:WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION,configurationVersion:OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V50_HOLISTIC_COMPOSITION})).toBe(true)
  })
  test('separates intake from document qualifications even when historical metadata contains them', async () => {
    const projection = await documentProjection(), raw = projection.customerClaims[0], claim = projection.claimProjections[0]
    raw.sourceReference = 'input_targetOffer'; raw.attribution = { sourceType:'DISCOVERY_NOTES',sourceLabel:'Target Product or Offer' }
    raw.statement = claim.statement = 'Target offer: Proposed activity'; claim.evidence = [raw.attribution.sourceLabel]
    const out = composeEvidenceBoundWorkingDraftSections(projection,WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION)
    expect(out[0].content).toContain('User-provided intake (Target Product or Offer)')
    expect(out.map(x=>x.content).join(' ')).not.toContain('document qualifications 1')
  })
  test.each(['sourceReference','evidenceReference'])('fails closed for missing %s ownership', async key=>{
    const p=await documentProjection();p.customerClaims[0][key]=''
    expect(()=>composeEvidenceBoundWorkingDraftSections(p,WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION)).toThrow('ownership')
  })
  test('requires a catalogue destination for document qualifications',async()=>{
    const p=await documentProjection();p.sectionLedger=p.sectionLedger.slice(0,1)
    expect(()=>composeEvidenceBoundWorkingDraftSections(p,WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION)).toThrow('catalogue section')
  })
  test('uses a neutral frame for missing or ambiguous roles rather than inventing a decision',async()=>{
    const p=await documentProjection();p.sectionLedger[0].targetSectionKey='next-legal-downstream-action';p.customerClaims[0].sectionKeys.push('next-legal-downstream-action')
    const out=composeEvidenceBoundWorkingDraftSections(p,WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION)
    expect(out[0].content).toContain('do not uniquely establish all three')
    expect(out[0].content).not.toContain('What this record supports now:')
  })
})


describe('decision-frame role boundaries',()=>{
  const roles=async()=>{
    const {projection:p}=await fixture(['Next Legal Downstream Action','Source And Lineage Record'])
    const seed=p.customerClaims[0], projected=p.claimProjections[0]
    const values=['The decision is whether the bounded trial may be considered after access review; this source does not authorize trial execution.','Access review remains outstanding.','this source does not authorize trial execution.']
    p.customerClaims=values.map((statement,i)=>({...structuredClone(seed),claimKey:'role_'+i,statement:'Document Customer Document: '+statement,sourceReference:i===1?'document_condition':'document_question',evidenceReference:'evidence_'+i,attribution:{sourceType:'UPLOADED_DOCUMENT',sourceLabel:i===1?'Customer Document: condition.txt':'Customer Document: question.txt'}}))
    p.claimProjections=p.customerClaims.map(raw=>({...structuredClone(projected),claimKey:raw.claimKey,statement:raw.statement,evidence:[raw.attribution.sourceLabel]}))
    p.sectionLedger.forEach(row=>{row.claimKeys=p.customerClaims.map(x=>x.claimKey)})
    return p
  }
  const render=p=>composeEvidenceBoundWorkingDraftSections(p,WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION)[0].content
  test('separately attributes the prerequisite and keeps exact quotations without invented permission',async()=>{
    const p=await roles(),text=render(p)
    expect(text).toContain('Question under consideration:');expect(text).toContain('Separately recorded outstanding prerequisite:')
    expect(text).toContain('Source authority boundary:');expect(text).toContain('Completing a prerequisite would not itself supply that permission.')
    expect(text).toContain('condition.txt');expect(text).toContain('question.txt')
    for(const raw of p.customerClaims)expect(text).toContain(raw.statement.slice('Document Customer Document: '.length))
  })
  test.each(['quotation','negation','missing','duplicate','mismatched condition','mixed authority sources'])('neutral fallback for %s',async kind=>{
    const p=await roles()
    if(kind==='missing'){p.sectionLedger[0].claimKeys.pop()}
    else if(kind==='duplicate'){const raw=structuredClone(p.customerClaims[1]);raw.claimKey='duplicate';p.customerClaims.push(raw);p.claimProjections.push({...structuredClone(p.claimProjections[1]),claimKey:raw.claimKey});p.sectionLedger[0].claimKeys.push(raw.claimKey)}
    else if(kind==='mixed authority sources'){p.customerClaims[2].sourceReference='another_document'}
    else {const text=kind==='quotation'?'The document quotes "Access review remains outstanding."':kind==='negation'?'It is not true that Access review remains outstanding.':'Security review remains outstanding.';p.customerClaims[1].statement=p.claimProjections[1].statement='Document Customer Document: '+text}
    expect(render(p)).toContain('do not uniquely establish all three');expect(render(p)).not.toContain('What this record supports now:');expect(render(p)).not.toContain('following source statements distinguish')
  })
  test('V9 describes the verified statements without creating an approval process',async()=>{
    const p=await roles();p.sectionLedger[0].heading='Next legal downstream action'
    const before=JSON.stringify(p),old=render(p)
    const rows=composeEvidenceBoundWorkingDraftSections(p,WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION),text=rows[0].content
    expect(workingDraftReaderHeading(p.sectionLedger[0],WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION)).toBe('Recorded question and review context')
    expect(text).toContain('These three quoted statements must not be read as assigning an execution approver')
    expect(text).toContain('defining an approval procedure, or granting permission after review')
    expect(text).not.toContain('Decision frame:')
    expect(text).toContain('Outstanding access review, from its own source:')
    for(const raw of p.customerClaims)expect(text).toContain(raw.statement.slice('Document Customer Document: '.length))
    expect(rows[1]).toEqual(composeEvidenceBoundWorkingDraftSections(p,WORKING_DRAFT_HOLISTIC_COMPOSITION_VERSION)[1])
    expect(render(p)).toBe(old);expect(JSON.stringify(p)).toBe(before)
    expect(isWorkingDraftCompositionIdentity({version:WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION,configurationVersion:OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V51_DESCRIPTIVE_DECISION_CONTEXT})).toBe(true)
    expect(isWorkingDraftCompositionIdentity({version:WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION,configurationVersion:OUTCOME_WORKING_DRAFT_PROVIDER_CONFIG_VERSIONS.OPENAI_RESPONSES_V50_HOLISTIC_COMPOSITION})).toBe(false)
  })
  test('V9 fallback title and prose do not invent an outstanding access review',async()=>{
    const p=await roles();p.sectionLedger[0].heading='Next legal downstream action';p.sectionLedger[0].claimKeys=p.sectionLedger[0].claimKeys.filter(k=>k!=='role_1')
    const text=composeEvidenceBoundWorkingDraftSections(p,WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION)[0].content
    expect(workingDraftReaderHeading(p.sectionLedger[0],WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION)).toBe('Recorded question and review context')
    expect(text).toContain('do not uniquely establish all three');expect(text).not.toContain('These three quoted statements')
    expect(text).not.toContain('Access review remains outstanding.')
  })
  test('V9 scoped caveat retains other mapped authority statements rather than denying their existence',async()=>{
    const p=await roles(),raw={...structuredClone(p.customerClaims[0]),claimKey:'additional_statement',statement:'Document Customer Document: The source names a fictional execution approver and procedure.'}
    p.customerClaims.push(raw);p.claimProjections.push({...structuredClone(p.claimProjections[0]),claimKey:raw.claimKey,statement:raw.statement});p.sectionLedger[0].claimKeys.push(raw.claimKey)
    const text=composeEvidenceBoundWorkingDraftSections(p,WORKING_DRAFT_DESCRIPTIVE_COMPOSITION_VERSION)[0].content
    expect(text).toContain('The source names a fictional execution approver and procedure.')
    expect(text).toContain('These three quoted statements must not be read as assigning')
    expect(text).not.toContain('The supplied record does not establish who')
  })

})
