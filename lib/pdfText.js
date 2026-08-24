// Server-only. Decrypts a PDF and returns each page as an array of lines,
// where a "line" is the text items that share a y-coordinate, joined by
// spaces and sorted left to right — enough layout to parse tabular pages.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extractPagesText(buffer, password) {
  const uint = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const loadingTask = getDocument({
    data: uint,
    password: password || undefined,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });
  const doc = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group items by rounded y — items on the same visual line share y within a tolerance
    const lines = new Map();
    for (const item of content.items) {
      const tx = item.transform;
      const y = Math.round(tx[5] * 2) / 2; // half-unit tolerance
      const x = tx[4];
      const str = item.str;
      if (!str) continue;
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x, str });
    }
    const sortedY = [...lines.keys()].sort((a, b) => b - a);
    const pageLines = sortedY.map((y) => {
      const items = lines.get(y).sort((a, b) => a.x - b.x);
      // Join with two spaces where the x-gap is large so columns stay separable.
      let out = '';
      let lastEnd = null;
      for (const it of items) {
        if (lastEnd !== null && it.x - lastEnd > 6) out += '  ';
        out += it.str;
        lastEnd = it.x + it.str.length * 3;
      }
      return out.replace(/[ \t]+$/, '');
    }).filter(Boolean);
    pages.push(pageLines);
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}
