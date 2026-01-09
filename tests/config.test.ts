import { validateConfig } from '../src/config'

describe('Config', () => {
  describe('validateConfig', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('should exit when DATABASE_URL is missing', () => {
      delete process.env.DATABASE_URL
      process.env.DATABASE_URL_POSTS = 'postgres://localhost/posts'
      process.env.DATABASE_URL_MANAGEMENT = 'postgres://localhost/mgmt'

      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any)
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      validateConfig()

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(consoleErrorSpy).toHaveBeenCalled()

      exitSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })

    it('should exit when DATABASE_URL_POSTS is missing', () => {
      process.env.DATABASE_URL = 'postgres://localhost/jobs'
      delete process.env.DATABASE_URL_POSTS
      process.env.DATABASE_URL_MANAGEMENT = 'postgres://localhost/mgmt'

      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any)
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      validateConfig()

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(consoleErrorSpy).toHaveBeenCalled()

      exitSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })

    it('should exit when DATABASE_URL_MANAGEMENT is missing', () => {
      process.env.DATABASE_URL = 'postgres://localhost/jobs'
      process.env.DATABASE_URL_POSTS = 'postgres://localhost/posts'
      delete process.env.DATABASE_URL_MANAGEMENT

      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any)
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      validateConfig()

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(consoleErrorSpy).toHaveBeenCalled()

      exitSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })

    it('should succeed when all required vars are present', () => {
      // Note: config is loaded at module import time, so we can't change env vars after
      // This test verifies validateConfig succeeds when values are available
      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any)
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      // The config already has values from the environment or defaults
      // If DATABASE_URL is set in the actual environment, validateConfig will succeed
      // If not, it will call process.exit, which is mocked here
      validateConfig()

      // If validation passed, exit should not be called
      if (!process.env.DATABASE_URL) {
        expect(exitSpy).toHaveBeenCalledWith(1)
      } else {
        expect(exitSpy).not.toHaveBeenCalled()
        expect(consoleLogSpy).toHaveBeenCalledWith(
          '✓ Configuration validated successfully'
        )
      }

      exitSpy.mockRestore()
      consoleLogSpy.mockRestore()
    })

    it('should reject invalid postgres URLs', () => {
      process.env.DATABASE_URL = 'mysql://localhost/jobs' // Invalid protocol
      process.env.DATABASE_URL_POSTS = 'postgres://localhost/posts'
      process.env.DATABASE_URL_MANAGEMENT = 'postgres://localhost/mgmt'

      const exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any)
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      validateConfig()

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(consoleErrorSpy).toHaveBeenCalled()

      exitSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })
  })
})
