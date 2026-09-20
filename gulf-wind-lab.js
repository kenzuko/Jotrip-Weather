import * as maplibregl from 'maplibre-gl';

const DATA_URL =
  'https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/data-weather/data/weather-poc/gulf-wind.json';
const CARTO_KEY = 'cb1_3q98_1_d8112ce70cc7ec9b9276b0a0';
const ENABLE_PARTICLES = false;
const BUILD_ID = 'POC2-CARTO-CUBIC';
const FALLBACK_URL =
  'https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather/spatial-ecmwf.json';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => Number.isFinite(Number(v));
const n = (v) => (isNum(v) ? Number(v) : NaN);

const state = {
  pack: null,
  frameIndex: 0,
  smooth: true,
  activeSlot: null,
  cache: new Map(),
  overlay: null,
  WindParticleLayer: null,
  playing: false,
  timer: null,
  loadStarted: performance.now(),
  loadMs: null,
  packBytes: 0,
  sourceMode: 'POC',
  renderToken: 0,
};

const BASE_STYLE = {
  version: 8,
  sources: {
    base: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png?key=' + CARTO_KEY,
        'https://b.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png?key=' + CARTO_KEY,
        'https://c.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png?key=' + CARTO_KEY,
        'https://d.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png?key=' + CARTO_KEY,
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    },
    labels: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png?key=' + CARTO_KEY,
        'https://b.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png?key=' + CARTO_KEY,
        'https://c.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png?key=' + CARTO_KEY,
        'https://d.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png?key=' + CARTO_KEY,
      ],
      tileSize: 256,
    },
  },
  layers: [
    { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 1 } },
    { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.94 } },
  ],
};

const map = new maplibregl.Map({
  container: 'map',
  style: BASE_STYLE,
  renderWorldCopies: false,
  attributionControl: true,
  maxPitch: 0,
  dragRotate: false,
  touchPitch: false,
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

function localTime(iso) {
  const d = new Date(iso || '');
  if (!Number.isFinite(d.getTime())) return '--:--';
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function ageText(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return 'không rõ tuổi dữ liệu';
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 2) return 'vừa cập nhật';
  if (min < 60) return min + ' phút trước';
  return (min / 60).toFixed(1) + ' giờ trước';
}

function runText(iso) {
  const d = new Date(iso || '');
  if (!Number.isFinite(d.getTime())) return 'ECMWF · 0.25°';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return 'ECMWF ' + hh + 'Z · 0.25°';
}

async function fetchText(url) {
  const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' · ' + url);
  const text = await r.text();
  return { text, json: JSON.parse(text) };
}

function compactFallback(raw) {
  const spatial = raw?.spatial || raw;
  const frames = spatial?.frames || [];
  if (!frames.length) throw new Error('Fallback ECMWF không có spatial frames');

  const sample = frames.find((f) => (f.cells || []).length) || frames[0];
  const lats = [...new Set((sample.cells || []).map((c) => n(c.requested_lat ?? c.lat)).filter(Number.isFinite))]
    .sort((a, b) => a - b);
  const lons = [...new Set((sample.cells || []).map((c) => n(c.requested_lon ?? c.lon)).filter(Number.isFinite))]
    .sort((a, b) => a - b);

  const nx = lons.length;
  const ny = lats.length;
  const key = (lat, lon) => lat.toFixed(4) + '|' + lon.toFixed(4);

  const outFrames = frames
    .map((frame) => {
      const by = new Map(
        (frame.cells || []).map((c) => [
          key(n(c.requested_lat ?? c.lat), n(c.requested_lon ?? c.lon)),
          c,
        ]),
      );
      const u = new Array(nx * ny).fill(null);
      const v = new Array(nx * ny).fill(null);
      const speed = new Array(nx * ny).fill(null);

      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const row = by.get(key(lats[iy], lons[ix]));
          if (!row) continue;
          const idx = iy * nx + ix;
          const uu = n(row.u10_ms);
          const vv = n(row.v10_ms);
          if (!Number.isFinite(uu) || !Number.isFinite(vv)) continue;
          u[idx] = uu;
          v[idx] = vv;
          speed[idx] = Number.isFinite(n(row.wind_kmh))
            ? n(row.wind_kmh)
            : Math.hypot(uu, vv) * 3.6;
        }
      }

      return {
        lead_hours: Number(frame.lead_hours || 0),
        valid_time: frame.valid_time,
        u_ms: u,
        v_ms: v,
        speed_kmh: speed,
      };
    })
    .filter((f) => f.u_ms.some((x) => x !== null));

  return {
    schema: 'JOTRIP_GULF_WIND_POC_FALLBACK',
    status: 'READY',
    generated_at: raw.generated_at || raw.run_time || new Date().toISOString(),
    source: 'ECMWF_IFS_DIRECT_FALLBACK',
    run_time: raw.run_time || spatial.short_run_time,
    bounds: {
      west: Math.min(...lons),
      south: Math.min(...lats),
      east: Math.max(...lons),
      north: Math.max(...lats),
    },
    grid: {
      step_deg: Number(spatial.requested_grid_deg || 0.25),
      nx,
      ny,
      lats,
      lons,
      order: 'lat_ascending_then_lon_ascending',
    },
    frames: outFrames,
    display_interpolation: 'RENDER_ONLY',
  };
}

async function loadPack() {
  try {
    const primary = await fetchText(DATA_URL);
    if (primary.json?.status !== 'READY' || !(primary.json.frames || []).length) {
      throw new Error('Gulf render pack chưa READY');
    }
    state.packBytes = new Blob([primary.text]).size;
    state.sourceMode = 'GULF';
    return primary.json;
  } catch (primaryError) {
    console.warn('[Gulf Wind Lab] POC pack unavailable, using island fallback', primaryError);
    const fallback = await fetchText(FALLBACK_URL);
    state.packBytes = new Blob([fallback.text]).size;
    state.sourceMode = 'FALLBACK';
    return compactFallback(fallback.json);
  }
}

function nearestFrameIndex(frames) {
  let best = 0;
  let bestDist = Infinity;
  frames.forEach((f, i) => {
    const t = Date.parse(f.valid_time || '');
    if (!Number.isFinite(t)) return;
    const dist = Math.abs(t - Date.now());
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

function fitGulf() {
  const p = state.pack;
  const b = state.sourceMode === 'GULF'
    ? [p.bounds.west, p.bounds.south, p.bounds.east, p.bounds.north]
    : [100.75, 7.5, 105.75, 13.0];

  map.fitBounds(
    [[b[0], b[1]], [b[2], b[3]]],
    {
      padding: innerWidth < 700
        ? { top: 70, right: 5, bottom: 80, left: 5 }
        : { top: 76, right: 18, bottom: 88, left: 18 },
      duration: 650,
    },
  );
  $('gulfCamera').classList.add('active');
  $('islandCamera').classList.remove('active');
}

function fitIsland() {
  map.fitBounds(
    [[103.68, 9.72], [104.22, 10.52]],
    {
      padding: innerWidth < 700
        ? { top: 82, right: 12, bottom: 88, left: 12 }
        : { top: 90, right: 42, bottom: 92, left: 42 },
      duration: 650,
    },
  );
  $('islandCamera').classList.add('active');
  $('gulfCamera').classList.remove('active');
}

function colorLut() {
  const stops = [
    [0.00, [69, 83, 181, 118]],
    [0.14, [52, 120, 205, 135]],
    [0.28, [43, 166, 205, 148]],
    [0.42, [47, 188, 150, 156]],
    [0.57, [164, 202, 74, 166]],
    [0.70, [232, 196, 56, 177]],
    [0.82, [237, 122, 47, 190]],
    [0.92, [211, 58, 82, 202]],
    [1.00, [142, 39, 119, 212]],
  ];
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        a = stops[s];
        b = stops[s + 1];
        break;
      }
    }
    const f = a[0] === b[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 4; c++) {
      lut[i * 4 + c] = Math.round(a[1][c] + (b[1][c] - a[1][c]) * clamp(f, 0, 1));
    }
  }
  return lut;
}

const WIND_LUT = colorLut();

function sampleGridLinear(arr, nx, ny, gx, gy) {
  const x0 = clamp(Math.floor(gx), 0, nx - 1);
  const y0 = clamp(Math.floor(gy), 0, ny - 1);
  const x1 = clamp(x0 + 1, 0, nx - 1);
  const y1 = clamp(y0 + 1, 0, ny - 1);
  const fx = clamp(gx - x0, 0, 1);
  const fy = clamp(gy - y0, 0, 1);

  const q00 = Number(arr[y0 * nx + x0]);
  const q10 = Number(arr[y0 * nx + x1]);
  const q01 = Number(arr[y1 * nx + x0]);
  const q11 = Number(arr[y1 * nx + x1]);

  if (![q00, q10, q01, q11].every(Number.isFinite)) {
    const candidates = [q00, q10, q01, q11].filter(Number.isFinite);
    if (!candidates.length) return NaN;
    return candidates.reduce((s, v) => s + v, 0) / candidates.length;
  }

  const top = q00 * (1 - fx) + q10 * fx;
  const bottom = q01 * (1 - fx) + q11 * fx;
  return top * (1 - fy) + bottom * fy;
}

function cubic1d(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function sampleGridCubic(arr, nx, ny, gx, gy) {
  const x = Math.floor(gx);
  const y = Math.floor(gy);
  const fx = gx - x;
  const fy = gy - y;

  if (x < 1 || x >= nx - 2 || y < 1 || y >= ny - 2) {
    return sampleGridLinear(arr, nx, ny, gx, gy);
  }

  const rows = new Float64Array(4);
  for (let j = -1; j <= 2; j++) {
    const base = (y + j) * nx;
    const p0 = Number(arr[base + x - 1]);
    const p1 = Number(arr[base + x]);
    const p2 = Number(arr[base + x + 1]);
    const p3 = Number(arr[base + x + 2]);
    if (![p0, p1, p2, p3].every(Number.isFinite)) {
      return sampleGridLinear(arr, nx, ny, gx, gy);
    }
    rows[j + 1] = cubic1d(p0, p1, p2, p3, fx);
  }

  let value = cubic1d(rows[0], rows[1], rows[2], rows[3], fy);

  // Catmull-Rom can overshoot. Clamp to the native 2x2 cell so smoothing
  // never invents an intensity outside the local model envelope.
  const q00 = Number(arr[y * nx + x]);
  const q10 = Number(arr[y * nx + x + 1]);
  const q01 = Number(arr[(y + 1) * nx + x]);
  const q11 = Number(arr[(y + 1) * nx + x + 1]);
  const lo = Math.min(q00, q10, q01, q11);
  const hi = Math.max(q00, q10, q01, q11);
  value = clamp(value, lo, hi);
  return value;
}

function sampleGrid(arr, nx, ny, gx, gy, smooth) {
  if (!smooth) {
    const ix = clamp(Math.round(gx), 0, nx - 1);
    const iy = clamp(Math.round(gy), 0, ny - 1);
    const value = arr[iy * nx + ix];
    return value === null || value === undefined ? NaN : Number(value);
  }
  return sampleGridCubic(arr, nx, ny, gx, gy);
}

function renderCanvas(frame, kind, smooth) {
  const { nx, ny } = state.pack.grid;
  const mobile = innerWidth < 700;
  const width = kind === 'scalar' ? (mobile ? 512 : 768) : (mobile ? 256 : 384);
  const aspect = Math.max(0.7, Math.min(1.5,
    (state.pack.bounds.north - state.pack.bounds.south) /
    (state.pack.bounds.east - state.pack.bounds.west)));
  const height = Math.round(width * aspect);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true });
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const fixed = 30;

  const xg = new Float32Array(width);
  const yg = new Float32Array(height);
  for (let x = 0; x < width; x++) xg[x] = (nx - 1) * (x / Math.max(1, width - 1));
  for (let y = 0; y < height; y++) yg[y] = (ny - 1) * (1 - y / Math.max(1, height - 1));

  let p = 0;
  for (let y = 0; y < height; y++) {
    const gy = yg[y];
    for (let x = 0; x < width; x++) {
      const gx = xg[x];
      const u = sampleGrid(frame.u_ms, nx, ny, gx, gy, smooth);
      const v = sampleGrid(frame.v_ms, nx, ny, gx, gy, smooth);

      if (!Number.isFinite(u) || !Number.isFinite(v)) {
        data[p++] = 0; data[p++] = 0; data[p++] = 0; data[p++] = 0;
        continue;
      }

      if (kind === 'scalar') {
        const speed = Math.hypot(u, v) * 3.6;
        const li = clamp(Math.round((speed / 55) * 255), 0, 255) * 4;
        data[p++] = WIND_LUT[li];
        data[p++] = WIND_LUT[li + 1];
        data[p++] = WIND_LUT[li + 2];
        data[p++] = WIND_LUT[li + 3];
      } else {
        data[p++] = Math.round(clamp((u + fixed) / (fixed * 2), 0, 1) * 255);
        data[p++] = Math.round(clamp((v + fixed) / (fixed * 2), 0, 1) * 255);
        data[p++] = 0;
        data[p++] = 255;
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function cacheKey(index) {
  return index + ':' + (state.smooth ? 'smooth' : 'grid');
}

function frameAssets(index) {
  const key = cacheKey(index);
  if (state.cache.has(key)) return state.cache.get(key);

  const frame = state.pack.frames[index];
  const assets = {
    scalarUrl: renderCanvas(frame, 'scalar', state.smooth),
    vectorUrl: renderCanvas(frame, 'vector', true),
  };
  state.cache.set(key, assets);

  while (state.cache.size > 5) {
    const first = state.cache.keys().next().value;
    state.cache.delete(first);
  }
  return assets;
}

function coords() {
  const b = state.pack.bounds;
  return [
    [b.west, b.north],
    [b.east, b.north],
    [b.east, b.south],
    [b.west, b.south],
  ];
}

function fieldLayerId(slot) {
  return 'gulf-wind-field-' + slot;
}

function fieldSourceId(slot) {
  return 'gulf-wind-source-' + slot;
}

function removeSlot(slot) {
  const layerId = fieldLayerId(slot);
  const sourceId = fieldSourceId(slot);
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

function installSlot(slot, scalarUrl, opacity) {
  removeSlot(slot);
  const sourceId = fieldSourceId(slot);
  const layerId = fieldLayerId(slot);
  map.addSource(sourceId, {
    type: 'image',
    url: scalarUrl,
    coordinates: coords(),
  });
  map.addLayer(
    {
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: {
        'raster-opacity': opacity,
        'raster-fade-duration': 0,
      },
    },
    'labels',
  );
  if (map.getLayer('engine-grid')) map.moveLayer('engine-grid', 'labels');
}

function addGridOverlay() {
  const p = state.pack;
  const lines = [];
  for (const lat of p.grid.lats) {
    lines.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[p.bounds.west, lat], [p.bounds.east, lat]],
      },
      properties: {},
    });
  }
  for (const lon of p.grid.lons) {
    lines.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[lon, p.bounds.south], [lon, p.bounds.north]],
      },
      properties: {},
    });
  }
  if (map.getLayer('engine-grid')) map.removeLayer('engine-grid');
  if (map.getSource('engine-grid')) map.removeSource('engine-grid');
  map.addSource('engine-grid', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: lines },
  });
  map.addLayer(
    {
      id: 'engine-grid',
      type: 'line',
      source: 'engine-grid',
      paint: {
        'line-color': 'rgba(15,45,62,.72)',
        'line-width': 0.75,
        'line-opacity': state.smooth ? 0 : 0.38,
      },
    },
    'labels',
  );
}

function setGridOpacity() {
  if (map.getLayer('engine-grid')) {
    map.setPaintProperty('engine-grid', 'line-opacity', state.smooth ? 0 : 0.38);
  }
}

function fadeBetween(fromSlot, toSlot, token, duration = 260) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      if (token !== state.renderToken) return resolve();
      const t = clamp((now - start) / duration, 0, 1);
      const eased = t * t * (3 - 2 * t);
      if (fromSlot && map.getLayer(fieldLayerId(fromSlot))) {
        map.setPaintProperty(fieldLayerId(fromSlot), 'raster-opacity', 0.66 * (1 - eased));
      }
      if (map.getLayer(fieldLayerId(toSlot))) {
        map.setPaintProperty(fieldLayerId(toSlot), 'raster-opacity', 0.66 * eased);
      }
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

async function ensureParticleRenderer() {
  if (state.overlay || state.WindParticleLayer) return;
  try {
    const [{ MapboxOverlay }, { WindParticleLayer }] = await Promise.all([
      import('@deck.gl/mapbox'),
      import('maplibre-gl-wind'),
    ]);
    state.WindParticleLayer = WindParticleLayer;
    state.overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
    });
    map.addControl(state.overlay);
  } catch (err) {
    console.error('[Gulf Wind Lab] particle renderer failed', err);
    $('errorCard').classList.remove('hidden');
    $('errorText').textContent =
      'Particle renderer không tải được, nhưng basemap và scalar wind field vẫn giữ nguyên. ' +
      String(err?.message || err);
  }
}

function updateParticles(vectorUrl) {
  if (!state.overlay || !state.WindParticleLayer) return;
  const mobile = innerWidth < 700;
  const layer = new state.WindParticleLayer({
    id: 'gulf-wind-particles',
    image: vectorUrl,
    bounds: [
      state.pack.bounds.west,
      state.pack.bounds.south,
      state.pack.bounds.east,
      state.pack.bounds.north,
    ],
    imageUnscale: [-30, 30],
    numParticles: mobile ? 4200 : 8500,
    maxAge: mobile ? 58 : 72,
    speedFactor: mobile ? 22 : 26,
    speedRange: [0, 20],
    width: mobile ? 0.95 : 1.15,
    colorRamp: [
      [0.0, [255, 255, 255, 80]],
      [0.35, [255, 255, 255, 145]],
      [0.70, [255, 251, 235, 205]],
      [1.0, [255, 238, 218, 245]],
    ],
  });
  state.overlay.setProps({ layers: [layer] });
}

function updateLabels() {
  const frame = state.pack.frames[state.frameIndex];
  $('timeLabel').textContent = localTime(frame.valid_time);
  $('runLabel').textContent = runText(state.pack.run_time);
  $('slider').value = String(state.frameIndex);
  $('status').textContent =
    (state.sourceMode === 'GULF' ? 'GULF FIELD' : 'FALLBACK GRID') +
    ' · CARTO · CUBIC · ' + BUILD_ID + ' · ' + ageText(state.pack.generated_at);
}

async function showFrame(index, immediate = false) {
  if (!state.pack?.frames?.length) return;
  const token = ++state.renderToken;
  state.frameIndex = clamp(index, 0, state.pack.frames.length - 1);
  updateLabels();

  let assets;
  try {
    assets = frameAssets(state.frameIndex);
  } catch (err) {
    console.error('[Gulf Wind Lab] frame render failed', err);
    $('errorCard').classList.remove('hidden');
    $('errorText').textContent =
      'Không dựng được weather field của frame này. Basemap vẫn giữ nguyên. ' +
      String(err?.message || err);
    return;
  }

  const nextSlot = state.activeSlot === 'a' ? 'b' : 'a';
  installSlot(nextSlot, assets.scalarUrl, state.activeSlot && !immediate ? 0 : 0.66);

  if (!state.activeSlot || immediate) {
    if (state.activeSlot) removeSlot(state.activeSlot);
    state.activeSlot = nextSlot;
  } else {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (token !== state.renderToken) return;
    const old = state.activeSlot;
    await fadeBetween(old, nextSlot, token);
    if (token !== state.renderToken) return;
    removeSlot(old);
    state.activeSlot = nextSlot;
  }

  if (ENABLE_PARTICLES) updateParticles(assets.vectorUrl);
  setGridOpacity();

  const ahead = Math.min(state.pack.frames.length - 1, state.frameIndex + 1);
  const preload = () => {
    if (ahead !== state.frameIndex) {
      try { frameAssets(ahead); } catch (_) {}
    }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(preload, { timeout: 1000 });
  else setTimeout(preload, 120);
}

function directionFromUV(u, v) {
  return (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
}

function cardinal(deg) {
  const names = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'];
  return names[Math.round(deg / 45) % 8];
}

function sampleAt(frame, lat, lon) {
  const p = state.pack;
  const gx = (lon - p.bounds.west) / (p.bounds.east - p.bounds.west) * (p.grid.nx - 1);
  const gy = (lat - p.bounds.south) / (p.bounds.north - p.bounds.south) * (p.grid.ny - 1);
  if (gx < 0 || gy < 0 || gx > p.grid.nx - 1 || gy > p.grid.ny - 1) return null;
  const u = sampleGrid(frame.u_ms, p.grid.nx, p.grid.ny, gx, gy, true);
  const v = sampleGrid(frame.v_ms, p.grid.nx, p.grid.ny, gx, gy, true);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  return {
    u,
    v,
    speedKmh: Math.hypot(u, v) * 3.6,
    direction: directionFromUV(u, v),
  };
}

function stopPlay() {
  state.playing = false;
  $('playBtn').textContent = '▶';
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function togglePlay() {
  if (state.playing) {
    stopPlay();
    return;
  }
  state.playing = true;
  $('playBtn').textContent = '❚❚';
  state.timer = setInterval(() => {
    const next = (state.frameIndex + 1) % state.pack.frames.length;
    showFrame(next);
  }, 1050);
}

function setMode(smooth) {
  state.smooth = smooth;
  state.cache.clear();
  $('smoothBtn').classList.toggle('active', smooth);
  $('gridBtn').classList.toggle('active', !smooth);
  setGridOpacity();
  showFrame(state.frameIndex, true);
}

function bindUI() {
  $('gulfCamera').addEventListener('click', fitGulf);
  $('islandCamera').addEventListener('click', fitIsland);
  $('smoothBtn').addEventListener('click', () => setMode(true));
  $('gridBtn').addEventListener('click', () => setMode(false));
  $('playBtn').addEventListener('click', togglePlay);

  $('slider').addEventListener('input', (e) => {
    stopPlay();
    showFrame(Number(e.target.value));
  });

  map.on('click', (e) => {
    if (!state.pack) return;
    const frame = state.pack.frames[state.frameIndex];
    const s = sampleAt(frame, e.lngLat.lat, e.lngLat.lng);
    if (!s) {
      $('probeValue').textContent = 'Ngoài vùng field hiện có';
      $('probeMeta').textContent = 'Basemap vẫn có thể xem bình thường';
      return;
    }
    $('probeValue').textContent = s.speedKmh.toFixed(1) + ' km/h';
    $('probeMeta').textContent =
      cardinal(s.direction) + ' ' + Math.round(s.direction) + '° · ' +
      localTime(frame.valid_time) + ' · nội suy hiển thị từ grid 0.25°';
  });
}

function perfLoop() {
  let count = 0;
  let last = performance.now();
  const loop = (now) => {
    count++;
    if (now - last >= 1000) {
      const fps = Math.round(count * 1000 / (now - last));
      const load = state.loadMs == null ? '--' : (state.loadMs / 1000).toFixed(1) + 's';
      const kb = state.packBytes ? Math.round(state.packBytes / 1024) + 'KB' : '--';
      $('perf').textContent = 'FPS ' + fps + ' · LOAD ' + load + ' · PACK ' + kb;
      count = 0;
      last = now;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

async function boot() {
  bindUI();
  perfLoop();
  $('errorCard').classList.add('hidden');
  $('errorText').textContent = '';
  $('status').textContent = BUILD_ID + ' · đang nạp field…';

  try {
    state.pack = await loadPack();
    if (state.pack?.status !== 'READY' || !(state.pack.frames || []).length) {
      throw new Error('Render pack không READY');
    }

    $('slider').max = String(state.pack.frames.length - 1);
    state.frameIndex = nearestFrameIndex(state.pack.frames);
    addGridOverlay();
    fitGulf();

    if (ENABLE_PARTICLES) await ensureParticleRenderer();
    await showFrame(state.frameIndex, true);

    state.loadMs = performance.now() - state.loadStarted;
    updateLabels();

    if (state.sourceMode !== 'GULF') {
      $('errorCard').classList.remove('hidden');
      $('errorText').textContent =
        'Gulf render pack đang được build nên POC tạm dùng grid Phú Quốc hiện tại. ' +
        'Basemap và renderer vẫn có thể test, nhưng coverage màu chưa phủ toàn Vịnh.';
    }
  } catch (err) {
    console.error('[Gulf Wind Lab] boot failed', err);
    $('status').textContent = 'WEATHER DATA ERROR';
    $('errorCard').classList.remove('hidden');
    $('errorText').textContent =
      'Weather data không tải được. Basemap được giữ độc lập để không bao giờ biến mất. ' +
      String(err?.message || err);
  }
}

map.once('style.load', boot);
