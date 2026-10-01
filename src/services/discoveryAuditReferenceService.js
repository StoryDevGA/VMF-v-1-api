const normalizeAuditRef = (value) => String(value || '').trim()

export const appendDiscoveryAuditRef = (values, auditRef) => {
  const refs = Array.isArray(values) ? values.map(normalizeAuditRef) : []
  const normalizedAuditRef = normalizeAuditRef(auditRef)
  return [...new Set([...refs, normalizedAuditRef].filter(Boolean))]
}

const collectAuditRefs = (...items) => items.flatMap((item) => [
  ...(Array.isArray(item?.auditRefs) ? item.auditRefs : []),
  item?.auditRef,
]).map(normalizeAuditRef).filter(Boolean)

const indexById = (items, key) => new Map((Array.isArray(items) ? items : [])
  .reduce((entries, item) => {
    const id = String(item?.[key] || '').trim()
    if (!id) return entries
    const existing = entries.get(id) || {}
    entries.set(id, { ...existing, ...item })
    return entries
  }, new Map()))

const sameRecordContent = (current, previous, key) => {
  const fields = key === 'evidenceObjectId'
    ? [
        'sourceId',
        'extractedFact',
        'sourceLocation',
        'contentHash',
        'documentHash',
        'evidenceState',
        'acceptanceState',
        'reviewStatus',
        'acceptedBy',
        'acceptanceTimestamp',
        'rejectedBy',
        'rejectionTimestamp',
      ]
    : ['sourceType', 'type', 'fieldKey', 'url', 'finalUrl', 'valueHash', 'documentHash', 'fileName', 'documentId']

  return fields.every((field) => {
    const currentValue = current?.[field]
    const previousValue = previous?.[field]
    if (currentValue === undefined && previousValue === undefined) return true
    return JSON.stringify(currentValue) === JSON.stringify(previousValue)
  })
}

const getSources = (evidencePack = {}) => [
  ...(Array.isArray(evidencePack.sourceRegistry) ? evidencePack.sourceRegistry : []),
  ...(Array.isArray(evidencePack.lineage?.sources) ? evidencePack.lineage.sources : []),
  ...(Array.isArray(evidencePack.acquisition?.sourceRegistry) ? evidencePack.acquisition.sourceRegistry : []),
]

export const attachDiscoveryRegistrationAuditRef = (evidencePack, auditRef, previousEvidencePack = {}) => {
  const normalizedAuditRef = normalizeAuditRef(auditRef)
  const previousRecords = [
    ...(Array.isArray(previousEvidencePack.evidenceObjects) ? previousEvidencePack.evidenceObjects : []),
    ...getSources(previousEvidencePack),
  ]
  const previousAuditRefs = [
    ...(Array.isArray(previousEvidencePack.audit_refs) ? previousEvidencePack.audit_refs : []),
    ...previousRecords.flatMap((item) => collectAuditRefs(item)),
  ]
  if (!normalizedAuditRef && previousAuditRefs.length === 0) return evidencePack

  const previousEvidenceById = indexById(previousEvidencePack.evidenceObjects, 'evidenceObjectId')
  const previousSourcesById = indexById(getSources(previousEvidencePack), 'sourceId')
  const withAuditRef = (items, key, previousById) => Array.isArray(items)
      ? items.map((item) => {
        const previous = previousById.get(String(item?.[key] || '').trim())
        const isCarried = Boolean(previous && sameRecordContent(item, previous, key))
        const auditRefs = appendDiscoveryAuditRef(
          collectAuditRefs(item, previous),
          isCarried ? '' : normalizedAuditRef,
        )
        const nextAuditRef = isCarried
          ? (normalizeAuditRef(previous?.auditRef || item?.auditRef) || normalizedAuditRef)
          : (normalizedAuditRef || normalizeAuditRef(item?.auditRef || previous?.auditRef))
        return {
          ...item,
          ...(nextAuditRef ? { auditRef: nextAuditRef } : {}),
          ...(auditRefs.length > 0 ? { auditRefs } : {}),
        }
      })
    : items

  const sourceRegistry = withAuditRef(evidencePack.sourceRegistry, 'sourceId', previousSourcesById)
  const evidenceObjects = withAuditRef(evidencePack.evidenceObjects, 'evidenceObjectId', previousEvidenceById)
  const lineageSources = withAuditRef(evidencePack.lineage?.sources, 'sourceId', previousSourcesById)
  const acquisitionSources = withAuditRef(
    evidencePack.acquisition?.sourceRegistry,
    'sourceId',
    previousSourcesById,
  )
  const currentRecords = [
    ...(Array.isArray(evidenceObjects) ? evidenceObjects : []),
    ...(Array.isArray(sourceRegistry) ? sourceRegistry : []),
    ...(Array.isArray(lineageSources) ? lineageSources : []),
    ...(Array.isArray(acquisitionSources) ? acquisitionSources : []),
  ]

  return {
    ...evidencePack,
    audit_refs: [...new Set([
      ...(Array.isArray(previousEvidencePack.audit_refs) ? previousEvidencePack.audit_refs : []),
      ...(Array.isArray(evidencePack.audit_refs) ? evidencePack.audit_refs : []),
      ...previousRecords.flatMap(collectAuditRefs),
      ...currentRecords.flatMap((item) => collectAuditRefs(item)),
      normalizedAuditRef,
    ].map(normalizeAuditRef).filter(Boolean))],
    sourceRegistry,
    evidenceObjects,
    lineage: evidencePack.lineage && {
      ...evidencePack.lineage,
      sources: lineageSources,
    },
    acquisition: evidencePack.acquisition && {
      ...evidencePack.acquisition,
      sourceRegistry: acquisitionSources,
    },
  }
}

export const attachDiscoveryDecisionAuditRef = (evidencePack, auditRef, evidenceObjects) => {
  const normalizedAuditRef = normalizeAuditRef(auditRef)
  if (!normalizedAuditRef) return evidencePack

  const evidenceIdsWithDecision = new Set((Array.isArray(evidenceObjects) ? evidenceObjects : [])
    .map((evidence) => String(evidence?.evidenceObjectId || '').trim())
    .filter(Boolean))

  return {
    ...evidencePack,
    audit_refs: appendDiscoveryAuditRef(evidencePack.audit_refs, normalizedAuditRef),
    evidenceObjects: (Array.isArray(evidencePack.evidenceObjects) ? evidencePack.evidenceObjects : [])
      .map((evidence) => evidenceIdsWithDecision.has(String(evidence?.evidenceObjectId || '').trim())
        ? {
            ...evidence,
            auditRef: normalizedAuditRef,
            auditRefs: appendDiscoveryAuditRef(collectAuditRefs(evidence), normalizedAuditRef),
          }
        : evidence),
  }
}

export const attachRuntimeIntelligenceGraphAuditRef = (graph, auditRef) => {
  const normalizedAuditRef = normalizeAuditRef(auditRef)
  if (!normalizedAuditRef || !graph?.build || typeof graph.build !== 'object') return graph
  return {
    ...graph,
    build: { ...graph.build, auditRef: normalizedAuditRef },
  }
}
