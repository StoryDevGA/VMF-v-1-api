import mongoose from 'mongoose'
import RuntimePathRegistry from '../models/RuntimePathRegistry.js'

const makeBaseRuntimePath = (overrides = {}) => ({
  pathKey: 'framework_state.lifecycle.stage',
  label: 'Framework Lifecycle Stage',
  description: 'Current lifecycle stage of the framework state.',
  frameworkKeys: ['VMF'],
  scope: 'FRAMEWORK_STATE',
  allowedOperations: ['READ', 'WRITE', 'BIND'],
  dataType: 'STRING',
  category: 'LIFECYCLE',
  sourceType: 'RUNTIME_STATE',
  createdBy: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
  updatedBy: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
  ...overrides,
})

describe('RuntimePathRegistry model', () => {
  test('marks pathKey as immutable after creation', () => {
    expect(RuntimePathRegistry.schema.path('pathKey').options.immutable).toBe(true)
  })

  test('accepts SECTION and ARTIFACT categories for normalized VMF v2.3.1 rows', async () => {
    const sectionDoc = new RuntimePathRegistry(makeBaseRuntimePath({
      pathKey: 'framework_state.sections.customer_problem',
      label: 'Customer Problem Section',
      description: 'Normalized section runtime path.',
      category: 'SECTION',
      uiControl: 'TEXTAREA',
      exampleValue: '',
    }))

    const artifactDoc = new RuntimePathRegistry(makeBaseRuntimePath({
      pathKey: 'framework_state.artifacts.board_summary',
      label: 'Board Summary Artifact',
      description: 'Normalized artifact runtime path.',
      dataType: 'OBJECT',
      category: 'ARTIFACT',
      sourceType: 'DERIVED',
      uiControl: 'JSON',
      exampleValue: null,
    }))

    await expect(sectionDoc.validate()).resolves.toBeUndefined()
    await expect(artifactDoc.validate()).resolves.toBeUndefined()
  })

  test('generates a hashed stable id for wildcard path keys', async () => {
    const doc = new RuntimePathRegistry(makeBaseRuntimePath({
      pathKey: 'framework_state.sections.*',
      label: 'Framework Sections Wildcard',
      description: 'Wildcard runtime path.',
      dataType: 'OBJECT',
      category: 'STATE',
      uiControl: 'JSON',
      allowedOperations: ['READ', 'BIND'],
      exampleValue: null,
    }))

    await expect(doc.validate()).resolves.toBeUndefined()
    expect(doc.stableId).toMatch(/^path-framework-state-sections-[a-z0-9]+$/)
    expect(doc.stableId).not.toBe('path-framework-state-sections-*')
  })

  test('rejects allowedValues that conflict with regexPattern', async () => {
    const doc = new RuntimePathRegistry(makeBaseRuntimePath({
      allowedValues: ['DRAFT', 'APPROVED'],
      regexPattern: '^PASS$',
    }))

    await expect(doc.validate()).rejects.toMatchObject({
      errors: {
        allowedValues: expect.objectContaining({
          message: expect.stringContaining('allowedValues must satisfy'),
        }),
      },
    })
  })

  test('accepts compatible allowedValues and regexPattern combinations', async () => {
    const doc = new RuntimePathRegistry(makeBaseRuntimePath({
      allowedValues: ['PASS', 'PASS_APPROVED'],
      regexPattern: '^PASS',
      minLength: 4,
      maxLength: 20,
    }))

    await expect(doc.validate()).resolves.toBeUndefined()
  })
})
