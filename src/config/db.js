import mongoose from 'mongoose'
import env from './env.js'
import logger from './logger.js'

mongoose.set('strictQuery', true)

mongoose.connection.on('connected', () => {
  logger.info('mongo connected')
})

mongoose.connection.on('disconnected', () => {
  logger.warn('mongo disconnected')
})

mongoose.connection.on('error', (err) => {
  logger.error({ err }, 'mongo connection error')
})

export const connectDb = async ({ autoIndex = !env.isProduction } = {}) => {
  if (mongoose.connection.readyState === 1) {
    logger.info('already connected to mongo')
    return
  }

  if (!env.mongoUri) {
    throw new Error('MONGODB_URI is not set')
  }

  await mongoose.connect(env.mongoUri, {
    autoIndex,
    serverSelectionTimeoutMS: env.mongoServerSelectionTimeoutMs,
    connectTimeoutMS: env.mongoConnectTimeoutMs,
    socketTimeoutMS: env.mongoSocketTimeoutMs,
    heartbeatFrequencyMS: env.mongoHeartbeatFrequencyMs,
    minPoolSize: env.mongoMinPoolSize,
    maxPoolSize: env.mongoMaxPoolSize,
    maxIdleTimeMS: env.mongoMaxIdleTimeMs,
  })

  logger.info(
    {
      minPoolSize: env.mongoMinPoolSize,
      maxPoolSize: env.mongoMaxPoolSize,
      connectTimeoutMs: env.mongoConnectTimeoutMs,
      socketTimeoutMs: env.mongoSocketTimeoutMs,
    },
    'mongo connection pool configured',
  )
}

export const disconnectDb = async () => {
  await mongoose.disconnect()
}
