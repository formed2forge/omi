/**
 * Stable path for niri `spawn`. AppImage sets APPIMAGE to the .AppImage file;
 * process.execPath is the ephemeral /tmp/.mount_* extract and must not be written.
 */
export function resolvePackagedSpawnPath(
  env: NodeJS.ProcessEnv,
  execPath: string,
  isPackaged: boolean
): string | null {
  if (!isPackaged) return null
  const appImage = env.APPIMAGE?.trim()
  if (appImage) return appImage
  return execPath
}
