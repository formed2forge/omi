import { describe, it, expect } from 'vitest'
import { isDesktopAutomationAvailable } from './automationAvailability'

describe('isDesktopAutomationAvailable', () => {
  it('is true on Windows when not explicitly disabled', () => {
    expect(isDesktopAutomationAvailable('win32', undefined)).toBe(true)
    expect(isDesktopAutomationAvailable('win32', '1')).toBe(true)
  })

  it('is false when OMI_AUTOMATION=0', () => {
    expect(isDesktopAutomationAvailable('win32', '0')).toBe(false)
  })

  it('is false on Linux and macOS regardless of env', () => {
    expect(isDesktopAutomationAvailable('linux', undefined)).toBe(false)
    expect(isDesktopAutomationAvailable('darwin', undefined)).toBe(false)
  })
})
