import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function buildSimplePdf(opts: {
  title: string;
  subtitle?: string;
  sections: { heading: string; rows: [string, string][] }[];
  footer?: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;
  const pageH = 792;
  const margin = 50;
  const lineH = 14;
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  const wrap = (text: string, f: typeof font, size: number, maxW: number) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > maxW) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const drawLine = (text: string, f: typeof font, size: number, color = rgb(0, 0, 0)) => {
    const lines = wrap(text, f, size, pageW - margin * 2);
    for (const ln of lines) {
      if (y < margin + lineH) {
        page = doc.addPage([pageW, pageH]);
        y = pageH - margin;
      }
      page.drawText(ln, { x: margin, y, size, font: f, color });
      y -= size + 4;
    }
  };

  drawLine(opts.title, bold, 18);
  if (opts.subtitle) drawLine(opts.subtitle, font, 11, rgb(0.4, 0.4, 0.4));
  y -= 6;

  for (const sec of opts.sections) {
    if (!sec.rows.length) continue;
    y -= 6;
    drawLine(sec.heading, bold, 13);
    for (const [k, v] of sec.rows) {
      if (v == null || v === "") continue;
      drawLine(`${k}: ${v}`, font, 10);
    }
  }
  if (opts.footer) {
    y -= 8;
    drawLine(opts.footer, font, 9, rgb(0.5, 0.5, 0.5));
  }
  return doc.save();
}