import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import env from './config/env.js'
import requestLogger from './middleware/requestLogger.js'
import errorHandler from './middleware/errorHandler.js'
import healthRoutes from './routes/health.routes.js'

const app = express()

app.set('trust proxy', env.trustProxy)
app.disable('x-powered-by')

const corsOptions = {
  origin: env.corsOrigins.length > 0 ? env.corsOrigins : false,
  credentials: true,
}

app.use(helmet())
app.use(cors(corsOptions))
app.use(express.json({ limit: '1mb' }))
app.use(requestLogger)
app.use(
  rateLimit({
    windowMs: env.rateLimitWindowMs,
    limit: env.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  })
)

app.get('/', (_req, res) => {
  res.status(200).json({ message: 'VMF API' })
})

app.use('/health', healthRoutes)

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' })
})

app.use(errorHandler)

export default app
