import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformPermission } from '../middleware/authorize.js'
import {
  validateCreateRole,
  validateListRoles,
  validateRoleId,
  validateUpdateRole,
} from '../validators/role.validator.js'
import {
  createRole,
  deleteRole,
  getPermissionCatalogue,
  getRole,
  listRoles,
  updateRole,
} from '../controllers/role.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformPermission('ROLE_MANAGE'))

router.get('/', validateListRoles, listRoles)
router.get('/permissions/catalogue', getPermissionCatalogue)
router.post('/', validateCreateRole, createRole)
router.get('/:roleId', validateRoleId, getRole)
router.patch('/:roleId', validateRoleId, validateUpdateRole, updateRole)
router.delete('/:roleId', validateRoleId, deleteRole)

export default router
