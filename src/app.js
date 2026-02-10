import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import env from './config/env.js'
import requestLogger from './middleware/requestLogger.js'
import requestContext from './middleware/requestContext.js'
import errorHandler from './middleware/errorHandler.js'
import { generalApiRateLimit } from './middleware/rateLimits.js'
import healthRoutes from './routes/health.routes.js'

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

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' })
})

app.use(errorHandler)

export default app
