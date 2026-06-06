import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import env from './config/env.js'
import requestLogger from './middleware/requestLogger.js'
import requestContext from './middleware/requestContext.js'
import correlationEnricher from './middleware/correlationEnricher.js'
import performanceMonitor from './middleware/performanceMonitor.js'
import errorHandler from './middleware/errorHandler.js'
import { generalApiRateLimit } from './middleware/rateLimits.js'
import healthRoutes from './routes/health.routes.js'
import monitoringRoutes from './routes/monitoring.routes.js'
import authRoutes from './routes/auth.routes.js'
import identityPlusRoutes from './routes/identityPlus.routes.js'
import invitationAuthRoutes from './routes/invitationAuth.routes.js'
import invitationRoutes from './routes/invitations.routes.js'
import systemVersioningPolicyRoutes from './routes/systemVersioningPolicy.routes.js'
import frameworkRegistryRoutes from './routes/frameworkRegistry.routes.js'
import frameworkPackageRoutes from './routes/frameworkPackages.routes.js'
import runtimeAgentRoutes from './routes/runtimeAgents.routes.js'
import runtimeSkillRoutes from './routes/runtimeSkills.routes.js'
import runtimePathRoutes from './routes/runtimePaths.routes.js'
import skillRoleRegistryRoutes from './routes/skillRoleRegistry.routes.js'
import validationRegistryRoutes from './routes/validationRegistry.routes.js'
import workflowPolicyRoutes from './routes/workflowPolicies.routes.js'
import uiContractRoutes from './routes/uiContracts.routes.js'
import runtimeValidationRoutes from './routes/runtimeValidation.routes.js'
import runtimeActivationRoutes from './routes/runtimeActivation.routes.js'
import runtimeInstanceRoutes from './routes/runtimeInstances.routes.js'
import superAdminAuditRoutes from './routes/superAdminAudit.routes.js'
import licenseLevelRoutes from './routes/licenseLevels.routes.js'
import roleRoutes from './routes/roles.routes.js'
import onboardingRoutes from './routes/onboarding.routes.js'
import customerRoutes from './routes/customers.routes.js'
import { customerTenantRouter, tenantRouter } from './routes/tenants.routes.js'
import { customerUserRouter, userRouter } from './routes/users.routes.js'
import { tenantVmfRouter, vmfRouter } from './routes/vmfs.routes.js'
import { vmfDealRouter, dealRouter } from './routes/deals.routes.js'
import { bulkRouter, bulkDisableRouter } from './routes/bulk.routes.js'
import auditRouter from './routes/audit.routes.js'
import gdprRouter from './routes/gdpr.routes.js'
import fakeAuthRoutes from './routes/fakeAuth.routes.js'
import logger from './config/logger.js'

const app = express()

if (env.fakeAuthAllowed) {
  logger.warn('FAKE AUTH IS ENABLED — Identity Plus verification is bypassed. Do not use in production.')
}

app.set('trust proxy', env.trustProxy)
app.disable('x-powered-by')

const corsOptions = {
  origin: env.corsOrigins,
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'API-Version', 'X-Step-Up-Token'],
  maxAge: 600,
}

// Enhanced helmet configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  }
}))

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
const defaultJsonParser = express.json({ limit: '1mb' })
app.use((req, res, next) => (
  req.path.startsWith('/api/v1/runtime-instances')
    ? next()
    : defaultJsonParser(req, res, next)
))
app.use(requestContext) // Add request context before logger
app.use(correlationEnricher) // Enrich responses with requestId
app.use(requestLogger)
app.use(performanceMonitor)
app.use(generalApiRateLimit)

app.get('/', (_req, res) => {
  res.status(200).json({ message: 'VMF API' })
})

app.use('/health', healthRoutes)
app.use('/metrics', monitoringRoutes)
app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/webhooks/identity-plus', identityPlusRoutes)
app.use('/api/v1/super-admin/invitations', invitationAuthRoutes)
app.use('/api/v1/super-admin/invitations', invitationRoutes)
app.use('/api/v1/super-admin/system-versioning-policy', systemVersioningPolicyRoutes)
app.use('/api/v1/super-admin/runtime-control/framework-registry', frameworkRegistryRoutes)
app.use('/api/v1/super-admin/runtime-control/framework-packages', frameworkPackageRoutes)
app.use('/api/v1/super-admin/runtime-control/agents', runtimeAgentRoutes)
app.use('/api/v1/super-admin/runtime-control/skills', runtimeSkillRoutes)
app.use('/api/v1/super-admin/runtime-control/runtime-paths', runtimePathRoutes)
app.use('/api/v1/super-admin/runtime-control/skill-roles', skillRoleRegistryRoutes)
app.use('/api/v1/super-admin/runtime-control/validation-registry', validationRegistryRoutes)
app.use('/api/v1/super-admin/runtime-control/workflow-policies', workflowPolicyRoutes)
app.use('/api/v1/super-admin/runtime-control/ui-contracts', uiContractRoutes)
app.use('/api/v1/super-admin/runtime-control/runtime-validation', runtimeValidationRoutes)
app.use('/api/v1/super-admin/runtime-control/runtime-activation', runtimeActivationRoutes)
app.use('/api/v1/runtime-instances', runtimeInstanceRoutes)
app.use('/api/v1/super-admin/denied-access-logs', superAdminAuditRoutes)
if (env.governanceLicenseLevelsEnabled) {
  app.use('/api/v1/super-admin/licence-levels', licenseLevelRoutes)
} else {
  logger.warn('GOVERNANCE_LICENSE_LEVELS_ENABLED=false - licence level routes are disabled')
}
app.use('/api/v1/super-admin/roles', roleRoutes)

if (env.governanceExternalOnboardingEnabled) {
  app.use('/api/v1/super-admin/customers', onboardingRoutes)
} else {
  logger.warn('GOVERNANCE_EXTERNAL_ONBOARDING_ENABLED=false - external onboarding route is disabled')
}
// More specific customer-scoped routes BEFORE the general /customers mount
// (Express prefix-matches app.use, so /customers would intercept /customers/:id/users)
app.use('/api/v1/customers/:customerId/tenants/:tenantId/vmfs', tenantVmfRouter)
app.use('/api/v1/customers/:customerId/tenants', customerTenantRouter)
app.use('/api/v1/customers/:customerId/users/bulk-disable', bulkDisableRouter)
app.use('/api/v1/customers/:customerId/users/bulk', bulkRouter)
app.use('/api/v1/customers/:customerId/users', customerUserRouter)
app.use('/api/v1/customers', customerRoutes)
app.use('/api/v1/vmfs/:vmfId/deals', vmfDealRouter)
app.use('/api/v1/vmfs', vmfRouter)
app.use('/api/v1/tenants', tenantRouter)
app.use('/api/v1/users', userRouter)
app.use('/api/v1/deals', dealRouter)
app.use('/api/v1/audit-logs', auditRouter)
app.use('/api/v1/gdpr', gdprRouter)
app.use('/api/v1/fake-auth/invitations', fakeAuthRoutes)

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' })
})

app.use(errorHandler)

export default app
