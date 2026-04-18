import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateSkillRole,
  validateListSkillRoles,
  validateSkillRoleId,
  validateUpdateSkillRole,
} from '../validators/skillRoleRegistry.validator.js'
import {
  createSkillRole,
  getSkillRole,
  getSkillRoleDependencies,
  listSkillRoles,
  updateSkillRole,
} from '../controllers/skillRoleRegistry.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListSkillRoles, listSkillRoles)
router.post('/', validateCreateSkillRole, createSkillRole)
router.get('/:roleId', validateSkillRoleId, getSkillRole)
router.get('/:roleId/dependencies', validateSkillRoleId, getSkillRoleDependencies)
router.patch('/:roleId', validateSkillRoleId, validateUpdateSkillRole, updateSkillRole)

export default router

