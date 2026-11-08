// Makes the app icons in public/ from one drawing. Run with: npm run icons
// Logo (8 Nov 2026): a cream bowl with a rose heart in it and three sage-green curls of steam, on dark rose.
import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const ROSE = "#9C3E5E"; // a little darker than the app's main colour (#B34D6E)
const CREAM = "#FBF4F3";
const SAGE = "#A9CDAD";

const drawing = `
  <path d="M136 268h240a120 120 0 0 1-240 0z" fill="${CREAM}"/>
  <rect x="116" y="252" width="280" height="24" rx="12" fill="${CREAM}"/>
  <path d="M256 362c-14-11-38-26-38-46a19 19 0 0 1 38-7 19 19 0 0 1 38 7c0 20-24 35-38 46z" fill="${ROSE}"/>
  <g fill="none" stroke="${SAGE}" stroke-width="18" stroke-linecap="round">
    <path d="M206 222c-22-26 22-44 0-76"/>
    <path d="M256 222c-22-26 22-44 0-76"/>
    <path d="M306 222c-22-26 22-44 0-76"/>
  </g>`;

// Rounded corners for browsers; full square for "maskable" and iOS, which cut their own shape.
const svg = (rounded) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ""} fill="${ROSE}"/>${drawing}
</svg>`;

await writeFile("public/favicon.svg", svg(true));
const png = (rounded, size, file) => sharp(Buffer.from(svg(rounded))).resize(size, size).png().toFile(`public/${file}`);
await png(true, 192, "icon-192.png");
await png(true, 512, "icon-512.png");
await png(false, 512, "icon-maskable-512.png");
await png(false, 180, "apple-touch-icon.png");
console.log("Iconen gemaakt in public/");
