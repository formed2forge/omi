// Shortcuts settings tab. Mac reference: ShortcutsSettingsSection.swift.
//
// Composition mirrors Mac: one CARD per global shortcut (Ask-omi/summon first,
// then record), each with a title/description, a row of selectable chips (the
// default preset + a Custom recorder chip), and a conflict warning — rendered in
// the Windows dark settings idiom (SettingRow chrome, white/neutral selection,
// no purple).
//
// Machinery (both chords are real, rebindable, persisted):
//  - Summon — window.omi.getSummonHotkey / setSummonHotkey (persisted in main
//    appSettings.summonHotkey; also mirrored to the legacy overlayShortcut pref so
//    App.tsx's startup re-apply converges). Default Shift+Space.
//  - Record — window.omi.getRecordHotkey / setRecordHotkey (persisted in main
//    appSettings.recordHotkey). Default Ctrl+Space.
// Rebinds reuse the shared capture-phase recorder (useChordRecorder) and the
// shared suspend/resume of ALL global chords, so pressing the CURRENT chord during
// a rebind is captured instead of firing. A chord already owned by another app
// surfaces registered=false → the amber "held by another app" warning (the real
// silent-failure fix: a persisted/conflicting chord previously failed with only a
// console.warn at boot).
//
// Disabling a chord (macOS's per-shortcut Off): built for the RECORD card only —
// its default Ctrl+Space collides with the Windows IME language-switch, so an
// "Off" chip lets the user release it. Deliberately NOT offered for Summon: that
// accelerator is also the push-to-talk hold trigger (main/bar gesture machine),
// so disabling it would silently kill PTT.
//
// Phase 1 (Linux shortcuts): each card has a Test control that probes whether the
// OS will accept the current chord (suspend → register probe → resume). Linux
// also shows a read-only session diagnostic row (portal/ozone/WM hints).
import { useEffect, useRef, useState } from 'react'
import { Keyboard, MessageSquareText, Monitor } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  LinuxDeConflictScanResult,
  LinuxShortcutSessionDiagnostics,
  NiriCompositorKeybindStatus,
  RecordHotkeyState
} from '../../../../../shared/types'
import { setPreferences } from '../../../lib/preferences'
import { SettingRow } from '../SettingRow'
import { acceleratorToTokens, DEFAULT_OVERLAY_ACCELERATOR } from '../../../lib/overlayShortcut'
import { useChordRecorder } from '../../../hooks/useChordRecorder'
import { DEFAULT_RECORD_HOTKEY } from '../../../../../shared/hotkeyDefaults'

export function ShortcutsTab(): React.JSX.Element {
  const [shortcutDeliveryReliable, setShortcutDeliveryReliable] = useState(true)

  useEffect(() => {
    let unmounted = false
    void window.omi?.getLinuxShortcutSession?.().then((info) => {
      if (unmounted || !info?.globalShortcuts.available) return
      setShortcutDeliveryReliable(info.globalShortcuts.deliveryReliable)
    })
    return () => {
      unmounted = true
    }
  }, [])

  return (
    <>
      <LinuxShortcutSessionRow />
      <ShortcutCard
        icon={MessageSquareText}
        title="Summon hotkey"
        subtitle="Global shortcut to reveal the floating bar and ask a question."
        keywords="hotkey shortcut summon floating bar overlay ask accelerator keybinding rebind custom"
        defaultAccel={DEFAULT_OVERLAY_ACCELERATOR}
        load={() => window.omi?.getSummonHotkey?.() ?? Promise.resolve(null)}
        commit={(next) =>
          window.omi?.setSummonHotkey?.(next) ?? Promise.resolve({ ok: false, registered: false })
        }
        shortcutDeliveryReliable={shortcutDeliveryReliable}
        // Mirror to the legacy pref so App.tsx's startup re-apply converges.
        onCommitted={(next) => setPreferences({ overlayShortcut: next })}
      />
      <ShortcutCard
        icon={Keyboard}
        title="Record hotkey"
        subtitle="Global shortcut to start and stop recording."
        keywords="hotkey shortcut record accelerator keybinding rebind mic custom"
        defaultAccel={DEFAULT_RECORD_HOTKEY}
        load={() => window.omi?.getRecordHotkey?.() ?? Promise.resolve(null)}
        commit={(next) =>
          window.omi?.setRecordHotkey?.(next) ?? Promise.resolve({ ok: false, registered: false })
        }
        shortcutDeliveryReliable={shortcutDeliveryReliable}
        // Record-only: the "Off" chip. Summon omits this (coupled to PTT), so its
        // card renders no Off affordance.
        onSetEnabled={(enabled) =>
          window.omi?.setRecordHotkeyEnabled?.(enabled) ??
          Promise.resolve({ accelerator: '', registered: false, enabled })
        }
      />
    </>
  )
}

function LinuxShortcutSessionRow(): React.JSX.Element | null {
  const [diag, setDiag] = useState<LinuxShortcutSessionDiagnostics | null | undefined>(undefined)
  const [niriStatus, setNiriStatus] = useState<NiriCompositorKeybindStatus | null>(null)
  const [deScan, setDeScan] = useState<LinuxDeConflictScanResult | null>(null)
  const [showConsent, setShowConsent] = useState(false)
  const [cancelledManual, setCancelledManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    const [info, status, scan] = await Promise.all([
      window.omi?.getLinuxShortcutSession?.() ?? Promise.resolve(null),
      window.omi?.getNiriCompositorKeybindStatus?.() ?? Promise.resolve(null),
      window.omi?.scanLinuxDeConflicts?.() ?? Promise.resolve(null)
    ])
    setDiag(info ?? null)
    setNiriStatus(status)
    setDeScan(scan)
    if (
      status &&
      status.state === 'not-installed' &&
      !status.consentGranted &&
      !cancelledManual
    ) {
      setShowConsent(true)
    }
  }

  useEffect(() => {
    let unmounted = false
    void (async () => {
      const [info, status, scan] = await Promise.all([
        window.omi?.getLinuxShortcutSession?.() ?? Promise.resolve(null),
        window.omi?.getNiriCompositorKeybindStatus?.() ?? Promise.resolve(null),
        window.omi?.scanLinuxDeConflicts?.() ?? Promise.resolve(null)
      ])
      if (unmounted) return
      setDiag(info ?? null)
      setNiriStatus(status)
      setDeScan(scan)
      if (status && status.state === 'not-installed' && !status.consentGranted) {
        setShowConsent(true)
      }
    })()
    return () => {
      unmounted = true
    }
  }, [])

  if (!diag) return null

  const gs = diag.globalShortcuts
  const mechanism = gs.available
    ? gs.mechanism === 'wayland-portal'
      ? 'Wayland desktop portal'
      : 'X11 global grab'
    : gs.reason
  const workaround = gs.compositorWorkaround
  const needsCompositorBinds = gs.available && !gs.deliveryReliable && diag.compositor === 'niri'
  const showManual =
    needsCompositorBinds &&
    workaround &&
    (cancelledManual ||
      niriStatus?.state === 'dev-unsupported' ||
      niriStatus?.state === 'config-missing')

  const onApply = async (): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      const res = await window.omi?.installNiriCompositorKeybinds?.({ grantConsent: true })
      setNiriStatus(res?.status ?? null)
      setShowConsent(false)
      setCancelledManual(false)
      if (!res?.ok && res?.status.state === 'conflict') {
        setActionError(res.status.reason ?? 'Chord conflict in niri config.')
      } else if (!res?.ok) {
        setActionError(res?.status.reason ?? 'Could not install compositor keybinds.')
      }
    } finally {
      setBusy(false)
    }
  }

  const onCancel = (): void => {
    setShowConsent(false)
    setCancelledManual(true)
  }

  return (
    <SettingRow
      icon={Monitor}
      title="Linux shortcut environment"
      subtitle="Session facts Omi uses when registering global shortcuts."
      keywords="linux wayland x11 portal ozone desktop environment shortcut diagnostics niri sway kde plasma compositor"
    >
      <div className="space-y-2 text-xs text-white/55">
        <p className="font-mono text-[11px] text-white/70">{diag.summary}</p>
        <p>
          Session <span className="text-white/80">{diag.sessionType}</span>
          {diag.compositor !== 'unknown' ? (
            <>
              {' '}
              · compositor <span className="text-white/80">{diag.compositor}</span>
            </>
          ) : null}
          {diag.currentDesktop ? (
            <>
              {' '}
              · desktop <span className="text-white/80">{diag.currentDesktop}</span>
            </>
          ) : null}{' '}
          · ozone <span className="text-white/80">{diag.ozonePlatform}</span>
        </p>
        <p>
          Global shortcut path: <span className="text-white/80">{mechanism}</span>
        </p>

        {diag.compositor === 'kde' && deScan?.state === 'conflicts' && deScan.conflicts?.length ? (
          <div className="space-y-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-3 text-amber-100/90">
            <p>
              These Omi chords are already bound in Plasma (System Settings → Shortcuts). Pick a
              different chord in Omi, or change that shortcut in Plasma.
            </p>
            {deScan.sourcePath ? (
              <p className="font-mono text-[11px] text-white/70">{deScan.sourcePath}</p>
            ) : null}
            {deScan.conflicts.map((c) => (
              <div key={`${c.action}-${c.deChord}-${c.actionId}`} className="space-y-1">
                <p>
                  Omi <span className="text-white/90">{c.action}</span> (
                  <span className="font-mono text-[11px] text-white/80">{c.electronAccelerator}</span>
                  ) conflicts with{' '}
                  <span className="text-white/90">
                    {c.component} / {c.label}
                  </span>{' '}
                  (<span className="font-mono text-[11px] text-white/80">{c.deChord}</span>)
                </p>
              </div>
            ))}
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80"
            >
              Rescan Plasma shortcuts
            </button>
          </div>
        ) : null}

        {diag.compositor === 'kde' && deScan?.state === 'ok' ? (
          <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p className="text-emerald-300/90">
              No Plasma global-shortcut conflicts for Omi&apos;s current chords.
            </p>
            {deScan.sourcePath ? (
              <p className="font-mono text-[11px] text-white/60">{deScan.sourcePath}</p>
            ) : null}
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80"
            >
              Rescan Plasma shortcuts
            </button>
          </div>
        ) : null}

        {diag.compositor === 'kde' && deScan?.state === 'scan-failed' ? (
          <p className="text-amber-300">{deScan.reason ?? 'Plasma shortcut scan failed.'}</p>
        ) : null}

        {needsCompositorBinds && niriStatus ? (
          <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <p>
              Compositor shortcuts:{' '}
              <span className="text-white/80">{niriStatusLabel(niriStatus.state)}</span>
              {niriStatus.configPath ? (
                <>
                  {' '}
                  · <span className="font-mono text-[11px] text-white/70">{niriStatus.configPath}</span>
                </>
              ) : null}
            </p>

            {showConsent ? (
              <div className="space-y-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-3 text-amber-100/90">
                <p>
                  Omi needs to add keybinds to your niri config so global shortcuts work. Omi will
                  check included KDL files for conflicts, then write a marked block (your other
                  binds are not changed).
                </p>
                {niriStatus.configPath ? (
                  <p className="font-mono text-[11px] text-white/80">File: {niriStatus.configPath}</p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onApply()}
                    className="rounded-lg border border-white/25 bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {busy ? 'Applying…' : 'Apply'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onCancel}
                    className="rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/[0.06] disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {!showConsent && niriStatus.state === 'not-installed' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowConsent(true)}
                className="rounded-lg border border-white/25 bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                Apply to niri…
              </button>
            ) : null}

            {!showConsent && niriStatus.consentGranted && niriStatus.state !== 'installed' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onApply()}
                className="rounded-lg border border-white/25 bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {busy ? 'Applying…' : 'Retry Apply'}
              </button>
            ) : null}

            {niriStatus.state === 'conflict' && niriStatus.conflicts?.length ? (
              <div className="space-y-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-3 text-amber-100/90">
                <p>
                  These chords are already bound in your niri config. Omi will not overwrite them —
                  pick a different chord in Omi, or change the bind in niri.
                </p>
                {niriStatus.conflicts.map((c) => (
                  <div key={`${c.action}-${c.niriChord}`} className="space-y-1">
                    <p>
                      <span className="text-white/90">{c.electronAccelerator}</span> (
                      {c.action}) →{' '}
                      <span className="font-mono text-[11px] text-white/80">{c.niriChord}</span>
                    </p>
                    <p className="font-mono text-[11px] text-white/70">{c.existingBind}</p>
                    <p className="font-mono text-[10px] text-white/50">{c.filePath}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {niriStatus.state === 'scan-incomplete' ? (
              <p className="text-amber-200/90">
                {niriStatus.reason}
                {niriStatus.unreadableIncludes?.length ? (
                  <span className="mt-1 block font-mono text-[11px] text-white/60">
                    {niriStatus.unreadableIncludes.join(', ')}
                  </span>
                ) : null}
              </p>
            ) : null}

            {actionError ? <p className="text-amber-300">{actionError}</p> : null}

            {niriStatus.state === 'installed' ? (
              <p className="text-emerald-300/90">
                Compositor shortcuts installed. Try your summon chord now.
              </p>
            ) : null}
          </div>
        ) : null}

        {showManual && workaround ? (
          <div className="space-y-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-amber-100/90">
            <p>
              Manual niri config — bind these in your compositor config (or click Apply above when
              ready):
            </p>
            <p className="font-mono text-[11px] text-white/80">Summon: {workaround.summonCommand}</p>
            <p className="font-mono text-[11px] text-white/80">
              Record mic: {workaround.recordMicCommand}
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-white/70">
              {workaround.niriConfigExample}
            </pre>
            {cancelledManual ? (
              <button
                type="button"
                onClick={() => {
                  setCancelledManual(false)
                  setShowConsent(true)
                  void refresh()
                }}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80"
              >
                Show Apply prompt again
              </button>
            ) : null}
          </div>
        ) : null}

        {needsCompositorBinds &&
        !showManual &&
        !showConsent &&
        niriStatus?.state !== 'installed' &&
        niriStatus?.state !== 'conflict' &&
        workaround &&
        diag.compositor !== 'niri' ? (
          <div className="space-y-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-amber-100/90">
            <p>
              {diag.compositor} does not deliver in-app global shortcuts to Electron apps. Bind
              these in your compositor config instead:
            </p>
            <p className="font-mono text-[11px] text-white/80">Summon: {workaround.summonCommand}</p>
            <p className="font-mono text-[11px] text-white/80">
              Record mic: {workaround.recordMicCommand}
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-white/70">
              {workaround.niriConfigExample}
            </pre>
          </div>
        ) : null}
      </div>
    </SettingRow>
  )
}

function niriStatusLabel(state: NiriCompositorKeybindStatus['state']): string {
  switch (state) {
    case 'installed':
      return 'Installed'
    case 'not-installed':
    case 'needs-consent':
      return 'Not installed'
    case 'conflict':
      return 'Conflict'
    case 'dev-unsupported':
      return 'Packaged build required'
    case 'config-missing':
      return 'Config not found'
    case 'scan-incomplete':
      return 'Scan incomplete'
    case 'scan-failed':
      return 'Scan failed'
    case 'write-failed':
      return 'Write failed'
    default:
      return 'Unavailable'
  }
}

/** Keycap chips for an accelerator (e.g. "Ctrl" + "Space"). */
function Keycaps({ accel }: { accel: string }): React.JSX.Element {
  return (
    <span className="flex items-center gap-1">
      {acceleratorToTokens(accel).map((t, i) => (
        <kbd
          key={`${t}-${i}`}
          className="flex h-6 min-w-6 items-center justify-center rounded-md bg-black/30 px-1.5 text-xs font-semibold text-white/85"
        >
          {t}
        </kbd>
      ))}
    </span>
  )
}

/**
 * One rebindable global-shortcut card: the default preset chip + a Custom chip
 * (which records a new chord), the current chord shown as keycaps, and an amber
 * warning when the OS hasn't claimed it. `load` fetches the current accelerator +
 * registration; `commit` persists a captured chord and reports OS acceptance.
 */
function ShortcutCard(props: {
  icon: LucideIcon
  title: string
  subtitle: string
  keywords: string
  defaultAccel: string
  load: () => Promise<RecordHotkeyState | null>
  commit: (accelerator: string) => Promise<{ ok: boolean; registered: boolean }>
  onCommitted?: (accelerator: string) => void
  /** When provided, the card renders an "Off" chip that fully disables the chord
   *  (Record card only; Summon omits it — it's coupled to push-to-talk). */
  onSetEnabled?: (enabled: boolean) => Promise<RecordHotkeyState>
  /** Linux-only: in-app shortcuts may register but never fire (niri/sway). */
  shortcutDeliveryReliable?: boolean
}): React.JSX.Element {
  const {
    icon,
    title,
    subtitle,
    keywords,
    defaultAccel,
    load,
    commit,
    onCommitted,
    onSetEnabled,
    shortcutDeliveryReliable = true
  } = props
  const [accel, setAccel] = useState<string | null>(null)
  const [registered, setRegistered] = useState(true)
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'available' | 'unavailable' | null>(null)
  // Set as soon as the user picks a chip / records a chord. The mount `load()` is
  // async, so a fast click whose commit resolves FIRST would otherwise be undone
  // by the (now stale) load result — ignore the load once the user has acted.
  const acted = useRef(false)

  useEffect(() => {
    let unmounted = false
    void load().then((h) => {
      if (unmounted || acted.current || !h) return
      setAccel(h.accelerator)
      setRegistered(h.registered)
      setEnabled(h.enabled !== false)
    })
    return () => {
      unmounted = true
    }
    // Mount-only: `load` is a stable inline closure per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setTestResult(null)
  }, [accel])

  const runTest = async (): Promise<void> => {
    if (!accel || !enabled) return
    setError(null)
    setTestResult(null)
    setTesting(true)
    try {
      const res = await window.omi?.testShortcutAccelerator?.(accel)
      setTestResult(res?.available ? 'available' : 'unavailable')
    } finally {
      setTesting(false)
    }
  }

  // suspend/resume release ALL global chords while recording — otherwise pressing
  // the CURRENT chord (e.g. Ctrl+Space / Shift+Space) fires it instead of being
  // captured. Shared handlers cover both the record and summon chords.
  const recorder = useChordRecorder({
    suspend: () => window.omi?.suspendShortcutCapture?.(),
    resume: () => window.omi?.resumeShortcutCapture?.(),
    commit: async (next) => {
      acted.current = true
      const res = await commit(next)
      // Record card (intent model): a declined OS claim is still a SUCCESSFUL
      // commit — main persisted `next` and released the old chord. Report ok so
      // the hook takes its onCommitted path and the single canonical !registered
      // note ("held by another app") renders, rather than CHORD_IN_USE_MESSAGE
      // ("try another"), which reads as "nothing was applied" — and which a
      // re-opened Settings would then contradict. Summon (no onSetEnabled) keeps
      // the rollback semantics: ok:false there really does mean nothing changed.
      if (onSetEnabled) return { ok: true, registered: !!res?.registered }
      return { ok: !!res?.ok, registered: !!res?.registered }
    },
    onCommitted: (next, result) => {
      setAccel(next)
      setRegistered(result.registered)
      // Committing a binding implicitly re-enables the chord (main persists this).
      setEnabled(true)
      onCommitted?.(next)
    },
    onError: setError
  })

  // Clicking the default preset chip re-binds to the default (unless already there
  // AND enabled — a click while "Off" must still re-enable at the default).
  const selectDefault = async (): Promise<void> => {
    if (enabled && accel === defaultAccel) return
    acted.current = true
    setError(null)
    const res = await commit(defaultAccel)
    if (res?.ok) {
      setAccel(defaultAccel)
      setRegistered(true)
      setEnabled(true)
      onCommitted?.(defaultAccel)
    } else if (onSetEnabled) {
      // Record card: selecting a preset is an enable intent even when the OS can't
      // claim the chord (conflict) — reflect enabled; the !registered branch below
      // surfaces the same "held by another app" note as a fresh load (consistent
      // copy, rather than a second "try another" string for the identical state).
      setAccel(defaultAccel)
      setRegistered(false)
      setEnabled(true)
    } else {
      setError('That shortcut is already in use — try another.')
    }
  }

  // Clicking the "Off" chip fully disables the chord (Record card only).
  const selectOff = async (): Promise<void> => {
    if (!onSetEnabled || !enabled) return
    acted.current = true
    setError(null)
    const res = await onSetEnabled(false)
    setEnabled(res.enabled === true)
    setRegistered(!!res.registered)
  }

  // While off, neither preset appears selected — the "Off" chip owns selection.
  const isDefault = enabled && accel === defaultAccel
  const isCustom = enabled && accel != null && accel !== defaultAccel

  return (
    <SettingRow icon={icon} title={title} subtitle={subtitle} keywords={keywords}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Default preset chip. */}
          <Chip selected={isDefault} onClick={() => void selectDefault()}>
            <Keycaps accel={defaultAccel} />
            <span className="text-white/50">Default</span>
          </Chip>

          {/* Custom chip — shows the current custom chord, or records a new one. */}
          <Chip selected={isCustom} onClick={() => recorder.start()} disabled={recorder.recording}>
            {recorder.recording ? (
              <span className="text-white/60">Press keys… (Esc to cancel)</span>
            ) : isCustom && accel ? (
              <>
                <Keycaps accel={accel} />
                <span className="text-white/50">Custom</span>
              </>
            ) : (
              <span>Custom…</span>
            )}
          </Chip>

          {/* Off chip — Record card only (onSetEnabled provided). Disables the
              chord entirely; the presets stay visible so the user can re-pick. */}
          {onSetEnabled && (
            <Chip selected={!enabled} onClick={() => void selectOff()}>
              <span>Off</span>
            </Chip>
          )}

          <Chip selected={false} onClick={() => void runTest()} disabled={!enabled || !accel || testing}>
            <span>{testing ? 'Testing…' : 'Test'}</span>
          </Chip>
        </div>

        {!enabled ? (
          <p className="text-xs text-white/40">Recording shortcut is off.</p>
        ) : testResult === 'available' && !shortcutDeliveryReliable ? (
          <p className="text-xs text-amber-300">
            Omi can register this chord, but your compositor does not deliver global shortcut
            events to apps. Use the compositor-keybind commands shown above.
          </p>
        ) : testResult === 'available' ? (
          <p className="text-xs text-emerald-300/90">This shortcut is available on your system.</p>
        ) : testResult === 'unavailable' ? (
          <p className="text-xs text-amber-300">
            Another app is using this shortcut — pick a different one.
          </p>
        ) : error || !registered ? (
          <p className="text-xs text-amber-300">
            {error ?? 'This shortcut is held by another app — pick a different one.'}
          </p>
        ) : null}
      </div>
    </SettingRow>
  )
}

/** A selectable chip (Mac's preset/custom chips, Windows chrome). Selected uses a
 *  neutral white ring/tint — never purple (INV-UI-1). */
function Chip(props: {
  selected: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const { selected, onClick, disabled, children } = props
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ' +
        (selected
          ? 'border-white/25 bg-white/[0.08] text-white'
          : 'border-white/10 bg-white/[0.02] text-white/80 hover:bg-white/[0.06]')
      }
    >
      {children}
    </button>
  )
}
