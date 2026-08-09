// pnpm add -D sharp png-to-ico  →  node scripts/icons.mjs
// Rasterises the SVG sources in public/icons/src into the PNG/ICO files the manifest declares.
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SRC = 'public/icons/src';
const OUT = 'public/icons';
await mkdir(OUT, { recursive: true });

const png = async (src, size, name) =>
  sharp(await readFile(`${SRC}/${src}`)).resize(size, size).png().toFile(`${OUT}/${name}`);

await png('orbit-icon.svg', 192, 'icon-192.png');
await png('orbit-icon.svg', 512, 'icon-512.png');
await png('orbit-icon-maskable.svg', 192, 'maskable-192.png');
await png('orbit-icon-maskable.svg', 512, 'maskable-512.png');
await png('orbit-icon.svg', 180, 'apple-touch-icon.png');   // iOS ignores the manifest
await png('orbit-icon.svg', 512, 'monochrome-512.png');      // optional; tinted by the OS

// favicon.ico from the thickened small-size build
const favicon = await readFile(`${SRC}/orbit-favicon.svg`);
const sizes = await Promise.all([16, 32, 48].map(s =>
  sharp(favicon).resize(s, s).png().toBuffer()));
await writeFile('src/app/favicon.ico', await pngToIco(sizes));

console.log('icons written');
