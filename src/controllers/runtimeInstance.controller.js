import {
  createRuntimeInstance as createRuntimeInstanceRecord,
  getRuntimeInstance as getRuntimeInstanceRecord,
  listRuntimeInstances as listRuntimeInstanceRecords,
} from '../services/runtimeInstanceService.js'
import { getRuntimeRenderer as getRuntimeRendererProjection } from '../services/runtimeRendererService.js'

const buildRuntimeInstanceErrorResponse = (req, err) => ({
  error: {
    code: err.code || 'REQUEST_ERROR',
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
    requestId: req.requestId,
  },
})

export const createRuntimeInstance = async (req, res, next) => {
  try {
    const runtimeInstance = await createRuntimeInstanceRecord({
      actorUserId: req.context?.userId || req.userId,
      auditRequest: req,
      scopes: req.scopes,
      payload: req.body,
    })

    return res.status(201).json({
      data: runtimeInstance,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const listRuntimeInstances = async (req, res, next) => {
  try {
    const { data, meta } = await listRuntimeInstanceRecords({
      scopes: req.scopes,
      query: req.query,
    })

    return res.status(200).json({
      data,
      meta: {
        ...meta,
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeInstance = async (req, res, next) => {
  try {
    const runtimeInstance = await getRuntimeInstanceRecord({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: runtimeInstance,
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}

export const getRuntimeRenderer = async (req, res, next) => {
  try {
    const renderer = await getRuntimeRendererProjection({
      scopes: req.scopes,
      runtimeInstanceId: req.params.runtimeInstanceId,
    })

    return res.status(200).json({
      data: renderer,
      meta: {
        requestId: req.requestId,
        renderTraceId: renderer.diagnostics?.renderTraceId,
        version: 'v1',
      },
    })
  } catch (err) {
    if (err?.status && err?.code) {
      return res.status(err.status).json(buildRuntimeInstanceErrorResponse(req, err))
    }
    return next(err)
  }
}
