import { describe, test, expect, beforeAll } from '@jest/globals'

// Set up test environment variables
beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-unit-tests-should-be-long-and-complex-in-production'
  process.env.MONGODB_URI = 'mongodb://localhost:27017/vmf_test'
  process.env.REDIS_URL = 'redis://localhost:6379'
})

describe('Phase 1 Core Setup', () => {
  test('Environment configuration', async () => {
    // Test that environment config works
    const { default: env } = await import('../config/env.js')
    
    expect(env).toBeDefined()
    expect(env.nodeEnv).toBeDefined()
    expect(env.port).toBeDefined()
    expect(typeof env.port).toBe('number')
  })

  test('MongoDB models', async () => {
    // Test that models are properly defined
    const models = await import('../models/index.js')
    
    expect(models.Customer).toBeDefined()
    expect(models.User).toBeDefined()
    expect(models.Tenant).toBeDefined()
    expect(models.VMF).toBeDefined()
    expect(models.Deal).toBeDefined()
    expect(models.Role).toBeDefined()
    expect(models.AuditLog).toBeDefined()
  })

  test('Token service', async () => {
    // Test that token service is properly configured
    const { default: tokenService } = await import('../services/tokenService.js')
    
    expect(tokenService).toBeDefined()
    expect(typeof tokenService.verifyAccessToken).toBe('function')
    expect(typeof tokenService.verifyRefreshToken).toBe('function')
    expect(typeof tokenService.generateTokens).toBe('function')
  })

  test('Middleware', async () => {
    // Test that middleware is properly defined
    const { default: authJwt } = await import('../middleware/authJwt.js')
    const rateLimits = await import('../middleware/rateLimits.js')
    
    expect(authJwt).toBeDefined()
    expect(typeof authJwt).toBe('function')
    expect(rateLimits.authRateLimit).toBeDefined()
    expect(rateLimits.userManagementRateLimit).toBeDefined()
    expect(rateLimits.tenantManagementRateLimit).toBeDefined()
    expect(rateLimits.bulkOperationsRateLimit).toBeDefined()
  })

  test('Seeds configuration', async () => {
    // Test that seeds are properly configured
    const { systemRoles } = await import('../seeds/systemRoles.js')
    
    expect(systemRoles).toBeDefined()
    expect(Array.isArray(systemRoles)).toBe(true)
    expect(systemRoles.length).toBeGreaterThan(0)
    
    // Verify required system roles exist
    const roleKeys = systemRoles.map(role => role.key)
    expect(roleKeys).toContain('SUPER_ADMIN')
    expect(roleKeys).toContain('CUSTOMER_ADMIN')
    expect(roleKeys).toContain('TENANT_ADMIN')
    expect(roleKeys).toContain('USER')
  })
})