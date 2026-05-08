import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs";

const data = JSON.parse(fs.readFileSync("/tmp/roma.json", "utf8"));
const FOLDER_ID = "11uuKcoEXllpcg3Dj5fIdbdK1gwjcFVOH"; // Roma's Family Restaurant-Woodruff

async function buildPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageW = 612, pageH = 792, margin = 50;
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;
  const wrap = (t, f, s, mw) => {
    const words = String(t).split(/\s+/); const lines = []; let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (f.widthOfTextAtSize(test, s) > mw) { if (line) lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line); return lines;
  };
  const draw = (t, f, s, c = rgb(0, 0, 0)) => {
    for (const ln of wrap(t, f, s, pageW - margin * 2)) {
      if (y < margin + 14) { page = doc.addPage([pageW, pageH]); y = pageH - margin; }
      page.drawText(ln, { x: margin, y, size: s, font: f, color: c });
      y -= s + 4;
    }
  };
  draw("Hood Cleaning Performance Report", bold, 18);
  draw(new Date().toLocaleString(), font, 11, rgb(0.4, 0.4, 0.4));
  y -= 6;
  draw("Details", bold, 13);
  for (const [k, v] of Object.entries(data)) {
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    const val = Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    const label = k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    draw(`${label}: ${val}`, font, 10);
  }
  return await doc.save();
}

async function uploadMultipart(name, mime, content) {
  const boundary = "----up" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name, parents: [FOLDER_ID] });
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([head, Buffer.from(content), tail]);
  const r = await fetch("https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": process.env.GOOGLE_DRIVE_API_KEY,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const t = await r.text();
  console.log(name, r.status, t);
}

const pdf = await buildPdf();
const base = `report-${data.service_date}`;
await uploadMultipart(`${base}.pdf`, "application/pdf", pdf);
await uploadMultipart(`${base}.json`, "application/json", JSON.stringify(data, null, 2));
