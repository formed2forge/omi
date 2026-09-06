/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public share origin for conversation links (#4339). Default https://h.omi.me */
  readonly VITE_OMI_SHARE_BASE_URL?: string
  /** Explicit local-dev gate. 'local_dev' shows the "Sign In (Developer)" control
   *  on Login and connects the Firebase Auth instance to the local emulator
   *  (lib/firebase.ts). Any other value (including unset) — the normal/production
   *  case — never shows it. See shared/environmentProfile.ts. */
  readonly VITE_OMI_APP_PROFILE?: string
  /** Firebase Auth emulator host, required (with the port below) when
   *  VITE_OMI_APP_PROFILE=local_dev — e.g. the Mac harness's LAN/Tailscale
   *  address. Ignored outside local_dev. */
  readonly VITE_FIREBASE_AUTH_EMULATOR_HOST?: string
  /** Firebase Auth emulator port, required alongside the host above. */
  readonly VITE_FIREBASE_AUTH_EMULATOR_PORT?: string
}
