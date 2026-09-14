import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { renderOutcomeStudioAsset } from '../services/outcomeStudioAssetRenderingService.js'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const evidenceDirectory = path.resolve(
  scriptDirectory,
  '..',
  '..',
  '..',
  'docs',
  'generated',
  'harness-runs',
  'ss-027',
  '2026-09-11-rendering-foundation',
)
const outputDirectory = path.join(evidenceDirectory, 'rendered-outputs')

const ids = {
  tenantId: '507f1f77bcf86cd799439011',
  customerId: '507f1f77bcf86cd799439012',
  runtimeInstanceId: '507f1f77bcf86cd799439013',
}

const assetVersion = {
  ...ids,
  outcomeAssetId: 'outcome_asset_ss027_fixture',
  outcomeAssetVersionId: 'outcome_asset_version_ss027_fixture',
  versionNumber: 1,
  status: 'CURRENT',
  runtimeRevision: { id: 'runtime-revision-27', number: 27 },
  title: 'Commercial Strategy Decision Paper',
  outputTypeKey: 'commercial-strategy-decision-paper',
  outputSchemaKey: 'commercial-strategy-decision-paper.v1',
  customerContent: {
    markdown: '# Commercial Strategy Decision Paper\n\n## Recommendation\n\nUse the governed evidence base to move from a coherent replacement proposition to a repeatable buying decision system.',
    sections: [{
      key: 'recommendation',
      label: 'Recommendation',
      blocks: [{
        type: 'PARAGRAPH',
        text: 'Use the governed evidence base to move from a coherent replacement proposition to a repeatable buying decision system.',
      }],
    }],
  },
  evidenceReferences: [{
    sourceId: 'evidence-source-1',
    locator: 'framework_state.evidence_pack',
    status: 'ACCEPTED',
  }],
  governanceMarkers: {
    evidenceBoundary: 'Current accepted evidence from the bound runtime revision only.',
    claimRestrictions: ['Do not invent quantified impact, ROI or named-customer proof.'],
    warnings: ['Review the recommendation against current evidence before circulation.'],
    limitations: ['This foundation proof is not Parlon parity or Product acceptance.'],
  },
  visualIntent: {
    layoutPattern: 'DECISION',
    components: [{ type: 'CALLOUT' }],
  },
}

const buildInput = () => ({
  assetVersion,
  stylePackReceipt: {
    packKey: 'style-executive-neutral',
    versionId: 'style-version-1',
    version: '1.0.0',
    contentHash: 'sha256:style-pack',
    status: 'RESOLVED',
    tokens: { accentColor: '#2c7db9' },
  },
  visualSystemPackReceipt: {
    packKey: 'visual-system-executive-neutral',
    versionId: 'visual-version-1',
    version: '1.0.0',
    contentHash: 'sha256:visual-pack',
    status: 'RESOLVED',
    allowedComponents: ['HEADING', 'PARAGRAPH', 'CALLOUT', 'METRIC'],
  },
  outputContract: {
    outputTypeKey: 'commercial-strategy-decision-paper',
    outputSchemaKey: 'commercial-strategy-decision-paper.v1',
    styleKey: 'style-executive-neutral',
    audience: 'Parlon leadership',
  },
})

const writeJson = async (filename, value) => {
  await writeFile(path.join(evidenceDirectory, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const run = async () => {
  await mkdir(outputDirectory, { recursive: true })
  const persistedReceipts = []
  const result = await renderOutcomeStudioAsset({
    ...buildInput(),
    persistRenderOutput: async (record) => {
      persistedReceipts.push(record)
    },
  })

  for (const output of result.renderOutputs) {
    await writeFile(
      path.join(outputDirectory, output.delivery.filename),
      Buffer.from(output.delivery.contentBase64, 'base64'),
    )
  }

  await writeJson('asset-model-readback.json', result.model)
  await writeJson('render-output-receipts-readback.json', persistedReceipts)
  await writeJson('rendering-proof-summary.json', {
    assetId: result.model.assetId,
    assetVersionId: result.model.assetVersionId,
    versionNumber: result.model.versionNumber,
    sourceContentChecksum: result.model.sourceContentChecksum,
    formats: result.renderOutputs.map(({ record }) => record.format),
    renderOutputCount: result.renderOutputs.length,
    persistedReceiptCount: persistedReceipts.length,
    artifactChecksums: Object.fromEntries(result.renderOutputs.map(({ record }) => [record.format, record.artifact.outputChecksum])),
    contentIncludedInReceipts: persistedReceipts.some(({ renderReceipt }) => renderReceipt.contentIncludedInReceipt),
    databaseWrites: false,
  })
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
