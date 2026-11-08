/** Frame-aware Zstandard decoding used by session-log recovery. */
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528

interface Frame { start: number; end: number }

export function scanFrames(buf: Buffer): Frame[] {
  const frames: Frame[] = []
  let offset = 0
  while (offset < buf.length) {
    const start = offset
    if (buf.length - offset < 4) throw new Error('torn frame header')
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`)
    offset += 4
    if (offset === buf.length) throw new Error('torn frame after magic')
    const descriptor = buf.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error('reserved frame-header bit')
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buf.length - offset < remainingHeaderBytes) throw new Error('torn frame header fields')
    offset += remainingHeaderBytes
    for (;;) {
      if (buf.length - offset < 3) throw new Error('torn block header')
      const blockHeader = buf.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error('reserved block type')
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buf.length - offset < payloadBytes) throw new Error('torn block payload')
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buf.length - offset < 4) throw new Error('torn checksum')
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/** Decompress every frame of a multi-frame zstd container. */
export function decompressAllFrames(buf: Buffer): Buffer {
  const frames = scanFrames(buf)
  const parts: Buffer[] = []
  for (const frame of frames) parts.push(zstdDecompressSync(buf.subarray(frame.start, frame.end)))
  return Buffer.concat(parts)
}
