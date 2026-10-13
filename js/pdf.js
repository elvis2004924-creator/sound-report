// 聲音報表 PDF（由 PDFManager.swift 移植）
// 版面座標與原版相同：A4 橫式 842 × 595 pt，每頁 25 行。
// 文字是真正的文字（可選取、可搜尋），字型為內嵌的黑體（思源黑體子集），
// 表格線與灰底是向量圖形。全部在手機上完成，不需要網路。

import { paginate, allContexts, pdfRowCells, ROWS_PER_PAGE, APP_VERSION } from './logic.js';
import { TrueTypeFont } from './ttf.js';

const PAGE_W = 842, PAGE_H = 595;
const TABLE_LEFT = 35, TABLE_TOP = 130, TABLE_BOTTOM = 550, TABLE_W = 772;
const COL_WIDTHS = [35, 25, 25, 25, 28, 30, 30, 30, 30, 30, 30, 30, 30, 218, 176];
const COL_NAMES = ['流水號', '場', '鏡', '次', 'Size', 'Tr1', 'Tr2', 'Tr3', 'Tr4', 'Tr5', 'Tr6', 'Tr7', 'Tr8', '內容', '備註'];
const HEADER_GRAY = 0xb7 / 255;
const ZEBRA_GRAY = 0xef / 255;
const ASCENT = 0.96; // 文字上緣到基線的比例（對齊原版 UIKit 的 draw(at:)）

const FONT_URLS = { regular: 'fonts/SoundReportHei-Regular.ttf', bold: 'fonts/SoundReportHei-Bold.ttf' };
const LOGO_URL = 'icons/logo.png';
const LOGO_H = 30; // LOGO 高度（pt）
let fontsPromise = null;
let logoPromise = null;

/** 載入 LOGO，拆成灰階與透明度兩張圖給 PDF 用 */
function loadLogo() {
  if (!logoPromise) {
    logoPromise = (async () => {
      const blob = await (await fetch(LOGO_URL)).blob();
      const url = URL.createObjectURL(blob);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const gray = new Uint8Array(c.width * c.height), alpha = new Uint8Array(c.width * c.height);
      for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
        gray[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
        alpha[j] = d[i + 3];
      }
      return { img, url, width: c.width, height: c.height, gray, alpha };
    })().catch(e => { logoPromise = null; console.warn('LOGO 載入失敗', e); return null; });
  }
  return logoPromise;
}

/** 載入字型（第一次之後會留在記憶體，離線時從快取讀取） */
export function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all(Object.entries(FONT_URLS).map(async ([key, url]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`字型載入失敗（${res.status}）`);
      const buf = await res.arrayBuffer();
      return [key, { ttf: new TrueTypeFont(buf), buffer: buf }];
    })).then(Object.fromEntries).catch(e => { fontsPromise = null; throw e; });
  }
  return fontsPromise;
}

// MARK: - 排版：把每一頁轉成「畫線、填色、寫字」的指令

class Layout {
  constructor(fonts, logo) {
    this.fonts = fonts;
    this.logo = logo;
    this.ops = [];
  }
  font(bold) {
    // 粗體字型只含固定的標題字；其他字一律用標準字重
    return bold ? this.fonts.bold.ttf : this.fonts.regular.ttf;
  }
  pick(ch, bold) {
    const cp = ch.codePointAt(0);
    if (bold && this.fonts.bold.ttf.hasGlyph(cp)) return { key: 'bold', ttf: this.fonts.bold.ttf };
    return { key: 'regular', ttf: this.fonts.regular.ttf };
  }
  width(text, size, bold = false) {
    let w = 0;
    for (const ch of text) { const { ttf } = this.pick(ch, bold); w += ttf.advance(ttf.glyphId(ch.codePointAt(0))); }
    return w * size / 1000;
  }
  fit(text, maxWidth, size) {
    if (!text) return '';
    if (this.width(text, size) <= maxWidth) return text;
    const chars = [...text];
    let lo = 0, hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.width(chars.slice(0, mid).join('') + '…', size) <= maxWidth) lo = mid; else hi = mid - 1;
    }
    return chars.slice(0, lo).join('') + '…';
  }
  /** 以文字上緣為準寫字（與原版 draw(at:) 相同） */
  text(text, x, yTop, size, bold = false, gray = 0) {
    if (!text) return;
    // 同一串字可能混用兩種字型，依字型切段
    let run = '', runKey = null, cx = x;
    const flush = () => {
      if (!run) return;
      this.ops.push({ t: 'text', text: run, x: cx, y: yTop + size * ASCENT, size, font: runKey, gray });
      cx += this.width(run, size, runKey === 'bold');
      run = '';
    };
    for (const ch of text) {
      const { key } = this.pick(ch, bold);
      if (key !== runKey) { flush(); runKey = key; }
      run += ch;
    }
    flush();
  }
  rect(x, y, w, h, gray) { this.ops.push({ t: 'rect', x, y, w, h, gray }); }
  image(x, y, w, h) { this.ops.push({ t: 'image', x, y, w, h }); }
  line(x1, y1, x2, y2) { this.ops.push({ t: 'line', x1, y1, x2, y2 }); }
}

function layoutPage(L, info, page, allRecords, contexts) {
  const rowH = (TABLE_BOTTOM - TABLE_TOP) / (ROWS_PER_PAGE + 1);

  // LOGO 放在「聲音報表」前面
  let titleX = TABLE_LEFT;
  if (L.logo) {
    const w = LOGO_H * L.logo.width / L.logo.height;
    L.image(TABLE_LEFT, 21, w, LOGO_H);
    titleX = TABLE_LEFT + w + 7;
  }
  L.text('聲音報表', titleX, 25, 22, true);
  const pageLabel = `Page ${page.pageNumber}`;
  L.text(pageLabel, TABLE_LEFT + TABLE_W - L.width(pageLabel, 8, true), 25, 8, true);

  const hY = [60, 80, 100], hX = [40, 300, 580];
  const headerData = [
    [['片名:', info.title], ['日期:', page.date], ['頁碼:', String(page.pageNumber)]],
    [['導演:', info.director], ['錄音:', page.mixer], ['地點:', page.location]],
    [['製片:', info.producer], ['收音:', page.boom], ['SD (Folder):', page.sdFolder]],
  ];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const [label, value] = headerData[r][c];
    L.text(label, hX[c], hY[r], 8, true);
    L.text(' ' + (value || ''), hX[c] + L.width(label, 8, true), hY[r], 8);
  }

  // 表頭灰底與隔行灰底
  L.rect(TABLE_LEFT, TABLE_TOP, TABLE_W, rowH, HEADER_GRAY);
  for (let i = 0; i < page.records.length; i++) {
    if (i % 2 === 1) L.rect(TABLE_LEFT, TABLE_TOP + (i + 1) * rowH, TABLE_W, rowH, ZEBRA_GRAY);
  }

  // 表頭文字（置中）
  let x = TABLE_LEFT;
  COL_WIDTHS.forEach((w, i) => {
    const name = COL_NAMES[i];
    L.text(name, x + (w - L.width(name, 8, true)) / 2, TABLE_TOP + (rowH - 12) / 2, 8, true);
    x += w;
  });

  // 資料列
  page.records.forEach((record, rowIndex) => {
    const globalIndex = page.globalStartIndex + rowIndex;
    const cells = pdfRowCells(record, globalIndex, allRecords, rowIndex === 0, contexts);
    const y = TABLE_TOP + (rowIndex + 1) * rowH + (rowH - 12) / 2;
    let cx = TABLE_LEFT;
    cells.forEach((text, col) => {
      const w = COL_WIDTHS[col];
      const t = L.fit(text, w - 4, 8);
      if (col < 13) L.text(t, cx + (w - L.width(t, 8)) / 2, y, 8);
      else L.text(t, cx + 2, y, 8);
      cx += w;
    });
  });

  // 表格線
  for (let i = 0; i <= ROWS_PER_PAGE + 1; i++) {
    const yy = TABLE_TOP + i * rowH;
    L.line(TABLE_LEFT, yy, TABLE_LEFT + TABLE_W, yy);
  }
  L.line(TABLE_LEFT, TABLE_TOP, TABLE_LEFT, TABLE_BOTTOM);
  x = TABLE_LEFT;
  COL_WIDTHS.forEach((w, i) => {
    x += w;
    if (i === 4) { // Size 欄右邊畫雙線
      L.line(x - 1, TABLE_TOP, x - 1, TABLE_BOTTOM);
      L.line(x + 1, TABLE_TOP, x + 1, TABLE_BOTTOM);
    } else L.line(x, TABLE_TOP, x, TABLE_BOTTOM);
  });
  L.line(TABLE_LEFT + TABLE_W, TABLE_TOP, TABLE_LEFT + TABLE_W, TABLE_BOTTOM);

  // 右下角：製作簽名、LOGO 設計者；左下角：版本號
  ['Made by zwJiang', 'LOGO design by T'].forEach((s, i) => {
    L.text(s, TABLE_LEFT + TABLE_W - L.width(s, 6), TABLE_BOTTOM + 7 + i * 8, 6, false, 0.45);
  });
  L.text(`江哲維工作室 v${APP_VERSION}`, TABLE_LEFT, TABLE_BOTTOM + 7, 6, false, 0.45);
}

function layoutEmptyPage(L, info) {
  L.text('尚無 Take 紀錄', 40, 40, 18, true);
  L.text(`片名: ${info.title}`, 40, 70, 18, true);
}

// MARK: - 產生 PDF 與預覽

/**
 * @returns {Promise<{ blob: Blob, previews: string[], pageCount: number }>}
 */
export async function generateSoundReport(project, onProgress) {
  const [fonts, logo] = await Promise.all([loadFonts(), loadLogo()]);
  const info = project.info;
  const records = project.takes;
  const pages = paginate(records);
  const contexts = allContexts(records);

  const pageOps = [];
  const total = Math.max(pages.length, 1);
  for (let i = 0; i < total; i++) {
    const L = new Layout(fonts, logo);
    if (pages.length) layoutPage(L, info, pages[i], records, contexts);
    else layoutEmptyPage(L, info);
    pageOps.push(L.ops);
  }

  const title = info.title ? `${info.title} 聲音報表` : '聲音報表';
  const blob = await buildPDF(pageOps, fonts, logo, { title, creator: 'SoundReport App', author: 'Sound Department' });

  // 預覽圖：用同一套排版指令與同一套字型畫出來，所見即所得
  const previews = [];
  await registerPreviewFonts(fonts);
  previewLogo = logo?.img || null;
  const scale = 1.5;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PAGE_W * scale);
  canvas.height = Math.round(PAGE_H * scale);
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < pageOps.length; i++) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawOpsToCanvas(ctx, pageOps[i]);
    previews.push(URL.createObjectURL(await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88))));
    onProgress?.(i + 1, pageOps.length);
    if (i % 3 === 2) await new Promise(r => setTimeout(r, 0));
  }
  const previewWidthPx = canvas.width;
  canvas.width = canvas.height = 0;

  /** 放大時用：依需要的像素寬度重新畫一頁（最寬 4096px，避免手機記憶體不足） */
  const renderPreview = async (i, pxWidth) => {
    const w = Math.min(4096, Math.max(400, Math.round(pxWidth)));
    const s = w / PAGE_W;
    const c = document.createElement('canvas');
    c.width = w; c.height = Math.round(PAGE_H * s);
    const x = c.getContext('2d');
    x.setTransform(s, 0, 0, s, 0, 0);
    drawOpsToCanvas(x, pageOps[i]);
    const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    c.width = c.height = 0;
    return URL.createObjectURL(out);
  };
  return { blob, previews, pageCount: total, previewWidth: previewWidthPx, renderPreview };
}

let previewFontsReady = null;
function registerPreviewFonts(fonts) {
  if (!previewFontsReady) {
    previewFontsReady = Promise.all([
      new FontFace('SRHei', fonts.regular.buffer).load(),
      new FontFace('SRHeiBold', fonts.bold.buffer).load(),
    ]).then(faces => faces.forEach(f => document.fonts.add(f))).catch(e => { previewFontsReady = null; throw e; });
  }
  return previewFontsReady;
}

let previewLogo = null;
function drawOpsToCanvas(ctx, ops) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const op of ops) {
    if (op.t === 'image' && previewLogo) ctx.drawImage(previewLogo, op.x, op.y, op.w, op.h);
    if (op.t === 'rect') {
      const g = Math.round(op.gray * 255);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(op.x, op.y, op.w, op.h);
    }
  }
  ctx.fillStyle = '#000';
  for (const op of ops) {
    if (op.t === 'text') {
      ctx.font = `${op.size}px ${op.font === 'bold' ? 'SRHeiBold' : 'SRHei'}`;
      const g = Math.round((op.gray || 0) * 255);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillText(op.text, op.x, op.y);
    }
  }
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const op of ops) {
    if (op.t === 'line') { ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2, op.y2); }
  }
  ctx.stroke();
}

// MARK: - PDF 寫入器

const enc = new TextEncoder();
const n2 = v => (Math.round(v * 1000) / 1000).toString();

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

function pdfTextString(s) {
  let hex = 'FEFF';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += cp.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}

function pdfDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `(D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}'${p(Math.abs(off) % 60)}')`;
}

function utf16hex(str) {
  let hex = '';
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += cp.toString(16).padStart(4, '0');
  }
  return hex.toUpperCase();
}

function randomTag() {
  let s = '';
  for (let i = 0; i < 6; i++) s += String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return s;
}

async function buildPDF(pageOps, fonts, logo, meta) {
  // 1. 收集每個字型用到的字形
  const used = { regular: new Map(), bold: new Map() }; // gid -> unicode 字元
  for (const ops of pageOps) for (const op of ops) {
    if (op.t !== 'text') continue;
    const ttf = fonts[op.font].ttf;
    for (const ch of op.text) {
      const gid = ttf.glyphId(ch.codePointAt(0));
      if (gid && !used[op.font].has(gid)) used[op.font].set(gid, ch);
    }
  }
  const fontKeys = ['regular', 'bold'].filter(k => used[k].size || k === 'regular');

  // 2. 物件編號
  let nextObj = 1;
  const alloc = () => nextObj++;
  const catalogId = alloc(), pagesId = alloc(), infoId = alloc();
  const fontObjs = {};
  for (const k of fontKeys) {
    fontObjs[k] = { type0: alloc(), cid: alloc(), desc: alloc(), file: alloc(), toUni: alloc(), name: k === 'bold' ? 'F2' : 'F1' };
  }
  const pageObjs = pageOps.map(() => ({ page: alloc(), content: alloc() }));
  const hasLogo = !!logo && pageOps.some(ops => ops.some(op => op.t === 'image'));
  const logoObj = hasLogo ? { img: alloc(), mask: alloc() } : null;

  const objects = new Map(); // id -> Uint8Array[]
  const put = (id, ...parts) => objects.set(id, parts.map(p => (typeof p === 'string' ? enc.encode(p) : p)));
  const putStream = async (id, dict, bytes, extra = '') => {
    const z = await deflate(bytes);
    const data = z || bytes;
    put(id, `<< ${dict} /Length ${data.length}${z ? ' /Filter /FlateDecode' : ''}${extra} >>\nstream\n`, data, '\nendstream');
  };

  put(catalogId, '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
  put(pagesId, `<< /Type /Pages /Count ${pageOps.length} /Kids [${pageObjs.map(p => `${p.page} 0 R`).join(' ')}] >>`);
  put(infoId, `<< /Title ${pdfTextString(meta.title)} /Creator ${pdfTextString(meta.creator)} /Author ${pdfTextString(meta.author)} /Producer (SoundReport Web) /CreationDate ${pdfDate()} >>`);

  // 3. 字型（Type0 + CIDFontType2，Identity-H，含 ToUnicode 讓文字可搜尋）
  for (const k of fontKeys) {
    const o = fontObjs[k];
    const ttf = fonts[k].ttf;
    const baseName = `${randomTag()}+SoundReportHei-${k === 'bold' ? 'Bold' : 'Regular'}`;
    const gids = [...used[k].keys()].sort((a, b) => a - b);

    put(o.type0, `<< /Type /Font /Subtype /Type0 /BaseFont /${baseName} /Encoding /Identity-H /DescendantFonts [${o.cid} 0 R] /ToUnicode ${o.toUni} 0 R >>`);
    const w = gids.map(g => `${g} [${ttf.advance(g)}]`).join(' ');
    put(o.cid, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${o.desc} 0 R /DW 1000 /W [${w}] /CIDToGIDMap /Identity >>`);
    const s = 1000 / ttf.unitsPerEm;
    const bbox = ttf.bbox.map(v => Math.round(v * s)).join(' ');
    put(o.desc, `<< /Type /FontDescriptor /FontName /${baseName} /Flags 4 /FontBBox [${bbox}] /ItalicAngle 0 /Ascent ${Math.round(ttf.ascender * s)} /Descent ${Math.round(ttf.descender * s)} /CapHeight 733 /StemV ${k === 'bold' ? 140 : 80} /FontFile2 ${o.file} 0 R >>`);
    const sub = ttf.subset(gids);
    await putStream(o.file, '', sub, ` /Length1 ${sub.length}`);

    let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (let i = 0; i < gids.length; i += 100) {
      const chunk = gids.slice(i, i + 100);
      cmap += `${chunk.length} beginbfchar\n${chunk.map(g => `<${g.toString(16).padStart(4, '0').toUpperCase()}> <${utf16hex(used[k].get(g))}>`).join('\n')}\nendbfchar\n`;
    }
    cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    await putStream(o.toUni, '', enc.encode(cmap));
  }
  const fontRes = fontKeys.map(k => `/${fontObjs[k].name} ${fontObjs[k].type0} 0 R`).join(' ');
  if (logoObj) {
    const dims = `/Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceGray /BitsPerComponent 8`;
    await putStream(logoObj.mask, dims, logo.alpha);
    await putStream(logoObj.img, `${dims} /SMask ${logoObj.mask} 0 R`, logo.gray);
  }
  const xobjRes = logoObj ? ` /XObject << /Logo ${logoObj.img} 0 R >>` : '';

  // 4. 每一頁的內容
  for (let i = 0; i < pageOps.length; i++) {
    const ops = pageOps[i];
    const lines = [];
    for (const op of ops) if (op.t === 'image' && logoObj) lines.push(`q ${n2(op.w)} 0 0 ${n2(op.h)} ${n2(op.x)} ${n2(PAGE_H - op.y - op.h)} cm /Logo Do Q`);
    for (const op of ops) if (op.t === 'rect') lines.push(`${n2(op.gray)} g ${n2(op.x)} ${n2(PAGE_H - op.y - op.h)} ${n2(op.w)} ${n2(op.h)} re f`);
    lines.push('0 g');
    for (const op of ops) {
      if (op.t !== 'text') continue;
      const ttf = fonts[op.font].ttf;
      let hex = '';
      for (const ch of op.text) hex += ttf.glyphId(ch.codePointAt(0)).toString(16).padStart(4, '0');
      lines.push(`${n2(op.gray || 0)} g`);
      lines.push(`BT /${fontObjs[op.font].name} ${n2(op.size)} Tf 1 0 0 1 ${n2(op.x)} ${n2(PAGE_H - op.y)} Tm <${hex.toUpperCase()}> Tj ET`);
    }
    lines.push('0 G 1 w 0 J');
    for (const op of ops) if (op.t === 'line') lines.push(`${n2(op.x1)} ${n2(PAGE_H - op.y1)} m ${n2(op.x2)} ${n2(PAGE_H - op.y2)} l S`);
    const p = pageObjs[i];
    put(p.page, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << ${fontRes} >>${xobjRes} >> /Contents ${p.content} 0 R >>`);
    await putStream(p.content, '', enc.encode(lines.join('\n')));
  }

  // 5. 組合檔案
  const chunks = [];
  let pos = 0;
  const push = b => { const bytes = typeof b === 'string' ? enc.encode(b) : b; chunks.push(bytes); pos += bytes.length; };
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const offsets = [];
  const total = nextObj - 1;
  for (let id = 1; id <= total; id++) {
    offsets[id] = pos;
    push(`${id} 0 obj\n`);
    for (const part of objects.get(id)) push(part);
    push('\nendobj\n');
  }
  const xrefPos = pos;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= total; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${total + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
