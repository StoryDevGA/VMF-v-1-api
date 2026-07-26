import outcomeStudioReadinessService from '../services/outcomeStudioReadinessService.js'

export const getCurrentOutcomeStudioReadiness = async (req, res, next) => {
  try {
    const data = await outcomeStudioReadinessService.getCurrentReadiness()
    res.status(200).json({ data, meta: { requestId: req.requestId, version: 'v1' } })
  } catch (error) { next(error) }
}

export const getOutcomeStudioReadinessHistory = async (req, res, next) => {
  try {
    const result = await outcomeStudioReadinessService.listReadinessHistory(req.query)
    res.status(200).json({ data: result.items, meta: { ...result, items: undefined, requestId: req.requestId, version: 'v1' } })
  } catch (error) { next(error) }
}

export const putOutcomeStudioReadiness = async (req, res, next) => {
  try {
    const data = await outcomeStudioReadinessService.createReadinessRevision({ payload: req.validatedOutcomeStudioReadiness, request: req })
    res.status(201).json({ data, meta: { requestId: req.requestId, version: 'v1' } })
  } catch (error) { next(error) }
}

export const putOutcomeStudioDevelopmentTestReadiness = async (req, res, next) => {
  try {
    const data = await outcomeStudioReadinessService.createDevelopmentTestReadinessRevision({
      payload: req.validatedOutcomeStudioDevelopmentTestReadiness,
      request: req,
    })
    res.status(201).json({ data, meta: { requestId: req.requestId, version: 'v1' } })
  } catch (error) { next(error) }
}
