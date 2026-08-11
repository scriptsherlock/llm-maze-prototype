// Draw all eight mazes on one sheet, so the set can be eyeballed side by side.
//
//   node mazes8/scripts/preview.mjs        -> mazes8/preview.svg
//
// Thin walls, wide cells: the same proportions the moderator map uses, so what you
// see here is what the bird's-eye view will look like.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { G, START, GOAL, profile, isOpen } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
// --dir renders a candidate set instead of the live one.
const DIR_ARG = (process.argv.slice(2).find((a) => a.startsWith("--dir=")) || "").split("=")[1];
const dir = DIR_ARG ? path.join(root, DIR_ARG) : path.join(root, "public", "mazes8");

const WALL = 4, CELL = 17, PAD = 16, LABEL = 40, COLS = 4;
const track = (i) => (i % 2 === 0 ? WALL : CELL);
const offsets = (() => { const o = [0]; for (let i = 0; i < G; i += 1) o.push(o[i] + track(i)); return o; })();
const SIZE = offsets[G];

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

const tiles = files.map((f) => {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  const g = src.match(/"[01]+"/g).map((s) => s.replace(/"/g, "")).map((r) => r.split("").map(Number));
  return { id: f.replace(/\.js$/, ""), g, p: profile(g) };
});

const rows = Math.ceil(tiles.length / COLS);
const tileW = SIZE + PAD * 2, tileH = SIZE + PAD * 2 + LABEL;
const HEADER = 42;
const W = tileW * COLS, H = tileH * rows + HEADER;

// Whatever every maze shares goes in the header — that is the point of the set, and
// repeating it on each tile only crowds out what actually differs.
const same = (k) => [...new Set(tiles.map((t) => t.p[k]))];
const shared = [
  same("pathLength").length === 1 ? `${tiles[0].p.pathLength} moves` : null,
  same("branchPoints").length === 1 ? `${tiles[0].p.branchPoints} branch points` : null,
  same("choicePoints").length === 1 ? `${tiles[0].p.choicePoints} choice points` : null,
].filter(Boolean).join(" · ");

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif">
<rect width="${W}" height="${H}" fill="#f8fafc"/>
<text x="${PAD}" y="26" font-size="14" fill="#0f172a" font-weight="600">Eight matched mazes${shared ? ` — every one: ${shared}` : ""}</text>`;

tiles.forEach((t, i) => {
  const ox = (i % COLS) * tileW + PAD;
  const oy = Math.floor(i / COLS) * tileH + PAD + HEADER;
  svg += `\n<g transform="translate(${ox},${oy})">`;
  svg += `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="#e0f2fe"/>`;
  // walls, skipping isolated corner posts so they do not show as floating dots
  for (let y = 0; y < G; y += 1) for (let x = 0; x < G; x += 1) {
    if (t.g[y][x] !== 1) continue;
    const isolated = x % 2 === 0 && y % 2 === 0 &&
      [[1,0],[-1,0],[0,1],[0,-1]].every(([dx,dy]) => !(x+dx>=0&&x+dx<G&&y+dy>=0&&y+dy<G) || t.g[y+dy][x+dx] === 0);
    if (isolated) continue;
    svg += `<rect x="${offsets[x]}" y="${offsets[y]}" width="${track(x)}" height="${track(y)}" fill="#22304f"/>`;
  }
  const dot = (c, fill) => `<rect x="${offsets[c.x]}" y="${offsets[c.y]}" width="${track(c.x)}" height="${track(c.y)}" fill="${fill}"/>`;
  svg += dot(START, "#2563eb") + dot(GOAL, "#22c55e");
  svg += `<text x="0" y="${SIZE + 17}" font-size="13" fill="#0f172a" font-weight="600">${t.id}</text>`;
  svg += `<text x="0" y="${SIZE + 32}" font-size="11.5" fill="#64748b">` +
    `${t.p.loops} loops · ${t.p.deadEndBranches} dead ends</text>`;
  svg += `</g>`;
});
svg += "\n</svg>\n";

// Written twice on purpose: one copy next to the module for reviewing offline, one
// under public/ so the /m8 index page can show it without a build step.
const outs = DIR_ARG ? [path.join(dir, "preview.svg")] : [path.join(root, "mazes8", "preview.svg"), path.join(dir, "preview.svg")];
for (const out of outs) {
  fs.writeFileSync(out, svg);
  console.log(`wrote ${path.relative(root, out)}`);
}
console.log(`${tiles.length} mazes, blue = start, green = exit`);
