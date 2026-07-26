const disclosure = 'Illustrative reference candidate | not approved'

const notes = (specific) => `${specific} This slide is part of a controlled fictional engineering example and does not describe a real organization. The figures are illustrative, require validation before real use, and support a gated decision rather than unconditional implementation. Reviewers should test the evidence, assumptions, controls, and named ownership before relying on the recommendation.`

export const professionalPresentationCandidateFixture = Object.freeze({
  schemaVersion: 'governed-deliverable.v1',
  deliverableFamily: 'PRESENTATION',
  metadata: Object.freeze({
    title: 'Enterprise Knowledge Operating Model Modernisation',
    subtitle: 'Decision case for a gated 12-month programme',
    audience: 'Executive Investment Committee',
    status: 'DRAFT',
    versionNumber: 1,
    disclosure,
  }),
  slides: Object.freeze([
    Object.freeze({
      layout: 'COVER',
      title: 'Enterprise Knowledge Operating Model Modernisation',
      notes: notes('The decision question is whether leadership should fund mobilisation and validation for a governed enterprise knowledge operating model.'),
      content: Object.freeze({
        eyebrow: 'Illustrative business case',
        subtitle: 'Decision case for a gated 12-month programme',
        audience: 'Executive Investment Committee',
      }),
    }),
    Object.freeze({
      layout: 'DECISION',
      title: 'Approve a gated programme, not unconditional scale-up',
      notes: notes('The recommendation is to approve a staged programme with explicit opportunities to correct, reduce scope, or stop when evidence does not support the next phase.'),
      content: Object.freeze({
        statement: 'Approve mobilisation and validation across four explicit investment gates.',
        metrics: Object.freeze([
          Object.freeze({ label: 'Initial envelope', value: 'GBP 420k', detail: 'Programme implementation envelope', tone: 'CAUTION' }),
          Object.freeze({ label: 'Four-year NPV', value: 'GBP 145k', detail: 'Illustrative base case', tone: 'POSITIVE' }),
          Object.freeze({ label: 'Indicative payback', value: '2.8 years', detail: 'After programme start', tone: 'PRIMARY' }),
        ]),
        qualifier: 'Benefits realization depends on managers removing rework and redirecting released capacity.',
      }),
    }),
    Object.freeze({
      layout: 'METRICS',
      title: 'Fragmentation creates GBP 762k of avoidable annual effort',
      notes: notes('The annual avoidable-effort baseline is calculated from 210 workers, 5.5 hours per worker per month, 12 months, and a GBP 55 fully loaded hourly rate.'),
      content: Object.freeze({
        steps: Object.freeze([
          Object.freeze({ label: 'Knowledge workers', value: '210', detail: 'People in scope', tone: 'NEUTRAL' }),
          Object.freeze({ label: 'Avoidable effort', value: '5.5', detail: 'Hours each month', tone: 'PRIMARY' }),
          Object.freeze({ label: 'Loaded rate', value: 'GBP 55', detail: 'Per hour', tone: 'CAUTION' }),
        ]),
        result: Object.freeze({ label: 'Annual baseline', value: 'GBP 762,300', detail: 'Avoidable effort each year', tone: 'PRIMARY' }),
        indicators: Object.freeze([
          Object.freeze({ label: 'First-review acceptance', value: '55%', detail: 'Current quality baseline', tone: 'CAUTION' }),
          Object.freeze({ label: 'Evidence traceability', value: '30%', detail: 'Deliverables with complete evidence', tone: 'POSITIVE' }),
        ]),
      }),
    }),
    Object.freeze({
      layout: 'CHART',
      title: 'The governed model wins on fit, traceability and reuse',
      notes: notes('Three options are compared across strategic fit, time to value, governance, cost position, scalability, and reuse. The governed enterprise model achieves the strongest weighted score.'),
      content: Object.freeze({
        chartType: 'BAR',
        categories: Object.freeze(['Current processes', 'Local automation', 'Governed model']),
        series: Object.freeze([
          Object.freeze({ name: 'Weighted score', values: Object.freeze([36, 56, 86]) }),
        ]),
        callouts: Object.freeze([
          Object.freeze({ label: 'Recommendation', value: 'Option 3', detail: 'Governed enterprise model', tone: 'POSITIVE' }),
        ]),
        qualifier: 'Local automation can support bounded experiments but should not become the enterprise model.',
      }),
    }),
    Object.freeze({
      layout: 'PROCESS',
      title: 'Five accountable capabilities replace fragmented local processes',
      notes: notes('The recommended model separates governed knowledge, reasoning and authoring, approval and lineage, professional rendering, and quality governance without blurring accountability.'),
      content: Object.freeze({
        steps: Object.freeze([
          Object.freeze({ label: 'Governed knowledge', detail: 'Reusable information, policy and style', period: 'KNOWLEDGE' }),
          Object.freeze({ label: 'Reasoning and authoring', detail: 'Create and refine working drafts', period: 'AUTHORING' }),
          Object.freeze({ label: 'Approval and lineage', detail: 'Create an immutable approved version', period: 'APPROVAL' }),
          Object.freeze({ label: 'Professional rendering', detail: 'Produce the agreed audience format', period: 'RENDERING' }),
          Object.freeze({ label: 'Quality governance', detail: 'Named review and retained evidence', period: 'ASSURANCE' }),
        ]),
        outcome: 'Business conversation -> approved working output -> professional deliverable',
      }),
    }),
    Object.freeze({
      layout: 'CHART',
      title: 'The base case pays back after disciplined adoption',
      notes: notes('The base case ramps benefits over four years and deducts annual operating costs. The cumulative position turns positive during Year 3 and reaches about GBP 285,000 by Year 4.'),
      content: Object.freeze({
        chartType: 'COLUMN',
        categories: Object.freeze(['Year 1', 'Year 2', 'Year 3', 'Year 4']),
        series: Object.freeze([
          Object.freeze({ name: 'Net benefit GBPk', values: Object.freeze([61, 168, 241, 236]) }),
        ]),
        callouts: Object.freeze([
          Object.freeze({ label: 'Steady-state value', value: 'GBP 391k', detail: 'Gross annual value', tone: 'POSITIVE' }),
          Object.freeze({ label: 'Cumulative position', value: 'GBP 285k', detail: 'After initial investment', tone: 'PRIMARY' }),
          Object.freeze({ label: 'Four-year NPV', value: 'GBP 145k', detail: 'At an 8% discount rate', tone: 'CAUTION' }),
        ]),
        qualifier: 'Capacity value is not guaranteed cash savings.',
      }),
    }),
    Object.freeze({
      layout: 'CHART',
      title: 'Value depends on productivity realization',
      notes: notes('Sensitivity analysis shows a material downside when productivity realization and external-spend reduction fall below the base assumptions. Stage gates preserve the option to stop.'),
      content: Object.freeze({
        chartType: 'BAR',
        categories: Object.freeze(['Downside', 'Base', 'Upside']),
        series: Object.freeze([
          Object.freeze({ name: 'Four-year NPV GBPk', values: Object.freeze([-226, 145, 515]) }),
        ]),
        callouts: Object.freeze([
          Object.freeze({ label: 'Downside payback', value: 'Beyond Year 4', detail: 'Productivity realization 30%', tone: 'CAUTION' }),
          Object.freeze({ label: 'Base payback', value: '2.8 years', detail: 'Productivity realization 45%', tone: 'POSITIVE' }),
        ]),
        qualifier: 'Do not scale unless pilot evidence supports the base-case trajectory.',
      }),
    }),
    Object.freeze({
      layout: 'RISK',
      title: 'Three delivery risks need executive attention',
      notes: notes('The highest risks concern benefits realization, behavior change, and knowledge migration quality. These exposures require named owners and evidence before selective scale.'),
      content: Object.freeze({
        risks: Object.freeze([
          Object.freeze({ label: 'Benefits realization below plan', probability: 3, impact: 5, score: 15, owner: 'COO | benefits owner and gated scale' }),
          Object.freeze({ label: 'Adoption and behavior change', probability: 3, impact: 4, score: 12, owner: 'Change Lead | role-based pilots and measures' }),
          Object.freeze({ label: 'Knowledge migration quality', probability: 3, impact: 4, score: 12, owner: 'Knowledge Lead | sampling and rollback' }),
          Object.freeze({ label: 'Supplier dependency', probability: 2, impact: 4, score: 8, owner: 'Commercial Lead | exit testing' }),
          Object.freeze({ label: 'Governance burden', probability: 2, impact: 3, score: 6, owner: 'Quality Lead | risk-tiered controls' }),
        ]),
        secondary: 'Lower exposures remain controlled through vendor-neutral terms and service targets.',
      }),
    }),
    Object.freeze({
      layout: 'PROCESS',
      title: 'Four gates control investment over 12 months',
      notes: notes('The roadmap releases funding by phase. Each phase has an explicit exit gate, and a missed gate triggers correction, scope reduction, or a stop decision.'),
      content: Object.freeze({
        steps: Object.freeze([
          Object.freeze({ label: 'Mobilize and validate', detail: 'Baseline, ownership and control design agreed', period: 'Weeks 0-8' }),
          Object.freeze({ label: 'Build the foundation', detail: 'Quality and operating readiness accepted', period: 'Months 2-5' }),
          Object.freeze({ label: 'Pilot two teams', detail: 'Benefits checkpoint supports scale', period: 'Months 6-9' }),
          Object.freeze({ label: 'Scale selectively', detail: 'Operating model approved for proven use cases', period: 'Months 10-12' }),
        ]),
        outcome: 'Funding is released by phase. A missed gate triggers correction, scope reduction, or stop.',
      }),
    }),
    Object.freeze({
      layout: 'SCORECARD',
      title: 'Prove quality and adoption before scale',
      notes: notes('The Year 1 scorecard focuses on observable measures: avoidable effort, cycle time, first-review acceptance, evidence traceability, and active use in pilot roles.'),
      content: Object.freeze({
        rows: Object.freeze([
          Object.freeze({ measure: 'Avoidable effort', baseline: '5.5 hours', target: '3.8 or lower', owner: 'Functional Directors' }),
          Object.freeze({ measure: 'Executive cycle time', baseline: '10 days', target: '7 or lower', owner: 'Operations' }),
          Object.freeze({ measure: 'First-review acceptance', baseline: '55%', target: '75% or higher', owner: 'Quality Lead' }),
          Object.freeze({ measure: 'Complete evidence traceability', baseline: '30%', target: '85% or higher', owner: 'Knowledge Governance Lead' }),
          Object.freeze({ measure: 'Active use in pilot roles', baseline: 'Not established', target: '70% or higher', owner: 'Programme Director' }),
        ]),
      }),
    }),
    Object.freeze({
      layout: 'CONDITIONS',
      title: 'Approval depends on five explicit conditions',
      notes: notes('Approval is conditional on Finance validation, Security and Privacy approval, Product confirmation of the quality benchmark, named operational ownership, and credible Month 9 evidence.'),
      content: Object.freeze({
        conditions: Object.freeze([
          Object.freeze({ label: 'Finance validates assumptions A01-A10', detail: 'Confirm the business case inputs and sensitivity range' }),
          Object.freeze({ label: 'Security and Privacy approve provider and data controls', detail: 'Confirm data flow, retention, and regional controls' }),
          Object.freeze({ label: 'Product confirms the quality benchmark and review method', detail: 'Adopt the decision standard before operational reliance' }),
          Object.freeze({ label: 'Named operational owners accept accountability', detail: 'Assign service, knowledge, quality, and benefit owners' }),
          Object.freeze({ label: 'Month 9 evidence supports the base-case trajectory', detail: 'Use observed quality, adoption, and productivity results' }),
        ]),
        continueRule: 'Evidence supports the next gate',
        pauseRule: 'A condition remains unresolved',
      }),
    }),
    Object.freeze({
      layout: 'CLOSING',
      title: 'Fund mobilisation and validation',
      notes: notes('The requested decision is to fund Phase 1 within the programme envelope, confirm the five conditions, and return at the first gate with validated evidence.'),
      content: Object.freeze({
        statement: 'Fund mobilisation and validation',
        subtitle: 'Do not authorize unconditional scale-up.',
        steps: Object.freeze([
          Object.freeze({ label: 'Approve Phase 1', detail: 'Within the programme envelope' }),
          Object.freeze({ label: 'Confirm conditions', detail: 'Assign named decision owners' }),
          Object.freeze({ label: 'Validate evidence', detail: 'Test baseline and controls' }),
          Object.freeze({ label: 'Return at gate', detail: 'Use observed results' }),
        ]),
      }),
    }),
  ]),
})
