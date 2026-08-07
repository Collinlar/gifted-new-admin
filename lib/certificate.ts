import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";
import QRCode from "qrcode";

// ── Geometry ───────────────────────────────────────────────────────────────
//
// A4 in PDF points. pdf-lib measures from the BOTTOM left, templates are
// authored from the TOP left, and every conversion happens in this file so the
// editor and the renderer cannot drift apart.
//
// Field x and y are percentages of the page and describe the CENTRE of the
// element. Centre rather than a corner because it makes centring trivial and
// matches how a person actually places something by eye.

const A4_SHORT = 595.28;
const A4_LONG  = 841.89;

export function pageSize(orientation: string): [number, number] {
  return orientation === "portrait" ? [A4_SHORT, A4_LONG] : [A4_LONG, A4_SHORT];
}

// ── Field model ────────────────────────────────────────────────────────────

export interface CertField {
  id: string;
  type: "text" | "image" | "qr";
  x: number;              // 0-100, centre
  y: number;              // 0-100, centre
  // text
  text?: string;          // may contain {{tokens}}
  size?: number;          // points
  font?: "helvetica" | "times";
  bold?: boolean;
  italic?: boolean;
  color?: string;         // #RRGGBB
  align?: "left" | "center" | "right";
  // image and qr
  url?: string;
  width?: number;         // 0-100 as a percentage of page width
}

export type Snapshot = Record<string, string | number>;

export function fillTokens(template: string, snap: Snapshot, verifyUrl: string): string {
  return String(template ?? "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
    const k = key.toLowerCase();
    if (k === "verify_url") return verifyUrl;
    if (k === "percentage") return `${snap.percentage ?? 0}%`;
    const v = snap[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

function hexToRgb(hex?: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return rgb(0.09, 0.11, 0.16); // near black, matches the app's ink
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// ── Renderer ───────────────────────────────────────────────────────────────

export interface RenderInput {
  fields: CertField[];
  backgroundUrl?: string | null;
  orientation?: string;
  snapshot: Snapshot;
  verifyUrl: string;
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; kind: "png" | "jpg" } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // Sniff the magic bytes rather than trusting the content type header,
    // because a wrong guess makes pdf-lib throw rather than degrade.
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    if (!isPng && !isJpg) return null;
    return { bytes: buf, kind: isPng ? "png" : "jpg" };
  } catch {
    return null;
  }
}

export async function renderCertificate(input: RenderInput): Promise<Uint8Array> {
  const { fields, backgroundUrl, orientation = "landscape", snapshot, verifyUrl } = input;

  const [pw, ph] = pageSize(orientation);
  const doc = await PDFDocument.create();
  const page: PDFPage = doc.addPage([pw, ph]);

  const fonts: Record<string, PDFFont> = {
    helvetica:    await doc.embedFont(StandardFonts.Helvetica),
    helveticaB:   await doc.embedFont(StandardFonts.HelveticaBold),
    helveticaI:   await doc.embedFont(StandardFonts.HelveticaOblique),
    times:        await doc.embedFont(StandardFonts.TimesRoman),
    timesB:       await doc.embedFont(StandardFonts.TimesRomanBold),
    timesI:       await doc.embedFont(StandardFonts.TimesRomanItalic),
  };

  const pickFont = (f: CertField): PDFFont => {
    const base = f.font === "times" ? "times" : "helvetica";
    if (f.bold)   return fonts[base + "B"];
    if (f.italic) return fonts[base + "I"];
    return fonts[base];
  };

  // Background first, everything else sits on top
  if (backgroundUrl) {
    const bg = await fetchBytes(backgroundUrl);
    if (bg) {
      const img = bg.kind === "png" ? await doc.embedPng(bg.bytes) : await doc.embedJpg(bg.bytes);
      // Cover the page, preserving aspect ratio, centred. Overflow is cropped
      // rather than letterboxed so the paper is never part-white.
      const scale = Math.max(pw / img.width, ph / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }

  for (const f of fields || []) {
    const cx = (pw * (f.x ?? 50)) / 100;
    const cyTop = (ph * (f.y ?? 50)) / 100;
    const cy = ph - cyTop; // flip to pdf-lib's bottom-left origin

    if (f.type === "text") {
      const raw = fillTokens(f.text || "", snapshot, verifyUrl);
      if (!raw) continue;

      const font = pickFont(f);
      const size = f.size ?? 18;
      const color = hexToRgb(f.color);
      const lines = raw.split("\n");
      const lineHeight = size * 1.25;
      // Vertically centre the whole block on cy
      const blockTop = cy + ((lines.length - 1) * lineHeight) / 2;

      lines.forEach((line, i) => {
        const w = font.widthOfTextAtSize(line, size);
        const x = f.align === "left"  ? cx
                : f.align === "right" ? cx - w
                : cx - w / 2;
        page.drawText(line, {
          x,
          // 0.35 of the size drops the baseline so the glyphs look centred on
          // the point rather than sitting above it
          y: blockTop - i * lineHeight - size * 0.35,
          size, font, color,
        });
      });
      continue;
    }

    if (f.type === "image" && f.url) {
      const got = await fetchBytes(f.url);
      if (!got) continue;
      const img = got.kind === "png" ? await doc.embedPng(got.bytes) : await doc.embedJpg(got.bytes);
      const w = (pw * (f.width ?? 15)) / 100;
      const h = w * (img.height / img.width);
      page.drawImage(img, { x: cx - w / 2, y: cy - h / 2, width: w, height: h });
      continue;
    }

    if (f.type === "qr") {
      const png = await QRCode.toBuffer(verifyUrl, {
        type: "png", margin: 1, width: 512,
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      const img = await doc.embedPng(new Uint8Array(png));
      const s = (pw * (f.width ?? 10)) / 100;
      page.drawImage(img, { x: cx - s / 2, y: cy - s / 2, width: s, height: s });
    }
  }

  return doc.save();
}

// ── Sample data for previewing a template before anyone earns one ──────────

export const SAMPLE_SNAPSHOT: Snapshot = {
  candidate_name: "Ama Mensah",
  school:         "Achimota School",
  grade:          "10",
  exam_title:     "GH STEM Olympiad, Round 1",
  score:          34,
  total:          40,
  percentage:     85,
  grade_band:     "Distinction",
  date_issued:    "6 Aug 2026",
  serial:         "SAMPLE-2026-0001",
};

// ── Starter layouts, so a certificate can go out without designing one ─────

export function starterFields(theme: string): CertField[] {
  const ink = theme === "dark" ? "#FFFFFF" : "#0A0E1A";
  const accent = theme === "dark" ? "#E8A020" : "#1D9E75";

  return [
    { id: "title",  type: "text", x: 50, y: 22, text: "Certificate of Achievement",
      size: 34, font: "times", bold: true, color: ink, align: "center" },
    { id: "intro",  type: "text", x: 50, y: 34, text: "This is to certify that",
      size: 13, font: "helvetica", color: ink, align: "center" },
    { id: "name",   type: "text", x: 50, y: 45, text: "{{candidate_name}}",
      size: 40, font: "times", bold: true, color: accent, align: "center" },
    { id: "body",   type: "text", x: 50, y: 58,
      text: "has successfully completed\n{{exam_title}}\nachieving {{grade_band}} with a score of {{score}} out of {{total}}",
      size: 13, font: "helvetica", color: ink, align: "center" },
    { id: "date",   type: "text", x: 22, y: 80, text: "Issued {{date_issued}}",
      size: 10, font: "helvetica", color: ink, align: "center" },
    { id: "serial", type: "text", x: 50, y: 92, text: "Certificate {{serial}}",
      size: 8, font: "helvetica", color: ink, align: "center" },
    { id: "qr",     type: "qr",   x: 88, y: 82, width: 9 },
  ];
}
