import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateUIContract,
  validateListUIContracts,
  validateUIContractId,
  validateUpdateUIContract,
} from '../validators/uiContract.validator.js'
import {
  activateUIContract,
  createUIContract,
  deprecateUIContract,
  getUIContract,
  getUIContractDependencies,
  listUIContracts,
  updateUIContract,
} from '../controllers/uiContract.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListUIContracts, listUIContracts)
router.post('/', validateCreateUIContract, createUIContract)
router.get('/:uiContractId', validateUIContractId, getUIContract)
router.get('/:uiContractId/dependencies', validateUIContractId, getUIContractDependencies)
router.patch('/:uiContractId', validateUIContractId, validateUpdateUIContract, updateUIContract)
router.post('/:uiContractId/activate', validateUIContractId, activateUIContract)
router.post('/:uiContractId/deprecate', validateUIContractId, deprecateUIContract)

export default router
