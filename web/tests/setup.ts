import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

beforeEach(() => {
  // Prefer jsdom storage over Node's own experimental localStorage global.
  vi.stubGlobal('localStorage', jsdom.window.localStorage)
  vi.stubGlobal('sessionStorage', jsdom.window.sessionStorage)
})

afterEach(() => {
  // Unmount while the test's mocks and clock are still installed so effects can
  // release their own resources before the environment is reset.
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.resetAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  jsdom.window.localStorage.clear()
  jsdom.window.sessionStorage.clear()
})
