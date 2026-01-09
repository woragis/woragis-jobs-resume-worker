import pino from 'pino'
import { config } from './config'

const logLevelToNumber = (level: string): number => {
  const levels: Record<string, number> = {
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
  }
  return levels[level.toLowerCase()] || 30
}

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
