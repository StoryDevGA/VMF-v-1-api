import { describe, expect, test } from '@jest/globals';
import {
  OUTCOME_STUDIO_CONVERSATION_OUTPUT_RESOLUTION_VERSION,
  assertOutcomeStudioOutputContractResolution,
  compareOutcomeStudioOutputContractCurrentness,
  completeOutcomeStudioOutputContractResolution,
  resolveOutcomeStudioConversationOutputContract,
} from '../services/outcomeStudioOutputContractResolutionService.js';

const deliverables = [
  { key: 'executive-brief', label: 'Executive Brief', active: true },
  { key: 'sales-proposal', label: 'Sales Proposal', active: true },
  { key: 'board-update', label: 'Board Update', active: true },
];

describe('Outcome Studio conversation output contract resolution', () => {
  test('resolves the Parlon benchmark request as an investor Executive Brief', () => {
    const result = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Can you prepare an executive brief for our investor day',
      deliverables,
    });

    expect(result).toEqual({
      contractVersion: OUTCOME_STUDIO_CONVERSATION_OUTPUT_RESOLUTION_VERSION,
      status: 'RESOLVED',
      source: 'CONVERSATION_INFERENCE',
      confidence: 'HIGH',
      inferenceReason: 'MATCHED_FULL_OUTPUT_TYPE_PHRASE',
      outputIntent: { key: 'executive-brief', label: 'Executive Brief', version: '' },
      audience: { key: 'INVESTORS', label: 'Investors', version: '' },
      purpose: {
        key: 'INVESTOR_DAY_EXECUTIVE_COMMUNICATION',
        label: 'Investor Day executive communication',
        version: '',
      },
      selectedOutputType: { key: 'executive-brief', label: 'Executive Brief', version: '' },
      selectedOutputSchema: null,
      selectedStyle: null,
      knowledgePackRoles: [],
      clarificationPath: { required: false, reason: '', question: '' },
    });
  });

  test('normalizes punctuation and full output keys without fuzzy matching', () => {
    const result = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Please create an EXECUTIVE_BRIEF.',
      deliverables,
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.selectedOutputType.key).toBe('executive-brief');
  });

  test('requires clarification when no full output phrase matches', () => {
    const result = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Please write something useful for tomorrow.',
      deliverables,
    });

    expect(result.status).toBe('CLARIFICATION_REQUIRED');
    expect(result.inferenceReason).toBe('NO_OUTPUT_TYPE_MATCH');
    expect(result.clarificationPath.question.length).toBeLessThanOrEqual(240);
  });

  test('requires clarification when multiple output types match', () => {
    const result = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Prepare an executive brief and a sales proposal.',
      deliverables,
    });

    expect(result.status).toBe('CLARIFICATION_REQUIRED');
    expect(result.inferenceReason).toBe('MULTIPLE_OUTPUT_TYPE_MATCHES');
  });

  test('excludes a deliverable phrase negated in the prior three tokens', () => {
    const result = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Not an executive brief; prepare a sales proposal.',
      deliverables,
    });

    expect(result.status).toBe('RESOLVED');
    expect(result.selectedOutputType.key).toBe('sales-proposal');
  });

  test.each([
    [
      [
        { key: 'executive-brief', label: 'Executive Brief' },
        { key: 'executive_brief', label: 'Leadership Brief' },
      ],
      'MULTIPLE_OUTPUT_TYPE_MATCHES',
    ],
    [
      [
        { key: 'executive-brief', label: 'Executive Brief' },
        { key: 'leadership-note', label: 'Executive_Brief' },
      ],
      'DUPLICATE_NORMALIZED_OUTPUT_TYPE_LABEL',
    ],
  ])('requires clarification for conflicting deliverable definitions', (items, reason) => {
    const result = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Prepare an executive brief.',
      deliverables: items,
    });

    expect(result.status).toBe('CLARIFICATION_REQUIRED');
    expect(result.inferenceReason).toBe(reason);
  });

  test('ignores audience words inside the matched deliverable and clarifies real audience conflict', () => {
    const ignored = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Prepare an executive brief.',
      deliverables,
    });
    const conflict = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Prepare an executive brief for investors and the board.',
      deliverables,
    });

    expect(ignored.audience).toBeNull();
    expect(conflict.status).toBe('CLARIFICATION_REQUIRED');
    expect(conflict.inferenceReason).toBe('MULTIPLE_AUDIENCE_SIGNALS');
  });

  test('applies purpose precedence and clarifies conflicting specific purposes', () => {
    const investorDay = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Prepare an executive brief with recommendations for investor day.',
      deliverables,
    });
    const decision = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Prepare an executive brief with a recommendation.',
      deliverables,
    });
    const conflict = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Prepare an executive brief with a recommendation and sales pitch.',
      deliverables,
    });

    expect(investorDay.purpose.key).toBe('INVESTOR_DAY_EXECUTIVE_COMMUNICATION');
    expect(decision.purpose.key).toBe('DECISION_RECOMMENDATION');
    expect(conflict.inferenceReason).toBe('MULTIPLE_PURPOSE_SIGNALS');
  });

  test('ignores purpose words inside the matched deliverable phrase', () => {
    const result = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Create the Sales Email deliverable with customer-ready recommendations.',
      deliverables: [
        { key: 'sales_email', label: 'Sales Email', active: true },
      ],
      requestedOutputTypeKey: 'sales_email',
    });

    expect(result).toMatchObject({
      status: 'RESOLVED',
      selectedOutputType: { key: 'sales_email' },
      purpose: { key: 'DECISION_RECOMMENDATION' },
    });
  });

  test('preserves exact capability identities and separator distinctions at the boundary', () => {
    const exactDeliverables = [
      { key: 'sales_email', label: 'Sales Email', active: true },
      { key: 'sales-email', label: 'Hyphen Sales Email', active: true },
      { key: 'x'.repeat(140), label: 'Boundary Deliverable', active: true },
    ];
    const underscore = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Create the Sales Email.',
      deliverables: exactDeliverables,
      requestedOutputTypeKey: 'sales_email',
    });
    const hyphen = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Create the Hyphen Sales Email.',
      deliverables: exactDeliverables,
      requestedOutputTypeKey: 'sales-email',
    });
    const boundary = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Create the boundary deliverable.',
      deliverables: exactDeliverables,
      requestedOutputTypeKey: 'x'.repeat(140),
    });

    expect(underscore.selectedOutputType.key).toBe('sales_email');
    expect(hyphen.selectedOutputType.key).toBe('sales-email');
    expect(boundary.selectedOutputType.key).toBe('x'.repeat(140));
  });

  test('normalizes explicit fallback lookup by case and whitespace without merging separators', () => {
    const result = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Create the Sales Email.',
      deliverables: [
        { key: 'sales_email', label: 'Sales Email', active: true },
        { key: 'sales-email', label: 'Hyphen Sales Email', active: true },
      ],
      requestedOutputTypeKey: '  SALES_EMAIL  ',
    });

    expect(result).toMatchObject({
      status: 'RESOLVED',
      selectedOutputType: { key: 'sales_email' },
    });
  });

  test('supports an exact active explicit override and exposes unavailable overrides safely', () => {
    const override = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Create something for customers.',
      deliverables,
      requestedOutputTypeKey: 'sales-proposal',
    });
    const unavailable = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Create something for customers.',
      deliverables,
      requestedOutputTypeKey: 'unknown-output',
    });
    const inactive = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Create an executive brief.',
      deliverables: [
        { key: 'executive-brief', label: 'Executive Brief', status: 'DRAFT' },
      ],
      requestedOutputTypeKey: 'executive-brief',
    });

    expect(override).toMatchObject({
      status: 'RESOLVED',
      source: 'EXPLICIT_API_OVERRIDE',
      inferenceReason: 'MATCHED_EXPLICIT_ACTIVE_OUTPUT_TYPE_KEY',
      selectedOutputType: { key: 'sales-proposal' },
    });
    expect(unavailable).toMatchObject({
      status: 'CLARIFICATION_REQUIRED',
      source: 'EXPLICIT_API_OVERRIDE',
      inferenceReason: 'EXPLICIT_OUTPUT_TYPE_UNAVAILABLE',
      selectedOutputType: null,
    });
    expect(inactive).toMatchObject({
      status: 'CLARIFICATION_REQUIRED',
      inferenceReason: 'EXPLICIT_OUTPUT_TYPE_UNAVAILABLE',
      selectedOutputType: null,
    });
  });

  test('completes selected contracts and bounded active Knowledge Pack roles', () => {
    const resolution = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Prepare an executive brief for investor day.',
      deliverables,
    });
    const knowledgeContext = {
      outputType: { key: 'executive-brief', label: 'Executive Brief', version: '2.1.0' },
      outputSchema: { key: 'executive-brief-schema', label: 'Executive Brief Schema', version: '3.0.0' },
      style: { key: 'investor-executive', label: 'Investor Executive Style', version: '1.4.0' },
      framework: { key: 'VMF', label: 'Value Management Framework', version: '2.3.1' },
      knowledgePacks: [
        {
          key: 'adaptive-reasoning-layer',
          label: 'Adaptive Reasoning Layer',
          version: '1.0.0',
          selected: true,
          status: 'ACTIVE',
        },
        {
          key: 'rendering-layer',
          label: 'Rendering Layer',
          version: '1.1.0',
          selected: true,
          active: true,
        },
        {
          key: 'inactive-method',
          label: 'Inactive Method',
          version: '1.0.0',
          selected: true,
          status: 'INACTIVE',
        },
      ],
    };

    const result = completeOutcomeStudioOutputContractResolution({
      resolution,
      knowledgeContext,
      binding: {
        outputType: { key: 'executive-brief', label: 'Executive Brief', version: '2.1.0' },
        outputSchema: {
          key: 'executive-brief-schema',
          label: 'Executive Brief Schema',
          version: '3.0.0',
        },
        style: { key: 'investor-executive', label: 'Investor Executive Style', version: '1.4.0' },
      },
      frameworkKey: 'VMF',
    });

    expect(result.selectedOutputType.version).toBe('2.1.0');
    expect(result.selectedOutputSchema.key).toBe('executive-brief-schema');
    expect(result.selectedStyle.key).toBe('investor-executive');
    expect(result.knowledgePackRoles).toEqual([
      {
        role: 'OUTPUT_TYPE',
        classification: 'OUTPUT_TYPE',
        key: 'executive-brief',
        label: 'Executive Brief',
        version: '2.1.0',
      },
      {
        role: 'OUTPUT_SCHEMA',
        classification: 'OUTPUT_SCHEMA',
        key: 'executive-brief-schema',
        label: 'Executive Brief Schema',
        version: '3.0.0',
      },
      {
        role: 'STYLE',
        classification: 'STYLE',
        key: 'investor-executive',
        label: 'Investor Executive Style',
        version: '1.4.0',
      },
      {
        role: 'ARL',
        classification: 'METHOD',
        key: 'adaptive-reasoning-layer',
        label: 'Adaptive Reasoning Layer',
        version: '1.0.0',
      },
      {
        role: 'RL',
        classification: 'METHOD',
        key: 'rendering-layer',
        label: 'Rendering Layer',
        version: '1.1.0',
      },
      {
        role: 'VMF',
        classification: 'FRAMEWORK',
        key: 'VMF',
        label: 'Value Management Framework',
        version: '2.3.1',
      },
    ]);
  });

  test('reports currentness mismatches without throwing', () => {
    const resolution = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Prepare an executive brief.',
      deliverables,
    });
    const result = compareOutcomeStudioOutputContractCurrentness({
      resolution,
      knowledgeContext: {
        outputType: { key: 'executive-brief', label: 'Executive Brief', version: '2.0.0' },
      },
      binding: {
        outputType: { key: 'executive-brief', label: 'Executive Brief', version: '1.0.0' },
      },
    });

    expect(result).toEqual({
      current: false,
      mismatches: [
        { field: 'outputType.version', expected: '1.0.0', actual: '2.0.0' },
      ],
    });
  });

  test('compares governed capability keys exactly after canonical trim and lowercase', () => {
    const resolution = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Create the Sales Email.',
      deliverables: [{ key: 'sales_email', label: 'Sales Email', active: true }],
      requestedOutputTypeKey: 'sales_email',
    });
    const matching = compareOutcomeStudioOutputContractCurrentness({
      resolution,
      knowledgeContext: {
        outputType: { key: 'sales_email', label: 'Sales Email', version: '1.0.0' },
      },
    });
    const collision = compareOutcomeStudioOutputContractCurrentness({
      resolution,
      knowledgeContext: {
        outputType: { key: 'sales-email', label: 'Sales Email', version: '1.0.0' },
      },
    });

    expect(matching.current).toBe(true);
    expect(collision).toEqual({
      current: false,
      mismatches: [
        { field: 'outputType.key', expected: 'sales_email', actual: 'sales-email' },
      ],
    });
  });

  test('strict sanitizer rejects extra fields, overlength values, duplicate roles, and malformed status', () => {
    const safe = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Prepare an executive brief.',
      deliverables,
    });

    expect(() => assertOutcomeStudioOutputContractResolution({ ...safe, rawPrompt: 'unsafe' }))
      .toThrow('missing or extra fields');
    expect(() =>
      assertOutcomeStudioOutputContractResolution({
        ...safe,
        inferenceReason: 'x'.repeat(241),
      }),
    ).toThrow('invalid length');
    expect(() =>
      assertOutcomeStudioOutputContractResolution({
        ...safe,
        knowledgePackRoles: [
          {
            role: 'STYLE',
            classification: 'STYLE',
            key: 'style-one',
            label: 'Style One',
            version: '1',
          },
          {
            role: 'STYLE',
            classification: 'STYLE',
            key: 'style-two',
            label: 'Style Two',
            version: '1',
          },
        ],
      }),
    ).toThrow('duplicate roles');
    expect(() =>
      assertOutcomeStudioOutputContractResolution({ ...safe, status: 'MAYBE' }),
    ).toThrow('status is malformed');
    const clarification = resolveOutcomeStudioConversationOutputContract({
      prompt: 'Write something useful.',
      deliverables,
    });
    expect(() =>
      assertOutcomeStudioOutputContractResolution({
        ...clarification,
        selectedOutputType: {
          key: 'executive-brief',
          label: 'Executive Brief',
          version: '',
        },
      }),
    ).toThrow('must not carry a selected contract');
    expect(() =>
      resolveOutcomeStudioConversationOutputContract({
        prompt: 'x'.repeat(2001),
        deliverables,
      }),
    ).toThrow('invalid length');
  });

  test('safe resolution never persists the raw prompt or candidate identifiers and content', () => {
    const secretMarker = 'PRIVATE-CUSTOMER-MARKER-7391';
    const result = resolveOutcomeStudioConversationOutputContract({
      prompt: `Prepare an executive brief for investors. ${secretMarker}`,
      deliverables: deliverables.map((item, index) => ({
        ...item,
        id: `candidate-id-${index}`,
        content: `candidate-content-${index}`,
      })),
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(secretMarker);
    expect(serialized).not.toContain('candidate-id');
    expect(serialized).not.toContain('candidate-content');
    expect(Object.keys(result)).toEqual([
      'contractVersion',
      'status',
      'source',
      'confidence',
      'inferenceReason',
      'outputIntent',
      'audience',
      'purpose',
      'selectedOutputType',
      'selectedOutputSchema',
      'selectedStyle',
      'knowledgePackRoles',
      'clarificationPath',
    ]);
  });
});
