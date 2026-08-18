import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function renderSvgToPng(svgPath, outputPath, size) {
  const svgContent = readFileSync(svgPath, 'utf8');
  const tempHtmlPath = resolve(ROOT_DIR, `temp-${size}-${Date.now()}.html`);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: ${size}px;
      height: ${size}px;
      overflow: hidden;
      background: transparent;
    }
    svg {
      width: ${size}px;
      height: ${size}px;
      display: block;
    }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`;

  writeFileSync(tempHtmlPath, html, 'utf8');

  try {
    const res = spawnSync(CHROME_PATH, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${size},${size}`,
      '--default-background-color=00000000',
      `--screenshot=${outputPath}`,
      `file://${tempHtmlPath}`
    ], { stdio: 'pipe' });

    if (res.status === 0) {
      console.log(`✓ Rendered ${outputPath.split('/').pop()} (${size}x${size})`);
    } else {
      console.warn(`Warning on ${outputPath}:`, res.stderr?.toString());
    }
  } finally {
    if (existsSync(tempHtmlPath)) {
      unlinkSync(tempHtmlPath);
    }
  }
}

const svgPath = resolve(ROOT_DIR, 'favicon.svg');
console.log('Rendering 100% exact PNG icons from Space Cadet Pinball favicon.svg...');

renderSvgToPng(svgPath, resolve(ROOT_DIR, 'icon-512.png'), 512);
renderSvgToPng(svgPath, resolve(ROOT_DIR, 'favicon.png'), 512);
renderSvgToPng(svgPath, resolve(ROOT_DIR, 'icon-192.png'), 192);
renderSvgToPng(svgPath, resolve(ROOT_DIR, 'apple-touch-icon.png'), 180);
renderSvgToPng(svgPath, resolve(ROOT_DIR, 'icon-maskable-512.png'), 512);
renderSvgToPng(svgPath, resolve(ROOT_DIR, 'favicon-32x32.png'), 32);

console.log('All Space Cadet Pinball PNG icons rendered successfully!');
