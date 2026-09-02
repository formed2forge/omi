import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** Per-port automation bearer token file (macOS parity: `omi-automation-{port}.token`). */
export function automationTokenFilePath(port: number, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OMI_AUTOMATION_TOKEN_FILE?.trim()
  if (explicit) return explicit
  return join(tmpdir(), `omi-automation-${port}.token`)
}

export function generateAutomationToken(): string {
  return randomBytes(32).toString('hex')
}

/** Write the launch token for harnesses (`omi-ctl` reads this file). */
export function writeAutomationTokenFile(port: number, token: string): string {
  const path = automationTokenFilePath(port)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best-effort on platforms that ignore mode */
  }
  return path
}

export function parseBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  const token = match?.[1]?.trim()
  return token || null
}
