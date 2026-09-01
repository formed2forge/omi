// Per-row identity mark for a floating agent pill. Faithful port of macOS'
// NotchMorphDot / AgentProviderLogoMark: a status-colored orb, or a Hermes/
// OpenClaw logo tinted to that same color when the kernel stamped a provider.
// Colored circle is the contract; the logo is an overlay on alpha, never a
// second status channel. NO PURPLE (INV-UI-1).
import hermesLogo from '../../assets/brands/hermes_logo.png'
import openclawLogo from '../../assets/brands/openclaw_logo.png'
import {
  displayTintToken,
  statusGroupFromDisplay,
  type AgentPillDisplayStatus
} from './agentPills'
import { statusOrbClasses } from './agentPillTranscript'

const PROVIDER_LOGO: Record<string, string> = {
  hermes: hermesLogo,
  openclaw: openclawLogo
}

export type AgentStatusMarkProps = {
  displayStatus: AgentPillDisplayStatus
  provider?: string | null
  /** Pulse while the run is still in flight (queued/running group). */
  pulse?: boolean
}

export function AgentStatusMark(props: AgentStatusMarkProps): React.JSX.Element {
  const token = displayTintToken(props.displayStatus)
  const group = statusGroupFromDisplay(props.displayStatus)
  const pulse = props.pulse ?? (group === 'running' || group === 'queued')
  const logo = props.provider ? PROVIDER_LOGO[props.provider.toLowerCase()] : undefined
  const colorCls = statusOrbClasses(token)
  const pulseCls = pulse ? 'animate-pulse' : ''

  if (logo) {
    return (
      <span
        data-testid="agent-status-mark"
        data-agent-status={group}
        aria-hidden="true"
        className={`relative h-2.5 w-2.5 shrink-0 ${pulseCls}`}
      >
        <span
          className={`absolute inset-0 ${colorCls}`}
          style={{
            maskImage: `url(${logo})`,
            WebkitMaskImage: `url(${logo})`,
            maskSize: 'contain',
            WebkitMaskSize: 'contain',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskPosition: 'center',
            WebkitMaskPosition: 'center'
          }}
        />
      </span>
    )
  }

  return (
    <span
      data-testid="agent-status-mark"
      data-agent-status={group}
      aria-hidden="true"
      className={`h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/40 ${colorCls} ${pulseCls}`}
    />
  )
}
