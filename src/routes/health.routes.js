import { Router } from 'express'

const router = Router()

router.get('/', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

export default router
