import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import requireStepUp from '../middleware/requireStepUp.js'
import {
  validateCreateFrameworkRegistry,
  validateFrameworkRegistryId,
  validateListFrameworkRegistries,
  validateUpdateFrameworkRegistry,
} from '../validators/frameworkRegistry.validator.js'
import {
  createFrameworkRegistry,
  getFrameworkRegistry,
  listFrameworkRegistries,
  updateFrameworkRegistry,
} from '../controllers/frameworkRegistry.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListFrameworkRegistries, listFrameworkRegistries)
router.post('/', requireStepUp, validateCreateFrameworkRegistry, createFrameworkRegistry)
router.get('/:registryId', validateFrameworkRegistryId, getFrameworkRegistry)
router.patch(
  '/:registryId',
  requireStepUp,
  validateFrameworkRegistryId,
  validateUpdateFrameworkRegistry,
  updateFrameworkRegistry,
)

export default router
