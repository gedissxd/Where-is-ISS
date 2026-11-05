(() => {
  "use strict";

  const ISS_API = "https://api.wheretheiss.at/v1/satellites/25544";
  const GEOCODE_API = "https://nominatim.openstreetmap.org/reverse";
  const IMG = "https://cdn.jsdelivr.net/npm/three-globe@2.45.6/example/img";
  const POLL_MS = 3000;                 // ISS position refresh
  const GEOCODE_MIN_MS = 15000;         // Respect Nominatim's usage policy
  const TRACK_MINUTES = 45;             // Ground track shown before/after "now"
  const TRACK_REFRESH_MS = 10 * 60 * 1000;
  const EARTH_RADIUS_KM = 6371;
  const KM_PER_DEG = 111.32;
  const KM_TO_MI = 0.621371;

  const $ = (id) => document.getElementById(id);
  const el = {
    lat: $("latitude"), lon: $("longitude"), alt: $("altitude"), vel: $("velocity"),
    vis: $("visibility"), foot: $("footprint"), updated: $("last-updated"),
    country: $("country"), status: $("status"), statusText: $("status-text"),
    follow: $("follow"),
  };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isNarrow = () => window.innerWidth <= 860;

  /* ---------------- Units ---------------- */
  let units = "metric";
  try { units = localStorage.getItem("iss-units") || "metric"; } catch (_) {}
  let last = null;

  function applyUnits() {
    document.querySelectorAll(".unit-toggle button").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.unit === units)));
    document.querySelectorAll('[data-unit-label="dist"]').forEach((s) =>
      (s.textContent = units === "metric" ? "km" : "mi"));
    document.querySelectorAll('[data-unit-label="speed"]').forEach((s) =>
      (s.textContent = units === "metric" ? "km/h" : "mph"));
    if (last) renderStats(last);
  }

  document.querySelectorAll(".unit-toggle button").forEach((b) =>
    b.addEventListener("click", () => {
      units = b.dataset.unit;
      try { localStorage.setItem("iss-units", units); } catch (_) {}
      applyUnits();
    }));

  /* ---------------- Formatting ---------------- */
  const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const conv = (km) => (units === "metric" ? km : km * KM_TO_MI);
  const fmtLat = (v) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? "N" : "S"}`;
  const fmtLon = (v) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? "E" : "W"}`;

  function renderStats(d) {
    el.lat.textContent = fmtLat(d.latitude);
    el.lon.textContent = fmtLon(d.longitude);
    el.alt.textContent = nf1.format(conv(d.altitude));
    el.vel.textContent = nf0.format(conv(d.velocity));
    el.foot.textContent = nf0.format(conv(d.footprint));
    el.vis.textContent = d.visibility === "daylight" ? "☀️ Daylight" : "🌙 Eclipsed";
    el.updated.textContent = new Date(d.timestamp * 1000).toLocaleTimeString();
  }

  function setStatus(state, text) {
    el.status.dataset.state = state;
    el.statusText.textContent = text;
  }

  /* ---------------- Globe ---------------- */
  const globeEl = $("globe");
  const issAlt = (km) => km / EARTH_RADIUS_KM;   // globe.gl altitude is in Earth radii

  const markerEl = document.createElement("div");
  markerEl.className = "iss-marker";
  markerEl.textContent = "🛰️";

  let issPoint = null;                 // { lat, lng, alt }
  let tracks = [];                     // [{ kind, points: [[lat, lng, alt], ...] }]

  const globe = new Globe(globeEl, { animateIn: !reduceMotion })
    .backgroundColor("rgba(0,0,0,0)")
    .globeImageUrl(`${IMG}/earth-blue-marble.jpg`)
    .bumpImageUrl(`${IMG}/earth-topology.png`)
    .showAtmosphere(true)
    .atmosphereColor("#6ee7ff")
    .atmosphereAltitude(0.2)
    .width(window.innerWidth)
    .height(window.innerHeight)
    // ISS marker
    .htmlElementsData([])
    .htmlLat("lat").htmlLng("lng").htmlAltitude("alt")
    .htmlElement(() => markerEl)
    .htmlTransitionDuration(0)
    // Ground track
    .pathsData([])
    .pathPoints("points")
    .pathPointLat((p) => p[0]).pathPointLng((p) => p[1]).pathPointAlt((p) => p[2])
    .pathColor((t) => (t.kind === "past"
      ? ["rgba(167,139,250,0.15)", "rgba(167,139,250,0.95)"]
      : ["rgba(110,231,255,0.95)", "rgba(110,231,255,0.15)"]))
    .pathStroke(2)
    .pathResolution(4)
    .pathDashLength((t) => (t.kind === "past" ? 1 : 0.02))
    .pathDashGap((t) => (t.kind === "past" ? 0 : 0.012))
    .pathDashAnimateTime((t) => (t.kind === "past" || reduceMotion ? 0 : 40000))
    .pathTransitionDuration(0)
    // Visibility footprint: rings radiating from the sub-satellite point
    .ringsData([])
    .ringColor(() => (t) => `rgba(110,231,255,${0.6 * (1 - t)})`)
    .ringMaxRadius("radius")
    .ringPropagationSpeed(6)
    .ringRepeatPeriod(reduceMotion ? 0 : 1400);

  // Hide the marker when it is on the far side of the Earth.
  if (typeof globe.htmlElementVisibilityModifier === "function") {
    globe.htmlElementVisibilityModifier((elm, isVisible) => { elm.style.opacity = isVisible ? 1 : 0; });
  }

  const controls = globe.controls();
  controls.enableDamping = true;
  controls.minDistance = 130;
  controls.maxDistance = 900;

  const viewAltitude = () => (isNarrow() ? 2.6 : 2.2);
  globe.pointOfView({ lat: 20, lng: 0, altitude: viewAltitude() }, 0);

  // Any manual drag turns off auto-follow.
  controls.addEventListener("start", () => { el.follow.checked = false; });
  el.follow.addEventListener("change", () => {
    if (el.follow.checked && issPoint) {
      globe.pointOfView({ lat: issPoint.lat, lng: issPoint.lng, altitude: viewAltitude() }, 1200);
    }
  });

  // On narrow screens the stats panel is a bottom sheet, so fit the globe into the space above it.
  const panelEl = document.querySelector(".panel");
  function sizeGlobe() {
    const h = isNarrow() ? Math.max(260, Math.round(panelEl.getBoundingClientRect().top) + 24) : innerHeight;
    globeEl.style.height = `${h}px`;
    globe.width(innerWidth).height(h);
  }
  addEventListener("resize", sizeGlobe);
  if (window.ResizeObserver) new ResizeObserver(sizeGlobe).observe(panelEl);
  sizeGlobe();

  // Keep longitudes continuous so paths never jump the long way around at ±180°.
  function unwrap(points) {
    for (let i = 1; i < points.length; i++) {
      let d = points[i][1] - points[i - 1][1];
      while (d > 180) { points[i][1] -= 360; d -= 360; }
      while (d < -180) { points[i][1] += 360; d += 360; }
    }
    return points;
  }

  /* ---------------- Ground track ---------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fetchPositions(timestamps) {
    const res = await fetch(`${ISS_API}/positions?timestamps=${timestamps.join(",")}&units=kilometers`);
    if (!res.ok) throw new Error(`positions ${res.status}`);
    return res.json();
  }

  // The API takes at most 10 timestamps per call and ~1 req/s, so fetch in spaced batches.
  async function fetchTrack(from, to, count) {
    const step = (to - from) / (count - 1);
    const ts = Array.from({ length: count }, (_, i) => Math.round(from + i * step));
    const out = [];
    for (let i = 0; i < ts.length; i += 10) {
      if (i) await sleep(1100);
      out.push(...(await fetchPositions(ts.slice(i, i + 10))));
    }
    return unwrap(out.map((p) => [p.latitude, p.longitude, issAlt(p.altitude)]));
  }

  let trackFetchedAt = 0;
  let trackBusy = false;
  async function updateTrack(nowSec) {
    if (trackBusy) return;
    trackBusy = true;
    try {
      const span = TRACK_MINUTES * 60;
      const past = await fetchTrack(nowSec - span, nowSec, 20);
      await sleep(1100);
      const future = await fetchTrack(nowSec, nowSec + span, 20);
      tracks = [{ kind: "past", points: past }, { kind: "future", points: future }];
      globe.pathsData(tracks);
      trackFetchedAt = Date.now();
    } catch (err) {
      console.warn("Ground track unavailable:", err);
    } finally {
      trackBusy = false;
    }
  }

  /* ---------------- Reverse geocoding ---------------- */
  let geocodedAt = 0;
  async function updateCountry(lat, lon) {
    if (Date.now() - geocodedAt < GEOCODE_MIN_MS) return;
    geocodedAt = Date.now();
    try {
      const res = await fetch(`${GEOCODE_API}?format=json&lat=${lat}&lon=${lon}&zoom=3&accept-language=en`);
      const data = await res.json();
      const a = data && data.address;
      el.country.textContent = a ? (a.country || a.continent || "Unknown territory") : "🌊 Open ocean";
    } catch (err) {
      console.warn("Geocoding failed:", err);
    }
  }

  /* ---------------- Main loop ---------------- */
  let firstFix = true;
  async function tick() {
    try {
      const res = await fetch(`${ISS_API}?units=kilometers`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      last = d;

      issPoint = { lat: d.latitude, lng: d.longitude, alt: issAlt(d.altitude) };
      globe.htmlElementsData([issPoint]);
      globe.ringsData([{ lat: d.latitude, lng: d.longitude, radius: d.footprint / 2 / KM_PER_DEG }]);

      if (el.follow.checked) {
        const pov = { lat: d.latitude, lng: d.longitude, altitude: firstFix ? viewAltitude() : globe.pointOfView().altitude };
        globe.pointOfView(pov, firstFix ? 2000 : POLL_MS);
      }
      firstFix = false;

      renderStats(d);
      setStatus("live", "Live");
      updateCountry(d.latitude, d.longitude);
      if (Date.now() - trackFetchedAt > TRACK_REFRESH_MS) updateTrack(d.timestamp);
    } catch (err) {
      console.error("Error fetching ISS location:", err);
      setStatus("error", "Offline — retrying");
    } finally {
      setTimeout(tick, POLL_MS);
    }
  }

  applyUnits();
  tick();

  /* ---------------- Starfield ---------------- */
  const canvas = $("starfield");
  const ctx = canvas.getContext("2d");
  let stars = [];

  function resizeStars() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round((innerWidth * innerHeight) / 5000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: Math.random() * 1.3 + 0.3,
      z: Math.random() * 0.6 + 0.2,
      tw: Math.random() * Math.PI * 2,
    }));
  }

  function drawStars(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.fillStyle = "#fff";
    for (const s of stars) {
      if (!reduceMotion) {
        s.x -= s.z * 0.05;
        if (s.x < 0) s.x += innerWidth;
      }
      const a = reduceMotion ? 1 : 0.5 + 0.5 * Math.sin(t / 900 + s.tw);
      ctx.globalAlpha = s.z * (0.5 + a * 0.5);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(drawStars);
  }

  addEventListener("resize", resizeStars);
  resizeStars();
  requestAnimationFrame(drawStars);
})();
