// Resolve the niri config file path (matches niri docs precedence, minus --config argv).
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export function resolveNiriConfigPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.NIRI_CONFIG?.trim()
  if (override) {
    return existsSync(override) ? override : null
  }
  const xdg = env.XDG_CONFIG_HOME?.trim()
  const userConfig = xdg
    ? join(xdg, 'niri', 'config.kdl')
    : join(homedir(), '.config', 'niri', 'config.kdl')
  if (existsSync(userConfig)) return userConfig
  const systemConfig = '/etc/niri/config.kdl'
  if (existsSync(systemConfig)) return systemConfig
  // Prefer creating/using the user path even when missing (caller may create).
  return userConfig
}
