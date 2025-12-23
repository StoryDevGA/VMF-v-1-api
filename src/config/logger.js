import pino from 'pino'
import env from './env.js'

const logger = pino({
  level: env.logLevel,
  base: {
    service: 'vmf-v-1-api',
  },
})

export default logger
