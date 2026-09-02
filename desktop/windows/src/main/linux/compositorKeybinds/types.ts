export const OMI_MANAGED_BEGIN = '// BEGIN OMI MANAGED SHORTCUTS — written by Omi; safe to replace'
export const OMI_MANAGED_END = '// END OMI MANAGED SHORTCUTS'

export type NiriBindAction = 'summon' | 'record-mic' | 'other'

export type NiriBindHit = {
  chord: string
  normalizedChord: string
  filePath: string
  line: string
  action: NiriBindAction
  /** True when the bind sits inside an Omi managed block. */
  inManagedBlock: boolean
}

export type NiriConfigFile = {
  path: string
  text: string
}

export type NiriScanResult = {
  primaryPath: string
  files: NiriConfigFile[]
  /** Include paths that could not be read. */
  unreadableIncludes: string[]
  /** True when every include resolved successfully. */
  scanComplete: boolean
  binds: NiriBindHit[]
  managedBlockFile: string | null
}

export type NiriChordPlan = {
  electronAccelerator: string
  niriChord: string
  action: 'summon' | 'record-mic'
}

export type NiriChordDecision =
  | { status: 'omi-installed'; hit: NiriBindHit }
  | { status: 'chord-free' }
  | { status: 'chord-conflict'; hit: NiriBindHit }
  | { status: 'omi-stale'; hit: NiriBindHit }
