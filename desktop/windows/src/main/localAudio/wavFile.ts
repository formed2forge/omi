// Minimal WAV (RIFF/PCM) container for the locally-persisted raw audio capture.
// The capture pipeline already produces 16kHz mono Int16 PCM
// (renderer/src/lib/capture/captureEngine.ts) and the exact same bytes are sent
// over the omi-listen:feed IPC channel to the cloud STT lane — so writing a
// standard PCM WAV file needs zero re-encoding, just a 44-byte header around the
// raw bytes. WAV (vs. a bespoke framed container) was chosen specifically so the
// files are directly playable in any media player without a custom decoder.
import { closeSync, openSync, writeSync } from 'fs'

export const WAV_HEADER_BYTES = 44
export const PCM_SAMPLE_RATE = 16000
export const PCM_CHANNELS = 1
export const PCM_BITS_PER_SAMPLE = 16

/** Build a canonical 44-byte PCM WAV header for `dataBytes` of 16kHz mono
 *  Int16 PCM. Pure — safe to call twice (once with 0 to reserve space, again
 *  with the final size to patch it) without touching a filesystem. */
export function buildWavHeader(dataBytes: number): Buffer {
  const byteRate = (PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BITS_PER_SAMPLE) / 8
  const blockAlign = (PCM_CHANNELS * PCM_BITS_PER_SAMPLE) / 8
  const header = Buffer.alloc(WAV_HEADER_BYTES)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4) // RIFF chunk size = everything after this field
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt subchunk size (PCM)
  header.writeUInt16LE(1, 20) // audio format = 1 (PCM, uncompressed)
  header.writeUInt16LE(PCM_CHANNELS, 22)
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}

/**
 * Streams PCM16 chunks to a WAV file on disk. The final data size isn't known
 * until the recording stops, so the header is written twice: a zero-size
 * placeholder at open (so the file is well-formed even if the process dies
 * mid-recording — most players still read the audio, just not the tagged
 * length) and the real size patched in at `close()`.
 *
 * Synchronous fs calls, matching this codebase's other main-process durable-write
 * paths (appSettings.ts, better-sqlite3) — chunk writes are small (one capture
 * frame, a few KB) and infrequent enough that sync I/O doesn't block the event
 * loop meaningfully, and sync keeps write/close ordering trivially correct
 * without a promise chain per chunk.
 */
export class WavFileWriter {
  private readonly fd: number
  private bytesWritten = 0
  private closed = false

  constructor(readonly path: string) {
    this.fd = openSync(path, 'w')
    writeSync(this.fd, buildWavHeader(0), 0, WAV_HEADER_BYTES, 0)
  }

  /** Append one chunk of PCM16 bytes. No-op after close().
   *
   *  Every write (including the header ones) passes an EXPLICIT position —
   *  writeSync's positional form is a pwrite and does not advance the fd's
   *  implicit read/write cursor, so an unpositioned write() after the
   *  constructor's positional header write would land back at offset 0 and
   *  clobber the header instead of appending. Tracking bytesWritten and always
   *  positioning explicitly sidesteps that entirely. */
  write(chunk: Buffer): void {
    if (this.closed) return
    writeSync(this.fd, chunk, 0, chunk.byteLength, WAV_HEADER_BYTES + this.bytesWritten)
    this.bytesWritten += chunk.byteLength
  }

  /** Patch the header with the real data size and close the fd. Idempotent —
   *  safe to call more than once (e.g. from two teardown paths racing). */
  close(): void {
    if (this.closed) return
    this.closed = true
    const header = buildWavHeader(this.bytesWritten)
    writeSync(this.fd, header, 0, WAV_HEADER_BYTES, 0)
    closeSync(this.fd)
  }

  /** Total on-disk size once closed (header + PCM payload). */
  get totalBytes(): number {
    return WAV_HEADER_BYTES + this.bytesWritten
  }
}
