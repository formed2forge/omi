/**
 * electron-builder installs Linux packages under
 * `/opt/${sanitizeFileName(productName)}` (see FpmTarget). Spaces survive
 * sanitize-filename and break Fedora `rpmbuild` / fpm (opaque
 * "rpmbuild failed (exit code )" with destination `/opt/Omi for Windows`).
 *
 * Keep the Windows display name; use a space-free name when packaging Linux.
 */
export const WINDOWS_PRODUCT_NAME = 'Omi for Windows'
export const LINUX_PRODUCT_NAME = 'Omi'

export function isLinuxElectronBuilderArgv(argv = process.argv) {
  return argv.some(
    (arg) =>
      arg === 'linux' ||
      arg === '--linux' ||
      arg.startsWith('--linux=') ||
      arg.startsWith('linux:')
  )
}

export function resolveElectronBuilderProductName(argv = process.argv) {
  return isLinuxElectronBuilderArgv(argv) ? LINUX_PRODUCT_NAME : WINDOWS_PRODUCT_NAME
}
