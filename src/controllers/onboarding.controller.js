import { LicenseLevel } from '../models/index.js'
import auditService from '../services/auditService.js'
import performanceCacheService from '../services/performanceCacheService.js'
import monitoringService from '../services/monitoringService.js'
import {
  onboardCustomerWithAdmin,
  isProvisioningError,
} from '../services/provisioningService.js'

const buildProvisioningErrorResponse = (req, err) => ({
  error: {
    code: err.code || (err.status === 409 ? 'CONFLICT' : 'VALIDATION_FAILED'),
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
    requestId: req.requestId,
  },
})

const validateLicenseLevelExists = async (licenseLevelId) => {
  const licenseLevel = await LicenseLevel.findById(licenseLevelId).select('_id')
  return Boolean(licenseLevel)
}

const classifyOnboardingFailureType = (err) => {
  if (err?.code === 'CONFLICT' || err?.status === 409) return 'conflict'
  if (
    err?.code === 'VALIDATION_FAILED' ||
    err?.status === 422 ||
    err?.name === 'ValidationError'
  ) {
    return 'validation'
  }
  return 'internal'
}

const recordOnboardingFailure = (req, err, failureType) => {
  monitoringService.recordOnboardingTransactionFailure({ failureType })

  const actorUserId = req.context?.userId || req.userId
  if (!actorUserId) return

  void auditService.logFromRequest(req, {
    action: auditService.AUDIT_ACTIONS.ONBOARDING_TRANSACTION_FAILED,
    actorUserId,
    resourceType: auditService.RESOURCE_TYPES.User,
    resourceId: actorUserId,
    scope: {},
    diff: {
      source: 'external_onboarding',
      failureType,
      errorCode: err?.code || (err?.status === 409 ? 'CONFLICT' : 'INTERNAL_ERROR'),
      statusCode: err?.status || 500,
      message: err?.message || 'Onboarding transaction failed.',
    },
  })
}

export const onboardCustomer = async (req, res, next) => {
  try {
    const licenseLevelId = req.body?.customer?.licenseLevelId
    if (!licenseLevelId) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'customer.licenseLevelId is required.',
          requestId: req.requestId,
        },
      })
    }

    const licenseLevelExists = await validateLicenseLevelExists(licenseLevelId)
    if (!licenseLevelExists) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'customer.licenseLevelId must reference an existing licence level.',
          requestId: req.requestId,
        },
      })
    }

    const actorUserId = req.context?.userId || req.userId
    const onboardingResult = await onboardCustomerWithAdmin(req.body, actorUserId, req)

    const customer = onboardingResult.customer
    const adminUser = onboardingResult.adminUser
    const tenant = onboardingResult.tenant
    const vmf = onboardingResult.vmf

    await Promise.all([
      performanceCacheService.invalidateCustomerTopology(customer._id),
      performanceCacheService.invalidateUserPermissions(adminUser._id),
      ...(tenant ? [performanceCacheService.invalidateTenantStatus(tenant._id)] : []),
    ])

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.CUSTOMER_CREATED,
      resourceType: auditService.RESOURCE_TYPES.Customer,
      resourceId: customer._id,
      scope: { customerId: customer._id },
      diff: {
        source: 'external_onboarding',
        licenseLevelId: customer.licenseLevelId,
        governance: customer.governance,
      },
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.CUSTOMER_ADMIN_ASSIGNED,
      resourceType: auditService.RESOURCE_TYPES.Customer,
      resourceId: customer._id,
      scope: { customerId: customer._id },
      diff: {
        source: 'external_onboarding',
        userId: adminUser._id,
        role: 'CUSTOMER_ADMIN',
        canonicalAdminUserId: customer.governance?.customerAdminUserId || null,
        usedExistingAdmin: onboardingResult.usedExistingAdmin,
      },
    })

    await auditService.logFromRequest(req, {
      action: auditService.AUDIT_ACTIONS.CUSTOMER_ADMIN_CANONICAL_SET,
      resourceType: auditService.RESOURCE_TYPES.Customer,
      resourceId: customer._id,
      scope: { customerId: customer._id },
      diff: {
        from: null,
        to: customer.governance?.customerAdminUserId || null,
        source: 'external_onboarding',
      },
    })

    if (tenant) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.TENANT_CREATED,
        resourceType: auditService.RESOURCE_TYPES.Tenant,
        resourceId: tenant._id,
        scope: { customerId: customer._id, tenantId: tenant._id },
        diff: { source: 'external_onboarding' },
      })
    }

    if (vmf) {
      await auditService.logFromRequest(req, {
        action: auditService.AUDIT_ACTIONS.VMF_CREATED,
        resourceType: auditService.RESOURCE_TYPES.VMF,
        resourceId: vmf._id,
        scope: { customerId: customer._id, tenantId: vmf.tenantId, vmfId: vmf._id },
        diff: { source: 'external_onboarding' },
      })
    }

    return res.status(201).json({
      data: {
        customer: customer.toJSON(),
        adminUser: adminUser.toJSON(),
        ...(tenant ? { tenant: tenant.toJSON() } : {}),
        ...(vmf ? { vmf: vmf.toJSON() } : {}),
        usedExistingAdmin: onboardingResult.usedExistingAdmin,
      },
      meta: { requestId: req.requestId, version: 'v1' },
    })
  } catch (err) {
    if (isProvisioningError(err)) {
      const failureType = classifyOnboardingFailureType(err)
      recordOnboardingFailure(req, err, failureType)

      return res
        .status(err.status || 422)
        .json(buildProvisioningErrorResponse(req, err))
    }

    if (err.name === 'ValidationError') {
      const failureType = classifyOnboardingFailureType(err)
      recordOnboardingFailure(req, err, failureType)

      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: err.message,
          requestId: req.requestId,
        },
      })
    }

    recordOnboardingFailure(req, err, classifyOnboardingFailureType(err))

    next(err)
  }
}
