import { createHash } from 'node:crypto'
import { afterEach, describe, expect, jest, test } from '@jest/globals'
import RuntimeSupportAsset from '../models/RuntimeSupportAsset.js'
import { resolveRuntimeSupportAssets } from '../services/sectionExecutionContractService.js'

const content = 'Synthetic support guidance.'
const asset = (assetKey) => ({ assetKey, content, contentHash: createHash('sha256').update(content).digest('hex'),
  byteLength: Buffer.byteLength(content), assetType: 'GUIDANCE', mimeType: 'text/markdown', storageKey: 'renamed.md' })
const args = (reference) => ({
  frameworkPackage: { frameworkKey: 'VMF', packageKey: 'package-vmf', version: '3.1.5',
    sections: [{ sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context' }] },
  runtimeSkill: { key: 'skill-context', referenceAssets: [{ status: 'ACTIVE', isRuntimeAccessible: true, ...reference }] },
  sectionKey: 'customer-context', runtimePath: 'framework_state.sections.customer_context',
})
const mockRows = (rows) => {
  const lean = jest.fn().mockResolvedValue(rows)
  const select = jest.fn().mockReturnValue({ lean })
  const find = jest.spyOn(RuntimeSupportAsset, 'find').mockReturnValue({ select })
  return { find, select }
}
afterEach(() => jest.restoreAllMocks())

describe('section execution support asset identities', () => {
  test('declared ID wins over mismatched filename and retains exact package/owner scope', async () => {
    const { find, select } = mockRows([asset('guidance'), asset('wrong-file')])
    const result = await resolveRuntimeSupportAssets(args({ assetId: 'asset-guidance', storageKey: 'wrong-file.md' }))
    expect(result.map(row => row.assetKey)).toEqual(['guidance'])
    expect(find).toHaveBeenCalledWith({ packageKey: 'package-vmf', packageVersion: '3.1.5',
      ownerKey: 'skill-context', ownerType: 'RuntimeSkill', status: 'ACTIVE', runtimeAccessible: true })
    expect(select).toHaveBeenCalledWith('+content')
  })

  test('missing declared ID fails closed even when the filename resolves', async () => {
    mockRows([asset('fallback')])
    await expect(resolveRuntimeSupportAssets(args({ assetId: 'asset-missing', storageKey: 'fallback.md' })))
      .rejects.toMatchObject({ details: expect.objectContaining({ matchCount: 0 }) })
  })

  test.each([undefined, ''])('legacy absent ID %s resolves by filename', async (assetId) => {
    mockRows([asset('legacy')])
    const result = await resolveRuntimeSupportAssets(args({ assetId, storageKey: 'folder/legacy.md' }))
    expect(result.map(row => row.assetKey)).toEqual(['legacy'])
  })

  test.each(['guide.part', 'guide_part', 'guide--part'])('preserves valid assetKey punctuation: %s', async (key) => {
    mockRows([asset(key)])
    const result = await resolveRuntimeSupportAssets(args({ assetId: 'asset-guide-part', storageKey: 'unrelated.md' }))
    expect(result[0].assetKey).toBe(key)
  })

  test('rejects lossy ID ambiguity instead of choosing one asset', async () => {
    mockRows([asset('guide.part'), asset('guide_part')])
    await expect(resolveRuntimeSupportAssets(args({ assetId: 'asset-guide-part' })))
      .rejects.toMatchObject({ details: expect.objectContaining({ matchCount: 2 }) })
  })

  test('missing legacy asset fails closed', async () => {
    mockRows([])
    await expect(resolveRuntimeSupportAssets(args({ storageKey: 'missing.md' })))
      .rejects.toMatchObject({ details: expect.objectContaining({ matchCount: 0 }) })
  })
})
