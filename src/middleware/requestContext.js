import { v4 as uuidv4 } from 'uuid'

const requestContext = (req, res, next) => {
  // Generate or use existing request ID
  req.requestId = req.headers['x-request-id'] || uuidv4()
  
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