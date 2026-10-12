// 極簡 TrueType 字型讀取與子集化（只把 PDF 用到的字嵌進去，檔案才會小）

export class TrueTypeFont {
  constructor(buffer) {
    this.buf = buffer;
    this.dv = new DataView(buffer);
    this.tables = {};
    const numTables = this.dv.getUint16(4);
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      const tag = String.fromCharCode(...new Uint8Array(buffer, o, 4));
      this.tables[tag] = { offset: this.dv.getUint32(o + 8), length: this.dv.getUint32(o + 12) };
    }
    const head = this.tables.head.offset;
    this.unitsPerEm = this.dv.getUint16(head + 18);
    this.bbox = [0, 2, 4, 6].map(k => this.dv.getInt16(head + 36 + k));
    this.indexToLocFormat = this.dv.getInt16(head + 50);
    const hhea = this.tables.hhea.offset;
    this.ascender = this.dv.getInt16(hhea + 4);
    this.descender = this.dv.getInt16(hhea + 6);
    this.numHMetrics = this.dv.getUint16(hhea + 34);
    this.numGlyphs = this.dv.getUint16(this.tables.maxp.offset + 4);
    this.cmap = this.parseCmap();
    this.advanceCache = new Map();
  }

  parseCmap() {
    const dv = this.dv, base = this.tables.cmap.offset;
    const n = dv.getUint16(base + 2);
    let best = null;
    for (let i = 0; i < n; i++) {
      const pid = dv.getUint16(base + 4 + i * 8), eid = dv.getUint16(base + 6 + i * 8);
      const off = base + dv.getUint32(base + 8 + i * 8);
      const fmt = dv.getUint16(off);
      if (pid === 3 && eid === 10 && fmt === 12) { best = { off, fmt }; break; }
      if (pid === 3 && eid === 1 && fmt === 4 && !best) best = { off, fmt };
      if (pid === 0 && (fmt === 4 || fmt === 12) && !best) best = { off, fmt };
    }
    const map = new Map();
    if (!best) return map;
    const { off, fmt } = best;
    if (fmt === 12) {
      const groups = dv.getUint32(off + 12);
      for (let g = 0; g < groups; g++) {
        const p = off + 16 + g * 12;
        const start = dv.getUint32(p), end = dv.getUint32(p + 4), gid = dv.getUint32(p + 8);
        for (let c = start; c <= end; c++) map.set(c, gid + (c - start));
      }
    } else {
      const segX2 = dv.getUint16(off + 6);
      const ends = off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, rangeOffs = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = dv.getUint16(ends + s * 2), start = dv.getUint16(starts + s * 2);
        const delta = dv.getInt16(deltas + s * 2), ro = dv.getUint16(rangeOffs + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let gid;
          if (ro === 0) gid = (c + delta) & 0xffff;
          else {
            const gi = dv.getUint16(rangeOffs + s * 2 + ro + (c - start) * 2);
            gid = gi === 0 ? 0 : (gi + delta) & 0xffff;
          }
          if (gid) map.set(c, gid);
        }
      }
    }
    return map;
  }

  glyphId(codePoint) { return this.cmap.get(codePoint) || 0; }
  hasGlyph(codePoint) { return this.cmap.has(codePoint); }

  /** 字寬（以 1000 為一個字身） */
  advance(gid) {
    let w = this.advanceCache.get(gid);
    if (w !== undefined) return w;
    const h = this.tables.hmtx.offset;
    const raw = gid < this.numHMetrics ? this.dv.getUint16(h + gid * 4) : this.dv.getUint16(h + (this.numHMetrics - 1) * 4);
    w = Math.round(raw * 1000 / this.unitsPerEm);
    this.advanceCache.set(gid, w);
    return w;
  }

  glyphRange(gid) {
    const loca = this.tables.loca.offset;
    if (this.indexToLocFormat === 0) return [this.dv.getUint16(loca + gid * 2) * 2, this.dv.getUint16(loca + gid * 2 + 2) * 2];
    return [this.dv.getUint32(loca + gid * 4), this.dv.getUint32(loca + gid * 4 + 4)];
  }

  /** 保留原本的字形編號，只留下用到的字形外框，其餘清空 */
  subset(usedGids) {
    const glyfBase = this.tables.glyf.offset;
    const keep = new Set([0, ...usedGids]);
    // 複合字形：把引用到的字形也加進來
    const queue = [...keep];
    while (queue.length) {
      const gid = queue.pop();
      const [s, e] = this.glyphRange(gid);
      if (e <= s) continue;
      const p = glyfBase + s;
      if (this.dv.getInt16(p) >= 0) continue;
      let q = p + 10, flags;
      do {
        flags = this.dv.getUint16(q);
        const comp = this.dv.getUint16(q + 2);
        if (!keep.has(comp)) { keep.add(comp); queue.push(comp); }
        q += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
      } while (flags & 0x20);
    }

    const pieces = [];
    const loca = new Uint32Array(this.numGlyphs + 1);
    let pos = 0;
    for (let gid = 0; gid < this.numGlyphs; gid++) {
      loca[gid] = pos;
      if (!keep.has(gid)) continue;
      const [s, e] = this.glyphRange(gid);
      if (e > s) {
        const bytes = new Uint8Array(this.buf, glyfBase + s, e - s);
        pieces.push(bytes);
        pos += bytes.length;
        if (pos % 4) { const pad = 4 - (pos % 4); pieces.push(new Uint8Array(pad)); pos += pad; }
      }
    }
    loca[this.numGlyphs] = pos;
    const glyf = new Uint8Array(pos);
    let o = 0; for (const p of pieces) { glyf.set(p, o); o += p.length; }
    const locaBytes = new Uint8Array((this.numGlyphs + 1) * 4);
    const ldv = new DataView(locaBytes.buffer);
    loca.forEach((v, i) => ldv.setUint32(i * 4, v));

    const out = {};
    for (const tag of ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'prep']) {
      const t = this.tables[tag];
      if (t) out[tag] = new Uint8Array(this.buf.slice(t.offset, t.offset + t.length));
    }
    out.head = out.head.slice();
    new DataView(out.head.buffer).setInt16(50, 1); // loca 長格式
    new DataView(out.head.buffer).setUint32(8, 0); // checkSumAdjustment
    out.glyf = glyf;
    out.loca = locaBytes;
    return assemble(out);
  }
}

function checksum(bytes) {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  const dv = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + dv.getUint32(i)) >>> 0;
  return sum;
}

function assemble(tables) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  let entrySelector = 0; while ((1 << (entrySelector + 1)) <= n) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  let offset = 12 + n * 16;
  const layout = tags.map(tag => {
    const data = tables[tag];
    const entry = { tag, data, offset, length: data.length };
    offset += Math.ceil(data.length / 4) * 4;
    return entry;
  });
  const out = new Uint8Array(offset);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x00010000);
  dv.setUint16(4, n); dv.setUint16(6, searchRange); dv.setUint16(8, entrySelector); dv.setUint16(10, n * 16 - searchRange);
  layout.forEach((e, i) => {
    const p = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[p + k] = e.tag.charCodeAt(k);
    dv.setUint32(p + 4, checksum(e.data));
    dv.setUint32(p + 8, e.offset);
    dv.setUint32(p + 12, e.length);
    out.set(e.data, e.offset);
  });
  const headEntry = layout.find(e => e.tag === 'head');
  dv.setUint32(headEntry.offset + 8, (0xB1B0AFBA - checksum(out)) >>> 0);
  return out;
}
