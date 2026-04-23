import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateValidationRegistry,
  validateListValidationRegistry,
  validateUpdateValidationRegistry,
  validateValidationRegistryId,
} from '../validators/validationRegistry.validator.js'
import {
  createValidation,
  getValidation,
  getValidationDependencies,
  listValidations,
  updateValidation,
} from '../controllers/validationRegistry.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListValidationRegistry, listValidations)
router.post('/', validateCreateValidationRegistry, createValidation)
router.get('/:validationId', validateValidationRegistryId, getValidation)
router.get('/:validationId/dependencies', validateValidationRegistryId, getValidationDependencies)
router.patch('/:validationId', validateValidationRegistryId, validateUpdateValidationRegistry, updateValidation)

export default router

