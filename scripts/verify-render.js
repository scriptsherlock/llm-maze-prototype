const { spawn } = require("child_process");
const { chromium } = require("playwright");
const path = require("path");

const port = 3177;
const baseUrl = `http://127.0.0.1:${port}`;

async function main() {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  try {
    await waitForServer();
    const browser = await chromium.launch();
    try {
      await verifyViewport(browser, "desktop", { width: 1280, height: 900 });
      await verifyViewport(browser, "mobile", { width: 390, height: 844, isMobile: true });
      await verifyValidator(browser);
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
}

async function verifyValidator(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${baseUrl}/ai_validator.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("#validatorGrid .validator-cell");

  const result = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("#validatorGrid .validator-cell"));
    const player = document.querySelectorAll("#validatorGrid .validator-cell.player").length;
    const goal = document.querySelectorAll("#validatorGrid .validator-cell.goal").length;
    const local = document.querySelectorAll("#validatorGrid .validator-cell.local-path").length;
    const localText = document.querySelector("#localPathLength")?.textContent || "";
    return { cells: cells.length, player, goal, local, localText };
  });

  if (result.cells < 25 || result.player !== 1 || result.goal !== 1 || result.local < 2) {
    throw new Error(`validator grid check failed: ${JSON.stringify(result)}`);
  }

  console.log(`validator: cells=${result.cells}, local=${result.local}, ${result.localText}`);
  await page.close();
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch (_error) {
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Server did not start in time.");
}

async function verifyViewport(browser, name, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("#scene canvas");
  await page.waitForTimeout(600);

  const screenshotPath = path.join(__dirname, "..", `render-${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const result = await page.evaluate(() => {
    const canvas = document.querySelector("#scene canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { ok: false, reason: "No WebGL context." };

    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const points = [
      [0.5, 0.5],
      [0.2, 0.35],
      [0.8, 0.35],
      [0.5, 0.82],
      [0.38, 0.65],
      [0.62, 0.65],
    ];
    const pixels = [];
    const pixel = new Uint8Array(4);

    for (const [px, py] of points) {
      gl.readPixels(
        Math.floor(width * px),
        Math.floor(height * (1 - py)),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel
      );
      pixels.push([pixel[0], pixel[1], pixel[2], pixel[3]]);
    }

    const opaque = pixels.filter((p) => p[3] > 0).length;
    const unique = new Set(pixels.map((p) => p.join(","))).size;
    const brightness = pixels.map((p) => p[0] + p[1] + p[2]);
    const spread = Math.max(...brightness) - Math.min(...brightness);

    return {
      ok: opaque === points.length && unique >= 3 && spread > 40,
      width,
      height,
      opaque,
      unique,
      spread,
      pixels,
    };
  });

  if (!result.ok) {
    throw new Error(`${name} WebGL pixel check failed: ${JSON.stringify(result)}`);
  }

  console.log(`${name}: ${result.width}x${result.height}, unique=${result.unique}, spread=${result.spread}, screenshot=${screenshotPath}`);
  await page.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
