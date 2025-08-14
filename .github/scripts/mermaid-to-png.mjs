import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import { JSDOM } from "jsdom";
import mermaid from "mermaid";
import { Resvg } from "@resvg/resvg-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------- Config via env (with sensible defaults) -----------------------------
const INPUT_PATTERN = process.env.INPUT_PATTERN || "diagrams/**/*.mmd";
const OUTPUT_DIR    = process.env.OUTPUT_DIR    || "diagrams";
const MERMAID_THEME = process.env.MERMAID_THEME || "default";

// -------- Fake DOM (no browser) ----------------------------------------------
const dom = new JSDOM('<div id="container"></div>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.performance = { now: () => Date.now() };

// -------- Initialize Mermaid --------------------------------------------------
mermaid.initialize({
  startOnLoad: false,
  theme: MERMAID_THEME,        // e.g., default, neutral, forest, dark
  securityLevel: "strict",      // safer for CI
  flowchart: { htmlLabels: false }, // keeps JSDOM happy
  fontFamily: "Arial, sans-serif"
});

// -------- Utility -------------------------------------------------------------
const ensureDir = async (p) => fs.mkdir(p, { recursive: true });

const renderOne = async (mmdPath) => {
  const code = await fs.readFile(mmdPath, "utf8");
  const id = `mmd_${path.basename(mmdPath).replace(/\W+/g, "_")}_${Date.now()}`;

  // Render Mermaid -> SVG (no browser)
  const { svg } = await mermaid.render(id, code);

  // Rasterize SVG -> PNG using @resvg/resvg-js (no browser, no native deps)
  const resvg = new Resvg(svg, {
    // Uncomment to adjust output size:
    // fitTo: { mode: "width", value: 1600 },
    background: "white",
    font: { loadSystemFonts: true } // allow system fonts on runner
  });

  const pngData = resvg.render().asPng();

  const outDir = path.resolve(OUTPUT_DIR);
  await ensureDir(outDir);

  const outName = path.basename(mmdPath).replace(/\.(mmd|mermaid|txt)$/i, ".png");
  const outPath = path.join(outDir, outName);

  await fs.writeFile(outPath, pngData);
  return outPath;
};

const main = async () => {
  const files = await fg([INPUT_PATTERN], {
    dot: false,
    absolute: true,
    onlyFiles: true,
    unique: true,
    caseSensitiveMatch: false
  });

  if (files.length === 0) {
    console.log(`No Mermaid files matched pattern: ${INPUT_PATTERN}`);
    return;
  }

  console.log(`Rendering ${files.length} Mermaid file(s) to PNG (no browser)...`);
  let ok = 0, fail = 0;

  for (const f of files) {
    try {
      const out = await renderOne(f);
      console.log(`✓ ${path.relative(process.cwd(), f)} → ${path.relative(process.cwd(), out)}`);
      ok++;
    } catch (e) {
      console.error(`✗ Failed: ${f}\n${e.stack || e}`);
      fail++;
    }
  }
  console.log(`Done. Success: ${ok}, Failed: ${fail}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
