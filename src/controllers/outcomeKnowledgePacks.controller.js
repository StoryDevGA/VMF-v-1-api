import {
  activateOutcomeKnowledgePackVersion,
  createOutcomeKnowledgePackVersion,
  deleteOutcomeKnowledgePack,
  deprecateOutcomeKnowledgePackVersion,
  disableOutcomeKnowledgePackVersion,
  getOutcomeKnowledgePack,
  getOutcomeKnowledgePackVersion,
  importOutcomeKnowledgePackStarterVersion,
  importOutcomeKnowledgePackSourceDocumentDraft,
  listOutcomeKnowledgePacks,
  previewOutcomeKnowledgePackVersionContent,
  previewOutcomeKnowledgePackResolution,
  rollbackOutcomeKnowledgePack,
  updateOutcomeKnowledgePackVersionReview,
  validateOutcomeKnowledgePackVersion,
} from '../services/outcomeKnowledgePackRegistryService.js'
import {
  cloneKnowledgePackManifest,
  compareKnowledgePackManifests,
  createKnowledgePackManifest,
  getKnowledgePackManifest,
  listKnowledgePackManifests,
  previewKnowledgePackReasoningContext,
  previewKnowledgePackManifestResolution,
  updateKnowledgePackManifest,
} from '../services/knowledgePackManifestService.js'

const sendControllerError = (res, req, err) =>
  res.status(err?.status || 500).json({
    error: {
      code: err?.code || 'SERVER_ERROR',
      message: err?.message || 'Outcome Studio knowledge pack request failed.',
      details: err?.details || {},
      requestId: req.requestId,
    },
  })

export const listKnowledgePacks = async (req, res) => {
  try {
    const result = await listOutcomeKnowledgePacks({ query: req.query })
    res.status(200).json(result)
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const listKnowledgePackManifestsController = async (req, res) => {
  try {
    const result = await listKnowledgePackManifests({ query: req.query })
    res.status(200).json(result)
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const getKnowledgePackManifestController = async (req, res) => {
  try {
    const data = await getKnowledgePackManifest({ manifestId: req.params.manifestId })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const createKnowledgePackManifestController = async (req, res) => {
  try {
    const data = await createKnowledgePackManifest({
      body: req.body,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(201).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const updateKnowledgePackManifestController = async (req, res) => {
  try {
    const data = await updateKnowledgePackManifest({
      manifestId: req.params.manifestId,
      body: req.body,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const cloneKnowledgePackManifestController = async (req, res) => {
  try {
    const data = await cloneKnowledgePackManifest({
      manifestId: req.params.manifestId,
      body: req.body,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(201).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const compareKnowledgePackManifestsController = async (req, res) => {
  try {
    const data = await compareKnowledgePackManifests({
      manifestId: req.params.manifestId,
      targetManifestId: req.params.targetManifestId,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const previewKnowledgePackManifestResolutionController = async (req, res) => {
  try {
    const data = await previewKnowledgePackManifestResolution({
      manifestId: req.params.manifestId,
      query: req.query,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const previewKnowledgePackReasoningContextController = async (req, res) => {
  try {
    const data = await previewKnowledgePackReasoningContext({
      manifestId: req.params.manifestId,
      query: req.query,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const getKnowledgePack = async (req, res) => {
  try {
    const data = await getOutcomeKnowledgePack({ packId: req.params.packId })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const deleteKnowledgePack = async (req, res) => {
  try {
    const data = await deleteOutcomeKnowledgePack({
      packId: req.params.packId,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const createKnowledgePackVersion = async (req, res) => {
  try {
    const data = await createOutcomeKnowledgePackVersion({
      packId: req.params.packId,
      body: req.body,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(201).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const importKnowledgePackStarterVersion = async (req, res) => {
  try {
    const data = await importOutcomeKnowledgePackStarterVersion({
      packId: req.params.packId,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(201).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const importKnowledgePackSourceDocumentDraft = async (req, res) => {
  try {
    const data = await importOutcomeKnowledgePackSourceDocumentDraft({
      body: req.body,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(201).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const getKnowledgePackVersion = async (req, res) => {
  try {
    const data = await getOutcomeKnowledgePackVersion({
      packId: req.params.packId,
      versionId: req.params.versionId,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const previewKnowledgePackVersionContent = async (req, res) => {
  try {
    const data = await previewOutcomeKnowledgePackVersionContent({
      packId: req.params.packId,
      versionId: req.params.versionId,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const validateKnowledgePackVersion = async (req, res) => {
  try {
    const data = await validateOutcomeKnowledgePackVersion({
      packId: req.params.packId,
      versionId: req.params.versionId,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const activateKnowledgePackVersion = async (req, res) => {
  try {
    const data = await activateOutcomeKnowledgePackVersion({
      packId: req.params.packId,
      versionId: req.params.versionId,
      body: req.body,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const updateKnowledgePackVersionReview = async (req, res) => {
  try {
    const data = await updateOutcomeKnowledgePackVersionReview({
      packId: req.params.packId,
      versionId: req.params.versionId,
      body: req.body,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const deprecateKnowledgePackVersion = async (req, res) => {
  try {
    const data = await deprecateOutcomeKnowledgePackVersion({
      packId: req.params.packId,
      versionId: req.params.versionId,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const disableKnowledgePackVersion = async (req, res) => {
  try {
    const data = await disableOutcomeKnowledgePackVersion({
      packId: req.params.packId,
      versionId: req.params.versionId,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const rollbackKnowledgePack = async (req, res) => {
  try {
    const data = await rollbackOutcomeKnowledgePack({
      packId: req.params.packId,
      body: req.body,
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
    })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}

export const previewKnowledgePackResolution = async (req, res) => {
  try {
    const data = await previewOutcomeKnowledgePackResolution({ query: req.query })
    res.status(200).json({ data })
  } catch (err) {
    sendControllerError(res, req, err)
  }
}
