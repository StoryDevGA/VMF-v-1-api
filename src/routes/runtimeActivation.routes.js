import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import { validateFrameworkPackageId } from '../validators/frameworkPackage.validator.js'
import {
  getRuntimeActivationPackageHistory,
  getRuntimeActivationPackageReadiness,
  getRuntimeActivationSnapshot,
  listRuntimeDeployments,
} from '../controllers/runtimeActivation.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/packages/:packageId/readiness', validateFrameworkPackageId, getRuntimeActivationPackageReadiness)
router.get('/packages/:packageId/history', validateFrameworkPackageId, getRuntimeActivationPackageHistory)
router.get('/deployments', listRuntimeDeployments)
router.get('/snapshots/:activationId', getRuntimeActivationSnapshot)

export default router
