(() => {
  "use strict";

  const URLS = {
    ecmwf: "https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather/spatial-ecmwf.json",
    marine: "https://raw.githubusercontent.com/kenzuko/Jotrip-Lab/feat/weather-lab-data-engine-v1/weather/spatial-marine.json"
  };

  // Strategic default: see the Gulf first, then zoom to island when needed.
  const GULF_BOUNDS = [[100.30, 7.10], [105.65, 12.90]];
  const ISLAND_BOUNDS = [[103.72, 9.84], [104.18, 10.49]];

  const state = {
    ecmwf: null,
    marine: null,
    frames: [],
    frameIndex: 0,
    layer: "wind",
    playing: false,
    playTimer: null,
    scalarLayer: null,
    particleLayer: null,
    currentRows: [],
    currentVectorRows: []
  };

  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = v => (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) ? null : Number(v);

  function parseTime(s) {
    const t = Date.parse(s || "");
    return Number.isFinite(t) ? t : NaN;
  }

  function localStamp(s) {
    const d = new Date(s || "");
    if (!Number.isFinite(d.getTime())) return "--:--";
    return d.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    });
  }

  function ageText(s) {
    const t = parseTime(s);
    if (!Number.isFinite(t)) return "không rõ thời gian";
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 2) return "vừa cập nhật";
    if (mins < 60) return mins + " phút trước";
    return (mins / 60).toFixed(1) + " giờ trước";
  }

  async function fetchJSON(url) {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  const style = {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: ["https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "&copy; OpenStreetMap &copy; CARTO"
      },
      labels: {
        type: "raster",
        tiles: ["https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png"],
        tileSize: 256
      }
    },
    layers: [
      { id: "base", type: "raster", source: "base", paint: { "raster-opacity": 1 } },
      { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.92 } }
    ]
  };

  const map = new maplibregl.Map({
    container: "map",
    style,
    attributionControl: true,
    antialias: true,
    renderWorldCopies: false,
    maxPitch: 0,
    dragRotate: false,
    touchPitch: false
  });

  function fitGulf() {
    map.fitBounds(GULF_BOUNDS, {
      padding: innerWidth < 700 ? { top: 72, right: 6, bottom: 112, left: 6 } : { top: 80, right: 20, bottom: 110, left: 20 },
      duration: 700
    });
    $("gulfBtn").classList.add("active");
    $("islandBtn").classList.remove("active");
  }

  function fitIsland() {
    map.fitBounds(ISLAND_BOUNDS, {
      padding: innerWidth < 700 ? { top: 80, right: 12, bottom: 118, left: 12 } : { top: 86, right: 40, bottom: 120, left: 40 },
      duration: 700
    });
    $("islandBtn").classList.add("active");
    $("gulfBtn").classList.remove("active");
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
    }
    return shader;
  }

  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || "Program link failed");
    }
    return p;
  }

  function mercatorXY(lon, lat) {
    const x = (lon + 180) / 360;
    const r = lat * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
    return [x, y];
  }

  function valueOf(row, layer) {
    if (layer === "wind") return num(row.wind_kmh);
    if (layer === "rain") return num(row.rain_mm);
    if (layer === "waves") return num(row.wave_hs_m);
    if (layer === "current") return num(row.speed_kmh);
    return null;
  }

  function normalizeValue(v, layer) {
    if (v === null) return null;
    if (layer === "wind") return clamp(v / 55, 0, 1);
    if (layer === "rain") return clamp(Math.log1p(Math.max(0, v)) / Math.log1p(30), 0, 1);
    if (layer === "waves") return clamp(v / 2.5, 0, 1);
    if (layer === "current") return clamp(v / 2.2, 0, 1);
    return 0;
  }

  function key(lat, lon) {
    return Number(lat).toFixed(5) + "|" + Number(lon).toFixed(5);
  }

  function buildTriangles(rows, layer) {
    const valid = (rows || []).filter(r => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)) && valueOf(r, layer) !== null);
    if (valid.length < 4) return new Float32Array();

    const lats = [...new Set(valid.map(r => Number(r.lat)))].sort((a, b) => a - b);
    const lons = [...new Set(valid.map(r => Number(r.lon)))].sort((a, b) => a - b);
    const by = new Map(valid.map(r => [key(r.lat, r.lon), r]));
    const out = [];

    const push = r => {
      const [x, y] = mercatorXY(Number(r.lon), Number(r.lat));
      const n = normalizeValue(valueOf(r, layer), layer);
      out.push(x, y, n);
    };

    for (let iy = 0; iy < lats.length - 1; iy++) {
      for (let ix = 0; ix < lons.length - 1; ix++) {
        const a = by.get(key(lats[iy], lons[ix]));
        const b = by.get(key(lats[iy], lons[ix + 1]));
        const c = by.get(key(lats[iy + 1], lons[ix + 1]));
        const d = by.get(key(lats[iy + 1], lons[ix]));
        if (!a || !b || !c || !d) continue;
        push(a); push(b); push(c);
        push(a); push(c); push(d);
      }
    }
    return new Float32Array(out);
  }

  class ScalarFieldLayer {
    constructor() {
      this.id = "jotrip-weather-field";
      this.type = "custom";
      this.renderingMode = "2d";
      this.rows = [];
      this.layer = "wind";
      this.vertices = new Float32Array();
      this.dirty = true;
    }

    setField(rows, layer) {
      this.rows = rows || [];
      this.layer = layer;
      this.vertices = buildTriangles(this.rows, this.layer);
      this.dirty = true;
      if (this.map) this.map.triggerRepaint();
    }

    onAdd(mapInstance, gl) {
      this.map = mapInstance;
      this.gl = gl;
      this.p = program(gl,
        `precision highp float;
         uniform mat4 u_matrix;
         attribute vec2 a_pos;
         attribute float a_value;
         varying float v_value;
         void main() {
           v_value = a_value;
           gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
         }`,
        `precision mediump float;
         uniform float u_alpha;
         uniform float u_palette;
         varying float v_value;

         vec3 mix3(vec3 a, vec3 b, float t){ return a + (b-a)*clamp(t,0.0,1.0); }

         vec3 rampWind(float t){
           if(t < .16) return mix3(vec3(.18,.30,.68), vec3(.13,.58,.83), t/.16);
           if(t < .34) return mix3(vec3(.13,.58,.83), vec3(.18,.76,.67), (t-.16)/.18);
           if(t < .55) return mix3(vec3(.18,.76,.67), vec3(.65,.80,.37), (t-.34)/.21);
           if(t < .74) return mix3(vec3(.65,.80,.37), vec3(.95,.76,.24), (t-.55)/.19);
           if(t < .90) return mix3(vec3(.95,.76,.24), vec3(.93,.34,.28), (t-.74)/.16);
           return mix3(vec3(.93,.34,.28), vec3(.64,.12,.45), (t-.90)/.10);
         }

         vec3 rampRain(float t){
           if(t < .12) return mix3(vec3(.25,.45,.88), vec3(.12,.69,.87), t/.12);
           if(t < .31) return mix3(vec3(.12,.69,.87), vec3(.10,.77,.56), (t-.12)/.19);
           if(t < .53) return mix3(vec3(.10,.77,.56), vec3(.64,.82,.22), (t-.31)/.22);
           if(t < .74) return mix3(vec3(.64,.82,.22), vec3(.98,.76,.17), (t-.53)/.21);
           if(t < .90) return mix3(vec3(.98,.76,.17), vec3(.93,.25,.27), (t-.74)/.16);
           return mix3(vec3(.93,.25,.27), vec3(.61,.08,.50), (t-.90)/.10);
         }

         vec3 rampMarine(float t){
           if(t < .20) return mix3(vec3(.19,.35,.72), vec3(.09,.62,.84), t/.20);
           if(t < .45) return mix3(vec3(.09,.62,.84), vec3(.10,.77,.66), (t-.20)/.25);
           if(t < .70) return mix3(vec3(.10,.77,.66), vec3(.78,.80,.25), (t-.45)/.25);
           if(t < .88) return mix3(vec3(.78,.80,.25), vec3(.95,.49,.24), (t-.70)/.18);
           return mix3(vec3(.95,.49,.24), vec3(.76,.18,.39), (t-.88)/.12);
         }

         void main() {
           float t = clamp(v_value,0.0,1.0);
           vec3 rgb = u_palette < .5 ? rampWind(t) : (u_palette < 1.5 ? rampRain(t) : rampMarine(t));
           float a = u_alpha;
           if(u_palette > .5 && u_palette < 1.5) a *= smoothstep(.018,.16,t);
           else a *= (.34 + .66*smoothstep(.02,.72,t));
           gl_FragColor = vec4(rgb, a);
         }`
      );

      this.aPos = gl.getAttribLocation(this.p, "a_pos");
      this.aValue = gl.getAttribLocation(this.p, "a_value");
      this.uMatrix = gl.getUniformLocation(this.p, "u_matrix");
      this.uAlpha = gl.getUniformLocation(this.p, "u_alpha");
      this.uPalette = gl.getUniformLocation(this.p, "u_palette");
      this.buffer = gl.createBuffer();
    }

    render(gl, matrix) {
      if (!this.vertices.length) return;
      gl.useProgram(this.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      if (this.dirty) {
        gl.bufferData(gl.ARRAY_BUFFER, this.vertices, gl.DYNAMIC_DRAW);
        this.dirty = false;
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);

      const stride = 3 * 4;
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(this.aValue);
      gl.vertexAttribPointer(this.aValue, 1, gl.FLOAT, false, stride, 2 * 4);

      gl.uniformMatrix4fv(this.uMatrix, false, matrix);
      gl.uniform1f(this.uAlpha, this.layer === "rain" ? 0.82 : 0.68);
      gl.uniform1f(this.uPalette, this.layer === "wind" ? 0 : this.layer === "rain" ? 1 : 2);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertices.length / 3);
    }
  }

  function vectorFromRow(r, kind) {
    if (kind === "wind") {
      const u = num(r.u10_ms), v = num(r.v10_ms);
      return u === null || v === null ? null : [u, v];
    }
    if (kind === "current") {
      const u = num(r.u_ms), v = num(r.v_ms);
      return u === null || v === null ? null : [u, v];
    }
    if (kind === "waves") {
      const d = num(r.wave_direction_deg), h = num(r.wave_hs_m);
      if (d === null || h === null) return null;
      const to = (d + 180) * Math.PI / 180;
      return [Math.sin(to) * Math.max(.25, h), Math.cos(to) * Math.max(.25, h)];
    }
    return null;
  }

  class ParticleLayer {
    constructor() {
      this.id = "jotrip-weather-flow";
      this.type = "custom";
      this.renderingMode = "2d";
      this.rows = [];
      this.kind = "wind";
      this.particles = [];
      this.last = performance.now();
    }

    setVectors(rows, kind) {
      this.kind = kind;
      this.rows = (rows || []).map(r => {
        const v = vectorFromRow(r, kind);
        return v ? { lat: Number(r.lat), lon: Number(r.lon), u: v[0], v: v[1] } : null;
      }).filter(Boolean);

      if (!this.rows.length) {
        this.particles = [];
        return;
      }
      this.bounds = {
        west: Math.min(...this.rows.map(r => r.lon)),
        east: Math.max(...this.rows.map(r => r.lon)),
        south: Math.min(...this.rows.map(r => r.lat)),
        north: Math.max(...this.rows.map(r => r.lat))
      };
      this.seed();
      if (this.map) this.map.triggerRepaint();
    }

    seed() {
      if (!this.bounds) return;
      const count = innerWidth < 700 ? 420 : 760;
      this.particles = Array.from({ length: count }, () => this.spawn({}));
    }

    spawn(p) {
      const b = this.bounds;
      p.lon = b.west + Math.random() * (b.east - b.west);
      p.lat = b.south + Math.random() * (b.north - b.south);
      p.prevLon = p.lon;
      p.prevLat = p.lat;
      p.age = 0;
      p.maxAge = 50 + Math.random() * 130;
      return p;
    }

    nearest(lon, lat) {
      let best = null, dBest = Infinity;
      for (const r of this.rows) {
        const dx = (r.lon - lon) * Math.cos(lat * Math.PI / 180);
        const dy = r.lat - lat;
        const d = dx * dx + dy * dy;
        if (d < dBest) { dBest = d; best = r; }
      }
      return best;
    }

    onAdd(mapInstance, gl) {
      this.map = mapInstance;
      this.gl = gl;
      this.p = program(gl,
        `precision highp float;
         uniform mat4 u_matrix;
         attribute vec2 a_pos;
         void main(){ gl_Position = u_matrix * vec4(a_pos,0.0,1.0); }`,
        `precision mediump float;
         uniform float u_alpha;
         void main(){ gl_FragColor = vec4(.96,.99,1.0,u_alpha); }`
      );
      this.aPos = gl.getAttribLocation(this.p, "a_pos");
      this.uMatrix = gl.getUniformLocation(this.p, "u_matrix");
      this.uAlpha = gl.getUniformLocation(this.p, "u_alpha");
      this.buffer = gl.createBuffer();
    }

    render(gl, matrix) {
      if (!this.rows.length || !this.particles.length) return;
      const now = performance.now();
      const dt = clamp((now - this.last) / 1000, 0.005, 0.05);
      this.last = now;
      const verts = new Float32Array(this.particles.length * 4);
      let o = 0;

      const accel = this.kind === "current" ? 0.010 : this.kind === "waves" ? 0.006 : 0.00135;
      for (const p of this.particles) {
        p.prevLon = p.lon;
        p.prevLat = p.lat;
        const v = this.nearest(p.lon, p.lat);
        if (!v) { this.spawn(p); continue; }

        p.lon += v.u * accel * dt;
        p.lat += v.v * accel * dt;
        p.age += 1;

        if (
          p.lon < this.bounds.west || p.lon > this.bounds.east ||
          p.lat < this.bounds.south || p.lat > this.bounds.north ||
          p.age > p.maxAge
        ) this.spawn(p);

        const a = mercatorXY(p.prevLon, p.prevLat);
        const b = mercatorXY(p.lon, p.lat);
        verts[o++] = a[0]; verts[o++] = a[1];
        verts[o++] = b[0]; verts[o++] = b[1];
      }

      gl.useProgram(this.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(this.uMatrix, false, matrix);
      gl.uniform1f(this.uAlpha, this.kind === "wind" ? 0.74 : 0.62);
      gl.lineWidth(1);
      gl.drawArrays(gl.LINES, 0, o / 2);
      this.map.triggerRepaint();
    }
  }

  function nearestFrameIndex() {
    if (!state.frames.length) return 0;
    let best = 0, dist = Infinity;
    state.frames.forEach((f, i) => {
      const t = parseTime(f.valid_time);
      const d = Math.abs(t - Date.now());
      if (Number.isFinite(t) && d < dist) { dist = d; best = i; }
    });
    return best;
  }

  function rowsForLayer() {
    const frame = state.frames[state.frameIndex] || {};
    if (state.layer === "wind") {
      const rows = (frame.cells || []).filter(r => num(r.wind_kmh) !== null && num(r.u10_ms) !== null && num(r.v10_ms) !== null);
      return { scalar: rows, vectors: rows, vectorKind: "wind", time: frame.valid_time, source: "ECMWF IFS" };
    }
    if (state.layer === "rain") {
      const scalar = (frame.cells || []).filter(r => num(r.rain_mm) !== null);
      const vectors = (frame.cells || []).filter(r => num(r.u10_ms) !== null && num(r.v10_ms) !== null);
      return { scalar, vectors, vectorKind: "wind", time: frame.valid_time, source: "ECMWF IFS" };
    }
    if (state.layer === "waves") {
      const rows = (frame.cells || []).filter(r => num(r.wave_hs_m) !== null);
      return { scalar: rows, vectors: rows, vectorKind: "waves", time: frame.valid_time, source: "ECMWF WAVE" };
    }
    if (state.layer === "current") {
      const rows = (state.marine?.current?.cells || []).filter(r => num(r.speed_kmh) !== null);
      return { scalar: rows, vectors: rows, vectorKind: "current", time: state.marine?.current?.sampled_time, source: "COPERNICUS MARINE" };
    }
    return { scalar: [], vectors: [], vectorKind: "wind", time: null, source: "" };
  }

  function updateField() {
    if (state.layer === "cloud") return;
    const data = rowsForLayer();
    state.currentRows = data.scalar;
    state.currentVectorRows = data.vectors;

    state.scalarLayer.setField(data.scalar, state.layer);
    state.particleLayer.setVectors(data.vectors, data.vectorKind);

    $("timeLabel").textContent = localStamp(data.time);
    $("sourceLabel").textContent = data.source;
    $("timeSlider").disabled = state.layer === "current";
    $("timeSlider").style.opacity = state.layer === "current" ? ".35" : "1";

    $("probeValue").textContent = state.layer === "wind" ? "Gió - trường vector"
      : state.layer === "rain" ? "Mưa - bước model"
      : state.layer === "waves" ? "Sóng Hs"
      : "Dòng mặt biển";
    $("probeMeta").textContent = data.source + " · " + localStamp(data.time);
  }

  function setLayer(layer) {
    if (layer === "cloud") {
      $("cloudLock").classList.remove("hidden");
      return;
    }
    state.layer = layer;
    document.querySelectorAll(".layerbar button").forEach(b => b.classList.toggle("active", b.dataset.layer === layer));
    updateField();
  }

  function nearestRow(rows, lat, lon) {
    let best = null, dBest = Infinity;
    for (const r of rows || []) {
      const dx = (Number(r.lon) - lon) * Math.cos(lat * Math.PI / 180);
      const dy = Number(r.lat) - lat;
      const d = dx * dx + dy * dy;
      if (d < dBest) { dBest = d; best = r; }
    }
    return best;
  }

  function compass(deg) {
    const d = num(deg);
    if (d === null) return "";
    const labels = ["Bắc","Đông Bắc","Đông","Đông Nam","Nam","Tây Nam","Tây","Tây Bắc"];
    return labels[Math.round(d / 45) % 8] + " " + Math.round(d) + "°";
  }

  function probeAt(lngLat) {
    const row = nearestRow(state.currentRows, lngLat.lat, lngLat.lng);
    if (!row) return;
    let value = "";
    let meta = "";
    const data = rowsForLayer();

    if (state.layer === "wind") {
      value = Math.round(num(row.wind_kmh) || 0) + " km/h";
      meta = compass(row.wind_direction_deg);
    } else if (state.layer === "rain") {
      value = (num(row.rain_mm) || 0).toFixed(2) + " mm";
      meta = "Lượng mưa của bước model";
    } else if (state.layer === "waves") {
      value = (num(row.wave_hs_m) || 0).toFixed(2) + " m Hs";
      const p = num(row.wave_period_s);
      meta = compass(row.wave_direction_deg) + (p !== null ? " · " + p.toFixed(1) + " s" : "");
    } else if (state.layer === "current") {
      value = (num(row.speed_kmh) || 0).toFixed(2) + " km/h";
      meta = compass(row.direction_toward_deg);
    }

    $("probeValue").textContent = value;
    $("probeMeta").textContent = [meta, data.source, localStamp(data.time)].filter(Boolean).join(" · ");
  }

  function play() {
    if (state.layer === "current" || state.layer === "cloud") return;
    state.playing = !state.playing;
    $("playBtn").textContent = state.playing ? "❚❚" : "▶";
    if (state.playTimer) clearInterval(state.playTimer);
    state.playTimer = null;
    if (state.playing) {
      state.playTimer = setInterval(() => {
        state.frameIndex = (state.frameIndex + 1) % state.frames.length;
        $("timeSlider").value = String(state.frameIndex);
        updateField();
      }, 800);
    }
  }

  function bindUI() {
    $("gulfBtn").addEventListener("click", fitGulf);
    $("islandBtn").addEventListener("click", fitIsland);
    document.querySelectorAll(".layerbar button").forEach(b => b.addEventListener("click", () => setLayer(b.dataset.layer)));
    $("closeCloudLock").addEventListener("click", () => $("cloudLock").classList.add("hidden"));
    $("cloudLock").addEventListener("click", e => { if (e.target === $("cloudLock")) $("cloudLock").classList.add("hidden"); });
    $("playBtn").addEventListener("click", play);
    $("timeSlider").addEventListener("input", e => {
      state.frameIndex = Number(e.target.value);
      updateField();
    });
    map.on("click", e => probeAt(e.lngLat));
  }

  async function boot() {
    try {
      const [ecmwf, marine] = await Promise.all([fetchJSON(URLS.ecmwf), fetchJSON(URLS.marine)]);
      state.ecmwf = ecmwf;
      state.marine = marine;
      state.frames = ecmwf?.spatial?.frames || [];
      if (!state.frames.length) throw new Error("Engine không có spatial frames");

      state.frameIndex = nearestFrameIndex();
      $("timeSlider").max = String(state.frames.length - 1);
      $("timeSlider").value = String(state.frameIndex);
      $("freshness").textContent = "ENGINE · " + ageText(ecmwf.generated_at || ecmwf.run_time);

      state.scalarLayer = new ScalarFieldLayer();
      state.particleLayer = new ParticleLayer();
      map.addLayer(state.scalarLayer, "labels");
      map.addLayer(state.particleLayer, "labels");

      updateField();
    } catch (err) {
      console.error("[WeatherGL V8]", err);
      $("freshness").textContent = "ENGINE LOAD ERROR";
      $("probeValue").textContent = "Chưa tải được dữ liệu";
      $("probeMeta").textContent = String(err?.message || err);
    }
  }

  map.on("load", () => {
    fitGulf();
    bindUI();
    boot();
  });
})();