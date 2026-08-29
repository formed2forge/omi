import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildWavHeader,
  PCM_BITS_PER_SAMPLE,
  PCM_CHANNELS,
  PCM_SAMPLE_RATE,
  WAV_HEADER_BYTES,
  WavFileWriter
} from './wavFile'

const tempDirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'omi-wavfile-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('buildWavHeader', () => {
  it('encodes a canonical 44-byte PCM16 mono 16kHz header', () => {
    const header = buildWavHeader(1234)
    expect(header.byteLength).toBe(WAV_HEADER_BYTES)
    expect(header.toString('ascii', 0, 4)).toBe('RIFF')
    expect(header.readUInt32LE(4)).toBe(36 + 1234)
    expect(header.toString('ascii', 8, 12)).toBe('WAVE')
    expect(header.toString('ascii', 12, 16)).toBe('fmt ')
    expect(header.readUInt32LE(16)).toBe(16)
    expect(header.readUInt16LE(20)).toBe(1) // PCM
    expect(header.readUInt16LE(22)).toBe(PCM_CHANNELS)
    expect(header.readUInt32LE(24)).toBe(PCM_SAMPLE_RATE)
    expect(header.readUInt32LE(28)).toBe(
      (PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BITS_PER_SAMPLE) / 8
    )
    expect(header.readUInt16LE(32)).toBe((PCM_CHANNELS * PCM_BITS_PER_SAMPLE) / 8)
    expect(header.readUInt16LE(34)).toBe(PCM_BITS_PER_SAMPLE)
    expect(header.toString('ascii', 36, 40)).toBe('data')
    expect(header.readUInt32LE(40)).toBe(1234)
  })

  it('is pure — same input always yields byte-identical output', () => {
    expect(buildWavHeader(4096)).toEqual(buildWavHeader(4096))
  })
})

describe('WavFileWriter', () => {
  it('writes a well-formed, playable WAV file whose data matches the fed PCM exactly', () => {
    const dir = tempDir()
    const path = join(dir, 'session.wav')
    const writer = new WavFileWriter(path)

    const chunkA = Buffer.from(new Int16Array([1, -1, 32767, -32768]).buffer)
    const chunkB = Buffer.from(new Int16Array([0, 100, -100]).buffer)
    writer.write(chunkA)
    writer.write(chunkB)
    writer.close()

    const onDisk = readFileSync(path)
    const expectedData = Buffer.concat([chunkA, chunkB])
    expect(onDisk.byteLength).toBe(WAV_HEADER_BYTES + expectedData.byteLength)
    // Header reports the REAL final size, not the zero-size placeholder.
    expect(onDisk.readUInt32LE(40)).toBe(expectedData.byteLength)
    expect(onDisk.readUInt32LE(4)).toBe(36 + expectedData.byteLength)
    // The PCM payload round-trips byte-for-byte.
    expect(onDisk.subarray(WAV_HEADER_BYTES)).toEqual(expectedData)
    expect(writer.totalBytes).toBe(onDisk.byteLength)
  })

  it('reserves a well-formed zero-size header immediately on open (crash safety)', () => {
    const dir = tempDir()
    const path = join(dir, 'crash.wav')
    const writer = new WavFileWriter(path)
    writer.write(Buffer.from(new Int16Array([1, 2, 3]).buffer))
    // Never call close() — simulates a process crash mid-recording.
    const onDisk = readFileSync(path)
    expect(onDisk.readUInt32LE(40)).toBe(0) // placeholder, not yet patched
    expect(onDisk.toString('ascii', 0, 4)).toBe('RIFF')
  })

  it('close() is idempotent', () => {
    const dir = tempDir()
    const path = join(dir, 'idempotent.wav')
    const writer = new WavFileWriter(path)
    writer.write(Buffer.from(new Int16Array([7, 8]).buffer))
    writer.close()
    expect(() => writer.close()).not.toThrow()
    // A write after close is silently dropped, not appended.
    writer.write(Buffer.from(new Int16Array([9, 9, 9]).buffer))
    const onDisk = readFileSync(path)
    expect(onDisk.byteLength).toBe(WAV_HEADER_BYTES + 4)
  })
})
