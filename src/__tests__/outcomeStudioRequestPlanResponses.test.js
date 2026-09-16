import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'

const operation = jest.fn()
jest.unstable_mockModule('../services/outcomeStudioRequestPlanService.js', () => ({
  planOutcomeStudioRequest: operation,
  confirmOutcomeStudioRequestPlan: operation,
  retrieveOutcomeStudioRequestPlan: operation,
}))
const { planRuntimeOutcomeRequest } = await import('../controllers/runtimeInstance.controller.js')
const app = express()
app.use(express.json())
// Controller projection only: mounted production authentication is a separate test surface.
app.post('/planning/:runtimeInstanceId', planRuntimeOutcomeRequest)

describe('planning public error projection', () => {
  it.each(['RAW_TENANT_SECRET_123', 'MongoServerError', 'OUTCOME_PLANNING_INVENTED', 8000])(
    'does not expose an unapproved dependency code %s', async (code) => {
      operation.mockRejectedValueOnce(Object.assign(new Error('secret diagnostic'), {
        code, status: 409, details: { tenantId: 'secret identity', continuation: 'secret receipt' },
      }))
      const response = await request(app).post('/planning/runtime').send({ prompt: 'brief' })
      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('OUTCOME_PLANNING_UNAVAILABLE')
      expect(response.body.error.details).toEqual({ reason: 'OUTCOME_PLANNING_UNAVAILABLE',
        execution: { status: 'BLOCKED', canExecute: false } })
      expect(JSON.stringify(response.body)).not.toContain('secret')
    },
  )
  it('retains only an explicitly approved public code, never dependency diagnostics', async () => {
    operation.mockRejectedValueOnce(Object.assign(new Error('secret diagnostic'), {
      code: 'OUTCOME_PLANNING_RECEIPT_INVALID', status: 403, details: { actor: 'secret actor' },
    }))
    const response = await request(app).post('/planning/runtime').send({})
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('OUTCOME_PLANNING_RECEIPT_INVALID')
    expect(JSON.stringify(response.body)).not.toContain('secret')
  })

  it('delegates unknown failures to the shared 500 boundary', async () => {
    operation.mockRejectedValueOnce(Object.assign(new Error('secret programmer diagnostic'), {
      code: 'UNEXPECTED_DRIVER_FAILURE', status: 500,
    }))
    const response = await request(app).post('/planning/runtime').send({ prompt: 'brief' })
    expect(response.status).toBe(500)
    expect(response.body.error).toMatchObject({ code: 'OUTCOME_PLANNING_UNAVAILABLE' })
    expect(JSON.stringify(response.body)).not.toContain('secret')
  })
})
