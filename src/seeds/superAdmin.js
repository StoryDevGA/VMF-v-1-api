import { User } from '../models/index.js'

export const seedSuperAdmin = async () => {
  console.log('🌱 Seeding super admin user...')
  
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@storylineos.com'
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe123!'
  
  try {
    const existingUser = await User.findOne({ email: superAdminEmail })
    
    if (existingUser) {
      console.log(`  ✓ Super admin user already exists: ${superAdminEmail}`)
      return existingUser
    }
    
    const superAdmin = new User({
      email: superAdminEmail,
      name: 'Super Administrator',
      isActive: true,
      identityPlus: {
        trustStatus: 'TRUSTED',
        trustedAt: new Date()
      },
      memberships: [{
        customerId: null, // Platform level
        roles: ['SUPER_ADMIN']
      }]
    })
    
    await superAdmin.setPassword(superAdminPassword)
    await superAdmin.save()
    
    console.log(`  ✓ Created super admin user: ${superAdminEmail}`)
    console.log(`  ⚠️  Default password: ${superAdminPassword}`)
    console.log('  🔒 Please change the password after first login!')
    
    return superAdmin
  } catch (error) {
    console.error('  ✗ Failed to create super admin user:', error.message)
    throw error
  }
}