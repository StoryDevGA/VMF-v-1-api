import { Role } from '../models/index.js'

export const systemRoles = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Platform-level administrator with full customer and governance control.',
    scope: 'PLATFORM',
    permissions: [
      'PLATFORM_MANAGE',
      'CUSTOMER_CREATE',
      'CUSTOMER_UPDATE',
      'CUSTOMER_DELETE',
      'CUSTOMER_VIEW',
      'ROLE_MANAGE',
      'AUDIT_VIEW_ALL',
      'SYSTEM_HEALTH_VIEW'
    ],
    isSystem: true
  },
  {
    key: 'CUSTOMER_ADMIN',
    name: 'Customer Administrator', 
    description: 'Customer-scoped administrator for users, tenants, VMFs, and audits.',
    scope: 'CUSTOMER',
    permissions: [
      'CUSTOMER_VIEW',
      'USER_CREATE',
      'USER_UPDATE',
      'USER_DELETE',
      'USER_VIEW',
      'TENANT_CREATE',
      'TENANT_UPDATE',
      'TENANT_DELETE',
      'TENANT_VIEW',
      'VMF_CREATE',
      'VMF_UPDATE',
      'VMF_VIEW',
      'AUDIT_VIEW_CUSTOMER'
    ],
    isSystem: true
  },
  {
    key: 'TENANT_ADMIN',
    name: 'Tenant Administrator',
    description: 'Tenant-scoped administrator for VMF and Deal operations.',
    scope: 'TENANT', 
    permissions: [
      'TENANT_VIEW',
      'USER_VIEW_TENANT',
      'VMF_CREATE',
      'VMF_UPDATE',
      'VMF_VIEW',
      'DEAL_CREATE',
      'DEAL_UPDATE',
      'DEAL_DELETE',
      'DEAL_VIEW'
    ],
    isSystem: true
  },
  {
    key: 'USER',
    name: 'Standard User',
    description: 'Standard VMF participant with deal collaboration permissions.',
    scope: 'VMF',
    permissions: [
      'VMF_VIEW',
      'DEAL_CREATE',
      'DEAL_UPDATE',
      'DEAL_VIEW'
    ],
    isSystem: true
  }
]

export const seedSystemRoles = async () => {
  console.log('🌱 Seeding system roles...')
  
  for (const roleData of systemRoles) {
    try {
      const existingRole = await Role.findOne({ key: roleData.key })
      
      if (existingRole) {
        console.log(`  ✓ Role ${roleData.key} already exists`)
      } else {
        await Role.create(roleData)
        console.log(`  ✓ Created role: ${roleData.key}`)
      }
    } catch (error) {
      console.error(`  ✗ Failed to create role ${roleData.key}:`, error.message)
    }
  }
  
  console.log('✅ System roles seeding completed')
}
