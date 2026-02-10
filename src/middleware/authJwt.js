import tokenService from '../services/tokenService.js'

const authJwt = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authorization header missing or invalid',
          requestId: req.requestId
        }
      })
    }

    const token = authHeader.substring(7) // Remove 'Bearer ' prefix

    // Check if token is blacklisted
    const isBlacklisted = await tokenService.isTokenBlacklisted(token)
    if (isBlacklisted) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Token has been revoked',
          requestId: req.requestId
        }
      })
    }

    // Verify and decode token
    const decoded = tokenService.verifyAccessToken(token)
    
    // Add user info to request context
    req.context.userId = decoded.userId
    req.userId = decoded.userId // Legacy support
    req.userEmail = decoded.email

    next()
  } catch (error) {
    let message = 'Invalid token'
    
    if (error.name === 'TokenExpiredError') {
      message = 'Token has expired'
    } else if (error.name === 'JsonWebTokenError') {
      message = 'Invalid token format'
    }

    return res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: message,
        requestId: req.requestId
      }
    })
  }
}

export default authJwt