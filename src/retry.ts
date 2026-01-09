import retry from 'async-retry'
import { config } from './config'
import logger from './logger'

export interface RetryOptions {
  retries?: number
  minTimeout?: number
  maxTimeout?: number
  factor?: number
  onRetry?: (error: Error, attempt: number) => void
}

/**
 * Executes a function with exponential backoff retry logic.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  options?: RetryOptions
): Promise<T> {
  const retryOptions: retry.Options = {
    retries: options?.retries ?? config.retry.maxAttempts,
    minTimeout: options?.minTimeout ?? config.retry.initialDelay,
    maxTimeout: options?.maxTimeout ?? config.retry.maxDelay,
    factor: options?.factor ?? config.retry.backoffMultiplier,
    onRetry: (error: unknown, attempt: number) => {
      const errMsg = error instanceof Error ? error.message : String(error)
      logger.warn(
        { error: errMsg, attempt, operation },
        'Retrying operation after failure'
      )
      if (error instanceof Error) {
        options?.onRetry?.(error, attempt)
      }
    },
  }

  try {
    return await retry(async (bail: (error: Error) => void) => {
      try {
        return await fn()
      } catch (error) {
        // Don't retry on certain errors (e.g., 4xx client errors)
        if (error instanceof Error) {
          // Check if error message indicates a non-retryable error
          if (
            error.message.includes('404') ||
            error.message.includes('401') ||
            error.message.includes('403') ||
            error.message.includes('Invalid')
          ) {
            logger.error(
              { error: error.message, operation },
              'Non-retryable error, bailing'
            )
            bail(error)
            return undefined as any // TypeScript hack, bail throws
          }
        }
        throw error
      }
    }, retryOptions)
  } catch (error) {
    logger.error({ error, operation }, 'Operation failed after all retries')
    throw error
  }
}

/**
 * Sleep utility for manual delays.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
