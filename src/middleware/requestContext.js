import { v4 as uuidv4, validate as isUuid } from 'uuid'

const requestContext = (req, res, next) => {
  // Generate or use existing request ID
  const suppliedId = req.headers['x-request-id']
  req.requestId = typeof suppliedId === 'string' && isUuid(suppliedId) ? suppliedId : uuidv4()
  
  // Add request ID to response headers
  res.setHeader('x-request-id', req.requestId)
  
  // Store additional context
  req.context = {
    requestId: req.requestId,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    timestamp: new Date(),
    method: req.method,
    path: req.path,
    // User context will be added by auth middleware
    userId: null,
    scopes: null
  }
  
  next()
}

export default requestContext
