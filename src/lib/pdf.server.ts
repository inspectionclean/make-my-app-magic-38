import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

export type PdfSection = {
  heading: string;
  subheading?: string;
  rows?: [string, string][];
  paragraphs?: string[];
};

export async function buildSimplePdf(opts: {
  title: string;
  subtitle?: string;
  sections: PdfSection[];
  footer?: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;
  const pageH = 792;
  const margin = 54;
  const contentW = pageW - margin * 2;
  const labelW = 170;
  const valueW = contentW - labelW - 10;

  // Brand colors
  const brand = rgb(0.06, 0.36, 0.62); // deep blue
  const ink = rgb(0.13, 0.16, 0.22);
  const muted = rgb(0.42, 0.46, 0.53);
  const rule = rgb(0.85, 0.87, 0.9);
  const stripe = rgb(0.96, 0.97, 0.99);

  let page = doc.addPage([pageW, pageH]);
  let y = pageH;
  let pageIndex = 1;

  const sanitize = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2013|\u2014/g, "-");

  const wrap = (text: string, f: PDFFont, size: number, maxW: number): string[] => {
    const out: string[] = [];
    for (const para of String(text).split(/\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(""); continue; }
      let line = "";
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(test, size) > maxW) {
          if (line) out.push(line);
          // Hard-break very long tokens
          if (f.widthOfTextAtSize(w, size) > maxW) {
            let chunk = "";
            for (const ch of w) {
              if (f.widthOfTextAtSize(chunk + ch, size) > maxW) { out.push(chunk); chunk = ch; }
              else chunk += ch;
            }
            line = chunk;
          } else line = w;
        } else line = test;
      }
      if (line) out.push(line);
    }
    return out;
  };

  const drawHeader = () => {
    // Top brand bar
    page.drawRectangle({ x: 0, y: pageH - 90, width: pageW, height: 90, color: brand });
    page.drawText(sanitize(opts.title), { x: margin, y: pageH - 50, size: 22, font: bold, color: rgb(1, 1, 1) });
    if (opts.subtitle) {
      page.drawText(sanitize(opts.subtitle), { x: margin, y: pageH - 72, size: 11, font, color: rgb(0.86, 0.91, 0.97) });
    }
    // Accent stripe
    page.drawRectangle({ x: 0, y: pageH - 96, width: pageW, height: 4, color: rgb(0.96, 0.66, 0.18) });
    y = pageH - 120;
  };

  const drawFooter = () => {
    const txt = `Page ${pageIndex}` + (opts.footer ? `  •  ${sanitize(opts.footer)}` : "");
    const w = font.widthOfTextAtSize(txt, 9);
    page.drawLine({ start: { x: margin, y: 36 }, end: { x: pageW - margin, y: 36 }, thickness: 0.5, color: rule });
    page.drawText(txt, { x: pageW - margin - w, y: 22, size: 9, font, color: muted });
  };

  const newPage = () => {
    drawFooter();
    page = doc.addPage([pageW, pageH]);
    pageIndex++;
    drawHeader();
  };

  const ensure = (needed: number) => {
    if (y - needed < 56) newPage();
  };

  drawHeader();

  const drawSectionHeading = (heading: string, sub?: string) => {
    ensure(60);
    y -= 6;
    page.drawText(sanitize(heading.toUpperCase()), { x: margin, y, size: 12, font: bold, color: brand });
    y -= 6;
    page.drawLine({ start: { x: margin, y: y - 2 }, end: { x: pageW - margin, y: y - 2 }, thickness: 1, color: brand });
    y -= 14;
    if (sub) {
      ensure(20);
      page.drawText(sanitize(sub), { x: margin, y, size: 10, font, color: muted });
      y -= 14;
    }
  };

  const drawRow = (label: string, value: string, idx: number) => {
    const labelLines = wrap(sanitize(label), bold, 10, labelW);
    const valueLines = wrap(sanitize(value), font, 10, valueW);
    const lineH = 13;
    const rowH = Math.max(labelLines.length, valueLines.length) * lineH + 8;
    ensure(rowH);
    if (idx % 2 === 0) {
      page.drawRectangle({ x: margin - 4, y: y - rowH + 6, width: contentW + 8, height: rowH, color: stripe });
    }
    let ly = y - 2;
    for (const l of labelLines) {
      page.drawText(l, { x: margin, y: ly - 8, size: 10, font: bold, color: ink });
      ly -= lineH;
    }
    let vy = y - 2;
    for (const l of valueLines) {
      page.drawText(l, { x: margin + labelW + 10, y: vy - 8, size: 10, font, color: ink });
      vy -= lineH;
    }
    y -= rowH;
  };

  const drawParagraph = (text: string) => {
    const lines = wrap(sanitize(text), font, 10, contentW);
    for (const l of lines) {
      ensure(16);
      page.drawText(l, { x: margin, y: y - 10, size: 10, font, color: ink });
      y -= 14;
    }
    y -= 4;
  };

  for (const sec of opts.sections) {
    const hasRows = sec.rows && sec.rows.length;
    const hasParas = sec.paragraphs && sec.paragraphs.some((p) => p && p.trim());
    if (!hasRows && !hasParas) continue;
    drawSectionHeading(sec.heading, sec.subheading);
    if (hasRows) {
      let i = 0;
      for (const [k, v] of sec.rows!) {
        if (v == null || v === "") continue;
        drawRow(k, v, i++);
      }
    }
    if (hasParas) {
      for (const p of sec.paragraphs!) if (p && p.trim()) drawParagraph(p);
    }
    y -= 10;
  }

  drawFooter();
  return doc.save();
}