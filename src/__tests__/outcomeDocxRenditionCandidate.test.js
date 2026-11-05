import { describe, expect, test } from '@jest/globals'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { buildOutcomeStudioRenderableAsset, computeOutcomeStudioRenderableSourceChecksum } from '../services/outcomeStudioAssetRenderingService.js'
import { prepareOutcomeDocxRenditionCandidate, OUTCOME_DOCX_RENDITION_CAPABILITY } from '../services/outcomeDocxRenditionCandidateService.js'

// Isolated contract data; no approved customer fixture, signed receipt or native source.
const checksum = 'sha256:' + 'a'.repeat(64)
const receipt = (packKey, extra = {}) => ({ packKey, versionId: `${packKey}-v1`, version: '1.0.0', contentHash: checksum, status: 'RESOLVED', ...extra })
const input = (sections = [{ key: 'options', label: 'Options', blocks: [
  { type: 'PARAGRAPH', text: 'The result is provisional & requires <additional> evidence.'.replace('<additional>', 'additional') },
  { type: 'SOURCE_NOTE', label: 'Source restriction', text: 'This finding applies only to the observed sample.' },
  { type: 'QUOTATION', text: 'The participant requested a second observation.' },
  { type: 'INTAKE', label: 'Information needed', text: 'Obtain the agreed baseline.' },
  { type: 'LIST', text: 'Compare the two options.' },
  { type: 'TABLE', text: '| Option | Status |\n| --- | --- |\n| One | Unverified |' },
] }, { key: 'next', label: 'Next decision', blocks: [{ type: 'HEADING', text: 'Decision boundary' },
  { type: 'CALLOUT', label: 'Constraint', text: 'No execution is approved.' }] }]) => {
  const style = receipt('neutral-style')
  const visualSystem = receipt('neutral-visual', { allowedComponents: ['HEADING', 'PARAGRAPH', 'LIST', 'TABLE', 'CALLOUT'] })
  const packReceipts = { outputType: receipt('comparison'), outputSchema: receipt('comparison-schema'),
    audience: receipt('reviewers', { label: 'Reviewers' }), style, visualSystem }
  const model = buildOutcomeStudioRenderableAsset({
    assetVersion: {
      outcomeAssetId: 'fixture-draft', outcomeAssetVersionId: 'fixture-iteration', versionNumber: 1, status: 'CURRENT',
      tenantId: '507f1f77bcf86cd799439011', customerId: '507f1f77bcf86cd799439012', runtimeInstanceId: '507f1f77bcf86cd799439013',
      runtimeRevision: { id: 'fixture-revision', number: 1 }, title: 'Options comparison', customerContent: { sections },
      evidenceReferences: [{ sourceId: 'fixture-evidence', locator: 'observation', status: 'ACCEPTED' }],
      governanceMarkers: { evidenceBoundary: 'Observed sample only.', claimRestrictions: ['Do not generalise the observation.'], warnings: ['Review before use.'], limitations: ['A broader baseline is missing.'] },
      visualIntent: { layoutPattern: 'DOCUMENT', components: [{ type: 'CALLOUT' }] },
    },
    outputContract: { outputTypeKey: 'comparison', outputSchemaKey: 'comparison-schema', styleKey: style.packKey, audience: 'Reviewers' },
    stylePackReceipt: style, visualSystemPackReceipt: visualSystem,
  })
  const stage = role => ({ stageExecutionId: `fixture-${role}`, outputFingerprint: 'b'.repeat(64) })
  const sourceReference = { kind: 'DRAFT_ITERATION', draftId: model.assetId, draftIterationId: model.assetVersionId,
    tenantId: model.tenantId, customerId: model.customerId, runtimeInstanceId: model.runtimeInstanceId,
    runtimeRevisionId: model.runtimeRevision.id, runtimeRevisionNumber: 1, evidenceMembershipHash: checksum,
    planId: 'fixture-plan', planFingerprint: 'c'.repeat(64), workingDraft: stage('draft'), arl: stage('arl'), narrative: stage('narrative'), shaping: stage('shaping') }
  return { model, sourceReference, packReceipts }
}
const clone = value => JSON.parse(JSON.stringify(value))
const xmlText = xml => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('\n')

describe('SS-055 private DOCX compilation', () => {
  test('actual package retains source order, qualifications and distinct quote/intake/table treatment without receipt IDs', async () => {
    const request = input()
    const before = JSON.stringify(request)
    const result = await prepareOutcomeDocxRenditionCandidate(request)
    const zip = await JSZip.loadAsync(result.buffer)
    const xml = await zip.file('word/document.xml').async('string')
    const text = xmlText(xml)
    const expected = ['Options', 'provisional &amp;', 'Source restriction', 'observed sample', 'participant requested', 'Information needed', 'agreed baseline', 'Compare the two', 'Unverified', 'Next decision', 'Decision boundary', 'Constraint', 'No execution', 'Observed sample only.', 'Do not generalise', 'Review before use.', 'broader baseline']
    let position = -1
    for (const phrase of expected) {
      const next = text.indexOf(phrase, position + 1)
      expect(next).toBeGreaterThan(position)
      position = next
    }
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('Heading3')
    expect(text).not.toMatch(/fixture-|507f1f77|sha256:/)
    expect(result).toMatchObject({ status: 'PRIVATE_UNREVIEWED', sourceAdmission: 'NOT_VERIFIED', exportAvailable: false, finalisationAvailable: false })
    expect(result.artifact.outputChecksum).toBe('sha256:' + createHash('sha256').update(result.buffer).digest('hex'))
    expect(result.artifact.byteLength).toBe(result.buffer.length)
    expect(JSON.stringify(request)).toBe(before)
  })

  test('repeated identical input produces identical bytes and fingerprints without claiming persistence idempotency', async () => {
    const first = await prepareOutcomeDocxRenditionCandidate(input())
    const second = await prepareOutcomeDocxRenditionCandidate(input())
    expect(second.buffer.equals(first.buffer)).toBe(true)
    expect(second.inputFingerprint).toBe(first.inputFingerprint)
  })

  test.each(['outputType', 'outputSchema', 'audience', 'style', 'visualSystem'])('binds the %s pack version to the input fingerprint', async role => {
    const request = clone(input())
    const first = await prepareOutcomeDocxRenditionCandidate(request)
    request.packReceipts[role].version = '1.0.1'
    if (['style', 'visualSystem'].includes(role)) request.model.packReceipts[role].version = '1.0.1'
    const next = await prepareOutcomeDocxRenditionCandidate(request)
    expect(next.inputFingerprint).not.toBe(first.inputFingerprint)
  })

  test('binds source, plan and evidence membership changes without treating supplied references as verified', async () => {
    const first = await prepareOutcomeDocxRenditionCandidate(input())
    for (const property of ['planFingerprint', 'evidenceMembershipHash']) {
      const request = clone(input())
      request.sourceReference[property] = property === 'planFingerprint' ? 'd'.repeat(64) : 'sha256:' + 'd'.repeat(64)
      const next = await prepareOutcomeDocxRenditionCandidate(request)
      expect(next.inputFingerprint).not.toBe(first.inputFingerprint)
      expect(next.sourceAdmission).toBe('NOT_VERIFIED')
    }
  })

  test('accepts a materially different one-section profile without Commercial headings or fourteen-section rules', async () => {
    const result = await prepareOutcomeDocxRenditionCandidate(input([{ key: 'notice', label: 'Notice', blocks: [{ type: 'PARAGRAPH', text: 'The observation remains incomplete.' }] }]))
    const xml = await (await JSZip.loadAsync(result.buffer)).file('word/document.xml').async('string')
    expect(xmlText(xml)).toContain('Notice')
    expect(xmlText(xml)).not.toMatch(/Commercial|Executive conclusion|Leadership decision/)
    expect(OUTCOME_DOCX_RENDITION_CAPABILITY.format).toBe('DOCX')
  })

  test.each([
    ['format', request => { request.format = 'PDF' }, 'FORMAT_UNSUPPORTED'],
    ['source content', request => { request.model.sections[0].blocks[0].text = 'Changed claim' }, 'SOURCE_CHECKSUM_CHANGED'],
    ['duplicate blocks', request => { request.model.blocks[0].text = 'Disagreement' }, 'SOURCE_REPRESENTATIONS_DISAGREE'],
    ['duplicate markdown', request => { request.model.markdown += '\nChanged' }, 'SOURCE_CHECKSUM_CHANGED'],
    ['dropped qualification', request => { request.model.sections[0].blocks[0].qualification = 'Must stay'; request.model.sourceContentChecksum = computeOutcomeStudioRenderableSourceChecksum(request.model) }, 'SOURCE_REPRESENTATIONS_DISAGREE'],
    ['customer scope', request => { request.sourceReference.customerId = 'other-customer' }, 'SOURCE_MODEL_BINDING_MISMATCH'],
    ['runtime revision', request => { request.sourceReference.runtimeRevisionNumber = 2 }, 'SOURCE_MODEL_BINDING_MISMATCH'],
    ['missing stage', request => { delete request.sourceReference.arl }, 'SOURCE_REFERENCE_INVALID'],
    ['stage hash', request => { request.sourceReference.arl.outputFingerprint = 'invented' }, 'SOURCE_STAGE_REFERENCE_INVALID'],
    ['repeated stage', request => { request.sourceReference.arl.stageExecutionId = request.sourceReference.workingDraft.stageExecutionId }, 'SOURCE_STAGE_REFERENCE_AMBIGUOUS'],
    ['missing pack', request => { delete request.packReceipts.audience }, 'PACK_SELECTION_INCOMPLETE'],
    ['inactive pack', request => { request.packReceipts.outputType.status = 'DISABLED' }, 'PACK_RECEIPT_INVALID'],
    ['missing pack hash', request => { delete request.packReceipts.outputSchema.contentHash }, 'PACK_RECEIPT_INVALID'],
    ['output binding', request => { request.packReceipts.outputType.packKey = 'other-type' }, 'PACK_MODEL_BINDING_MISMATCH'],
    ['audience binding', request => { request.packReceipts.audience.label = 'Other readers' }, 'PACK_MODEL_BINDING_MISMATCH'],
    ['style binding', request => { request.packReceipts.style.version = '2.0.0' }, 'PACK_MODEL_BINDING_MISMATCH'],
    ['image request', request => { request.model.visualIntent.components = [{ type: 'IMAGE' }] }, 'VISUAL_CAPABILITY_UNSUPPORTED'],
    ['visual metadata loss', request => { request.model.visualIntent.components[0].assetId = 'ignored-image' }, 'SOURCE_REPRESENTATIONS_DISAGREE'],
  ])('rejects %s before rendering', async (_label, mutate, reason) => {
    const request = clone(input())
    mutate(request)
    await expect(prepareOutcomeDocxRenditionCandidate(request)).rejects.toMatchObject({ reason })
  })

  test.each([
    [{ type: 'IMAGE', text: 'An image' }, 'BLOCK_SEMANTICS_UNSUPPORTED'],
    [{ type: 'SOURCE_NOTE', text: 'Unlabelled source note' }, 'BLOCK_LABEL_REQUIRED'],
    [{ type: 'LIST', text: 'First\nSecond' }, 'MULTILINE_LIST_UNSUPPORTED'],
    [{ type: 'HEADING', text: 'First\nSecond' }, 'MULTILINE_HEADING_UNSUPPORTED'],
    [{ type: 'TABLE', text: 'Not a table' }, 'TABLE_SEMANTICS_UNSUPPORTED'],
  ])('rejects unsupported block semantics %j', async (block, reason) => {
    await expect(prepareOutcomeDocxRenditionCandidate(input([{ key: 'one', label: 'One', blocks: [block] }]))).rejects.toMatchObject({ reason })
  })

  test.each(['PARAGRAPH', 'LIST', 'TABLE', 'HEADING', 'QUOTATION'])('rejects a %s label rather than losing it', async type => {
    await expect(prepareOutcomeDocxRenditionCandidate(input([{ key: 'one', label: 'One', blocks: [{ type, text: 'Preserve this text.', label: 'Important label' }] }]))).rejects.toMatchObject({ reason: 'BLOCK_LABEL_UNSUPPORTED' })
  })

  test.each(['---', '# An unexpected heading', '- A list', '> A quotation', '```\ncode\n```', '| One |\n| --- |\n| Cell |'])('rejects paragraph structure reinterpretation: %s', async text => {
    await expect(prepareOutcomeDocxRenditionCandidate(input([{ key: 'one', label: 'One', blocks: [{ type: 'PARAGRAPH', text }] }]))).rejects.toMatchObject({ reason: 'BLOCK_CONTENT_SEMANTICS_UNSUPPORTED' })
  })

  test.each(['CALLOUT', 'INTAKE', 'SOURCE_NOTE'])('rejects structural Markdown in a %s body', async type => {
    await expect(prepareOutcomeDocxRenditionCandidate(input([{ key: 'one', label: 'One', blocks: [{ type, label: 'Necessary label', text: '# Unintended heading' }] }]))).rejects.toMatchObject({ reason: 'BLOCK_CONTENT_SEMANTICS_UNSUPPORTED' })
  })

  test.each(['HEADING', 'PARAGRAPH', 'LIST', 'TABLE', 'CALLOUT'])('rejects a visual policy that forbids rendered %s', async component => {
    const request = clone(input())
    request.packReceipts.visualSystem.allowedComponents = request.packReceipts.visualSystem.allowedComponents.filter(value => value !== component)
    request.model.packReceipts.visualSystem = clone(request.packReceipts.visualSystem)
    await expect(prepareOutcomeDocxRenditionCandidate(request)).rejects.toMatchObject({ reason: 'VISUAL_COMPONENT_NOT_PERMITTED' })
  })

  test('retains literal divider/heading text when the supplied representation is explicitly quotation', async () => {
    const result = await prepareOutcomeDocxRenditionCandidate(input([{ key: 'one', label: 'One', blocks: [{ type: 'QUOTATION', text: '---\n# Reported words' }] }]))
    const xml = await (await JSZip.loadAsync(result.buffer)).file('word/document.xml').async('string')
    expect(xmlText(xml)).toContain('--- # Reported words')
  })

  test('keeps controlled synthetic source delivery held before source-reference admission', async () => {
    const request = input()
    request.model = buildOutcomeStudioRenderableAsset({
      assetVersion: { ...request.model, outcomeAssetId: request.model.assetId, outcomeAssetVersionId: request.model.assetVersionId,
        status: 'CURRENT', customerContent: { sections: request.model.sections },
        runtimeInstanceId: '6ace5ee09bd4472c6be0cb07', customerId: '6a6c75f2cace7a21bd41ef98', tenantId: '6a6c76e3cace7a21bd41eff9',
        runtimeRevision: { id: '6ace5ee09bd4472c6be0cb07', number: 1 } },
      outputContract: request.model.outputContract, stylePackReceipt: request.packReceipts.style, visualSystemPackReceipt: request.packReceipts.visualSystem,
    })
    expect(request.model.artifactClassification).toBeDefined()
    await expect(prepareOutcomeDocxRenditionCandidate(request)).rejects.toMatchObject({ code: 'SYNTHETIC_TEST_DELIVERY_HELD' })
  })

  test('retains engine safety and declared source-size limits', async () => {
    const request = text => input([{ key: 'one', label: 'One', blocks: [{ type: 'PARAGRAPH', text }] }])
    await expect(prepareOutcomeDocxRenditionCandidate(request('Read https://example.invalid before use.'))).rejects.toMatchObject({ reason: 'URI_SCHEME_NOT_ALLOWED' })
    await expect(prepareOutcomeDocxRenditionCandidate(request('x'.repeat(262145)))).rejects.toMatchObject({ reason: 'SOURCE_SIZE_LIMIT_EXCEEDED' })
  })
})
