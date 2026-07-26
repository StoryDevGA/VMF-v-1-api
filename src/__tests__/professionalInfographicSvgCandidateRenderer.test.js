import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from '@jest/globals'
import {
  PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES,
  PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE,
  compileProfessionalInfographicSvgCandidate,
  parseProfessionalInfographicCandidateInput,
  renderProfessionalInfographicSvgCandidate,
  validateProfessionalInfographicSvgCandidate,
} from '../services/professionalInfographicSvgCandidateRenderer.js'
import {
  listOutcomeRendererCapabilities,
  OUTCOME_RENDERER_ENGINEERING_CANDIDATES,
  resolveOutcomeRendererCapability,
} from '../services/outcomeRendererCapabilityRegistryService.js'
import { professionalInfographicSvgCandidateFixture } from '../testFixtures/professionalInfographicSvgCandidateFixture.js'

const cloneFixture = () => JSON.parse(JSON.stringify(professionalInfographicSvgCandidateFixture))
const compileFixture = () => compileProfessionalInfographicSvgCandidate(professionalInfographicSvgCandidateFixture)

const expectSourceFreeFailure = (action, reason, code) => {
  try {
    action()
    throw new Error('Expected professional infographic SVG candidate failure.')
  } catch (error) {
    expect(error).toEqual(expect.objectContaining({ reason }))
    if (code) expect(error.code).toBe(code)
    expect(JSON.stringify(error)).not.toContain('customer-secret-marker')
    expect(error.details).toEqual(expect.objectContaining({ contentIncludedInError: false }))
  }
}

const replaceOnce = (source, from, to) => {
  expect(source).toContain(from)
  return source.replace(from, to)
}

const mapFixtureStrings = (value, transform, path = '') => {
  if (Array.isArray(value)) return value.map((entry, index) => mapFixtureStrings(entry, transform, `${path}[${index}]`))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapFixtureStrings(entry, transform, path ? `${path}.${key}` : key)]))
  }
  return typeof value === 'string' ? transform(value, path) : value
}

describe('Professional infographic SVG engineering candidate', () => {
  test('is inactive, non-resolvable, and excluded from active format discovery', () => {
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toHaveLength(7)
    expect(OUTCOME_RENDERER_ENGINEERING_CANDIDATES).toContainEqual(expect.objectContaining({
      capabilityKey: PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE.profileKey,
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      rolloutScopes: [],
      deliverableFamily: 'INFOGRAPHIC',
      formats: [expect.objectContaining({ format: 'SVG', mimeType: 'image/svg+xml' })],
      review: expect.objectContaining({
        accessibility: 'MANUAL_CERTIFICATION_OPEN',
        architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
        productReference: 'CANDIDATE_NOT_APPROVED',
      }),
    }))
    expect(listOutcomeRendererCapabilities().capabilities).not.toContainEqual(expect.objectContaining({
      capabilityKey: PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE.profileKey,
    }))
    expect(resolveOutcomeRendererCapability({
      outputTypeKey: 'infographic',
      outputSchemaKey: 'executive-infographic',
      styleKey: 'executive-style',
      format: 'SVG',
    })).toEqual({ status: 'UNSUPPORTED', reason: 'RENDER_FORMAT_UNSUPPORTED', capability: null })
  })

  test('has no import path from live services, routes, startup, or customer discovery', () => {
    [
      'src/app.js',
      'src/services/outputService.js',
      'src/services/outcomeStudioService.js',
      'src/services/outcomeStudioKnowledgeContextService.js',
      'src/services/outcomeStudioResolutionService.js',
      'src/routes/runtimeInstances.routes.js',
    ].forEach((path) => {
      expect(readFileSync(path, 'utf8')).not.toContain('professionalInfographicSvgCandidateRenderer')
    })
  })

  test('renders deterministic accessible live-text SVG with the fixed structural profile', () => {
    const first = renderProfessionalInfographicSvgCandidate(professionalInfographicSvgCandidateFixture)
    const second = renderProfessionalInfographicSvgCandidate(professionalInfographicSvgCandidateFixture)
    expect(first.profile).toBe(PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_PROFILE)
    expect(first.buffer.equals(second.buffer)).toBe(true)
    expect(createHash('sha256').update(first.buffer).digest('hex')).toBe(
      createHash('sha256').update(second.buffer).digest('hex'),
    )
    expect(first.metrics).toEqual({
      outputBytes: first.buffer.length,
      width: 1800,
      height: 2546,
      textNodeCount: 110,
      visibleWordCount: 296,
      contentIncludedInMetrics: false,
    })
    expect(first.validation).toEqual(expect.objectContaining({
      status: 'PASSED',
      width: 1800,
      height: 2546,
      groupCount: 10,
      textNodeCount: 110,
      visibleWordCount: 296,
      titlePresent: true,
      descriptionPresent: true,
      disclosurePresent: true,
      minimumContrastRatio: expect.any(Number),
      contentIncludedInValidation: false,
    }))
    expect(first.validation.minimumContrastRatio).toBeGreaterThanOrEqual(4.5)
    const svg = first.buffer.toString('utf8')
    expect(svg).toContain('<title id="svg-title">Enterprise Knowledge Modernisation</title>')
    expect(svg).toContain('<desc id="svg-desc">Executive decision infographic')
    expect(svg).toContain('Illustrative reference candidate | not approved')
    expect(svg).not.toMatch(/<path\b|<style\b|<script\b|foreignObject|href=/i)
  })

  test('normalizes supported text without truncation and escapes XML', () => {
    const fixture = cloneFixture()
    fixture.metadata.title = '  Investment\tcase & controlled <pilot>  '
    const parsed = parseProfessionalInfographicCandidateInput(fixture)
    expect(parsed.metadata.title).toBe('Investment case & controlled <pilot>')
    const svg = compileProfessionalInfographicSvgCandidate(fixture)
    expect(svg).toContain('Investment case &amp; controlled &lt;pilot&gt;')
    expect(svg).not.toContain('  Investment')
  })

  test('enforces exact objects, keys, discriminators, text, arrays, and arithmetic', () => {
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(null), 'INFOGRAPHIC_OBJECT_INVALID')
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput([]), 'INFOGRAPHIC_OBJECT_INVALID')
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput('customer-secret-marker'), 'INFOGRAPHIC_OBJECT_INVALID')

    const prototype = cloneFixture()
    Object.setPrototypeOf(prototype.recommendation, { inherited: true })
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(prototype), 'INFOGRAPHIC_OBJECT_INVALID')

    const extra = cloneFixture()
    extra.customerContent = 'customer-secret-marker'
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(extra), 'INFOGRAPHIC_FIELD_UNSUPPORTED')
    const missing = cloneFixture()
    delete missing.decision.heading
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(missing), 'INFOGRAPHIC_FIELD_REQUIRED')

    const discriminatorCases = [
      ['schemaVersion', 'wrong', 'INFOGRAPHIC_SCHEMA_UNSUPPORTED'],
      ['deliverableFamily', 'DOCUMENT', 'INFOGRAPHIC_FAMILY_UNSUPPORTED'],
      ['template', 'OTHER', 'INFOGRAPHIC_TEMPLATE_UNSUPPORTED'],
    ]
    discriminatorCases.forEach(([field, value, reason]) => {
      const fixture = cloneFixture()
      fixture[field] = value
      expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(fixture), reason)
    })
    const status = cloneFixture()
    status.metadata.status = 'APPROVED'
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(status), 'INFOGRAPHIC_STATUS_UNSUPPORTED')
    const disclosure = cloneFixture()
    disclosure.metadata.disclosure = 'Approved'
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(disclosure), 'INFOGRAPHIC_DISCLOSURE_INVALID')

    for (const invalid of ['', 'bad\u0000text', '\uD800']) {
      const fixture = cloneFixture()
      fixture.recommendation.heading = invalid
      expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(fixture), 'INFOGRAPHIC_TEXT_INVALID')
    }
    const tooLong = cloneFixture()
    tooLong.recommendation.heading = 'x'.repeat(181)
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(tooLong), 'INFOGRAPHIC_TEXT_LIMIT_EXCEEDED')

    const array = cloneFixture()
    array.outcomes.rows.pop()
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(array), 'INFOGRAPHIC_ARRAY_LENGTH_INVALID')
    const number = cloneFixture()
    number.metadata.versionNumber = 1.5
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(number), 'INFOGRAPHIC_NUMBER_INVALID')
    const score = cloneFixture()
    score.risks.items[0].score = 11
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(score), 'INFOGRAPHIC_RISK_SCORE_MISMATCH')
  })

  test('enforces global source and visible-word bounds', () => {
    const bytes = cloneFixture()
    bytes.extra = 'x'.repeat(33_000)
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(bytes), 'INFOGRAPHIC_SOURCE_LIMIT_EXCEEDED')

    const entries = cloneFixture()
    entries.extra = Array.from({ length: 50 }, () => 'x')
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(entries), 'INFOGRAPHIC_SOURCE_LIMIT_EXCEEDED')

    const depth = cloneFixture()
    depth.extra = { a: { b: { c: { d: 'x' } } } }
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(depth), 'INFOGRAPHIC_SOURCE_LIMIT_EXCEEDED')

    const circular = cloneFixture()
    circular.self = circular
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(circular), 'INFOGRAPHIC_OBJECT_INVALID')

    const short = mapFixtureStrings(cloneFixture(), (value, path) => {
      if (path === 'metadata.disclosure' || path === 'metadata.status' || path === 'schemaVersion'
        || path === 'deliverableFamily' || path === 'template') return value
      if (path === 'metadata.altText') return 'A controlled fictional executive infographic description with enough detail to satisfy the accessibility text minimum.'
      return 'x'
    })
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(short), 'INFOGRAPHIC_WORD_LIMIT_EXCEEDED')

    const verbose = mapFixtureStrings(cloneFixture(), (value, path) => {
      if (path === 'metadata.disclosure' || path === 'metadata.status' || path === 'schemaVersion'
        || path === 'deliverableFamily' || path === 'template' || path === 'metadata.altText') return value
      return 'alpha beta gamma delta epsilon zeta'
    })
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(verbose), 'INFOGRAPHIC_WORD_LIMIT_EXCEEDED')
  })

  test('rejects customer-language leakage in input and parsed SVG', () => {
    const input = cloneFixture()
    input.recommendation.heading = 'Provider context customer-secret-marker'
    expectSourceFreeFailure(() => renderProfessionalInfographicSvgCandidate(input), 'INFOGRAPHIC_CUSTOMER_LANGUAGE_UNSAFE')

    const svg = replaceOnce(compileFixture(), 'Fragmentation slows decisions', 'Provider context slows decisions')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(svg), 'SVG_CUSTOMER_LANGUAGE_UNSAFE')
  })

  test('rejects invalid output types, size, forbidden XML, and malformed XML', () => {
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate({}), 'SVG_OUTPUT_INVALID')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(''), 'SVG_OUTPUT_INVALID')
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(Buffer.alloc(524_289, 32)),
      'SVG_OUTPUT_LIMIT_EXCEEDED',
    )
    const svg = compileFixture()
    for (const construct of ['<!--comment-->', '<!DOCTYPE svg>', '<![CDATA[value]]>', '<?work value?>']) {
      expectSourceFreeFailure(
        () => validateProfessionalInfographicSvgCandidate(svg.replace('<svg ', `${construct}\n<svg `)),
        'SVG_XML_FORBIDDEN',
      )
    }
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('</svg>', '')),
      'SVG_XML_INVALID',
    )
  })

  test('rejects unsupported elements, attributes, namespaces, and references', () => {
    const svg = compileFixture()
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('</svg>', '<path id="bad-path" d="M0 0"/></svg>')),
      'SVG_ELEMENT_NOT_ALLOWED',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('<svg xmlns=', '<svg style="display:block" xmlns=')),
      'SVG_ATTRIBUTE_NOT_ALLOWED',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('<svg xmlns=', '<svg xmlns:xlink="urn:test" xmlns=')),
      'SVG_NAMESPACE_NOT_ALLOWED',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('fill="#F5F7F8"', 'fill="data:image/png;base64,bad"')),
      'SVG_REFERENCE_NOT_ALLOWED',
    )
  })

  test('rejects ID, ARIA, root, accessibility, and group inventory drift', () => {
    const svg = compileFixture()
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('id="header-label"', 'id="Bad ID"')),
      'SVG_ID_INVALID',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('id="current-state-label"', 'id="header-label"')),
      'SVG_ID_DUPLICATE',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('aria-labelledby="current-state-label"', 'aria-labelledby="missing"')),
      'SVG_ARIA_REFERENCE_INVALID',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('width="1800"', 'width="1799"')),
      'SVG_ROOT_INVALID',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(
        svg.replace('<title id="svg-title">', '<desc id="svg-title">').replace('</title>', '</desc>'),
      ),
      'SVG_ACCESSIBILITY_INVALID',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('<text id="header-title"', '<text aria-hidden="true" id="header-title"')),
      'SVG_ACCESSIBILITY_TEXT_HIDDEN',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('  <g id="current-state"', '  <g id="current-state-removed"')),
      'SVG_GROUP_INVENTORY_INVALID',
    )
  })

  test('rejects geometry, palette, contrast, and font drift', () => {
    const svg = compileFixture()
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('x="0" y="0" width="1800"', 'x="1" y="0" width="1800"')),
      'SVG_GEOMETRY_INVALID',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('fill="#F5F7F8"', 'fill="#ABC"')),
      'SVG_PALETTE_INVALID',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('id="current-heading" x="130" y="730" fill="#173B5E"', 'id="current-heading" x="130" y="730" fill="#FFFFFF"')),
      'SVG_CONTRAST_INVALID',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('font-family="Arial, Aptos, Segoe UI, sans-serif"', 'font-family="serif"')),
      'SVG_FONT_INVALID',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('id="header-audience" x="1690" y="112" fill="#173B5E" font-family="Arial, Aptos, Segoe UI, sans-serif" font-size="24"', 'id="header-audience" x="1690" y="112" fill="#173B5E" font-family="Arial, Aptos, Segoe UI, sans-serif" font-size="18"')),
      'SVG_FONT_SIZE_INVALID',
    )
  })

  test('rejects empty live text, visible-word limits, and disclosure drift', () => {
    const svg = compileFixture()
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('>Fragmentation slows decisions</text>', '></text>')),
      'SVG_TEXT_INVALID',
    )
    let removed = 0
    const short = svg.replace(/<text\b[^>]*id="([^"]+)"[^>]*>[^<]+<\/text>/g, (match, id) => {
      if (removed < 20 && !id.endsWith('-label') && id !== 'footer-disclosure') {
        removed += 1
        return ''
      }
      return id === 'footer-disclosure'
        ? match
        : match.replace(/>[^<]+<\/text>/, '>x</text>')
    })
    expect(removed).toBe(20)
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(short), 'SVG_WORD_LIMIT_EXCEEDED')
    const verboseText = Array.from({ length: 360 }, () => 'word').join(' ')
    const verbose = svg.replace('</g>\n</svg>', `    <text id="verbose-text" x="80" y="2520" fill="#526373" font-family="Arial, Aptos, Segoe UI, sans-serif" font-size="24" font-weight="400" text-anchor="start">${verboseText}</text>\n  </g>\n</svg>`)
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(verbose), 'SVG_WORD_LIMIT_EXCEEDED')
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('Illustrative reference candidate | not approved', 'Illustrative draft')),
      'SVG_DISCLOSURE_MISSING',
    )
  })

  test('uses source-free stable error envelopes', () => {
    const fixture = cloneFixture()
    fixture.recommendation.heading = 'customer-secret-marker'.repeat(20)
    expectSourceFreeFailure(
      () => renderProfessionalInfographicSvgCandidate(fixture),
      'INFOGRAPHIC_TEXT_LIMIT_EXCEEDED',
      PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED,
    )
  })

  test('never serializes attacker-controlled field, element, or attribute names', () => {
    const input = cloneFixture()
    input['customer-secret-marker'] = 'x'
    expectSourceFreeFailure(
      () => parseProfessionalInfographicCandidateInput(input),
      'INFOGRAPHIC_FIELD_UNSUPPORTED',
      PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.INPUT_INVALID,
    )

    const svg = compileFixture()
    const element = svg.replace('</svg>', '<customer-secret-marker/></svg>')
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(element),
      'SVG_ELEMENT_NOT_ALLOWED',
      PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
    )
    const attribute = svg.replace('<svg xmlns=', '<svg customer-secret-marker="x" xmlns=')
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(attribute),
      'SVG_ATTRIBUTE_NOT_ALLOWED',
      PROFESSIONAL_INFOGRAPHIC_SVG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED,
    )
  })

  test('enforces every fixed collection below and above exact cardinality', () => {
    const collections = [
      ['currentState.metrics', (value) => value.currentState.metrics],
      ['economicCase.metrics', (value) => value.economicCase.metrics],
      ['operatingModel.steps', (value) => value.operatingModel.steps],
      ['outcomes.rows', (value) => value.outcomes.rows],
      ['roadmap.phases', (value) => value.roadmap.phases],
      ['risks.items', (value) => value.risks.items],
      ['decision.conditions', (value) => value.decision.conditions],
    ]
    collections.forEach(([, select]) => {
      const below = cloneFixture()
      select(below).pop()
      expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(below), 'INFOGRAPHIC_ARRAY_LENGTH_INVALID')
      const above = cloneFixture()
      select(above).push(JSON.parse(JSON.stringify(select(above)[0])))
      expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(above), 'INFOGRAPHIC_ARRAY_LENGTH_INVALID')
    })
  })

  test('enforces metadata, short, detail, and statement byte limits directly', () => {
    const cases = [
      (value) => { value.metadata.altText = 'short' },
      (value) => { value.metadata.title = 'x'.repeat(181) },
      (value) => { value.risks.items[0].label = 'x'.repeat(141) },
      (value) => { value.currentState.metrics[0].detail = 'x'.repeat(181) },
      (value) => { value.decision.statement = 'x'.repeat(421) },
    ]
    cases.forEach((mutate) => {
      const fixture = cloneFixture()
      mutate(fixture)
      expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(fixture), 'INFOGRAPHIC_TEXT_LIMIT_EXCEEDED')
    })
  })

  test('rejects normalized internal-language variants in input and output', () => {
    const input = cloneFixture()
    input.recommendation.heading = 'Ｐｒｏｖｉｄｅｒ Ｃｏｎｔｅｘｔ review'
    expectSourceFreeFailure(() => renderProfessionalInfographicSvgCandidate(input), 'INFOGRAPHIC_CUSTOMER_LANGUAGE_UNSAFE')

    const svg = compileFixture()
    const normalized = svg.replace('Fragmentation slows decisions', 'Ｐｒｏｖｉｄｅｒ Ｃｏｎｔｅｘｔ review')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(normalized), 'SVG_CUSTOMER_LANGUAGE_UNSAFE')
    const split = svg.replace(
      /<text id="current-heading"([^>]*)>Fragmentation slows decisions<\/text>/,
      '<text id="current-heading"$1>Provider</text><text id="current-heading-split"$1>context review</text>',
    )
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(split), 'SVG_CUSTOMER_LANGUAGE_UNSAFE')
  })

  test('rejects every declared unsupported element and attribute class', () => {
    const svg = compileFixture()
    for (const element of ['path', 'style', 'script', 'foreignObject', 'animate', 'metadata']) {
      const mutated = svg.replace('</svg>', `<${element} id="unsupported-element">x</${element}></svg>`)
      expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(mutated), 'SVG_ELEMENT_NOT_ALLOWED')
    }
    for (const [name, value] of [['onclick', 'x'], ['href', 'x'], ['style', 'x'], ['transform', 'x']]) {
      const mutated = svg.replace('<svg xmlns=', `<svg ${name}="${value}" xmlns=`)
      expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(mutated), 'SVG_ATTRIBUTE_NOT_ALLOWED')
    }
  })

  test('rejects namespace and prohibited-reference variants fail closed', () => {
    const svg = compileFixture()
    const namespaceCases = [
      svg.replace('<svg xmlns=', '<x:svg xmlns:x="http://www.w3.org/2000/svg" xmlns=').replace('</svg>', '</x:svg>'),
      svg.replace('xmlns="http://www.w3.org/2000/svg"', 'xmlns="urn:other"'),
      svg.replace('<svg xmlns=', '<svg xmlns:x="urn:other" xmlns='),
      svg.replace('<rect id="header-background"', '<rect x:bad="value" xmlns:x="urn:other" id="header-background"'),
    ]
    namespaceCases.forEach((mutated) => {
      expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(mutated), 'SVG_NAMESPACE_NOT_ALLOWED')
    })

    const tokens = [
      'url(test)', 'DATA:image/png', 'file:test', 'JaVaScRiPt:test', 'http:test',
      'https:test', '//host', '\\path', '%2564ata%253Avalue', 'bad\u0001value',
    ]
    tokens.forEach((token) => {
      const mutated = svg.replace('fill="#F5F7F8"', `fill="${token}"`)
      expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(mutated), 'SVG_REFERENCE_NOT_ALLOWED')
    })
    const entityDecoded = svg.replace('fill="#F5F7F8"', 'fill="data&#58;image/png"')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(entityDecoded), 'SVG_REFERENCE_NOT_ALLOWED')
  })

  test('rejects duplicate or misplaced metadata and every group/role/anchor bypass', () => {
    const svg = compileFixture()
    const extraTitle = svg.replace('<g id="header"', '<title id="extra-title">Extra</title><g id="header"')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(extraTitle), 'SVG_ACCESSIBILITY_INVALID')
    const extraDesc = svg.replace('<g id="header"', '<desc id="extra-desc">Extra</desc><g id="header"')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(extraDesc), 'SVG_ACCESSIBILITY_INVALID')
    const misplaced = svg
      .replace('  <title id="svg-title">Enterprise Knowledge Modernisation</title>\n', '')
      .replace('</desc>', '</desc>\n  <title id="svg-title">Enterprise Knowledge Modernisation</title>')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(misplaced), 'SVG_ACCESSIBILITY_INVALID')

    const nested = svg.replace(
      '</g>\n  <g id="footer"',
      '<g id="nested-group" role="button" aria-labelledby="risk-1-label"></g></g>\n  <g id="footer"',
    )
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(nested), 'SVG_GROUP_INVENTORY_INVALID')
    const wrongRole = svg.replace('role="group" aria-labelledby="current-state-label"', 'role="button" aria-labelledby="current-state-label"')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(wrongRole), 'SVG_GROUP_INVENTORY_INVALID')
    const wrongLabel = svg.replace('aria-labelledby="current-state-label"', 'aria-labelledby="economics-label"')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(wrongLabel), 'SVG_GROUP_INVENTORY_INVALID')
    const sideways = svg.replace('text-anchor="start"', 'text-anchor="sideways"')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(sideways), 'SVG_ATTRIBUTE_NOT_ALLOWED')
    const cap = svg.replace('</g>\n</svg>', '<polyline id="footer-rule" points="0,2400 100,2400" fill="none" stroke="#173B5E" stroke-width="2" stroke-linecap="square" aria-hidden="true"/></g>\n</svg>')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(cap), 'SVG_ATTRIBUTE_NOT_ALLOWED')
  })

  test('rejects multiple ARIA targets and hidden tspan or group text', () => {
    const svg = compileFixture()
    const multiple = svg.replace('aria-labelledby="current-state-label"', 'aria-labelledby="current-state-label current-state-label"')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(multiple), 'SVG_ARIA_REFERENCE_INVALID')
    const hiddenGroup = svg.replace('<g id="current-state"', '<g aria-hidden="true" id="current-state"')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(hiddenGroup), 'SVG_ACCESSIBILITY_TEXT_HIDDEN')
    const hiddenTspan = svg.replace(
      '>Fragmentation slows decisions</text>',
      '><tspan id="hidden-tspan" x="130" dy="0" fill="#173B5E" font-size="24" font-weight="400" aria-hidden="true">Fragmentation slows decisions</tspan></text>',
    )
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(hiddenTspan), 'SVG_ACCESSIBILITY_TEXT_HIDDEN')
  })

  test('rejects direct geometry variants', () => {
    const svg = compileFixture()
    const cases = [
      svg.replace('id="header-background" x="0"', 'id="header-background" x="NaN"'),
      svg.replace('id="header-background" x="0"', 'id="header-background" x="-1"'),
      svg.replace('id="header-background" x="0" y="0" width="1800"', 'id="header-background" x="0" y="0" width="0"'),
      svg.replace('id="operating-step-1-circle" cx="154" cy="1332" r="24"', 'id="operating-step-1-circle" cx="154" cy="1332" r="-1"'),
      svg.replace('id="outcome-1-rule" x1="130"', 'id="outcome-1-rule" x1="Infinity"'),
      svg.replace('stroke-width="2" aria-hidden="true"', 'stroke-width="9" aria-hidden="true"'),
      svg.replace('</g>\n</svg>', '<polyline id="footer-rule" points="0,2400 bad" fill="none" stroke="#173B5E" stroke-width="2" aria-hidden="true"/></g>\n</svg>'),
    ]
    cases.forEach((mutated) => {
      expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(mutated), 'SVG_GEOMETRY_INVALID')
    })
  })

  test('rejects direct palette, font-weight, unsupported-size, and duplicate-disclosure variants', () => {
    const svg = compileFixture()
    for (const colour of ['red', '#ABC', '#173B5EAA', '#000000']) {
      expectSourceFreeFailure(
        () => validateProfessionalInfographicSvgCandidate(svg.replace('fill="#F5F7F8"', `fill="${colour}"`)),
        'SVG_PALETTE_INVALID',
      )
    }
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('font-weight="700"', 'font-weight="500"')),
      'SVG_FONT_INVALID',
    )
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('font-size="74"', 'font-size="23"')),
      'SVG_FONT_INVALID',
    )
    const duplicateDisclosure = svg.replace(
      '</g>\n</svg>',
      '<text id="duplicate-disclosure" x="80" y="2520" fill="#526373" font-family="Arial, Aptos, Segoe UI, sans-serif" font-size="24" font-weight="600" text-anchor="start">Illustrative reference candidate | not approved</text></g>\n</svg>',
    )
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(duplicateDisclosure), 'SVG_DISCLOSURE_MISSING')
  })

  test('directly rejects every remaining object and key-drift variant', () => {
    for (const nestedValue of [null, [], 'primitive']) {
      const fixture = cloneFixture()
      fixture.currentState.primaryMetric = nestedValue
      expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(fixture), 'INFOGRAPHIC_OBJECT_INVALID')
    }
    const rootPrototype = cloneFixture()
    Object.setPrototypeOf(rootPrototype, { inherited: true })
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(rootPrototype), 'INFOGRAPHIC_OBJECT_INVALID')
    const rootMissing = cloneFixture()
    delete rootMissing.schemaVersion
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(rootMissing), 'INFOGRAPHIC_FIELD_REQUIRED')
    const nestedUnknown = cloneFixture()
    nestedUnknown.currentState.unknown = 'customer-secret-marker'
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(nestedUnknown), 'INFOGRAPHIC_FIELD_UNSUPPORTED')
  })

  test('directly rejects non-string and C1-control text', () => {
    const nonString = cloneFixture()
    nonString.recommendation.heading = 42
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(nonString), 'INFOGRAPHIC_TEXT_INVALID')
    const c1 = cloneFixture()
    c1.recommendation.heading = 'bad\u0085text'
    expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(c1), 'INFOGRAPHIC_TEXT_INVALID')
  })

  test('directly rejects integer values below and above every declared range', () => {
    const cases = [
      (value, replacement) => { value.metadata.versionNumber = replacement },
      (value, replacement) => { value.risks.items[0].probability = replacement },
      (value, replacement) => { value.risks.items[0].impact = replacement },
      (value, replacement) => { value.risks.items[0].score = replacement },
    ]
    const ranges = [[0, 10000], [0, 6], [0, 6], [0, 26]]
    cases.forEach((mutate, index) => {
      ranges[index].forEach((replacement) => {
        const fixture = cloneFixture()
        mutate(fixture, replacement)
        expectSourceFreeFailure(() => parseProfessionalInfographicCandidateInput(fixture), 'INFOGRAPHIC_NUMBER_INVALID')
      })
    })
  })

  test('directly rejects ENTITY and remaining root/accessibility drift', () => {
    const svg = compileFixture()
    expectSourceFreeFailure(
      () => validateProfessionalInfographicSvgCandidate(svg.replace('<svg ', '<!ENTITY unsafe "value">\n<svg ')),
      'SVG_XML_FORBIDDEN',
    )
    const rootCases = [
      svg.replace('height="2546"', 'height="2545"'),
      svg.replace('viewBox="0 0 1800 2546"', 'viewBox="0 0 1800 2545"'),
      svg.replace('role="img"', 'role="document"'),
    ]
    rootCases.forEach((mutated) => {
      expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(mutated), 'SVG_ROOT_INVALID')
    })
    const accessibilityCases = [
      svg.replace(/<title id="svg-title">[^<]+<\/title>/, '<title id="svg-title"></title>'),
      svg.replace(/<desc id="svg-desc">[^<]+<\/desc>/, '<desc id="svg-desc"></desc>'),
      svg.replace('aria-labelledby="svg-title svg-desc"', 'aria-labelledby="svg-desc svg-title"'),
      svg.replace('aria-labelledby="svg-title svg-desc"', 'aria-labelledby="svg-title"'),
    ]
    accessibilityCases.forEach((mutated) => {
      expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(mutated), 'SVG_ACCESSIBILITY_INVALID')
    })
  })

  test('directly rejects reordered and extra direct groups', () => {
    const svg = compileFixture()
    const headerStart = svg.indexOf('  <g id="header"')
    const recommendationStart = svg.indexOf('  <g id="recommendation"')
    const currentStateStart = svg.indexOf('  <g id="current-state"')
    const headerBlock = svg.slice(headerStart, recommendationStart)
    const recommendationBlock = svg.slice(recommendationStart, currentStateStart)
    const reordered = `${svg.slice(0, headerStart)}${recommendationBlock}${headerBlock}${svg.slice(currentStateStart)}`
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(reordered), 'SVG_GROUP_INVENTORY_INVALID')

    const extra = svg.replace(
      '</svg>',
      '<g id="extra-group" role="group" aria-labelledby="extra-group-label"><rect id="extra-group-background" x="0" y="0" width="1" height="1" fill="#FFFFFF" aria-hidden="true"/><text id="extra-group-label" x="1" y="24" fill="#173B5E" font-family="Arial, Aptos, Segoe UI, sans-serif" font-size="18" font-weight="700" text-anchor="start">EXTRA</text></g>\n</svg>',
    )
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(extra), 'SVG_GROUP_INVENTORY_INVALID')
  })

  test('directly rejects out-of-canvas coordinates and corner-radius overflow', () => {
    const svg = compileFixture()
    const outside = svg.replace('id="header-background" x="0"', 'id="header-background" x="1801"')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(outside), 'SVG_GEOMETRY_INVALID')
    const radius = svg.replace('id="header-background" x="0" y="0" width="1800" height="330" rx="6"', 'id="header-background" x="0" y="0" width="1800" height="330" rx="21"')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(radius), 'SVG_GEOMETRY_INVALID')
  })

  test('directly rejects absent live text and path-only replacement', () => {
    const svg = compileFixture()
    const absent = svg.replace(/\s*<text\b[^>]*>[^<]*<\/text>/g, '')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(absent), 'SVG_TEXT_INVALID')
    const pathOnly = absent.replace('</svg>', '<path id="path-only" d="M0 0"/></svg>')
    expectSourceFreeFailure(() => validateProfessionalInfographicSvgCandidate(pathOnly), 'SVG_ELEMENT_NOT_ALLOWED')
  })
})
