import { getPermissionsForScope } from '../constants/permissionCatalogue.js'
import { Role } from '../models/index.js'

const buildSystemRoleSeed = ({
  key,
  name,
  description,
  scope,
}) => ({
  key,
  name,
  description,
  scope,
  permissions: getPermissionsForScope(scope),
  isSystem: true,
})

export const systemRoles = [
  buildSystemRoleSeed({
    key: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Platform-level administrator with full customer and governance control.',
    scope: 'PLATFORM',
  }),
  buildSystemRoleSeed({
    key: 'CUSTOMER_ADMIN',
    name: 'Customer Administrator',
    description: 'Customer-scoped administrator for users, tenants, VMFs, and audits.',
    scope: 'CUSTOMER',
  }),
  buildSystemRoleSeed({
    key: 'TENANT_ADMIN',
    name: 'Tenant Administrator',
    description: 'Tenant-scoped administrator for VMF and Deal operations.',
    scope: 'TENANT',
  }),
  buildSystemRoleSeed({
    key: 'USER',
    name: 'Standard User',
    description: 'Standard VMF participant with deal collaboration permissions.',
    scope: 'VMF',
  })
]

export const seedSystemRoles = async () => {
  console.log('🌱 Seeding system roles...')
  
  for (const roleData of systemRoles) {
    try {
      const existingRole = await Role.findOne({ key: roleData.key })
      
      if (existingRole) {
        console.log(`  Role ${roleData.key} already exists (permissions preserved)`)
        continue
      }

      await Role.create(roleData)
      console.log(`  Created role: ${roleData.key}`)
    } catch (error) {
      console.error(`  ✗ Failed to create role ${roleData.key}:`, error.message)
    }
  }
  
  console.log('✅ System roles seeding completed')
}
