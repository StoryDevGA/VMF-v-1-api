import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateUIContract,
  validateCloneUIContract,
  validateListUIContracts,
  validateUIContractId,
  validateUpdateUIContract,
} from '../validators/uiContract.validator.js'
import {
  activateUIContract,
  archiveUIContract,
  cloneUIContractRecord,
  createUIContract,
  deprecateUIContract,
  getUIContract,
  getUIContractDependencies,
  listUIContracts,
  updateUIContract,
  validateUIContract,
} from '../controllers/uiContract.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListUIContracts, listUIContracts)
router.post('/', validateCreateUIContract, createUIContract)
router.get('/:uiContractId', validateUIContractId, getUIContract)
router.get('/:uiContractId/dependencies', validateUIContractId, getUIContractDependencies)
router.patch('/:uiContractId', validateUIContractId, validateUpdateUIContract, updateUIContract)
router.post('/:uiContractId/clone', validateUIContractId, validateCloneUIContract, cloneUIContractRecord)
router.post('/:uiContractId/validate', validateUIContractId, validateUIContract)
router.post('/:uiContractId/activate', validateUIContractId, activateUIContract)
router.post('/:uiContractId/deprecate', validateUIContractId, deprecateUIContract)
router.post('/:uiContractId/archive', validateUIContractId, archiveUIContract)

export default router
