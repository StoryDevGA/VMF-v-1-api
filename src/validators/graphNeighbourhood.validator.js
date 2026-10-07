import { z } from 'zod'
import { createQueryValidator } from './shared.js'

const identity = z.string().max(240).trim().min(1).refine(value =>
  !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
const canonicalEvidenceIdentity = identity.refine(value =>
  !/runtime_(?:instances|section_states|evidence_sources|evidence_objects|graph_snapshots|graph_elements)|mongodb|mongo(?:db)?|collection/i.test(value))
const selection = z.object({
  nodeId: identity.optional(),
  evidenceObjectId: canonicalEvidenceIdentity.optional(),
  mode: z.enum(['Journey', 'Lineage', 'Impact']),
  graphHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  afterEdgeKey: identity.optional(),
}).strict()
const exactSelection = schema => schema.refine(value => Boolean(value.nodeId) !== Boolean(value.evidenceObjectId),
  { message: 'Select exactly one recorded graph node or canonical evidence identity.' })
export const graphNeighbourhoodSelectionSchema = exactSelection(selection)
export const validateGraphNeighbourhoodQuery = createQueryValidator(exactSelection(selection.extend({
  customerId: z.string().regex(/^[a-f0-9]{24}$/i),
  tenantId: z.string().regex(/^[a-f0-9]{24}$/i),
}).strict()))
