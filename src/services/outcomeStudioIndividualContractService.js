import { createHash } from 'node:crypto'
import { normalizeKnowledgePackRelationships, semanticVersionSatisfies } from './knowledgePackRelationshipContract.js'

const CONTRACT_VERSION = 'outcome-studio.individual-pack-metadata.v1'
const ready = (status) => ['READY', 'READY_WITH_GAPS'].includes(status)
const text = (value) => typeof value === 'string' ? value.trim() : ''
const descriptorValid = (value) => Boolean(text(value?.key) && text(value?.version))
const digest = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')
const contextIdentity = (context) => ({
  outputType: context.outputType,
  outputSchema: context.outputSchema,
  style: context.style,
  lineage: context.lineage,
  policy: context.resolutionEvidence?.policy,
  bindingEvidence: context.resolutionEvidence?.bindingEvidence,
})

// Public evidence contains hashes, not activation IDs or customer/tenant scope IDs.
// These are integrity fingerprints of resolver evidence, not authentication signatures.
export const projectIndividualPackBindingEvidence = (binding) => ({
  selectionHash: digest({
    selectedByLayer: binding.selectedByLayer || {},
    mandatorySafeguards: binding.mandatorySafeguards || binding.requiredPacks || [],
  }),
  graphHash: digest(binding.dependencyGraph || null),
  scopeHash: digest(binding.resolution?.scopeCandidates || []),
  lineageHash: digest(binding.lineage || null),
})

const targetsPack = (relationship, pack) => [
  ['targetKnowledgeAssetId', 'knowledgeAssetId'], ['targetPackType', 'packType'],
  ['targetPackKey', 'packKey'], ['targetKnowledgeLayer', 'knowledgeLayer'],
  ['targetCapabilityKey', 'capabilityKey'],
].every(([target, field]) => !relationship[target] || relationship[target] === pack[field])

const hasStructuralSchemaEdge = (binding, type, schema) => {
  try {
    return normalizeKnowledgePackRelationships(type.dependencyReferences, { required: true })
      .some((relationship) => {
        if (!['REQUIRED_AT_RUNTIME', 'REQUIRES_COMPATIBLE_PACK'].includes(relationship.relationshipType)
          || !targetsPack(relationship, schema)
          || !semanticVersionSatisfies(schema.semanticVersion, relationship.versionConstraint)) return false
        if (relationship.relationshipType === 'REQUIRES_COMPATIBLE_PACK') {
          const direct = schema.hasDirectCompatibilityMetadata === true
            || (schema.hasDirectCompatibilityMetadata === undefined && Array.isArray(schema.compatibleOutputTypes))
          const compatible = direct
            ? schema.compatibleOutputTypes?.some((value) => [type.knowledgeAssetId, type.capabilityKey]
              .some((key) => text(key).toLowerCase() === text(value).toLowerCase()))
            : normalizeKnowledgePackRelationships(schema.dependencyReferences, { required: true })
              .some((reference) => reference.relationshipType === 'COMPATIBLE_WITH'
                && targetsPack(reference, type)
                && semanticVersionSatisfies(type.semanticVersion, reference.versionConstraint))
          if (!compatible) return false
        }
        return binding.dependencyGraph?.edges?.some((edge) => (
          edge.from === type.activationId && edge.to === schema.activationId
          && edge.relationshipType === relationship.relationshipType
          && edge.requiredAt === relationship.requiredAt
          && edge.cardinality === relationship.cardinality
          && digest(edge.versionConstraint || null) === digest(relationship.versionConstraint || null)
        ))
      })
  } catch {
    return false
  }
}

// This receipt proves resolved metadata, never loaded content or permission to generate.
export const buildIndividualPackMetadataGuidance = ({ binding, context }) => {
  if (!context?.available || !ready(context.status) || !ready(binding?.status)) return null
  for (const layer of ['OUTPUT_TYPE', 'OUTPUT_SCHEMA']) {
    const selected = binding.selectedByLayer?.[layer]
    if (!Array.isArray(selected) || selected.length !== 1) return null
    const descriptor = context[layer === 'OUTPUT_TYPE' ? 'outputType' : 'outputSchema']
    if (descriptor?.key !== selected[0].capabilityKey
      || descriptor?.version !== selected[0].semanticVersion) return null
  }
  if (!hasStructuralSchemaEdge(binding, binding.selectedByLayer.OUTPUT_TYPE[0],
    binding.selectedByLayer.OUTPUT_SCHEMA[0])) return null
  const styles = binding.selectedByLayer.STYLE || []
  if (styles.length > 1 || (styles.length === 0 && context.style !== null)
    || (styles.length === 1 && (context.style?.key !== styles[0].capabilityKey
      || context.style?.version !== styles[0].semanticVersion))) return null
  const selectedPacks = Object.values(binding.selectedByLayer || {}).flat()
  if (selectedPacks.some((pack) => pack.status !== 'ACTIVE'
    || !text(pack.activationId) || !text(pack.versionId) || !text(pack.contentHash)
    || !text(pack.semanticVersion)
    || !binding.lineage?.activationIds?.includes(pack.activationId)
    || !binding.lineage?.versionIds?.includes(pack.versionId)
    || !binding.lineage?.contentHashes?.includes(pack.contentHash))) return null
  if (selectedPacks.some((pack) => !context.lineage?.contentHashes?.includes(pack.contentHash))) return null
  if (!descriptorValid(context.outputType) || !descriptorValid(context.outputSchema)
    || (context.style !== null && !descriptorValid(context.style))) return null
  if (binding.relationshipFailures?.length || binding.ambiguousCandidates?.length
    || binding.missingDependencies?.some((item) => item.requirement !== 'OPTIONAL')) return null
  const evidence = projectIndividualPackBindingEvidence(binding)
  if (digest(context.resolutionEvidence?.bindingEvidence) !== digest(evidence)) return null
  return {
    contractVersion: CONTRACT_VERSION,
    status: 'RESOLVED_METADATA',
    contentValidated: false,
    generationEligible: false,
    contextHash: digest(contextIdentity(context)),
    bindingHash: digest(evidence),
  }
}

export const hasCurrentIndividualPackMetadataGuidance = (context) => {
  const receipt = context?.outputSpecificCompositionGuidance
  const evidence = context?.resolutionEvidence?.bindingEvidence
  return Boolean(context?.available && ready(context.status)
    && descriptorValid(context.outputType) && descriptorValid(context.outputSchema)
    && (context.style === null || descriptorValid(context.style))
    && receipt?.contractVersion === CONTRACT_VERSION
    && receipt.status === 'RESOLVED_METADATA'
    && receipt.contentValidated === false && receipt.generationEligible === false
    && evidence && ['selectionHash', 'graphHash', 'scopeHash', 'lineageHash']
      .every((key) => /^[a-f0-9]{64}$/.test(evidence[key] || ''))
    && receipt.bindingHash === digest(evidence)
    && receipt.contextHash === digest(contextIdentity(context)))
}
