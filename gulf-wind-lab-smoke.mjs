import { chromium } from 'playwright';

const errors = [];
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

try {
  await page.goto('http://127.0.0.1:4173/gulf-wind-lab.html', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await page.waitForFunction(
    () => {
      const s = document.getElementById('status')?.textContent || '';
      return s.includes('GULF FIELD');
    },
    { timeout: 120000 },
  );

  await page.waitForFunction(
    () => (document.getElementById('timeLabel')?.textContent || '').trim() !== '--:--',
    { timeout: 60000 },
  );

  const mapCanvasCount = await page.locator('.maplibregl-canvas').count();
  if (mapCanvasCount < 1) throw new Error('MapLibre canvas missing');

  const status = await page.locator('#status').innerText();
  const perf = await page.locator('#perf').innerText();
  const time = await page.locator('#timeLabel').innerText();

  await page.locator('#gridBtn').click();
  await page.waitForTimeout(500);
  const gridActive = await page.locator('#gridBtn').evaluate((el) => el.classList.contains('active'));
  if (!gridActive) throw new Error('Grid mode did not activate');

  await page.locator('#smoothBtn').click();
  await page.waitForTimeout(500);

  const slider = page.locator('#slider');
  const max = Number(await slider.getAttribute('max'));
  if (!(max >= 20)) throw new Error('Expected at least 20 forecast frames');
  await slider.fill(String(Math.min(4, max)));
  await page.waitForTimeout(800);

  await page.mouse.click(210, 400);
  await page.waitForTimeout(250);
  const probe = await page.locator('#probeValue').innerText();
  if (!probe.includes('km/h') && !probe.includes('Ngoài vùng')) {
    throw new Error('Probe did not respond to map click: ' + probe);
  }

  await page.locator('#islandCamera').click();
  await page.waitForTimeout(700);
  await page.locator('#gulfCamera').click();
  await page.waitForTimeout(700);

  const errorVisible = await page.locator('#errorCard').evaluate(
    (el) => !el.classList.contains('hidden'),
  );

  await page.screenshot({ path: '/tmp/gulf-wind-lab-mobile.png', fullPage: true });

  console.log(JSON.stringify({
    status,
    perf,
    time,
    probe,
    mapCanvasCount,
    errorVisible,
    pageErrors: errors,
    consoleErrors,
  }, null, 2));

  if (errors.length) throw new Error('Page errors: ' + errors.join(' | '));
  if (errorVisible) {
    const errorText = await page.locator('#errorText').innerText();
    throw new Error('POC error card visible: ' + errorText);
  }
} finally {
  await browser.close();
}
