/**
 * Correlation Enricher Middleware
 *
 * Automatically injects the request correlation ID (`requestId`) into
 * every JSON response body, ensuring end-to-end traceability:
 *
 *   Success responses → `{ data: ..., meta: { requestId, version } }`
 *   Error responses   → `{ error: { ..., requestId } }`
 *
 * Must be mounted after `requestContext` (which generates `req.requestId`)
 * and before route handlers.
 *
 * @module middleware/correlationEnricher
 */

const correlationEnricher = (req, res, next) => {
  const originalJson = res.json.bind(res)

  /**
   * Override res.json to inject requestId into the response body.
   * Handles three shapes:
   *   1. error object  → `body.error.requestId`
   *   2. data envelope → `body.meta.requestId` + `body.meta.version`
   *   3. raw object    → left unchanged (e.g. health check, root)
   */
  res.json = function enrichedJson(body) {
    if (body && typeof body === 'object') {
      // Error envelope: { error: { code, message, ... } }
      if (body.error && typeof body.error === 'object') {
        body.error.requestId = req.requestId
      }
      // Data envelope: { data: ..., meta?: {} }
      else if (body.data !== undefined) {
        if (!body.meta) body.meta = {}
        body.meta.requestId = req.requestId
        if (!body.meta.version) body.meta.version = 'v1'
      }
      // Raw objects (e.g. { message: 'VMF API' }) — no mutation
    }

    return originalJson(body)
  }

  next()
}

export default correlationEnricher
