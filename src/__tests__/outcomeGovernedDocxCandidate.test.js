import { jest } from '@jest/globals'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { buildGovernedPrivateDocxInput, compileGovernedPrivateDocxInput, prepareGovernedPrivateDocxCandidate } from '../services/outcomeGovernedDocxCandidateService.js'
import { governedDocxFixture as fixture } from './fixtures/governedDocxCandidateFixture.js'
import { membershipHash } from '../services/runtimeEvidenceSnapshotContract.js'

// Generic, unsigned contract fixtures; no copied customer assertions or native
// admission proof. Real reader/signature checks belong to the source service.
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
test('actual DOCX preserves ordered headings, assertions, quotations and every local source qualification', async () => {
  const f = fixture(), before = JSON.stringify(f)
  const result = await compileGovernedPrivateDocxInput(f)
  expect(JSON.stringify(f)).toBe(before)
  expect(result).toMatchObject({ status: 'PRIVATE_UNREVIEWED', officialUse: false, normalOutputAvailable: false,
    authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false })
  expect(result.input.sourceEnvelope.source.scope.runtimeInstanceId).toBe('actual-controlled-runtime')
  expect(result.input.sourceEnvelope.renderingAvailable).toBe(false)
  expect(result.input.sourceEnvelope.source.reviewState.failure.failureCode).toBe('OLD_FAILURE_RETAINED')
  expect(result.input.styleEligibility.renderer.format).toBe('DOCX')
  expect(result.input.styleEligibility.rlApproved).toBe(false)
  expect(result.inputFingerprint).toBe(membershipHash(result.input))
  expect(result.artifact.outputChecksum).toBe(digest(result.buffer))
  const zip = await JSZip.loadAsync(result.buffer), xml = await zip.file('word/document.xml').async('string')
  let position = -1
  for (let i = 1; i <= 14; i++) {
    for (const text of [`Section ${i}`, `Observation ${i} remains provisional.`, `Quoted source ${i}.`,
      `Source limit ${i}: sample only.`, `Qualification ${i}: broader evidence is missing.`]) {
      const found = xml.indexOf(`>${text}<`, position + 1)
      expect(found).toBeGreaterThan(position); position = found
    }
  }
  expect(xml).not.toContain('actual-controlled-runtime')
  expect(xml).not.toContain('OLD_FAILURE_RETAINED')
  expect(xml).not.toContain('logical-iteration')
  expect(xml).toContain('Commercial Strategy and Decision Paper')
  expect(xml).not.toContain('PRIVATE_UNREVIEWED')
  expect(xml).not.toContain('Version 1')
  const properties = await zip.file('docProps/core.xml').async('string')
  expect(properties).not.toContain('Engineering')
  expect(properties).not.toContain('approval')
  expect(result.input.presentation.originalSourceTitle).toBe(f.shaping.title)
  expect(result.input.model.title).toBe(f.envelope.source.selectedPacks.OUTPUT_TYPE.label)
  expect(result.input.model.sections[0].sourcePaths.qualification).toBe('shaping.sections[0].qualification')
  const again = await compileGovernedPrivateDocxInput(f)
  expect(again.buffer.equals(result.buffer)).toBe(true)
  expect(again.inputFingerprint).toBe(result.inputFingerprint)
})

test.each([
  ['classification', f => { f.envelope.classification = 'OFFICIAL' }],
  ['delivery permission', f => { f.envelope.deliveryAvailable = true }],
  ['missing private hold', f => { delete f.envelope.renderingAvailable }],
  ['source tamper', f => { f.shaping.title = 'Unbound title' }],
  ['shaping fingerprint', f => { f.envelope.source.stageRefs[0].outputFingerprint = 'bad'; f.envelope.sourceFingerprint = membershipHash(f.envelope.source) }],
  ['pack mismatch', f => { f.envelope.source.selectedPacks.STYLE.versionId = 'other'; f.seal() }],
  ['pack content tamper', f => { f.documents[0].content += ' Changed.' }],
  ['audience tamper', f => { f.audienceDocument.content += ' Changed.' }],
  ['retired audience', f => { f.audienceDocument.status = 'RETIRED' }],
  ['missing section', f => { f.shaping.sections.pop(); f.seal() }],
  ['section order', f => { f.shaping.sections[0].order = 2; f.seal() }],
  ['empty qualification', f => { f.shaping.sections[0].qualification = ''; f.seal() }],
  ['duplicate element', f => { f.shaping.sections[1].elementId = f.shaping.sections[0].elementId; f.seal() }],
  ['diagram', f => { f.shaping.sections[0].diagram.present = true; f.seal() }],
  ['raw html', f => { f.shaping.sections[0].body = '<script>bad</script>'; f.seal() }],
  ['unsafe URI', f => { f.shaping.sections[0].qualification = 'Visit file:///private'; f.seal() }],
  ['unsupported code', f => { f.shaping.sections[0].body = '```\ncode\n```'; f.seal() }],
  ['unsupported divider', f => { f.shaping.sections[0].body = '---'; f.seal() }],
  ['multiline heading', f => { f.shaping.sections[0].heading = 'First\n## Second'; f.seal() }],
  ['missing title label', f => { delete f.envelope.source.selectedPacks.OUTPUT_TYPE.label; f.seal() }],
  ['multiline title label', f => { f.envelope.source.selectedPacks.OUTPUT_TYPE.label = 'Paper\nClaim'; f.seal() }],
  ['markdown title label', f => { f.envelope.source.selectedPacks.OUTPUT_TYPE.label = '**Paper**'; f.seal() }],
])('rejects %s without truncation or source repair', (_name, change) => {
  const f = fixture(); change(f)
  expect(() => buildGovernedPrivateDocxInput(f)).toThrow()
})

test('orchestrator reads source using trusted scope then loads exact selected versions', async () => {
  const f = fixture()
  const loaded = new Map([...f.documents.map(document => [document.source.versionId,
    { ...document.source, available: true, status: 'ACTIVE', content: document.content }]), [f.audienceDocument.versionId, f.audienceDocument]])
  const deps = { readSource: jest.fn(async () => f.envelope), loadPackContent: jest.fn(async ({ versionId }) => loaded.get(versionId)) }
  const args = { actorUserId: 'actor', runtimeInstanceId: 'actual-controlled-runtime', scopes: { trusted: true }, deps }
  const result = await prepareGovernedPrivateDocxCandidate(args)
  expect(result.status).toBe('PRIVATE_UNREVIEWED')
  expect(deps.readSource).toHaveBeenCalledWith({ actorUserId: args.actorUserId, runtimeInstanceId: args.runtimeInstanceId, scopes: args.scopes })
  expect(deps.loadPackContent).toHaveBeenCalledTimes(5)
  const error = Object.assign(new Error('Source unavailable'), { status: 503 })
  deps.readSource.mockRejectedValue(error); deps.loadPackContent.mockClear()
  await expect(prepareGovernedPrivateDocxCandidate(args)).rejects.toBe(error)
  expect(deps.loadPackContent).not.toHaveBeenCalled()
  deps.readSource.mockResolvedValue(f.envelope); deps.loadPackContent.mockRejectedValue(error)
  await expect(prepareGovernedPrivateDocxCandidate(args)).rejects.toBe(error)
})

test('orchestrator refuses cross-runtime source and inactive/mismatched loaded version', async () => {
  const f = fixture(), deps = { readSource: async () => f.envelope, loadPackContent: jest.fn(async () => null) }
  await expect(prepareGovernedPrivateDocxCandidate({ runtimeInstanceId: 'other', deps })).rejects.toMatchObject({ details: { reason: 'REQUEST_SCOPE_CHANGED' } })
  expect(deps.loadPackContent).not.toHaveBeenCalled()
  await expect(prepareGovernedPrivateDocxCandidate({ runtimeInstanceId: 'actual-controlled-runtime', deps })).rejects.toMatchObject({ details: { reason: 'SELECTED_DOCUMENT_UNAVAILABLE' } })
})

test.each([
  ['output asset ID', { incompatibleOutputTypes: ['OT-GENERIC'] }, 'STYLE_OUTPUT_EXPLICITLY_INCOMPATIBLE'],
  ['output pack key', { incompatibleOutputTypes: ['commercial-strategy-and-decision-paper'] }, 'STYLE_OUTPUT_EXPLICITLY_INCOMPATIBLE'],
  ['audience', { incompatibleAudienceKeys: ['generic-audience'] }, 'STYLE_AUDIENCE_EXPLICITLY_INCOMPATIBLE'],
  ['unsupported actual renderer component', { requiredRendererCapabilities: ['METRIC'] }, 'STYLE_COMPONENT_UNSUPPORTED'],
])('respects exact style exclusion by %s', (_name, constraint, reason) => {
  const f = fixture(), content = JSON.stringify({ styleConstraints: { contractVersion: 'style-overlay.constraints.v1',
    incompatibleOutputTypes: [], incompatibleAudienceKeys: [], requiredRendererCapabilities: [], ...constraint } })
  const contentHash = digest(content)
  Object.assign(f.documents[2], { content })
  Object.assign(f.documents[2].source, { contentHash, contentFormat: 'JSON' })
  f.shaping.outputContract.packs[2].contentHash = contentHash
  f.envelope.source.selectedPacks.STYLE.contentHash = contentHash
  f.seal()
  expect(() => buildGovernedPrivateDocxInput(f)).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason }) }))
})

test('requires output asset identity from the exact signed shaping source', () => {
  const f = fixture(); delete f.shaping.styleValidationReceipt; f.seal()
  expect(() => buildGovernedPrivateDocxInput(f)).toThrow(expect.objectContaining({ details: { reason: 'OUTPUT_ASSET_IDENTITY_MISSING', contentIncludedInError: false } }))
})
