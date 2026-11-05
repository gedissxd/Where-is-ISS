(() => {
  "use strict";

  const ISS_API = "https://api.wheretheiss.at/v1/satellites/25544";
  const GEOCODE_API = "https://nominatim.openstreetmap.org/reverse";
  const POLL_MS = 3000;            // ISS position refresh
  const GEOCODE_MIN_MS = 15000;    // Respect Nominatim's usage policy
  const TRACK_MINUTES = 45;        // Ground track shown before/after "now"
  const KM_TO_MI = 0.621371;

  const $ = (id) => document.getElementById(id);
  const el = {
    lat: $("latitude"), lon: $("longitude"), alt: $("altitude"), vel: $("velocity"),
    vis: $("visibility"), foot: $("footprint"), updated: $("last-updated"),
    country: $("country"), status: $("status"), statusText: $("status-text"),
    follow: $("follow"),
  };

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

  /* ---------------- Map ---------------- */
  const map = L.map("map", {
    worldCopyJump: true,
    zoomControl: true,
    minZoom: 2,
  }).setView([0, 0], 3);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  const issIcon = L.divIcon({ className: "iss-marker", html: "🛰️", iconSize: [40, 40], iconAnchor: [20, 20] });
  const marker = L.marker([0, 0], { icon: issIcon, keyboard: false, title: "ISS" }).addTo(map);
  const footprint = L.circle([0, 0], {
    radius: 1, color: "#6ee7ff", weight: 1, opacity: 0.5, fillColor: "#6ee7ff", fillOpacity: 0.06,
  }).addTo(map);
  const pastTrack = L.polyline([], { color: "#a78bfa", weight: 2, opacity: 0.8 }).addTo(map);
  const futureTrack = L.polyline([], { color: "#6ee7ff", weight: 2, opacity: 0.7, dashArray: "6 8" }).addTo(map);

  // Stop auto-follow when the user pans the map themselves.
  map.on("dragstart", () => { el.follow.checked = false; });
  el.follow.addEventListener("change", () => {
    if (el.follow.checked && last) map.panTo([last.latitude, last.longitude]);
  });

  // Split a lat/lon list wherever it crosses the antimeridian so lines don't streak across the map.
  function splitAntimeridian(points) {
    const segs = [];
    let cur = [];
    for (let i = 0; i < points.length; i++) {
      if (i > 0 && Math.abs(points[i][1] - points[i - 1][1]) > 180) {
        segs.push(cur);
        cur = [];
      }
      cur.push(points[i]);
    }
    if (cur.length) segs.push(cur);
    return segs;
  }

  /* ---------------- Ground track ---------------- */
  async function fetchPositions(timestamps) {
    const res = await fetch(`${ISS_API}/positions?timestamps=${timestamps.join(",")}&units=kilometers`);
    if (!res.ok) throw new Error(`positions ${res.status}`);
    return res.json();
  }

  let trackFetchedAt = 0;
  async function updateTrack(nowSec) {
    // API allows 10 timestamps per request; one request for the past, one for the future.
    const step = (TRACK_MINUTES * 60) / 9;
    const past = Array.from({ length: 10 }, (_, i) => Math.round(nowSec - TRACK_MINUTES * 60 + i * step));
    const future = Array.from({ length: 10 }, (_, i) => Math.round(nowSec + i * step));
    try {
      const [p, f] = await Promise.all([fetchPositions(past), fetchPositions(future)]);
      pastTrack.setLatLngs(splitAntimeridian(p.map((x) => [x.latitude, x.longitude])));
      futureTrack.setLatLngs(splitAntimeridian(f.map((x) => [x.latitude, x.longitude])));
      trackFetchedAt = Date.now();
    } catch (err) {
      console.warn("Ground track unavailable:", err);
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

      const ll = [d.latitude, d.longitude];
      marker.setLatLng(ll);
      footprint.setLatLng(ll).setRadius((d.footprint * 1000) / 2);
      if (firstFix) {
        map.setView(ll, 3, { animate: false });
        firstFix = false;
      } else if (el.follow.checked) {
        map.panTo(ll, { animate: true, duration: 1 });
      }

      renderStats(d);
      setStatus("live", "Live");
      updateCountry(d.latitude, d.longitude);
      if (Date.now() - trackFetchedAt > 5 * 60 * 1000) updateTrack(d.timestamp);
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
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let stars = [];
  let mouse = { x: -9999, y: -9999 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round((innerWidth * innerHeight) / 6000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: Math.random() * 1.4 + 0.3,
      z: Math.random() * 0.6 + 0.2,       // depth → drift speed & brightness
      tw: Math.random() * Math.PI * 2,    // twinkle phase
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const near = [];
    for (const s of stars) {
      if (!reduceMotion) {
        s.x -= s.z * 0.08;
        if (s.x < 0) s.x += innerWidth;
      }
      const a = 0.5 + 0.5 * Math.sin(t / 900 + s.tw);
      ctx.globalAlpha = s.z * (0.5 + a * 0.5);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      const dx = s.x - mouse.x, dy = s.y - mouse.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 140) near.push([s, dist]);
    }
    near.sort((a, b) => a[1] - b[1]);
    for (const [s, dist] of near.slice(0, 4)) {
      ctx.globalAlpha = (1 - dist / 140) * 0.6;
      ctx.strokeStyle = "#6ee7ff";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(mouse.x, mouse.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  addEventListener("resize", resize);
  addEventListener("mousemove", (e) => { mouse = { x: e.clientX, y: e.clientY }; });
  addEventListener("mouseleave", () => { mouse = { x: -9999, y: -9999 }; });
  resize();
  requestAnimationFrame(draw);
})();
