import { describe, expect, test } from '@jest/globals'
import {
  listOutcomeRendererCapabilities,
  OUTCOME_RENDERER_ENGINEERING_CANDIDATES,
  OUTCOME_RENDERER_CAPABILITY_REGISTRY_VERSION,
  resolveOutcomeRendererCapability,
} from '../services/outcomeRendererCapabilityRegistryService.js'

const binding = {
  outputTypeKey: 'board-summary',
  outputSchemaKey: 'board-summary-schema',
  styleKey: 'board-executive-style',
}

describe('Outcome renderer compatibility capability registry', () => {
  test('advertises only the four already implemented export formats', () => {
    const registry = listOutcomeRendererCapabilities()

    expect(registry.registryVersion).toBe(OUTCOME_RENDERER_CAPABILITY_REGISTRY_VERSION)
    expect(registry.capabilities).toHaveLength(1)
    expect(registry.capabilities[0]).toEqual(expect.objectContaining({
      lifecycleStatus: 'ACTIVE',
      fallbackRule: 'FAIL_CLOSED',
      engine: {
        key: 'OUTPUT_SERVICE_IN_PROCESS_COMPATIBILITY',
        version: '1',
        buildFingerprint: 'output-service:markdown-json-docx-pdf:compatibility-v1',
      },
      review: expect.objectContaining({
        architecture: 'OPEN_FOR_FINAL_SCHEMA_AND_NEW_RENDERERS',
      }),
    }))
    expect(registry.capabilities[0].formats.map((entry) => entry.format)).toEqual([
      'MARKDOWN',
      'JSON',
      'DOCX',
      'PDF',
    ])
  })

  test.each(['MARKDOWN', 'JSON', 'PDF'])(
    'resolves the existing %s implementation for a complete governed binding',
    (format) => {
      const result = resolveOutcomeRendererCapability({ ...binding, format })

      expect(result.status).toBe('SUPPORTED')
      expect(result.capability.formats).toContainEqual(expect.objectContaining({ format }))
    },
  )

  test('resolves only the canonical Executive Brief DOCX through the Development/Test professional capability', () => {
    const result = resolveOutcomeRendererCapability({
      ...binding,
      appEnvironment: 'development',
      outputTypeKey: 'executive-brief',
      format: 'DOCX',
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'SUPPORTED',
      capability: expect.objectContaining({
        capabilityKey: 'outcome-professional-document-dev-test',
        lifecycleStatus: 'ACTIVE_DEVELOPMENT_TEST',
        engine: expect.objectContaining({ version: 'docx@9.7.1' }),
        profileReferences: expect.objectContaining({
          productReferences: ['COR-005-v1.1-APPROVED-TEST-REFERENCE'],
        }),
      }),
    }))
  })

  test.each(['production', 'staging', '', 'unknown'])(
    'keeps Executive Brief DOCX on compatibility in the %s application environment',
    (appEnvironment) => {
      expect(resolveOutcomeRendererCapability({
        ...binding,
        appEnvironment,
        outputTypeKey: 'executive-brief',
        format: 'DOCX',
      }).capability.capabilityKey).toBe('outcome-studio-current-document-export')
    },
  )

  test('keeps non-Executive-Brief DOCX and format-omitted discovery on compatibility', () => {
    expect(resolveOutcomeRendererCapability({
      ...binding,
      appEnvironment: 'development',
      format: 'DOCX',
    }).capability.capabilityKey).toBe('outcome-studio-current-document-export')
    expect(resolveOutcomeRendererCapability({
      ...binding,
      appEnvironment: 'development',
    }).capability.capabilityKey).toBe('outcome-studio-current-document-export')
  })

  test('fails closed for an unknown format', () => {
    expect(resolveOutcomeRendererCapability({ ...binding, format: 'PPTX' })).toEqual({
      status: 'UNSUPPORTED',
      reason: 'RENDER_FORMAT_UNSUPPORTED',
      capability: null,
    })
  })

  test('fails closed when the required deliverable binding is incomplete', () => {
    expect(resolveOutcomeRendererCapability({
      format: 'PDF',
      outputTypeKey: 'board-summary',
      outputSchemaKey: '',
      styleKey: 'board-executive-style',
    })).toEqual({
      status: 'UNSUPPORTED',
      reason: 'REQUIRED_DELIVERABLE_BINDING_MISSING',
      capability: null,
    })
  })

  test('keeps non-approved engineering candidates outside active discovery and resolution', () => {
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toContainEqual(expect.objectContaining({
      capabilityKey: 'outcome-professional-document-engineering-candidate',
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      rolloutScopes: [],
    }))
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toContainEqual(expect.objectContaining({
      capabilityKey: 'outcome-professional-pdf-engineering-candidate',
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      rolloutScopes: [],
    }))
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toContainEqual(expect.objectContaining({
      capabilityKey: 'outcome-professional-presentation-pptx-engineering-candidate',
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      rolloutScopes: [],
      formats: [expect.objectContaining({ format: 'PPTX' })],
    }))
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toContainEqual(expect.objectContaining({
      capabilityKey: 'outcome-professional-infographic-png-engineering-candidate',
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      rolloutScopes: [],
      deliverableFamily: 'INFOGRAPHIC',
      sourceModelVersions: ['governed-deliverable.v1'],
      engine: {
        key: 'NAPI_RS_CANVAS_SVG_RASTER_ENGINEERING_CANDIDATE',
        version: '@napi-rs/canvas@1.0.0',
        canvasPackageIntegrity: 'sha512-Jqxcy1XOIqj+lH9sl1GT+il6GR3uQv13vI2mrwubP3uT8Olak2ClDrK2RnxlQKjwv8BRr4b3ug0YR7c6hBX8wg==',
        platform: 'win32',
        architecture: 'x64',
        nativePackage: '@napi-rs/canvas-win32-x64-msvc',
        nativePackageVersion: '1.0.0',
        nativePackageIntegrity: 'sha512-qwdhh9N6Gge/hC4pL9S1tQp0iKwhSl/dYjg7+RGp9k26iRGRi5MqqUyKGOXIWli0zOcuy5Y2wIH/jk2ry6i/jA==',
        nativeBinaryName: 'skia.win32-x64-msvc.node',
        nativeBinaryBytes: 27_246_592,
        nativeBinarySha256: 'f65bfb4c598dec157414a1435f74a71fbaba8f3406b0446f20f2df8a4fe618e4',
        buildFingerprint: 'professional-infographic-png-candidate:napi-rs-canvas-win32-x64-msvc:1.0.0:0.1.0',
      },
      formats: [{
        format: 'PNG',
        label: 'Infographic PNG engineering candidate',
        mimeType: 'image/png',
        extension: 'png',
      }],
    }))
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toContainEqual({
      capabilityKey: 'outcome-professional-infographic-pdf-engineering-candidate',
      capabilityVersion: '0.1.0',
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      rolloutScopes: [],
      deliverableFamily: 'INFOGRAPHIC',
      sourceModelVersions: ['governed-deliverable.v1'],
      supportedBlockTypes: [
        'INFOGRAPHIC_SECTION',
        'METRIC',
        'PROCESS',
        'OUTCOME_TABLE',
        'ROADMAP',
        'RISK_REGISTER',
        'DECISION_CONDITIONS',
      ],
      engine: {
        key: 'PLAYWRIGHT_CORE_CHROMIUM_IN_PROCESS_ENGINEERING_CANDIDATE',
        version: 'playwright-core@1.61.1',
        chromiumRevision: '1223',
        chromiumProductVersion: '148.0.7778.96',
        executableBytes: 4_011_008,
        executableSha256: '290fa7018fda22c52ada5eddb0113baf3ebc41fd0fde6085eddb19793606c635',
        installationFingerprint: '57f8172866f6ad4eff4c9592e0165b6f27c434b740c816ccf34d8597d53dcfdc',
        installationFileCount: 308,
        installationBytes: 432_272_872,
        launchPolicyKey: 'SANDBOXED_OFFLINE_STATIC_HTML_V1',
        buildFingerprint: 'professional-infographic-pdf-candidate:playwright-core:chromium-1223:0.1.0',
      },
      profileReferences: {
        templates: ['executive-decision-infographic-neutral.v0.1'],
        styles: ['executive-infographic-neutral.v0.1'],
        brands: [],
        fonts: ['Arial-chromium-candidate-not-packaged'],
        validation: ['professional-infographic-pdf-candidate.v0.1'],
        productReferences: ['COR-007-v1.1-NOT-APPROVED'],
      },
      review: {
        security: 'ENGINEERING_REVIEW_ONLY',
        licensing: 'OPEN',
        accessibility: 'MARKED_CONTAINER_ONLY_ACCESSIBILITY_OPEN',
        architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
        productReference: 'CANDIDATE_NOT_APPROVED',
      },
      fallbackRule: 'FAIL_CLOSED',
      formats: [{
        format: 'PDF',
        label: 'Infographic PDF engineering candidate',
        mimeType: 'application/pdf',
        extension: 'pdf',
      }],
    })
    expect(listOutcomeRendererCapabilities().capabilities).not.toContainEqual(expect.objectContaining({
      capabilityKey: 'outcome-professional-document-engineering-candidate',
    }))
    expect(listOutcomeRendererCapabilities().capabilities).not.toContainEqual(expect.objectContaining({
      capabilityKey: 'outcome-professional-pdf-engineering-candidate',
    }))
    expect(listOutcomeRendererCapabilities().capabilities).not.toContainEqual(expect.objectContaining({
      capabilityKey: 'outcome-professional-presentation-pptx-engineering-candidate',
    }))
    expect(listOutcomeRendererCapabilities().capabilities).not.toContainEqual(expect.objectContaining({
      capabilityKey: 'outcome-professional-infographic-png-engineering-candidate',
    }))
    expect(listOutcomeRendererCapabilities().capabilities).not.toContainEqual(expect.objectContaining({
      capabilityKey: 'outcome-professional-infographic-pdf-engineering-candidate',
    }))
    expect(resolveOutcomeRendererCapability({
      outputTypeKey: 'infographic',
      outputSchemaKey: 'executive-infographic',
      styleKey: 'executive-style',
      format: 'PDF',
    }).capability.capabilityKey).toBe('outcome-studio-current-document-export')
  })
})
