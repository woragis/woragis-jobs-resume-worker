import pino from 'pino'
import { config } from './config'

export const logger = pino(
  {
    level: config.app.logLevel,
    transport:
      config.app.env === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  },
  pino.destination({ sync: false })
)

export default logger
