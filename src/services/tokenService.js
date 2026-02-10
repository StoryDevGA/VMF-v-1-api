import jwt from 'jsonwebtoken'
import { getRedis } from '../config/redis.js'
import env from '../config/env.js'

class TokenService {
  constructor() {
    if (!env.jwtSecret || !env.jwtRefreshSecret) {
      throw new Error('JWT secrets must be configured')
    }
  }

  /**
   * Generate access and refresh token pair
   */
  async generateTokens(user) {
    const payload = {
      userId: user._id || user.id,
      email: user.email,
      type: 'access'
    }

    const refreshPayload = {
      userId: user._id || user.id,
      email: user.email,
      type: 'refresh'
    }

    const accessToken = jwt.sign(payload, env.jwtSecret, {
      expiresIn: env.jwtExpiry,
      issuer: 'storylineos-vmf-api',
      audience: 'storylineos-vmf-client'
    })

    const refreshToken = jwt.sign(refreshPayload, env.jwtRefreshSecret, {
      expiresIn: env.jwtRefreshExpiry,
      issuer: 'storylineos-vmf-api',
      audience: 'storylineos-vmf-client'
    })

    // Store refresh token in Redis (if available)
    const redis = getRedis()
    if (redis) {
      const refreshKey = `refresh_token:${user._id || user.id}`
      await redis.setex(refreshKey, 7 * 24 * 60 * 60, refreshToken) // 7 days
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
      tokenType: 'Bearer'
    }
  }

  /**
   * Verify and decode access token
   */
  verifyAccessToken(token) {
    try {
      return jwt.verify(token, env.jwtSecret, {
        issuer: 'storylineos-vmf-api',
        audience: 'storylineos-vmf-client'
      })
    } catch (error) {
      throw new Error('Invalid access token')
    }
  }

  /**
   * Verify and decode refresh token
   */
  verifyRefreshToken(token) {
    try {
      return jwt.verify(token, env.jwtRefreshSecret, {
        issuer: 'storylineos-vmf-api',
        audience: 'storylineos-vmf-client'
      })
    } catch (error) {
      throw new Error('Invalid refresh token')
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    const decoded = this.verifyRefreshToken(refreshToken)
    
    // Check if refresh token exists in Redis (if available)
    const redis = getRedis()
    if (redis) {
      const refreshKey = `refresh_token:${decoded.userId}`
      const storedToken = await redis.get(refreshKey)
      
      if (storedToken !== refreshToken) {
        throw new Error('Invalid or expired refresh token')
      }
    }

    // Generate new token pair
    const { User } = await import('../models/index.js')
    const user = await User.findById(decoded.userId)
    
    if (!user || !user.isActive) {
      throw new Error('User not found or inactive')
    }

    return this.generateTokens(user)
  }

  /**
   * Blacklist access token
   */
  async blacklistToken(token) {
    try {
      const decoded = jwt.decode(token)
      const redis = getRedis()
      
      if (!redis) return // Redis unavailable — blacklisting skipped

      if (decoded && decoded.exp) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000)
        if (ttl > 0) {
          await redis.setex(`blacklist:${token}`, ttl, 'true')
        }
      }
    } catch (error) {
      // If token is already invalid, no need to blacklist
      console.warn('Failed to blacklist token:', error.message)
    }
  }

  /**
   * Check if token is blacklisted
   */
  async isTokenBlacklisted(token) {
    try {
      const redis = getRedis()
      if (!redis) return false // Redis unavailable — assume not blacklisted
      const result = await redis.get(`blacklist:${token}`)
      return result === 'true'
    } catch (error) {
      // If Redis is down, assume token is not blacklisted to avoid breaking auth
      console.error('Failed to check token blacklist:', error.message)
      return false
    }
  }

  /**
   * Revoke refresh token
   */
  async revokeRefreshToken(userId) {
    const redis = getRedis()
    if (!redis) return // Redis unavailable — nothing to revoke
    const refreshKey = `refresh_token:${userId}`
    await redis.del(refreshKey)
  }

  /**
   * Revoke all user tokens
   */
  async revokeAllUserTokens(userId) {
    const redis = getRedis()
    if (!redis) return // Redis unavailable — nothing to revoke
    const refreshKey = `refresh_token:${userId}`
    await redis.del(refreshKey)
    // Note: Active access tokens will expire naturally within 15 minutes
  }
}

export default new TokenService()