import type { GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

// Load self-hosted font files for SVG → PNG rendering
const fontsDir = path.resolve(import.meta.dirname, '../../../public/fonts');
const sansFlexRegular = fs.readFileSync(path.join(fontsDir, 'google-sans-flex-400.ttf'));
const sansFlexBold = fs.readFileSync(path.join(fontsDir, 'google-sans-flex-700.ttf'));
const codeRegular = fs.readFileSync(path.join(fontsDir, 'google-sans-code-400.ttf'));
const codeWeight500 = fs.readFileSync(path.join(fontsDir, 'google-sans-code-500.ttf'));

const sansFlexRegularB64 = sansFlexRegular.toString('base64');
const sansFlexBoldB64 = sansFlexBold.toString('base64');
const codeRegularB64 = codeRegular.toString('base64');
const codeWeight500B64 = codeWeight500.toString('base64');

export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getCollection('docs');
  return docs.map((doc) => ({
    params: { slug: doc.id || 'index' },
    props: { title: doc.data.title, description: doc.data.description || '' },
  }));
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wrap text to fit within a max width (approximate character count). */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 1 > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildSvg(title: string, description: string): string {
  const W = 1200;
  const H = 630;

  // Title: ~30 chars per line at 48px on 1200w with padding
  const titleLines = wrapText(title, 32);
  const descLines = description ? wrapText(description, 58) : [];

  // Layout constants
  const pad = 64;
  const titleStartY = 200;
  const titleLineHeight = 62;
  const descStartY = titleStartY + titleLines.length * titleLineHeight + 28;
  const descLineHeight = 34;

  // Grid pattern (subtle dots)
  const gridDots: string[] = [];
  for (let x = pad; x < W - pad; x += 40) {
    for (let y = 40; y < H - 40; y += 40) {
      gridDots.push(`<circle cx="${x}" cy="${y}" r="0.6" fill="#1a1a1a"/>`);
    }
  }

  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="${pad}" y="${titleStartY + i * titleLineHeight}" font-family="'Google Sans Flex', sans-serif" font-size="52" font-weight="700" fill="#ffffff">${escapeXml(line)}</text>`
    )
    .join('\n    ');

  const descSvg = descLines
    .map(
      (line, i) =>
        `<text x="${pad}" y="${descStartY + i * descLineHeight}" font-family="'Google Sans Flex', sans-serif" font-size="24" font-weight="400" fill="#888888">${escapeXml(line)}</text>`
    )
    .join('\n    ');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @font-face {
        font-family: 'Google Sans Flex';
        font-weight: 400;
        src: url('data:font/truetype;base64,${sansFlexRegularB64}') format('truetype');
      }
      @font-face {
        font-family: 'Google Sans Flex';
        font-weight: 700;
        src: url('data:font/truetype;base64,${sansFlexBoldB64}') format('truetype');
      }
      @font-face {
        font-family: 'Google Sans Code';
        font-weight: 400;
        src: url('data:font/truetype;base64,${codeRegularB64}') format('truetype');
      }
      @font-face {
        font-family: 'Google Sans Code';
        font-weight: 600;
        src: url('data:font/truetype;base64,${codeWeight500B64}') format('truetype');
      }
    </style>
    <clipPath id="rounded">
      <rect width="${W}" height="${H}" rx="0" ry="0"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="#0a0a0a"/>

  <!-- Subtle grid -->
  ${gridDots.join('\n  ')}

  <!-- Top accent line -->
  <rect x="${pad}" y="120" width="64" height="3" fill="#3b82f6" rx="0"/>

  <!-- Title -->
  ${titleSvg}

  <!-- Description -->
  ${descSvg}

  <!-- Bottom divider -->
  <line x1="${pad}" y1="${H - 80}" x2="${W - pad}" y2="${H - 80}" stroke="#1a1a1a" stroke-width="1"/>

  <!-- Branding: left -->
  <text x="${pad}" y="${H - 40}" font-family="'Google Sans Code', monospace" font-size="20" font-weight="600" fill="#ffffff">unsurf</text>

  <!-- Branding: right -->
  <text x="${W - pad}" y="${H - 40}" font-family="'Google Sans Code', monospace" font-size="16" font-weight="400" fill="#555555" text-anchor="end">unsurf.coey.dev</text>
</svg>`;
}

export async function GET({ props }: { props: { title: string; description: string } }) {
  const svg = buildSvg(props.title, props.description);

  const png = await sharp(Buffer.from(svg))
    .resize(1200, 630)
    .png()
    .toBuffer();

  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
