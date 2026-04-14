import { Router } from 'express'
import authJwt from '../middleware/authJwt.js'
import loadScopes from '../middleware/loadScopes.js'
import { requirePlatformRole } from '../middleware/authorize.js'
import {
  validateCreateRuntimeSkill,
  validateListRuntimeSkills,
  validateRuntimeSkillId,
  validateUpdateRuntimeSkill,
} from '../validators/runtimeSkill.validator.js'
import {
  createRuntimeSkill,
  getRuntimeSkill,
  getRuntimeSkillDependencies,
  listRuntimeSkills,
  updateRuntimeSkill,
} from '../controllers/runtimeSkill.controller.js'

const router = Router()

router.use(authJwt, loadScopes, requirePlatformRole('SUPER_ADMIN'))

router.get('/', validateListRuntimeSkills, listRuntimeSkills)
router.post('/', validateCreateRuntimeSkill, createRuntimeSkill)
router.get('/:skillId', validateRuntimeSkillId, getRuntimeSkill)
router.get('/:skillId/dependencies', validateRuntimeSkillId, getRuntimeSkillDependencies)
router.patch('/:skillId', validateRuntimeSkillId, validateUpdateRuntimeSkill, updateRuntimeSkill)

export default router
