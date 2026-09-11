import { runUIContractDisplayCheckpoint } from '../services/uiContractDisplayCheckpointService.js'

export const runUIContractDisplayCheckpointEndpoint = async (req, res, next) => {
  try {
    res.json(await runUIContractDisplayCheckpoint({ packageId: req.params.packageId, uiContractKey: req.body.uiContractKey }))
  } catch (error) { next(error) }
}
