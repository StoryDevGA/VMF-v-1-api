export const OUTCOME_STUDIO_CONVERSATION_OUTPUT_RESOLUTION_VERSION =
  'outcome-studio.conversation-output-resolution.v1';

const TOP_LEVEL_KEYS = [
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
];

const DESCRIPTOR_KEYS = ['key', 'label', 'version'];
const ROLE_KEYS = ['role', 'classification', 'key', 'label', 'version'];
const CLARIFICATION_KEYS = ['required', 'reason', 'question'];
const VALID_STATUSES = new Set(['RESOLVED', 'CLARIFICATION_REQUIRED']);
const VALID_SOURCES = new Set([
  'BOUND_SESSION_REFINEMENT',
  'CONVERSATION_INFERENCE',
  'EXPLICIT_API_OVERRIDE',
  'LEGACY_BOUND_SESSION',
]);
const VALID_CONFIDENCE = new Set(['HIGH', 'NONE']);
const NEGATION_TOKENS = new Set(['no', 'not', 'never', 'without', 'instead']);
const MAX_PROMPT_LENGTH = 2000;
const MAX_DELIVERABLES = 48;
const MAX_KEY_OR_LABEL_LENGTH = 140;
const MAX_DESCRIPTOR_VALUE_LENGTH = 160;
const MAX_REASON_LENGTH = 240;
const MAX_CLARIFICATION_LENGTH = 240;
const MAX_ROLES = 6;

const AUDIENCE_SIGNALS = new Map([
  ['investor', ['INVESTORS', 'Investors']],
  ['investors', ['INVESTORS', 'Investors']],
  ['shareholder', ['INVESTORS', 'Investors']],
  ['shareholders', ['INVESTORS', 'Investors']],
  ['board', ['BOARD', 'Board']],
  ['director', ['BOARD', 'Board']],
  ['directors', ['BOARD', 'Board']],
  ['executive', ['EXECUTIVE_LEADERSHIP', 'Executive leadership']],
  ['executives', ['EXECUTIVE_LEADERSHIP', 'Executive leadership']],
  ['leadership', ['EXECUTIVE_LEADERSHIP', 'Executive leadership']],
  ['customer', ['CUSTOMERS_PROSPECTS', 'Customers and prospects']],
  ['customers', ['CUSTOMERS_PROSPECTS', 'Customers and prospects']],
  ['prospect', ['CUSTOMERS_PROSPECTS', 'Customers and prospects']],
  ['prospects', ['CUSTOMERS_PROSPECTS', 'Customers and prospects']],
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, keys, field) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${field} must be an object`);
  }

  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${field} contains missing or extra fields`);
  }
}

function assertBoundedString(value, field, maxLength, { allowEmpty = true } = {}) {
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be a string`);
  }
  if ((!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new RangeError(`${field} has an invalid length`);
  }
  return value;
}

function normalizeText(value) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[_\-/]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCapabilityIdentity(value) {
  return value.normalize('NFKC').trim().toLowerCase();
}

function tokenize(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(' ') : [];
}

function descriptor(key, label, version = '') {
  return { key, label, version };
}

function sanitizeDescriptor(value, field, { nullable = true } = {}) {
  if (value === null && nullable) {
    return null;
  }

  assertExactKeys(value, DESCRIPTOR_KEYS, field);
  return descriptor(
    assertBoundedString(value.key, `${field}.key`, MAX_DESCRIPTOR_VALUE_LENGTH, { allowEmpty: false }),
    assertBoundedString(value.label, `${field}.label`, MAX_DESCRIPTOR_VALUE_LENGTH, { allowEmpty: false }),
    assertBoundedString(value.version, `${field}.version`, MAX_DESCRIPTOR_VALUE_LENGTH),
  );
}

function sanitizeClarificationPath(value) {
  assertExactKeys(value, CLARIFICATION_KEYS, 'clarificationPath');
  if (typeof value.required !== 'boolean') {
    throw new TypeError('clarificationPath.required must be a boolean');
  }

  const reason = assertBoundedString(
    value.reason,
    'clarificationPath.reason',
    MAX_REASON_LENGTH,
  );
  const question = assertBoundedString(
    value.question,
    'clarificationPath.question',
    MAX_CLARIFICATION_LENGTH,
  );

  if (value.required && (!reason || !question)) {
    throw new TypeError('required clarification must include a reason and question');
  }
  if (!value.required && (reason || question)) {
    throw new TypeError('resolved output must not include clarification details');
  }

  return { required: value.required, reason, question };
}

function sanitizeRole(value, index) {
  const field = `knowledgePackRoles[${index}]`;
  assertExactKeys(value, ROLE_KEYS, field);
  return {
    role: assertBoundedString(value.role, `${field}.role`, MAX_KEY_OR_LABEL_LENGTH, {
      allowEmpty: false,
    }),
    classification: assertBoundedString(
      value.classification,
      `${field}.classification`,
      MAX_KEY_OR_LABEL_LENGTH,
      { allowEmpty: false },
    ),
    key: assertBoundedString(value.key, `${field}.key`, MAX_DESCRIPTOR_VALUE_LENGTH, {
      allowEmpty: false,
    }),
    label: assertBoundedString(value.label, `${field}.label`, MAX_DESCRIPTOR_VALUE_LENGTH, {
      allowEmpty: false,
    }),
    version: assertBoundedString(
      value.version,
      `${field}.version`,
      MAX_DESCRIPTOR_VALUE_LENGTH,
    ),
  };
}

export function assertOutcomeStudioOutputContractResolution(value) {
  assertExactKeys(value, TOP_LEVEL_KEYS, 'resolution');

  if (value.contractVersion !== OUTCOME_STUDIO_CONVERSATION_OUTPUT_RESOLUTION_VERSION) {
    throw new TypeError('resolution.contractVersion is unsupported');
  }
  if (!VALID_STATUSES.has(value.status)) {
    throw new TypeError('resolution.status is malformed');
  }
  if (!VALID_SOURCES.has(value.source)) {
    throw new TypeError('resolution.source is malformed');
  }
  if (!VALID_CONFIDENCE.has(value.confidence)) {
    throw new TypeError('resolution.confidence is malformed');
  }

  const inferenceReason = assertBoundedString(
    value.inferenceReason,
    'resolution.inferenceReason',
    MAX_REASON_LENGTH,
    { allowEmpty: false },
  );
  if (!Array.isArray(value.knowledgePackRoles) || value.knowledgePackRoles.length > MAX_ROLES) {
    throw new TypeError('resolution.knowledgePackRoles is malformed');
  }

  const knowledgePackRoles = value.knowledgePackRoles.map(sanitizeRole);
  const roleNames = knowledgePackRoles.map((role) => role.role);
  if (new Set(roleNames).size !== roleNames.length) {
    throw new TypeError('resolution.knowledgePackRoles contains duplicate roles');
  }

  const clarificationPath = sanitizeClarificationPath(value.clarificationPath);
  if (value.status === 'RESOLVED') {
    if (value.confidence !== 'HIGH' || clarificationPath.required) {
      throw new TypeError('resolved output must be high confidence without clarification');
    }
    if (value.outputIntent === null || value.selectedOutputType === null) {
      throw new TypeError('resolved output must include output intent and output type');
    }
  } else {
    if (value.confidence !== 'NONE' || !clarificationPath.required) {
      throw new TypeError('clarification output must have no confidence and require clarification');
    }
    if (
      value.outputIntent !== null ||
      value.audience !== null ||
      value.purpose !== null ||
      value.selectedOutputType !== null ||
      value.selectedOutputSchema !== null ||
      value.selectedStyle !== null ||
      knowledgePackRoles.length > 0
    ) {
      throw new TypeError('clarification output must not carry a selected contract');
    }
  }

  return {
    contractVersion: value.contractVersion,
    status: value.status,
    source: value.source,
    confidence: value.confidence,
    inferenceReason,
    outputIntent: sanitizeDescriptor(value.outputIntent, 'resolution.outputIntent'),
    audience: sanitizeDescriptor(value.audience, 'resolution.audience'),
    purpose: sanitizeDescriptor(value.purpose, 'resolution.purpose'),
    selectedOutputType: sanitizeDescriptor(
      value.selectedOutputType,
      'resolution.selectedOutputType',
    ),
    selectedOutputSchema: sanitizeDescriptor(
      value.selectedOutputSchema,
      'resolution.selectedOutputSchema',
    ),
    selectedStyle: sanitizeDescriptor(value.selectedStyle, 'resolution.selectedStyle'),
    knowledgePackRoles,
    clarificationPath,
  };
}

export const sanitizeOutcomeStudioOutputContractResolution =
  assertOutcomeStudioOutputContractResolution;

function activeDeliverables(deliverables) {
  if (!Array.isArray(deliverables) || deliverables.length > MAX_DELIVERABLES) {
    throw new TypeError(`deliverables must be an array of at most ${MAX_DELIVERABLES} items`);
  }

  return deliverables
    .map((deliverable, index) => {
      if (!isPlainObject(deliverable)) {
        throw new TypeError(`deliverables[${index}] must be an object`);
      }
      const key = assertBoundedString(
        deliverable.key,
        `deliverables[${index}].key`,
        MAX_KEY_OR_LABEL_LENGTH,
        { allowEmpty: false },
      );
      const label = assertBoundedString(
        deliverable.label,
        `deliverables[${index}].label`,
        MAX_KEY_OR_LABEL_LENGTH,
        { allowEmpty: false },
      );
      const hasStatus = typeof deliverable.status === 'string';
      const active = deliverable.active !== false && (!hasStatus || deliverable.status === 'ACTIVE');
      return { key, label, active };
    })
    .filter((deliverable) => deliverable.active);
}

function deliverableConflict(deliverables) {
  const normalizedKeys = new Set();
  const labelsToKeys = new Map();

  for (const deliverable of deliverables) {
    const normalizedKey = normalizeCapabilityIdentity(deliverable.key);
    const normalizedLabel = normalizeText(deliverable.label);
    if (normalizedKeys.has(normalizedKey)) {
      return 'DUPLICATE_NORMALIZED_OUTPUT_TYPE_KEY';
    }
    normalizedKeys.add(normalizedKey);

    if (labelsToKeys.has(normalizedLabel) && labelsToKeys.get(normalizedLabel) !== normalizedKey) {
      return 'DUPLICATE_NORMALIZED_OUTPUT_TYPE_LABEL';
    }
    labelsToKeys.set(normalizedLabel, normalizedKey);
  }

  return null;
}

function isNegated(tokens, startIndex) {
  const priorStart = Math.max(0, startIndex - 3);
  return tokens.slice(priorStart, startIndex).some((token) => NEGATION_TOKENS.has(token));
}

function phraseOccurrences(tokens, phraseTokens) {
  if (phraseTokens.length < 2 || phraseTokens.length > tokens.length) {
    return [];
  }

  const occurrences = [];
  for (let start = 0; start <= tokens.length - phraseTokens.length; start += 1) {
    const matches = phraseTokens.every((token, offset) => tokens[start + offset] === token);
    if (matches && !isNegated(tokens, start)) {
      occurrences.push({ start, end: start + phraseTokens.length - 1 });
    }
  }
  return occurrences;
}

function findDeliverableMatches(promptTokens, deliverables) {
  return deliverables.flatMap((deliverable) => {
    const phrases = new Map();
    for (const rawPhrase of [deliverable.label, deliverable.key]) {
      const phraseTokens = tokenize(rawPhrase);
      if (phraseTokens.length >= 2) {
        phrases.set(phraseTokens.join(' '), phraseTokens);
      }
    }

    const occurrences = [...phrases.values()].flatMap((phraseTokens) =>
      phraseOccurrences(promptTokens, phraseTokens),
    );
    return occurrences.length ? [{ deliverable, occurrences }] : [];
  });
}

function tokenFallsInsideRanges(index, ranges) {
  return ranges.some((range) => index >= range.start && index <= range.end);
}

function resolveAudience(promptTokens, ignoredRanges) {
  const detected = new Map();
  promptTokens.forEach((token, index) => {
    if (tokenFallsInsideRanges(index, ignoredRanges) || !AUDIENCE_SIGNALS.has(token)) {
      return;
    }
    const [key, label] = AUDIENCE_SIGNALS.get(token);
    detected.set(key, descriptor(key, label));
  });

  if (detected.size > 1) {
    return { conflict: true, value: null };
  }
  return { conflict: false, value: detected.values().next().value ?? null };
}

function hasContiguousPhrase(tokens, phrase) {
  return phraseOccurrences(tokens, phrase).length > 0;
}

function resolvePurpose(promptTokens, ignoredRanges = []) {
  const purposeTokens = promptTokens.filter((_, index) =>
    !tokenFallsInsideRanges(index, ignoredRanges),
  );
  if (hasContiguousPhrase(purposeTokens, ['investor', 'day'])) {
    return {
      conflict: false,
      value: descriptor(
        'INVESTOR_DAY_EXECUTIVE_COMMUNICATION',
        'Investor Day executive communication',
      ),
    };
  }

  const hasDecision = purposeTokens.some((token) =>
    ['decision', 'decisions', 'recommendation', 'recommendations'].includes(token),
  );
  const hasProposal = purposeTokens.some((token) =>
    ['proposal', 'proposals', 'sales', 'pitch', 'pitches'].includes(token),
  );
  const hasBrief = purposeTokens.some((token) =>
    ['brief', 'briefs', 'summary', 'summaries', 'update', 'updates'].includes(token),
  );

  if (hasDecision && hasProposal) {
    return { conflict: true, value: null };
  }
  if (hasDecision) {
    return {
      conflict: false,
      value: descriptor('DECISION_RECOMMENDATION', 'Decision or recommendation'),
    };
  }
  if (hasProposal) {
    return {
      conflict: false,
      value: descriptor('PROPOSAL_SALES_PITCH', 'Proposal, sales, or pitch communication'),
    };
  }
  if (hasBrief) {
    return {
      conflict: false,
      value: descriptor('BRIEF_SUMMARY_UPDATE', 'Brief, summary, or update'),
    };
  }
  return { conflict: false, value: null };
}

function clarificationQuestion(deliverables) {
  const labels = [];
  const seen = new Set();
  for (const deliverable of deliverables) {
    const normalized = normalizeText(deliverable.label);
    if (!seen.has(normalized)) {
      labels.push(deliverable.label);
      seen.add(normalized);
    }
  }

  const prefix = 'Which output would you like';
  if (labels.length === 0) {
    return `${prefix}?`;
  }

  const selectedLabels = [];
  for (const label of labels) {
    const candidate = `${prefix}: ${[...selectedLabels, label].join(', ')}?`;
    if (candidate.length > MAX_CLARIFICATION_LENGTH) {
      break;
    }
    selectedLabels.push(label);
  }
  return selectedLabels.length
    ? `${prefix}: ${selectedLabels.join(', ')}?`
    : `${prefix}?`;
}

function clarificationResolution({ source, reason, deliverables }) {
  return assertOutcomeStudioOutputContractResolution({
    contractVersion: OUTCOME_STUDIO_CONVERSATION_OUTPUT_RESOLUTION_VERSION,
    status: 'CLARIFICATION_REQUIRED',
    source,
    confidence: 'NONE',
    inferenceReason: reason,
    outputIntent: null,
    audience: null,
    purpose: null,
    selectedOutputType: null,
    selectedOutputSchema: null,
    selectedStyle: null,
    knowledgePackRoles: [],
    clarificationPath: {
      required: true,
      reason,
      question: clarificationQuestion(deliverables),
    },
  });
}

export function resolveOutcomeStudioConversationOutputContract({
  prompt,
  deliverables,
  requestedOutputTypeKey = '',
}) {
  assertBoundedString(prompt, 'prompt', MAX_PROMPT_LENGTH);
  assertBoundedString(
    requestedOutputTypeKey,
    'requestedOutputTypeKey',
    MAX_KEY_OR_LABEL_LENGTH,
  );

  const candidates = activeDeliverables(deliverables);
  const conflict = deliverableConflict(candidates);
  if (conflict) {
    return clarificationResolution({
      source: requestedOutputTypeKey ? 'EXPLICIT_API_OVERRIDE' : 'CONVERSATION_INFERENCE',
      reason: conflict,
      deliverables: candidates,
    });
  }

  const promptTokens = tokenize(prompt);
  const normalizedRequestedOutputTypeKey = requestedOutputTypeKey
    ? normalizeCapabilityIdentity(requestedOutputTypeKey)
    : '';
  let selectedMatch;
  let source = 'CONVERSATION_INFERENCE';
  let inferenceReason = 'MATCHED_FULL_OUTPUT_TYPE_PHRASE';

  if (requestedOutputTypeKey) {
    source = 'EXPLICIT_API_OVERRIDE';
    inferenceReason = 'MATCHED_EXPLICIT_ACTIVE_OUTPUT_TYPE_KEY';
    const selected = candidates.find((candidate) => (
      normalizeCapabilityIdentity(candidate.key) === normalizedRequestedOutputTypeKey
    ));
    if (!selected) {
      return clarificationResolution({
        source,
        reason: 'EXPLICIT_OUTPUT_TYPE_UNAVAILABLE',
        deliverables: candidates,
      });
    }
    const selectedOccurrences = findDeliverableMatches(promptTokens, [selected]);
    selectedMatch = {
      deliverable: selected,
      occurrences: selectedOccurrences[0]?.occurrences ?? [],
    };
  } else {
    const matches = findDeliverableMatches(promptTokens, candidates);
    const distinctKeys = new Set(
      matches.map((match) => normalizeCapabilityIdentity(match.deliverable.key)),
    );
    if (distinctKeys.size === 0) {
      return clarificationResolution({
        source,
        reason: 'NO_OUTPUT_TYPE_MATCH',
        deliverables: candidates,
      });
    }
    if (distinctKeys.size > 1) {
      return clarificationResolution({
        source,
        reason: 'MULTIPLE_OUTPUT_TYPE_MATCHES',
        deliverables: candidates,
      });
    }
    selectedMatch = matches[0];
  }

  const audienceResult = resolveAudience(promptTokens, selectedMatch.occurrences);
  if (audienceResult.conflict) {
    return clarificationResolution({
      source,
      reason: 'MULTIPLE_AUDIENCE_SIGNALS',
      deliverables: candidates,
    });
  }

  const purposeResult = resolvePurpose(promptTokens, selectedMatch.occurrences);
  if (purposeResult.conflict) {
    return clarificationResolution({
      source,
      reason: 'MULTIPLE_PURPOSE_SIGNALS',
      deliverables: candidates,
    });
  }

  const outputType = descriptor(
    selectedMatch.deliverable.key,
    selectedMatch.deliverable.label,
  );
  return assertOutcomeStudioOutputContractResolution({
    contractVersion: OUTCOME_STUDIO_CONVERSATION_OUTPUT_RESOLUTION_VERSION,
    status: 'RESOLVED',
    source,
    confidence: 'HIGH',
    inferenceReason,
    outputIntent: outputType,
    audience: audienceResult.value,
    purpose: purposeResult.value,
    selectedOutputType: outputType,
    selectedOutputSchema: null,
    selectedStyle: null,
    knowledgePackRoles: [],
    clarificationPath: { required: false, reason: '', question: '' },
  });
}

function descriptorFromContext(value, field) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return sanitizeDescriptor(
    {
      key: value.key,
      label: value.label,
      version: value.version ?? '',
    },
    field,
    { nullable: false },
  );
}

function bindingDescriptor(binding, field) {
  if (!isPlainObject(binding) || binding[field] === undefined) {
    return null;
  }
  return descriptorFromContext(binding[field], `binding.${field}`);
}

export function compareOutcomeStudioOutputContractCurrentness({
  resolution,
  knowledgeContext = {},
  binding = {},
}) {
  const safeResolution = assertOutcomeStudioOutputContractResolution(resolution);
  const mismatches = [];
  const contextDescriptors = {
    outputType: knowledgeContext.outputType
      ? descriptorFromContext(knowledgeContext.outputType, 'knowledgeContext.outputType')
      : null,
    outputSchema: knowledgeContext.outputSchema
      ? descriptorFromContext(knowledgeContext.outputSchema, 'knowledgeContext.outputSchema')
      : null,
    style: knowledgeContext.style
      ? descriptorFromContext(knowledgeContext.style, 'knowledgeContext.style')
      : null,
  };

  if (
    safeResolution.status === 'RESOLVED' &&
    contextDescriptors.outputType &&
    safeResolution.selectedOutputType.key !== contextDescriptors.outputType.key
  ) {
    mismatches.push({
      field: 'outputType.key',
      expected: safeResolution.selectedOutputType.key,
      actual: contextDescriptors.outputType.key,
    });
  }

  for (const field of ['outputType', 'outputSchema', 'style']) {
    const expected = bindingDescriptor(binding, field);
    const actual = contextDescriptors[field];
    if (!expected || !actual) {
      continue;
    }
    for (const property of ['key', 'version']) {
      if (expected[property] !== actual[property]) {
        mismatches.push({
          field: `${field}.${property}`,
          expected: expected[property],
          actual: actual[property],
        });
      }
    }
  }

  return { current: mismatches.length === 0, mismatches };
}

function selectedActivePack(pack, key) {
  return (
    isPlainObject(pack) &&
    pack.key === key &&
    pack.selected === true &&
    (pack.active === true || pack.status === 'ACTIVE')
  );
}

function role(roleName, classification, value) {
  return {
    role: roleName,
    classification,
    key: value.key,
    label: value.label,
    version: value.version,
  };
}

export function completeOutcomeStudioOutputContractResolution({
  resolution,
  knowledgeContext,
  binding = {},
  frameworkKey,
}) {
  const safeResolution = assertOutcomeStudioOutputContractResolution(resolution);
  if (safeResolution.status !== 'RESOLVED') {
    return safeResolution;
  }
  if (!isPlainObject(knowledgeContext)) {
    throw new TypeError('knowledgeContext must be an object');
  }

  const outputType = descriptorFromContext(
    knowledgeContext.outputType,
    'knowledgeContext.outputType',
  );
  const outputSchema = descriptorFromContext(
    knowledgeContext.outputSchema,
    'knowledgeContext.outputSchema',
  );
  const style = descriptorFromContext(knowledgeContext.style, 'knowledgeContext.style');
  const currentness = compareOutcomeStudioOutputContractCurrentness({
    resolution: safeResolution,
    knowledgeContext,
    binding,
  });
  if (!currentness.current) {
    throw new Error(
      `Outcome Studio output contract is not current: ${currentness.mismatches
        .map((mismatch) => mismatch.field)
        .join(', ')}`,
    );
  }

  const roles = [
    role('OUTPUT_TYPE', 'OUTPUT_TYPE', outputType),
    role('OUTPUT_SCHEMA', 'OUTPUT_SCHEMA', outputSchema),
    role('STYLE', 'STYLE', style),
  ];
  const packs = Array.isArray(knowledgeContext.knowledgePacks)
    ? knowledgeContext.knowledgePacks
    : [];
  const arl = packs.find((pack) => selectedActivePack(pack, 'adaptive-reasoning-layer'));
  const rl = packs.find((pack) => selectedActivePack(pack, 'rendering-layer'));

  if (arl) {
    roles.push(
      role(
        'ARL',
        'METHOD',
        descriptorFromContext(arl, 'knowledgeContext.knowledgePacks.ARL'),
      ),
    );
  }
  if (rl) {
    roles.push(
      role(
        'RL',
        'METHOD',
        descriptorFromContext(rl, 'knowledgeContext.knowledgePacks.RL'),
      ),
    );
  }
  if (frameworkKey === 'VMF') {
    const framework = isPlainObject(knowledgeContext.framework)
      ? descriptorFromContext(knowledgeContext.framework, 'knowledgeContext.framework')
      : descriptor('VMF', 'VMF', binding.frameworkVersion ?? '');
    roles.push(role('VMF', 'FRAMEWORK', framework));
  }

  return assertOutcomeStudioOutputContractResolution({
    ...safeResolution,
    selectedOutputType: outputType,
    selectedOutputSchema: outputSchema,
    selectedStyle: style,
    knowledgePackRoles: roles,
  });
}
