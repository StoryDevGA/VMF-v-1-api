export const professionalInfographicSvgCandidateFixture = Object.freeze({
  schemaVersion: 'governed-deliverable.v1',
  deliverableFamily: 'INFOGRAPHIC',
  template: 'EXECUTIVE_DECISION_INFOGRAPHIC',
  metadata: Object.freeze({
    title: 'Enterprise Knowledge Modernisation',
    subtitle: 'A controlled path from fragmented information to faster decisions',
    audience: 'Executive investment committee',
    status: 'DRAFT',
    versionNumber: 1,
    disclosure: 'Illustrative reference candidate | not approved',
    altText: 'Executive decision infographic summarising a fictional enterprise knowledge modernisation case, its economics, roadmap, risks, conditions, and proposed decision.',
  }),
  recommendation: Object.freeze({
    label: 'Recommendation',
    heading: 'Fund a focused twelve-month modernisation',
    statement: 'Start with priority workflows, prove adoption, and scale only when evidence supports the next phase.',
  }),
  currentState: Object.freeze({
    heading: 'Fragmentation slows decisions',
    primaryMetric: Object.freeze({ value: '18 hrs', label: 'weekly search effort', detail: 'per specialist team' }),
    metrics: Object.freeze([
      Object.freeze({ value: '42%', label: 'duplicate work', detail: 'across priority teams' }),
      Object.freeze({ value: '6 days', label: 'decision delay', detail: 'for routine reviews' }),
      Object.freeze({ value: '31%', label: 'content trusted', detail: 'without rechecking' }),
      Object.freeze({ value: '9', label: 'core repositories', detail: 'with mixed ownership' }),
    ]),
  }),
  economicCase: Object.freeze({
    heading: 'Base case supports action',
    metrics: Object.freeze([
      Object.freeze({ value: 'GBP 1.8m', label: 'annual benefit', detail: 'at steady adoption' }),
      Object.freeze({ value: '14 months', label: 'payback', detail: 'from programme start' }),
      Object.freeze({ value: '2.4x', label: 'three-year return', detail: 'before upside options' }),
    ]),
    qualifier: 'Benefits depend on workflow adoption, accountable ownership, and monthly measurement against the agreed baseline.',
  }),
  operatingModel: Object.freeze({
    heading: 'A governed operating model',
    steps: Object.freeze([
      Object.freeze({ label: 'Prioritise', detail: 'select valuable workflows' }),
      Object.freeze({ label: 'Curate', detail: 'assign accountable owners' }),
      Object.freeze({ label: 'Embed', detail: 'integrate daily decisions' }),
      Object.freeze({ label: 'Measure', detail: 'prove value and trust' }),
    ]),
  }),
  outcomes: Object.freeze({
    heading: 'Measurable year-one outcomes',
    rows: Object.freeze([
      Object.freeze({ label: 'Search effort', baseline: '18 hours', target: '8 hours' }),
      Object.freeze({ label: 'Decision delay', baseline: '6 days', target: '2 days' }),
      Object.freeze({ label: 'Trusted content', baseline: '31%', target: '75%' }),
      Object.freeze({ label: 'Duplicate work', baseline: '42%', target: '20%' }),
      Object.freeze({ label: 'Active adoption', baseline: '0%', target: '70%' }),
    ]),
  }),
  roadmap: Object.freeze({
    heading: 'Four controlled phases',
    phases: Object.freeze([
      Object.freeze({ period: 'Months 1-2', label: 'Baseline', detail: 'confirm measures and ownership' }),
      Object.freeze({ period: 'Months 3-5', label: 'Pilot', detail: 'launch two priority workflows' }),
      Object.freeze({ period: 'Months 6-9', label: 'Scale', detail: 'extend proven practices' }),
      Object.freeze({ period: 'Months 10-12', label: 'Embed', detail: 'transfer accountable operation' }),
    ]),
  }),
  risks: Object.freeze({
    heading: 'Manageable delivery risks',
    items: Object.freeze([
      Object.freeze({ label: 'Adoption remains uneven', probability: 3, impact: 4, score: 12 }),
      Object.freeze({ label: 'Ownership stays unclear', probability: 2, impact: 5, score: 10 }),
      Object.freeze({ label: 'Benefits are overstated', probability: 2, impact: 4, score: 8 }),
    ]),
    response: 'Use named owners, monthly evidence reviews, and stop-or-adjust gates before each expansion decision.',
  }),
  decision: Object.freeze({
    heading: 'Approve controlled mobilisation',
    statement: 'Release initial funding for the baseline and pilot, subject to five operating conditions.',
    conditions: Object.freeze([
      'Name an executive sponsor',
      'Confirm workflow owners',
      'Approve the value baseline',
      'Review evidence monthly',
      'Gate expansion on results',
    ]),
  }),
})
