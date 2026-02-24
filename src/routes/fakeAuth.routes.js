import { Router } from 'express'
import env from '../config/env.js'
import { getFakeAuthInvitation, completeFakeAuth } from '../controllers/fakeAuth.controller.js'

const router = Router()

// Gate: return 404 if fake auth is not allowed
router.use((_req, res, next) => {
  if (!env.fakeAuthAllowed) {
    return res.status(404).json({ error: 'Not Found' })
  }
  next()
})

router.get('/:invitationId/public', getFakeAuthInvitation)
router.post('/:invitationId/complete', completeFakeAuth)

export default router
