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
 * All routes are protected by HMAC signature verification when
 * `IDENTITY_PLUS_WEBHOOK_SECRET` is configured.
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

/**
 * Capture the raw body for HMAC verification.
 * This middleware must run BEFORE express.json() parses the body,
 * so the route file stores it on `req.rawBody`.
 *
 * Note: The app-level express.json() has already parsed the body by
 * the time we reach routes. To work around this, we reconstruct the
 * raw body from `req.body`. For production, consider using a custom
 * body parser at the app level that preserves `req.rawBody`.
 */
const verifyWebhookSignature = (req, res, next) => {
  const signature = req.get('X-Identity-Plus-Signature')

  // Reconstruct raw body from parsed body
  const rawBody = JSON.stringify(req.body)

  const valid = identityPlusService.verifyWebhookSignature(rawBody, signature)

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
