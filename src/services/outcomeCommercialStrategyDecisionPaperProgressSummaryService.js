import {
  COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
  COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
} from '../constants/outcomeCommercialStrategyDecisionPaper.js'

const asArray = (value) => Array.isArray(value) ? value : []

const doneWhen = (condition, itemKey, label) => condition ? [{ itemKey, label }] : []
const todoWhen = (condition, itemKey, label, blocker = '') => condition ? [{ itemKey, label, blocker }] : []

const buildRecommendedNext = ({
  blocked,
  knowledge,
  sourceAuthority,
  candidate,
  comparison,
  runGate,
  ss007Complete,
} = {}) => {
  if (ss007Complete) {
    return {
      action: 'NO_ACTION_REQUIRED',
      label: 'Sprint evidence is complete.',
      blocked: false,
      reason: '',
    }
  }

  if (blocked) {
    return {
      action: 'RESOLVE_KNOWLEDGE_READINESS',
      label: 'Upload/import/activate/certify missing Knowledge Packs, then rerun the governed readiness gate.',
      blocked: true,
      reason: runGate.reason || 'KNOWLEDGE_READINESS_BLOCKED',
      missingPackKeys: asArray(knowledge.missingPackKeys).filter(Boolean).sort(),
    }
  }

  if (sourceAuthority.status === 'SOURCE_AUTHORITY_REQUIRED') {
    return {
      action: 'SUPPLY_SOURCE_AUTHORITY',
      label: 'Supply or map required source-authority documents/support assets for missing packs.',
      blocked: true,
      reason: 'SOURCE_AUTHORITY_REQUIRED',
    }
  }

  if (runGate.mayGenerate === true && candidate.candidateAvailable !== true) {
    return {
      action: 'GENERATE_CANDIDATE',
      label: 'Generate one governed commercial strategy decision-paper candidate.',
      blocked: false,
      reason: '',
    }
  }

  if (runGate.mayCompare === true && comparison.comparisonAvailable !== true) {
    return {
      action: 'RUN_BENCHMARK_COMPARISON',
      label: 'Run governed benchmark comparison against the approved example benchmark reference.',
      blocked: false,
      reason: '',
    }
  }

  if (runGate.mayReportVerdict === true) {
    return {
      action: runGate.nextAction || 'REPORT_PASS_PARTIAL_OR_FAIL',
      label: 'Report pass, partial pass or fail from governed comparison evidence.',
      blocked: false,
      reason: '',
    }
  }

  return {
    action: runGate.nextAction || 'RERUN_READINESS_GATE',
    label: 'Rerun readiness and follow the governed run gate.',
    blocked: runGate.status === 'STOP',
    reason: runGate.reason || '',
  }
}

const compactLeftToDo = ({
  blocked,
  knowledge,
  sourceAuthority,
  benchmark,
  candidate,
  comparison,
  acceptance,
  help,
  runGate,
  ss007Complete,
} = {}) => {
  const primaryBlockers = []
  if (blocked) primaryBlockers.push('Missing or unresolved governed Knowledge Packs.')
  if (sourceAuthority.status === 'SOURCE_AUTHORITY_REQUIRED') {
    primaryBlockers.push('Required source-authority documents or support assets are not fully supplied/mapped.')
  }
  if (!blocked && benchmark.benchmarkAvailable !== true) {
    primaryBlockers.push('Approved benchmark reference metadata is not ready.')
  }

  const nextSequence = []
  if (!blocked && runGate.mayGenerate === true && candidate.candidateAvailable !== true) {
    nextSequence.push('Generate one governed commercial strategy decision-paper candidate.')
  } else if (!blocked && candidate.candidateAvailable !== true) {
    nextSequence.push('Rerun readiness until candidate generation is allowed.')
  }
  if (candidate.candidateAvailable === true && comparison.comparisonAvailable !== true) {
    nextSequence.push('Run governed benchmark comparison.')
  }
  if (comparison.comparisonAvailable === true && acceptance.status !== 'COMPARED') {
    nextSequence.push('Report pass, partial pass or fail.')
  }
  if (!ss007Complete) {
    nextSequence.push('Complete sprint evidence only after generation, comparison and verdict evidence exist.')
  }

  const separatePublicationBlockers = []
  if (help.publicationReady !== true) {
    separatePublicationBlockers.push('Verify selected help repository binding before help publication.')
  }

  return {
    primaryBlockers,
    nextSequence,
    separatePublicationBlockers,
    currentGate: runGate.status || '',
    currentGateAction: runGate.nextAction || '',
    missingPackKeys: asArray(knowledge.missingPackKeys).filter(Boolean).sort(),
  }
}

export const buildCommercialStrategyDecisionPaperProgressSummary = ({
  readinessPackage = {},
} = {}) => {
  const projection = readinessPackage.readinessProjection || {}
  const manifest = readinessPackage.evidenceManifest || {}
  const runGate = projection.runGate || readinessPackage.runGate || {}
  const knowledge = projection.knowledgeReadiness || {}
  const sourceAuthority = projection.sourceAuthority || {}
  const benchmark = projection.benchmark || {}
  const candidate = projection.candidate || {}
  const comparison = projection.comparison || {}
  const help = projection.help || {}
  const qa = projection.qaEvidence || {}
  const acceptance = readinessPackage.sprintEvidenceSnapshot?.acceptanceResult || {}

  const completed = [
    ...doneWhen(Boolean(projection.status), 'readiness_projection', 'Safe readiness projection exists.'),
    ...doneWhen(Boolean(manifest.manifestFingerprint), 'evidence_manifest', 'Evidence manifest is fingerprinted.'),
    ...doneWhen(knowledge.status === 'READY', 'knowledge_readiness_ready', 'Knowledge readiness projection is ready.'),
    ...doneWhen(sourceAuthority.status === 'NO_SOURCE_AUTHORITY_GAPS', 'source_authority_clear', 'No missing source-authority gaps are reported.'),
    ...doneWhen(benchmark.benchmarkAvailable === true, 'benchmark_reference_ready', 'Benchmark reference metadata is ready.'),
    ...doneWhen(candidate.candidateAvailable === true, 'candidate_reference_ready', 'Generated candidate reference metadata is ready.'),
    ...doneWhen(comparison.comparisonAvailable === true, 'comparison_result_ready', 'Comparison result metadata is ready.'),
    ...doneWhen(acceptance.status === 'COMPARED', 'acceptance_result_available', 'Pass, partial pass or fail result is available.'),
    ...doneWhen(help.publicationReady === true, 'help_publication_ready', 'Help publication readiness is clear.'),
    ...doneWhen(qa.extendedQaRequired === false && qa.browserQaRequired === false, 'bounded_qa_only', 'QA remains bounded to chain evidence.'),
  ]

  const remaining = [
    ...todoWhen(
      knowledge.stopBeforeGeneration === true || asArray(knowledge.missingPackKeys).length > 0,
      'resolve_knowledge_packs',
      'Upload/import/activate/certify missing Knowledge Packs and rerun governed resolver.',
      'KNOWLEDGE_READINESS_BLOCKED',
    ),
    ...todoWhen(
      sourceAuthority.status === 'SOURCE_AUTHORITY_REQUIRED',
      'supply_source_authority',
      'Supply or map required source-authority documents/support assets for missing packs.',
      'SOURCE_AUTHORITY_REQUIRED',
    ),
    ...todoWhen(
      benchmark.benchmarkAvailable !== true,
      'verify_benchmark_reference',
      'Verify approved benchmark reference metadata and provenance.',
      'BENCHMARK_REFERENCE_BLOCKED',
    ),
    ...todoWhen(
      runGate.mayGenerate !== true && candidate.candidateAvailable !== true && runGate.status !== 'READY_FOR_GENERATION',
      'wait_for_generation_gate',
      'Wait until the run gate allows candidate generation.',
      runGate.reason || 'GENERATION_GATE_NOT_READY',
    ),
    ...todoWhen(
      runGate.mayGenerate === true && candidate.candidateAvailable !== true,
      'generate_candidate',
      'Generate one governed commercial strategy decision-paper candidate.',
      'CANDIDATE_NOT_GENERATED',
    ),
    ...todoWhen(
      candidate.candidateAvailable === true && comparison.comparisonAvailable !== true,
      'run_comparison',
      'Run benchmark comparison against the approved commercial strategy decision-paper benchmark.',
      'COMPARISON_NOT_READY',
    ),
    ...todoWhen(
      comparison.comparisonAvailable === true && acceptance.status !== 'COMPARED',
      'report_acceptance_result',
      'Report pass, partial pass or fail from governed comparison evidence.',
      'ACCEPTANCE_RESULT_NOT_REPORTED',
    ),
    ...todoWhen(
      help.publicationReady !== true,
      'verify_help_binding',
      'Verify selected help repository binding before publication.',
      'HELP_PUBLICATION_BLOCKED',
    ),
    ...todoWhen(
      readinessPackage.sprintEvidenceSnapshot?.ss007Complete !== true,
      'complete_sprint_evidence',
      'Complete sprint evidence only after generation, comparison and verdict evidence exist.',
      'SS007_NOT_COMPLETE',
    ),
  ]

  const blocked = runGate.status === 'STOP'
    || knowledge.stopBeforeGeneration === true
    || asArray(knowledge.missingPackKeys).length > 0
  const ss007Complete = readinessPackage.sprintEvidenceSnapshot?.ss007Complete === true

  return {
    contractVersion: COMMERCIAL_STRATEGY_DECISION_PAPER_CONTRACT_VERSION,
    requestedOutputTypeKey: COMMERCIAL_STRATEGY_DECISION_PAPER_OUTPUT_TYPE_KEY,
    status: ss007Complete
      ? 'COMPLETE'
      : blocked
        ? 'BLOCKED'
        : 'IN_PROGRESS',
    runGateStatus: runGate.status || '',
    nextAction: runGate.nextAction || '',
    completionClaim: projection.completionClaim || 'NOT_COMPLETE',
    ss007Complete,
    leftToDo: compactLeftToDo({
      blocked,
      knowledge,
      sourceAuthority,
      benchmark,
      candidate,
      comparison,
      acceptance,
      help,
      runGate,
      ss007Complete,
    }),
    recommendedNext: buildRecommendedNext({
      blocked,
      knowledge,
      sourceAuthority,
      candidate,
      comparison,
      runGate,
      ss007Complete,
    }),
    completed,
    remaining,
  }
}

export default {
  buildCommercialStrategyDecisionPaperProgressSummary,
}
