/*
 * Export trang PDF → WebP cho assets/flashcard/<set>/
 * ------------------------------------------------------------------
 * PDF chỉ là source file: raster hoá TRƯỚC khi chạy app, không dùng
 * PDF.js ở runtime.
 *
 * Cách chạy: dán script này vào một trang trắng có pdf.js (hoặc chạy
 * trong môi trường có sẵn helper readFileBinary/saveFile của project).
 * Chạy lại cho từng bộ và từng khoảng trang (mỗi lượt ~6 trang để
 * tránh timeout).
 *
 *   SET   = 'm1' | 'm2' | 'm3' | 'm4'
 *   FIRST / LAST = khoảng trang PDF (1-based)
 *
 * Quy ước trang: 1 = bìa, 2 = mục lục, 3+4 = thẻ 1, 5+6 = thẻ 2 …
 * Orientation đọc từ chính viewport của trang, nên bộ trộn khổ vẫn đúng.
 */

const SET = 'm1';
const FIRST = 1;
const LAST = 6;

const WIDTHS = {
  cover: 640,          // → cover-lg.webp, downscale 320 → cover.webp
  coverThumb: 320,
  portrait: { large: 1024, small: 640 },
  landscape: { large: 1600, small: 960 }
};
const QUALITY = 0.8;

// pdf.js dùng requestAnimationFrame để chia chunk render; trong tab ẩn
// rAF không chạy → thay bằng setTimeout để render không bị treo.
window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);

const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

const bytes = new Uint8Array(await (await readFileBinary(`src-pdf/${SET}.pdf`)).arrayBuffer());
const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true }).promise;

const toWebp = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/webp', QUALITY));

function downscale(src, width) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((src.height * width) / src.width);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

async function renderPage(pageNo, width) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return { canvas, landscape: base.width > base.height };
}

async function exportPage(pageNo) {
  const probe = await doc.getPage(pageNo);
  const box = probe.getViewport({ scale: 1 });
  const landscape = box.width > box.height;
  const dir = `assets/flashcard/${SET}/`;

  if (pageNo === 1) {
    const { canvas } = await renderPage(pageNo, WIDTHS.cover);
    await saveFile(`${dir}cover-lg.webp`, await toWebp(canvas));
    await saveFile(`${dir}cover.webp`, await toWebp(downscale(canvas, WIDTHS.coverThumb)));
    return 'cover';
  }

  const size = landscape ? WIDTHS.landscape : WIDTHS.portrait;
  const { canvas } = await renderPage(pageNo, size.large);

  if (pageNo === 2) {
    await saveFile(`${dir}toc.webp`, await toWebp(canvas));
    return 'toc';
  }

  const n = String(Math.floor((pageNo - 3) / 2) + 1).padStart(2, '0');
  const face = (pageNo - 3) % 2 === 0 ? 'front' : 'back';
  await saveFile(`${dir}card-${n}-${face}-lg.webp`, await toWebp(canvas));
  await saveFile(`${dir}card-${n}-${face}.webp`, await toWebp(downscale(canvas, size.small)));
  return `card-${n}-${face}${landscape ? ' (landscape)' : ''}`;
}

const pages = [];
for (let p = FIRST; p <= LAST; p++) pages.push(p);
const done = await Promise.all(pages.map(exportPage));
console.log(done.join('\n'));
