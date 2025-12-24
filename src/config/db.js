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

export const connectDb = async () => {
  if (mongoose.connection.readyState === 1) {
    logger.info('already connected to mongo')
    return
  }

  if (!env.mongoUri) {
    throw new Error('MONGODB_URI is not set')
  }

  await mongoose.connect(env.mongoUri, {
    autoIndex: !env.isProduction,
    serverSelectionTimeoutMS: 5000,
  })
}

export const disconnectDb = async () => {
  await mongoose.disconnect()
}
