/** Desktop UI automation is Windows-only (win-automation-helper.exe). */
export function isDesktopAutomationAvailable(
  platform: NodeJS.Platform,
  omiAutomationEnv: string | undefined
): boolean {
  return platform === 'win32' && omiAutomationEnv !== '0'
}
