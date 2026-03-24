/**
 * CMS21 Save Editor — pure-JS binary codec
 *
 * Direct port of decode.py. All binary I/O uses DataView / Uint8Array so this
 * runs entirely in the browser with no backend required.
 *
 * Public API
 * ----------
 *   decode(arrayBuffer)                      → save object
 *   encode(save)                             → Uint8Array
 *   parseStats(save)                         → { money, level, xp, skill_points }
 *   parseGarage(save)                        → [{ name, state, raw }]
 *   parseSkills(save)                        → [{ name, purchased, tiers }]
 *   flattenParts(save)                       → [{ sec_idx, part_idx, name, condition, … }]
 *   applyEdits(save, { stats, partEdits,
 *               garageEdits, skillEdits })   → Uint8Array  (ready to download)
 */

// ── Constants ────────────────────────────────────────────────────────────────

const MAGIC = 'PJOOOTER'

const _STANDARD_SIZE = 47
const _BODY_SIZE     = 63
const _RIM_SIZE      = 64

const _BODY_PART_PREFIXES = ['car_', 'window', 'mirror', 'door', 'trunk',
                             'hood', 'taillight', 'bumper', 'fender']
const _RIM_PREFIXES       = ['rim_', 'tire_', 'wheel_']

const _GARAGE_NAMES = [
  'paintshop','scraps','dyno','warehouse','path_test','car_wash',
  'unlock_tablet','unlock_obd','unlock_fuel','unlock_electronic',
  'garage_upgrade','garage_customization','lifter','unlock_cylinder',
  'unlock_tires','brake_lathe','repair_parts','welder','battery',
  'crane','repair_body','bus_upgrade','windowtint',
]

const _utf8dec = new TextDecoder('utf-8')
const _utf8enc = new TextEncoder()

// Byte patterns used for dynamic-offset lookups in the tail section
// \x5c\xfe\xff\xff = last IEEE-754 NaN sentinel; \x00\x00\xf0\x41 = float32(30.0)
const _STATS_ANCHOR   = new Uint8Array([0x5c, 0xfe, 0xff, 0xff, 0x00, 0x00, 0xf0, 0x41])
// uint32(23) + str8 "paintshop"  (23 = number of garage items)
const _GARAGE_NEEDLE  = new Uint8Array([0x17, 0x00, 0x00, 0x00, 0x09,
                                        ..._utf8enc.encode('paintshop')])
// First skill name is always "fast_movement"
const _SKILL_NEEDLE   = _utf8enc.encode('fast_movement')

// ── Low-level utilities ───────────────────────────────────────────────────────

function _bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function _hexToBytes(hex) {
  const arr = new Uint8Array(hex.length >>> 1)
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return arr
}

function _concatBytes(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

/** Find first occurrence of needle in haystack from fromIndex. Returns -1 if absent. */
function _bytesIndexOf(haystack, needle, fromIndex = 0) {
  outer: for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/** Find last occurrence of needle in haystack. Returns -1 if absent. */
function _bytesLastIndexOf(haystack, needle) {
  let result = -1, i = 0
  while (true) {
    const idx = _bytesIndexOf(haystack, needle, i)
    if (idx === -1) break
    result = idx; i = idx + 1
  }
  return result
}

/** Read a length-prefixed UTF-8 string (1-byte length + data). Returns [string, nextPos]. */
function _readStr8(data, pos) {
  const n = data[pos]
  const s = _utf8dec.decode(data.slice(pos + 1, pos + 1 + n))
  return [s, pos + 1 + n]
}

/** Write a length-prefixed UTF-8 string. Returns Uint8Array. */
function _writeStr8(s) {
  const b = _utf8enc.encode(s)
  return _concatBytes([new Uint8Array([b.length]), b])
}

// ── Part name heuristic ───────────────────────────────────────────────────────

function _isValidPartName(s) {
  if (s.length < 3) return false
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) return false          // rejects e.g. 'Standard[#000000]'
  const alpha = [...s].filter(c => /[a-zA-Z]/.test(c))
  if (alpha.length > 0 && alpha.every(c => c === c.toUpperCase())) return false  // rejects 'DGR4D37'
  return true
}

function _findNextEntry(data, start) {
  for (let size = 0; size < Math.min(256, data.length - start); size++) {
    const pos = start + size
    if (pos >= data.length) break
    const n = data[pos]
    if (n >= 2 && n <= 60) {
      const end = pos + 1 + n
      if (end <= data.length) {
        const cand = data.slice(pos + 1, end)
        if (cand.every(b => b >= 32 && b < 127)) {
          if (_isValidPartName(String.fromCharCode(...cand))) return pos
        }
      }
    }
  }
  return -1
}

// ── Block size detection ──────────────────────────────────────────────────────

function _guessBlockSize(name) {
  const low = name.toLowerCase()
  if (_RIM_PREFIXES.some(p => low.startsWith(p)))       return _RIM_SIZE
  if (_BODY_PART_PREFIXES.some(p => low.startsWith(p))) return _BODY_SIZE
  return _STANDARD_SIZE
}

// ── Binary block decode / encode ──────────────────────────────────────────────
//
//  Block field layout (all little-endian):
//   [0..1]   uint16  part_id
//   [2..8]   7 bytes unknown flags
//   [9..12]  float32 condition  (0.0 = broken … 1.0 = perfect)
//   [13..16] float32 quality
//   [17..20] uint32  flag
//   [21..38] 18 bytes unknown
//   [39..42] float32 extra
//   [43..46] 4 bytes tail
//   -- body/rim parts append 16 bytes of RGBA colour --
//   [47..50] float32 paint.r
//   [51..54] float32 paint.g
//   [55..58] float32 paint.b
//   [59..62] float32 paint.a

function _decodeBlock(name, block) {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength)
  const n = block.length
  const entry = { name, _raw: _bytesToHex(block) }

  if (n >= 47) {
    entry.part_id   = view.getUint16(0, true)
    entry.condition = view.getFloat32(9, true)
    entry.quality   = view.getFloat32(13, true)
    entry.flag      = view.getUint32(17, true)
    entry.extra     = view.getFloat32(39, true)
  }
  if (n >= 63) {
    entry.paint = {
      r: view.getFloat32(47, true),
      g: view.getFloat32(51, true),
      b: view.getFloat32(55, true),
      a: view.getFloat32(59, true),
    }
  }
  return entry
}

function _encodeBlock(entry) {
  const block = _hexToBytes(entry._raw)
  const view  = new DataView(block.buffer)

  if (block.length >= 47) {
    if (entry.condition !== undefined) view.setFloat32(9,  entry.condition, true)
    if (entry.quality   !== undefined) view.setFloat32(13, entry.quality,   true)
    if (entry.flag      !== undefined) view.setUint32(17,  entry.flag,      true)
    if (entry.extra     !== undefined) view.setFloat32(39, entry.extra,     true)
  }
  if (block.length >= 63 && entry.paint) {
    view.setFloat32(47, entry.paint.r, true)
    view.setFloat32(51, entry.paint.g, true)
    view.setFloat32(55, entry.paint.b, true)
    view.setFloat32(59, entry.paint.a, true)
  }
  return block
}

// ── Parts section ─────────────────────────────────────────────────────────────

function _parsePartsSection(data, start) {
  let pos = start
  const [sectionName, p1] = _readStr8(data, pos)
  pos = p1

  const view  = new DataView(data.buffer, data.byteOffset)
  const count = view.getUint32(pos, true)
  pos += 4

  const parts = []
  for (let i = 0; i < count; i++) {
    const nameLen = data[pos]
    const name    = _utf8dec.decode(data.slice(pos + 1, pos + 1 + nameLen))
    pos += 1 + nameLen

    const dataStart = pos
    let blockSize

    if (i < count - 1) {
      let guessed  = _guessBlockSize(name)
      const cand   = dataStart + guessed
      let ok = false
      if (cand < data.length) {
        const n = data[cand]
        if (n >= 2 && n <= 60) {
          const end = cand + 1 + n
          if (end <= data.length) {
            const candStr = data.slice(cand + 1, end)
            if (candStr.every(b => b >= 32 && b < 127)) {
              if (_isValidPartName(String.fromCharCode(...candStr))) ok = true
            }
          }
        }
      }
      if (!ok) {
        const nextOff = _findNextEntry(data, dataStart)
        if (nextOff !== -1) guessed = nextOff - dataStart
      }
      blockSize = guessed
    } else {
      blockSize     = _guessBlockSize(name)
      const nextOff = _findNextEntry(data, dataStart + 1)
      if (nextOff !== -1) {
        const candidate = nextOff - dataStart
        if (candidate >= 40 && candidate <= 149) blockSize = candidate
      }
    }

    parts.push(_decodeBlock(name, data.slice(dataStart, dataStart + blockSize)))
    pos = dataStart + blockSize
  }

  return [{ section_name: sectionName, parts }, pos]
}

function _encodePartsSection(section) {
  const chunks = [_writeStr8(section.section_name)]
  const countBuf = new Uint8Array(4)
  new DataView(countBuf.buffer).setUint32(0, section.parts.length, true)
  chunks.push(countBuf)
  for (const p of section.parts) {
    chunks.push(_writeStr8(p.name))
    chunks.push(_encodeBlock(p))
  }
  return _concatBytes(chunks)
}

// ── Header ────────────────────────────────────────────────────────────────────

function _parseHeader(data) {
  const magic = String.fromCharCode(...data.slice(0, 8))
  if (magic !== MAGIC) throw new Error(`Not a valid CMS21 save file (bad magic: ${magic})`)

  const view  = new DataView(data.buffer, data.byteOffset)
  const year  = view.getUint16(8, true)
  const month = data[10]
  const nl    = data[11]
  const name  = _utf8dec.decode(data.slice(12, 12 + nl))
  let pos     = 12 + nl

  const rawStart = pos
  while (pos < data.length && data[pos] !== 0xff) pos++
  while (pos < data.length && data[pos] === 0xff) pos++

  const headerRaw = data.slice(rawStart, pos)

  const hdr = {
    magic,
    save_year:    year,
    save_month:   month,
    profile_name: name,
    version:      _extractVersion(headerRaw),
    _header_raw:  _bytesToHex(headerRaw),
  }
  return [hdr, pos]
}

function _extractVersion(raw) {
  for (let i = 0; i < raw.length - 8; i++) {
    const n = raw[i]
    if (n >= 3 && n <= 16) {
      const b = raw.slice(i + 1, i + 1 + n)
      if (!b.every(x => x >= 32 && x < 127)) continue
      const s = String.fromCharCode(...b)
      const stripped = s.replace(/[wWbB]+$/, '')
      const parts    = stripped.split('.')
      if (parts.length >= 2 && parts.filter(p => p !== '').every(p => /^\d+$/.test(p))) {
        return s
      }
    }
  }
  return ''
}

function _encodeHeader(hdr) {
  const yearBuf = new Uint8Array(2)
  new DataView(yearBuf.buffer).setUint16(0, hdr.save_year, true)
  return _concatBytes([
    new Uint8Array([...MAGIC].map(c => c.charCodeAt(0))),
    yearBuf,
    new Uint8Array([hdr.save_month]),
    _writeStr8(hdr.profile_name),
    _hexToBytes(hdr._header_raw),
  ])
}

// ── Tail-section dynamic-offset helpers ───────────────────────────────────────

function _tailStatsOffset(tail) {
  const idx = _bytesLastIndexOf(tail, _STATS_ANCHOR)
  if (idx === -1) throw new Error('Stats anchor not found — unexpected save format')
  return idx + 17  // anchor(8) + float(4) + float(4) + 1 pad byte
}

function _tailGarageStateOffset(tail) {
  const goff = _bytesIndexOf(tail, _GARAGE_NEEDLE)
  if (goff === -1) throw new Error('Garage section not found in save')
  let pos = goff + 4  // skip count uint32
  for (const name of _GARAGE_NAMES) pos += 1 + name.length
  pos += 4  // skip second count uint32
  return pos
}

function _tailSkillPointsOffset(tail) {
  const goff = _bytesIndexOf(tail, _GARAGE_NEEDLE)
  if (goff === -1) throw new Error('Garage section not found in save')
  return goff - 4
}

function _tailSkillsOffset(tail) {
  const idx = _bytesIndexOf(tail, _SKILL_NEEDLE)
  if (idx === -1) throw new Error('Skills section not found in save')
  return idx - 1 - 4  // back over the name-length byte and the count uint32
}

function _parseTailSkills(tail) {
  const view = new DataView(tail.buffer, tail.byteOffset)
  let pos    = _tailSkillsOffset(tail)
  const count = view.getUint32(pos, true)
  pos += 4

  const names = []
  for (let i = 0; i < count; i++) {
    const [name, next] = _readStr8(tail, pos)
    names.push(name); pos = next
  }
  pos += 4  // skip count2

  return names.map(name => {
    const dataLen = view.getUint32(pos, true)
    const data    = tail.slice(pos + 4, pos + 4 + dataLen)
    pos += 4 + dataLen
    return {
      name,
      purchased: data.length > 0 ? Boolean(data[0]) : false,
      tiers:     data.length > 1 ? Array.from(data.slice(1), Boolean) : [],
    }
  })
}

function _encodeTailSkills(tail, skills) {
  const buf  = new Uint8Array(tail)  // copy
  const view = new DataView(buf.buffer)
  let pos    = _tailSkillsOffset(buf)
  const count = view.getUint32(pos, true)
  pos += 4

  const names = []
  for (let i = 0; i < count; i++) {
    const [name, next] = _readStr8(buf, pos)
    names.push(name); pos = next
  }
  pos += 4  // skip count2

  for (let i = 0; i < names.length; i++) {
    const dataLen = view.getUint32(pos, true)
    const s = i < skills.length ? skills[i] : null
    if (s !== null) {
      const newData = new Uint8Array([s.purchased ? 1 : 0, ...s.tiers.map(t => t ? 1 : 0)])
      const patched = new Uint8Array(dataLen)
      patched.set(newData.slice(0, dataLen))
      buf.set(patched, pos + 4)
    }
    pos += 4 + dataLen
  }
  return buf
}

// ── Public: top-level decode / encode ────────────────────────────────────────

/**
 * Decode a .cms21b ArrayBuffer into a save object.
 * Pass the object (unmodified) to applyEdits or encode.
 */
export function decode(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer)
  const [header, sectionStart] = _parseHeader(data)

  const partsSections = []
  let pos = sectionStart
  if (pos < data.length) {
    const [section, nextPos] = _parsePartsSection(data, pos)
    partsSections.push(section)
    pos = nextPos
  }

  return {
    header,
    parts_sections: partsSections,
    _tail_raw: _bytesToHex(data.slice(pos)),
  }
}

/**
 * Re-encode a (possibly modified) save object into a Uint8Array.
 */
export function encode(save) {
  return _concatBytes([
    _encodeHeader(save.header),
    ...save.parts_sections.map(_encodePartsSection),
    _hexToBytes(save._tail_raw),
  ])
}

// ── Public: derived data (mirrors server.py helpers) ─────────────────────────

export function parseStats(save) {
  const tail = _hexToBytes(save._tail_raw)
  const view = new DataView(tail.buffer)
  const off  = _tailStatsOffset(tail)
  return {
    money:        view.getUint32(off,     true),
    level:        view.getUint32(off + 4, true) + 1,  // stored as level - 1
    xp:           view.getUint32(off + 8, true),
    skill_points: view.getUint32(_tailSkillPointsOffset(tail), true),
  }
}

export function parseGarage(save) {
  const tail = _hexToBytes(save._tail_raw)
  const base = _tailGarageStateOffset(tail)
  return _GARAGE_NAMES.map((name, i) => {
    const off = base + i * 8
    const raw = Array.from(tail.slice(off, off + 8))
    return { name, state: raw[0], raw }
  })
}

export function parseSkills(save) {
  return _parseTailSkills(_hexToBytes(save._tail_raw))
}

export function flattenParts(save) {
  const out = []
  for (let si = 0; si < save.parts_sections.length; si++) {
    const sec = save.parts_sections[si]
    for (let pi = 0; pi < sec.parts.length; pi++) {
      const p = sec.parts[pi]
      out.push({
        sec_idx:       si,
        part_idx:      pi,
        name:          p.name,
        condition:     p.condition ?? null,
        quality:       p.quality   ?? null,
        has_condition: 'condition' in p,
      })
    }
  }
  return out
}

/**
 * Apply a set of edits to a save object and return the binary result.
 *
 * @param {object} save        - The save object from decode()
 * @param {object} edits
 * @param {object} [edits.stats]        - { money, level, xp, skill_points }
 * @param {Array}  [edits.partEdits]    - [{ sec_idx, part_idx, condition }]
 * @param {Array}  [edits.garageEdits]  - [{ idx, state }]
 * @param {Array}  [edits.skillEdits]   - [{ name, purchased, tiers }]
 * @returns {Uint8Array}
 */
export function applyEdits(save, { stats, partEdits = [], garageEdits = [], skillEdits = [] } = {}) {
  save = JSON.parse(JSON.stringify(save))  // deep clone — never mutate the original

  // ── Player stats ────────────────────────────────────────────────────────────
  if (stats) {
    const tail = _hexToBytes(save._tail_raw)
    const view = new DataView(tail.buffer)
    const off  = _tailStatsOffset(tail)
    view.setUint32(off,     stats.money,               true)
    view.setUint32(off + 4, Math.max(0, stats.level - 1), true)
    view.setUint32(off + 8, stats.xp,                  true)
    if (stats.skill_points !== undefined) {
      view.setUint32(_tailSkillPointsOffset(tail), stats.skill_points, true)
    }
    save._tail_raw = _bytesToHex(tail)
  }

  // ── Part conditions ─────────────────────────────────────────────────────────
  for (const edit of partEdits) {
    save.parts_sections[edit.sec_idx].parts[edit.part_idx].condition =
      Math.max(0, Math.min(1, edit.condition))
  }

  // ── Garage state ────────────────────────────────────────────────────────────
  if (garageEdits.length > 0) {
    const tail = _hexToBytes(save._tail_raw)
    const base = _tailGarageStateOffset(tail)
    for (const edit of garageEdits) {
      tail[base + edit.idx * 8] = Math.max(0, Math.min(255, edit.state))
    }
    save._tail_raw = _bytesToHex(tail)
  }

  // ── Skills ──────────────────────────────────────────────────────────────────
  if (skillEdits.length > 0) {
    const tail    = _hexToBytes(save._tail_raw)
    const patched = _encodeTailSkills(tail, skillEdits)
    save._tail_raw = _bytesToHex(patched)
  }

  return encode(save)
}
