import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import env from './config/env.js'
import requestLogger from './middleware/requestLogger.js'
import requestContext from './middleware/requestContext.js'
import errorHandler from './middleware/errorHandler.js'
import { generalApiRateLimit } from './middleware/rateLimits.js'
import healthRoutes from './routes/health.routes.js'
import authRoutes from './routes/auth.routes.js'
import identityPlusRoutes from './routes/identityPlus.routes.js'
import customerRoutes from './routes/customers.routes.js'
import { customerTenantRouter, tenantRouter } from './routes/tenants.routes.js'
import { customerUserRouter, userRouter } from './routes/users.routes.js'
import { tenantVmfRouter, vmfRouter } from './routes/vmfs.routes.js'
import { vmfDealRouter, dealRouter } from './routes/deals.routes.js'
import { bulkRouter, bulkDisableRouter } from './routes/bulk.routes.js'

const app = express()

app.set('trust proxy', env.trustProxy)
app.disable('x-powered-by')

const corsOptions = {
  origin: env.corsOrigins,
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'API-Version'],
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
app.use(express.json({ limit: '1mb' }))
app.use(requestContext) // Add request context before logger
app.use(requestLogger)
app.use(generalApiRateLimit)

app.get('/', (_req, res) => {
  res.status(200).json({ message: 'VMF API' })
})

app.use('/health', healthRoutes)
app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/webhooks/identity-plus', identityPlusRoutes)
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

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' })
})

app.use(errorHandler)

export default app
