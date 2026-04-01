const freezePermissionGroup = (group) => Object.freeze({
  ...group,
  permissions: Object.freeze(
    group.permissions.map((permission) => Object.freeze({ ...permission })),
  ),
})

export const PERMISSION_CATALOGUE = Object.freeze([
  freezePermissionGroup({
    groupKey: 'PLATFORM_MANAGEMENT',
    groupLabel: 'Platform Management',
    permissions: [
      {
        key: 'PLATFORM_MANAGE',
        label: 'Manage Platform',
        description: 'Manage protected platform-wide administration workflows.',
      },
      {
        key: 'SYSTEM_HEALTH_VIEW',
        label: 'View System Health',
        description: 'View system health, operational status, and monitoring data.',
      },
    ],
  }),
  freezePermissionGroup({
    groupKey: 'CUSTOMER_MANAGEMENT',
    groupLabel: 'Customer Management',
    permissions: [
      {
        key: 'CUSTOMER_CREATE',
        label: 'Create Customers',
        description: 'Create customer records and onboarding workspaces.',
      },
      {
        key: 'CUSTOMER_UPDATE',
        label: 'Update Customers',
        description: 'Update customer profile, governance, and configuration data.',
      },
      {
        key: 'CUSTOMER_DELETE',
        label: 'Delete Customers',
        description: 'Delete customer records and related ownership data.',
      },
      {
        key: 'CUSTOMER_VIEW',
        label: 'View Customers',
        description: 'View customer records, metadata, and configuration.',
      },
    ],
  }),
  freezePermissionGroup({
    groupKey: 'USER_MANAGEMENT',
    groupLabel: 'User Management',
    permissions: [
      {
        key: 'USER_CREATE',
        label: 'Create Users',
        description: 'Create users within the current management scope.',
      },
      {
        key: 'USER_UPDATE',
        label: 'Update Users',
        description: 'Update user profile, access, and assignment details.',
      },
      {
        key: 'USER_DELETE',
        label: 'Delete Users',
        description: 'Delete or remove users within the current management scope.',
      },
      {
        key: 'USER_VIEW',
        label: 'View Users',
        description: 'View users within the current management scope.',
      },
      {
        key: 'USER_VIEW_TENANT',
        label: 'View Tenant Users',
        description: 'View users limited to tenant-scoped visibility.',
      },
    ],
  }),
  freezePermissionGroup({
    groupKey: 'TENANT_MANAGEMENT',
    groupLabel: 'Tenant Management',
    permissions: [
      {
        key: 'TENANT_CREATE',
        label: 'Create Tenants',
        description: 'Create tenant workspaces within a customer.',
      },
      {
        key: 'TENANT_UPDATE',
        label: 'Update Tenants',
        description: 'Update tenant settings, metadata, and governance details.',
      },
      {
        key: 'TENANT_DELETE',
        label: 'Delete Tenants',
        description: 'Delete tenant workspaces and related configuration.',
      },
      {
        key: 'TENANT_VIEW',
        label: 'View Tenants',
        description: 'View tenant records, metadata, and configuration.',
      },
    ],
  }),
  freezePermissionGroup({
    groupKey: 'VMF_OPERATIONS',
    groupLabel: 'VMF Operations',
    permissions: [
      {
        key: 'VMF_CREATE',
        label: 'Create VMFs',
        description: 'Create VMF workspaces within accessible tenants.',
      },
      {
        key: 'VMF_UPDATE',
        label: 'Update VMFs',
        description: 'Update VMF metadata, settings, and operational details.',
      },
      {
        key: 'VMF_VIEW',
        label: 'View VMFs',
        description: 'View VMF records, metadata, and current state.',
      },
    ],
  }),
  freezePermissionGroup({
    groupKey: 'DEAL_OPERATIONS',
    groupLabel: 'Deal Operations',
    permissions: [
      {
        key: 'DEAL_CREATE',
        label: 'Create Deals',
        description: 'Create deals within accessible VMFs.',
      },
      {
        key: 'DEAL_UPDATE',
        label: 'Update Deals',
        description: 'Update deal details, collaboration state, and progress.',
      },
      {
        key: 'DEAL_DELETE',
        label: 'Delete Deals',
        description: 'Delete deals from accessible VMFs.',
      },
      {
        key: 'DEAL_VIEW',
        label: 'View Deals',
        description: 'View deal records and collaboration details.',
      },
    ],
  }),
  freezePermissionGroup({
    groupKey: 'AUDIT_AND_GOVERNANCE',
    groupLabel: 'Audit & Governance',
    permissions: [
      {
        key: 'AUDIT_VIEW_ALL',
        label: 'View All Audits',
        description: 'View audit history across the entire platform.',
      },
      {
        key: 'AUDIT_VIEW_CUSTOMER',
        label: 'View Customer Audits',
        description: 'View audit history within the assigned customer scope.',
      },
      {
        key: 'ROLE_MANAGE',
        label: 'Manage Roles',
        description: 'Create, update, and manage role definitions.',
      },
    ],
  }),
])

export const ALL_PERMISSION_KEYS = Object.freeze(
  PERMISSION_CATALOGUE.flatMap((group) =>
    group.permissions.map((permission) => permission.key),
  ),
)

const ALL_PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS)

const PERMISSION_DEFAULTS_BY_SCOPE = Object.freeze({
  PLATFORM: Object.freeze([
    'PLATFORM_MANAGE',
    'CUSTOMER_CREATE',
    'CUSTOMER_UPDATE',
    'CUSTOMER_DELETE',
    'CUSTOMER_VIEW',
    'ROLE_MANAGE',
    'AUDIT_VIEW_ALL',
    'SYSTEM_HEALTH_VIEW',
  ]),
  CUSTOMER: Object.freeze([
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
    'AUDIT_VIEW_CUSTOMER',
  ]),
  TENANT: Object.freeze([
    'TENANT_VIEW',
    'USER_VIEW_TENANT',
    'VMF_CREATE',
    'VMF_UPDATE',
    'VMF_VIEW',
    'DEAL_CREATE',
    'DEAL_UPDATE',
    'DEAL_DELETE',
    'DEAL_VIEW',
  ]),
  VMF: Object.freeze([
    'VMF_VIEW',
    'DEAL_CREATE',
    'DEAL_UPDATE',
    'DEAL_VIEW',
  ]),
})

export const SUPER_ADMIN_LOCKED_PERMISSION_KEYS = PERMISSION_DEFAULTS_BY_SCOPE.PLATFORM

for (const [scope, permissionKeys] of Object.entries(PERMISSION_DEFAULTS_BY_SCOPE)) {
  const invalidPermissionKeys = permissionKeys.filter(
    (permissionKey) => !ALL_PERMISSION_KEY_SET.has(permissionKey),
  )

  if (invalidPermissionKeys.length > 0) {
    throw new Error(
      `Invalid permission catalogue scope mapping for ${scope}: ${invalidPermissionKeys.join(', ')}`,
    )
  }
}

export const getPermissionsForScope = (scope) => {
  const normalizedScope = String(scope || '').trim().toUpperCase()
  const permissionKeys = PERMISSION_DEFAULTS_BY_SCOPE[normalizedScope]

  return permissionKeys ? [...permissionKeys] : []
}
