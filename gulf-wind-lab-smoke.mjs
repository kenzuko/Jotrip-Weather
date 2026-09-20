import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const errors = [];
const consoleErrors = [];
const result = {
  ok: false,
  stage: 'init',
  status: null,
  perf: null,
  time: null,
  probe: null,
  mapCanvasCount: 0,
  flowCanvasPixels: 0,
  errorVisible: null,
  errorText: null,
  pageErrors: errors,
  consoleErrors,
  failure: null,
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

let failure = null;

try {
  result.stage = 'goto';
  await page.goto('http://127.0.0.1:4173/gulf-wind-lab.html', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  result.stage = 'wait-data';
  await page.waitForFunction(
    () => {
      const s = document.getElementById('status')?.textContent || '';
      return s.includes('GULF FIELD');
    },
    { timeout: 120000 },
  );

  result.stage = 'wait-time';
  await page.waitForFunction(
    () => (document.getElementById('timeLabel')?.textContent || '').trim() !== '--:--',
    { timeout: 60000 },
  );

  result.stage = 'map-check';
  result.mapCanvasCount = await page.locator('.maplibregl-canvas').count();
  if (result.mapCanvasCount < 1) throw new Error('MapLibre canvas missing');

  result.status = await page.locator('#status').innerText();
  result.perf = await page.locator('#perf').innerText();
  result.time = await page.locator('#timeLabel').innerText();

  result.stage = 'flow-canvas';
  await page.waitForTimeout(1400);
  result.flowCanvasPixels = await page.locator('#windFlow').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return 0;
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    for (let i = 3; i < data.length; i += 64) {
      if (data[i] > 6) visible++;
    }
    return visible;
  });
  if (result.flowCanvasPixels < 8) throw new Error('Wind flow canvas did not draw visible trails');

  result.stage = 'grid-toggle';
  await page.locator('#gridBtn').click();
  await page.waitForTimeout(500);
  const gridActive = await page.locator('#gridBtn').evaluate((el) => el.classList.contains('active'));
  if (!gridActive) throw new Error('Grid mode did not activate');

  await page.locator('#smoothBtn').click();
  await page.waitForTimeout(500);

  result.stage = 'timeline';
  const slider = page.locator('#slider');
  const max = Number(await slider.getAttribute('max'));
  if (!(max >= 20)) throw new Error('Expected at least 20 forecast frames');
  await slider.fill(String(Math.min(4, max)));
  await page.waitForTimeout(800);

  result.stage = 'probe';
  await page.mouse.click(210, 400);
  await page.waitForTimeout(250);
  result.probe = await page.locator('#probeValue').innerText();
  if (!result.probe.includes('km/h') && !result.probe.includes('Ngoài vùng')) {
    throw new Error('Probe did not respond to map click: ' + result.probe);
  }

  result.stage = 'camera';
  await page.locator('#islandCamera').click();
  await page.waitForTimeout(700);
  await page.locator('#gulfCamera').click();
  await page.waitForTimeout(700);

  result.stage = 'error-card';
  result.errorVisible = await page.locator('#errorCard').evaluate(
    (el) => !el.classList.contains('hidden'),
  );
  if (result.errorVisible) {
    result.errorText = await page.locator('#errorText').innerText();
    throw new Error('POC error card visible: ' + result.errorText);
  }

  if (errors.length) throw new Error('Page errors: ' + errors.join(' | '));

  result.ok = true;
  result.stage = 'done';
} catch (err) {
  failure = err;
  result.failure = String(err?.stack || err);
  try {
    result.status = result.status ?? await page.locator('#status').innerText({ timeout: 1000 });
  } catch {}
  try {
    result.perf = result.perf ?? await page.locator('#perf').innerText({ timeout: 1000 });
  } catch {}
  try {
    result.time = result.time ?? await page.locator('#timeLabel').innerText({ timeout: 1000 });
  } catch {}
  try {
    result.probe = result.probe ?? await page.locator('#probeValue').innerText({ timeout: 1000 });
  } catch {}
  try {
    result.errorVisible = await page.locator('#errorCard').evaluate(
      (el) => !el.classList.contains('hidden'),
      { timeout: 1000 },
    );
    if (result.errorVisible) result.errorText = await page.locator('#errorText').innerText({ timeout: 1000 });
  } catch {}
} finally {
  try {
    await page.screenshot({ path: '/tmp/gulf-wind-lab-mobile.png', fullPage: true });
  } catch {}
  await writeFile('/tmp/gulf-wind-smoke-result.json', JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

if (failure) {
  process.exitCode = 1;
}
