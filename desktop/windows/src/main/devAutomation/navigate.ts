/** Settings tab ids accepted by `omi-ctl navigate settings <section>`. */
export type DevAutomationSettingsTab =
  | 'general'
  | 'memories'
  | 'agents'
  | 'transcription'
  | 'rewind'
  | 'notifications'
  | 'privacy'
  | 'account'
  | 'plan-usage'
  | 'shortcuts'
  | 'advanced'
  | 'about'

/** Valid `omi-ctl navigate` screen targets for the Windows HashRouter shell. */
export const NAVIGATE_SCREEN_TARGETS = [
  'dashboard',
  'home',
  'conversations',
  'chat',
  'memories',
  'tasks',
  'goals',
  'rewind',
  'apps',
  'integrations',
  'settings',
  'permissions',
  'insights'
] as const

export type NavigateScreenTarget = (typeof NAVIGATE_SCREEN_TARGETS)[number]

const SCREEN_ALIASES: Record<string, string> = {
  dashboard: '/home',
  home: '/home',
  chat: '/home',
  conversations: '/conversations',
  memories: '/memories',
  tasks: '/tasks',
  goals: '/goals',
  rewind: '/rewind',
  apps: '/apps',
  integrations: '/apps',
  settings: '/settings',
  permissions: '/settings',
  insights: '/insights'
}

const SETTINGS_SECTION_ALIASES: Record<string, DevAutomationSettingsTab> = {
  general: 'general',
  memories: 'memories',
  agents: 'agents',
  transcription: 'transcription',
  rewind: 'rewind',
  notifications: 'notifications',
  privacy: 'privacy',
  account: 'account',
  plan: 'plan-usage',
  usage: 'plan-usage',
  'plan-usage': 'plan-usage',
  shortcuts: 'shortcuts',
  advanced: 'advanced',
  about: 'about',
  permissions: 'privacy'
}

export interface NavigateRequest {
  target: string
  settingsSection?: string
  activateApp?: boolean
}

export interface ResolvedNavigate {
  hashPath: string
  settingsTab?: DevAutomationSettingsTab
}

export function resolveNavigateRequest(req: NavigateRequest): ResolvedNavigate {
  const target = req.target.trim().toLowerCase()
  const hashPath = SCREEN_ALIASES[target]
  if (!hashPath) {
    throw new Error(`unknown navigation target: ${req.target}`)
  }

  const sectionRaw = (req.settingsSection ?? (target === 'permissions' ? 'privacy' : '')).trim()
  const settingsTab = sectionRaw
    ? SETTINGS_SECTION_ALIASES[sectionRaw.toLowerCase()]
    : hashPath === '/settings'
      ? SETTINGS_SECTION_ALIASES.general
      : undefined

  if (sectionRaw && !settingsTab) {
    throw new Error(`unknown settings section: ${sectionRaw}`)
  }

  return { hashPath, settingsTab }
}

/** Renderer script: set the hash route and optionally request a Settings tab. */
export function buildNavigateScript(resolved: ResolvedNavigate): string {
  const hash = `#${resolved.hashPath}`
  if (resolved.settingsTab) {
    return `(function () {
  window.__omiDevSettingsTab = ${JSON.stringify(resolved.settingsTab)};
  window.location.hash = ${JSON.stringify(hash)};
  window.dispatchEvent(new HashChangeEvent('hashchange'));
})()`
  }
  return `(function () {
  window.location.hash = ${JSON.stringify(hash)};
  window.dispatchEvent(new HashChangeEvent('hashchange'));
})()`
}
