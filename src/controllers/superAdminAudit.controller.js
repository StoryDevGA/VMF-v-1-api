import auditService from '../services/auditService.js'

export const listDeniedAccessLogs = async (req, res, next) => {
  try {
    const { actorUserId, startDate, endDate, page = 1, pageSize = 20 } = req.query

    const result = await auditService.query({
      actorUserId,
      startDate,
      endDate,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
      action: auditService.AUDIT_ACTIONS.ACCESS_DENIED,
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.DENIED_ACCESS_LOG_VIEWED,
      resourceType: 'AuditLog',
      scope: {},
      diff: { filters: { actorUserId, startDate, endDate }, resultCount: result.data.length },
    })

    return res.status(200).json({
      data: result.data,
      meta: {
        ...result.meta,
        requestId: req.requestId,
        version: 'v1',
      },
    })
  } catch (err) {
    next(err)
  }
}
