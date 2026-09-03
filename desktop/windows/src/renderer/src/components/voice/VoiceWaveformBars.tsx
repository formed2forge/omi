/** Compact 5-bar mic visualizer shown inside PushToTalkMicButton while
 *  listening. Port of macOS VoiceWaveformBars — driven by the turn driver's
 *  orbLevel (0..1), not a second analyser. Neutral/emerald only (INV-UI-1). */
export function VoiceWaveformBars(props: { active: boolean; level: number }): React.JSX.Element {
  const { active, level } = props
  const multipliers = [0.45, 0.75, 1, 0.75, 0.45]
  return (
    <span
      aria-hidden="true"
      className="flex h-[14px] w-[18px] items-center justify-center gap-[2px]"
    >
      {multipliers.map((m, i) => {
        const t = active ? Math.max(0.18, Math.min(1, 0.18 + level * m)) : 0.18
        return (
          <span
            key={i}
            className="w-[2.5px] rounded-full bg-current"
            style={{ height: `${Math.round(t * 14)}px` }}
          />
        )
      })}
    </span>
  )
}
