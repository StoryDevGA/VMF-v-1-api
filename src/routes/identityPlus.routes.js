/**
 * Identity Plus Webhook Routes
 *
 * Mounts Identity Plus webhook endpoints under
 * `/api/v1/webhooks/identity-plus`.
 *
 * Route map:
 *   POST /registration-complete  — User finished sign-up
 *   POST /trust-updated          — Trust status changed externally
 *
 * All routes require HMAC signature verification. Missing configuration denies access.
 */

import { Router } from 'express'
import identityPlusService from '../services/identityPlusService.js'
import {
  validateRegistrationComplete,
  validateTrustUpdated,
} from '../validators/identityPlus.validator.js'
import {
  handleRegistrationComplete,
  handleTrustUpdated,
} from '../controllers/identityPlus.controller.js'
import logger from '../config/logger.js'

const router = Router()

/* ------------------------------------------------------------------ */
/*  Webhook signature verification middleware                         */
/* ------------------------------------------------------------------ */

// The app parser captures raw bytes before JSON parsing; never reserialize signed data.
const verifyWebhookSignature = (req, res, next) => {
  const signature = req.get('X-Identity-Plus-Signature')
  const valid = identityPlusService.verifyWebhookSignature(req.rawBody, signature)

  if (!valid) {
    logger.warn(
      { requestId: req.requestId, ip: req.ip },
      'Identity Plus webhook — invalid signature',
    )
    return res.status(401).json({
      error: {
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Invalid webhook signature.',
        requestId: req.requestId,
      },
    })
  }

  next()
}

/* ------------------------------------------------------------------ */
/*  Routes                                                            */
/* ------------------------------------------------------------------ */

router.post(
  '/registration-complete',
  verifyWebhookSignature,
  validateRegistrationComplete,
  handleRegistrationComplete,
)

router.post(
  '/trust-updated',
  verifyWebhookSignature,
  validateTrustUpdated,
  handleTrustUpdated,
)

export default router
