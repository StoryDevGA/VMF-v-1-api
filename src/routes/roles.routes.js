import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateRole,
  validateListRoles,
  validateRoleId,
  validateUpdateRole,
} from '../validators/role.validator.js'
import {
  createRole,
  deleteRole,
  getRole,
  listRoles,
  updateRole,
} from '../controllers/role.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListRoles, listRoles)
router.post('/', validateCreateRole, createRole)
router.get('/:roleId', validateRoleId, getRole)
router.patch('/:roleId', validateRoleId, validateUpdateRole, updateRole)
router.delete('/:roleId', validateRoleId, deleteRole)

export default router
