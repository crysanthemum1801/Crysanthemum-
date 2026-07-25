/* ═══════════════════════════════════════════
   CHRYSANTHEMUM — app.js
   Vanilla JS · No frameworks · Firebase CDN
   ═══════════════════════════════════════════ */

"use strict";

// ─────────────────────────────────────────────
//  PASSWORD — change this string to set yours
// ─────────────────────────────────────────────
const UNIVERSE_PASSWORD = "albedo";

// ─── Universe world dimensions (large virtual canvas) ───
const WORLD_W = 6000;
const WORLD_H = 6000;

// ─── Overlap prevention radius (px in world-space) ───
const MIN_STAR_RADIUS = 52;

// ─── Long-press duration (ms) ───
const LONG_PRESS_MS = 650;

// ─── Special stars (fixed, permanent) ───
const SPECIAL_STARS = [
  {
    id:       "bigbang",
    title:    "Big Bang",
    memory:   "The first message. 2 jan 2025.",
    creator:  "",
    x:        3000,
    y:        3000,
    type:     "bigbang",
    createdAt: "In the beginning",
    timestamp: 0
  },
  {
    id:       "confession",
    title:    "Confession",
    memory:   "18 January 2026. 3 guesses",
    creator:  "",
    x:        3140,
    y:        2900,
    type:     "confession",
    createdAt: "January 18, 2026",
    timestamp: new Date("2026-01-18").getTime()
  }
];

// ─────────────────────────────────────────────
//  GLOBALS
// ─────────────────────────────────────────────
let stars = [];            // all stars (special + firestore)
let cam   = { x: 2600, y: 2550, zoom: 1.0 };  // camera state

let isDragging    = false;
let dragStartX    = 0;
let dragStartY    = 0;
let dragStartCamX = 0;
let dragStartCamY = 0;
let hasDragged    = false;
let lastTapTime   = 0;

let pendingLongPress = null;     // setTimeout id
let longPressTriggered = false;
let longPressWorldX = 0;
let longPressWorldY = 0;
let longPressScreenX = 0;
let longPressScreenY = 0;

// Pinch-to-zoom state
let pinchStartDist  = 0;
let pinchStartZoom  = 1;
let isPinching      = false;

// Touch tap tracking (for star-open on mobile)
let touchTapStartX  = 0;
let touchTapStartY  = 0;

// Canvas & context
let canvas, ctx;
let particles = [];
const PARTICLE_COUNT = 80;

// Background twinkle stars (purely visual, not data)
let bgStars = [];
let dustPatches = [];
// V3.1: Big Bang particle field
let bigBangParticles = [];
const BIGBANG_PARTICLE_COUNT = 18;
const BG_STAR_COUNT = 220;

let hintShown        = false;
let hintTimeout      = null;
let creationLock     = false;  // debounce creation
let pendingCreatePos = null;   // {x, y} world coords

// ─── V2 state ───
let linkingMode      = false;  // true when user is picking a binary partner
let linkingSourceId  = null;   // id of the star waiting for a partner
let openModalStar    = null;   // star currently shown in memory modal

// ─── V3.2: wandering starlight ───
let starlight = null;            // active journey state, or null when idle
let starlightIdleUntil = 0;      // ts when next journey may begin
let startupPulse     = 1.0;   // 1.0 → 0 over ~1s; drives wakeup animation

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initPasswordScreen();
});

window.addEventListener("firebase-ready", () => {
  // Firebase is loaded; universe init happens after password
});

// ─────────────────────────────────────────────
//  PASSWORD SCREEN
// ─────────────────────────────────────────────
function initPasswordScreen() {
  const bgCanvas = document.getElementById("bg-canvas");
  const bgCtx    = bgCanvas.getContext("2d");

  function resizeBg() {
    bgCanvas.width  = window.innerWidth;
    bgCanvas.height = window.innerHeight;
  }
  resizeBg();
  window.addEventListener("resize", resizeBg);

  // Subtle background stars for password screen
  const pwStars = Array.from({ length: 160 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.1 + 0.2,
    alpha: Math.random() * 0.5 + 0.1,
    speed: Math.random() * 0.003 + 0.001,
    phase: Math.random() * Math.PI * 2
  }));

  let t = 0;
  function drawBg() {
    const W = bgCanvas.width;
    const H = bgCanvas.height;
    bgCtx.clearRect(0, 0, W, H);
    t += 0.012;
    for (const s of pwStars) {
      const a = s.alpha * (0.6 + 0.4 * Math.sin(t * s.speed * 60 + s.phase));
      bgCtx.beginPath();
      bgCtx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      bgCtx.fillStyle = `rgba(180,190,240,${a})`;
      bgCtx.fill();
    }
    requestAnimationFrame(drawBg);
  }
  drawBg();

  // Password submit
  const input  = document.getElementById("password-input");
  const btn    = document.getElementById("enter-btn");
  const errMsg = document.getElementById("password-error");

  function tryEnter() {
    const val = input.value.trim();
    if (val.toLowerCase() === UNIVERSE_PASSWORD.toLowerCase()) {
      errMsg.textContent = "";
      document.getElementById("password-screen").classList.add("fade-out");
      setTimeout(launchUniverse, 900);
    } else {
      errMsg.textContent = "the stars don't recognize that.";
      input.value = "";
      input.focus();
    }
  }

  btn.addEventListener("click", tryEnter);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") tryEnter();
  });
}

// ─────────────────────────────────────────────
//  LAUNCH UNIVERSE
// ─────────────────────────────────────────────
function launchUniverse() {
  const screen = document.getElementById("universe-screen");
  screen.classList.remove("hidden");
  requestAnimationFrame(() => screen.classList.add("visible"));

  canvas = document.getElementById("universe-canvas");
  ctx    = canvas.getContext("2d");

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

// Seed background stars and particles
  generateBgStars();
  generateDustPatches();
  generateParticles();
  generateBigBangParticles();

  // Load special stars first
  stars = [...SPECIAL_STARS];

  // Start render loop
  requestAnimationFrame(renderLoop);

  // Attach interaction events
  attachPointerEvents();
  attachModalEvents();

  // Subscribe to Firestore once firebase is ready
  if (window._firebase) {
    subscribeToFirestore();
  } else {
    window.addEventListener("firebase-ready", subscribeToFirestore);
  }

  // Show hint after 2s
  hintTimeout = setTimeout(showHint, 2000);

  // Center camera on Big Bang
  cam.x = SPECIAL_STARS[0].x - canvas.width  / 2 / cam.zoom;
  cam.y = SPECIAL_STARS[0].y - canvas.height / 2 / cam.zoom;
}

// ─────────────────────────────────────────────
//  CANVAS RESIZE
// ─────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

// ─────────────────────────────────────────────
//  BACKGROUND STARS (visual only)
// ─────────────────────────────────────────────
function generateBgStars() {
  // Layer 1: tiny distant texture — ~140 stars
  const layer1 = Array.from({ length: 600 }, () => ({
    x:     Math.random() * WORLD_W,
    y:     Math.random() * WORLD_H,
    r:     Math.random() * 0.5 + 0.2,
    alpha: Math.random() * 0.25 + 0.12,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.010 + 0.002,
    layer: 1
  }));

  // Layer 2: mid stars — ~70
  const layer2 = Array.from({ length: 280 }, () => ({
    x:     Math.random() * WORLD_W,
    y:     Math.random() * WORLD_H,
    r:     Math.random() * 0.5 + 0.45,
    alpha: Math.random() * 0.30 + 0.25,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.008 + 0.002,
    layer: 2
  }));

  // Layer 3: rare bright stars with light bleed — ~12
  const layer3 = Array.from({ length: 40 }, () => ({
    x:     Math.random() * WORLD_W,
    y:     Math.random() * WORLD_H,
    r:     Math.random() * 1.0 + 1.0,
    alpha: Math.random() * 0.45 + 0.55,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.006 + 0.0015,
    layer: 3
  }));

  bgStars = [...layer1, ...layer2, ...layer3];
}

// ─────────────────────────────────────────────
//  V3: DUST PATCHES (generated once, not per-frame)
// ─────────────────────────────────────────────
   
function generateDustPatches() {
  const hues = [
    "70,90,160",   // blue
    "120,95,165",  // lavender
    "60,70,140"    // indigo
  ];

  dustPatches = [];
  let attempts = 0;

  while (dustPatches.length < 5 && attempts < 200) {
    attempts++;
    const candidate = {
      x:      Math.random() * WORLD_W,
      y:      Math.random() * WORLD_H,
      radius: 900 + Math.random() * 500,
      hue:    hues[Math.floor(Math.random() * hues.length)]
    };
    const tooClose = dustPatches.some(p =>
      Math.hypot(p.x - candidate.x, p.y - candidate.y) < (p.radius + candidate.radius) * 0.55
    );
    if (!tooClose) dustPatches.push(candidate);
  }
}

// ─── V3.1: seed Big Bang particle field once, around fixed origin ───
function generateBigBangParticles() {
  const cx = SPECIAL_STARS[0].x;
  const cy = SPECIAL_STARS[0].y;

  bigBangParticles = Array.from({ length: BIGBANG_PARTICLE_COUNT }, () => {
    const orbitRadius = 30 + Math.random() * 70;
    return {
      angle:       Math.random() * Math.PI * 2,
      orbitRadius: orbitRadius,
      orbitSpeed:  (Math.random() * 0.0003 + 0.00012) * (Math.random() < 0.5 ? 1 : -1),
      r:           Math.random() * 0.8 + 0.4,
      alpha:       Math.random() * 0.18 + 0.07,
      phase:       Math.random() * Math.PI * 2,
      shimmerSpeed: Math.random() * 0.0015 + 0.0008
    };
  });

  // Store origin so the draw function doesn't need SPECIAL_STARS lookup every frame
  bigBangParticles.originX = cx;
  bigBangParticles.originY = cy;
}

// ─────────────────────────────────────────────
//  FLOATING PARTICLES (atmospheric)
// ─────────────────────────────────────────────
function generateParticles() {
  particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x:    Math.random() * WORLD_W,
    y:    Math.random() * WORLD_H,
    r:    Math.random() * 1.2 + 0.3,
    vx:   (Math.random() - 0.5) * 0.12,
    vy:   (Math.random() - 0.5) * 0.12,
    alpha: Math.random() * 0.08 + 0.02
  }));
}

// ─────────────────────────────────────────────
//  FIRESTORE SUBSCRIPTION
// ─────────────────────────────────────────────
function subscribeToFirestore() {
  const { db, collection, onSnapshot, query, orderBy } = window._firebase;
  const q = query(collection(db, "stars"), orderBy("timestamp", "asc"));

  onSnapshot(q, (snapshot) => {
    // Remove old firestore stars, keep specials
    stars = [...SPECIAL_STARS];

    snapshot.forEach(doc => {
      const data = doc.data();
      stars.push({
        id:           doc.id,
        title:        data.title         || "",
        memory:       data.memory        || "",
        creator:      data.creator       || "",
        x:            data.x,
        y:            data.y,
        type:         "memory",
        createdAt:    formatTimestamp(data.createdAt),
        timestamp:    data.timestamp     || 0,
        // V2 fields — all optional, backward-compatible defaults
        size:         data.size          || "standard",
        color:        data.color         || "white",
        aura:         data.aura          || "none",
        linkedStarId: data.linkedStarId  || null,
        // V3.2 field
        isCelestial:  data.isCelestial   === true,
        // Birthday Nebula field
        birthdayNebula: data.birthdayNebula === true
      });
    });

    updateStarCount();
  }, (err) => {
    console.error("Firestore error:", err);
  });
}

function updateStarCount() {
  const memoryStars = stars.filter(s => s.type === "memory").length;
  const el = document.getElementById("star-count");
  el.textContent = memoryStars === 1 ? "1 memory" : `${memoryStars} memories`;
}

// ─────────────────────────────────────────────
//  RENDER LOOP
// ─────────────────────────────────────────────
let lastTime = 0;
function renderLoop(ts) {
  const dt = Math.min((ts - lastTime) / 16.67, 3);  // cap delta
  lastTime = ts;

  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  // Space background gradient
  const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.85);
  grad.addColorStop(0, "#0c0e1e");
  grad.addColorStop(1, "#060710");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.save();

  // Apply camera transform
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x - W / 2, -cam.y - H / 2);

  // Draw background nebula haze
  drawNebula();

  // Draw bg stars (twinkle)
  drawBgStars(ts);

  // Drift particles
  updateAndDrawParticles(dt);

  // V2: tick startup pulse (fades from 1 → 0 over ~1.2s)
  if (startupPulse > 0) startupPulse = Math.max(0, startupPulse - dt * 0.014);

// V2: draw binary threads beneath stars
  drawBinaryThreads(ts);

  // V3.1: Big Bang particle field (drawn once per frame, not per star)
  drawBigBangParticles(ts);

  // Draw memory stars
  for (const star of stars) {
    drawStar(star, ts);
  }

  // V3.2: wandering starlight (drawn above stars, last)
  updateAndDrawStarlight(ts);

  ctx.restore();

  requestAnimationFrame(renderLoop);
}
   
// ─────────────────────────────────────────────
//  NEBULA HAZE
// ─────────────────────────────────────────────
function drawNebula() {
  for (const p of dustPatches) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
    g.addColorStop(0,    `rgba(${p.hue},0.30)`);
    g.addColorStop(0.35, `rgba(${p.hue},0.18)`);
    g.addColorStop(0.7,  `rgba(${p.hue},0.08)`);
    g.addColorStop(1,    "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─────────────────────────────────────────────
//  BACKGROUND STAR RENDERING
// ─────────────────────────────────────────────
function drawBgStars(ts) {
  const t = ts * 0.001;
  for (const s of bgStars) {
    const a = s.alpha * (0.8 + 0.2 * Math.sin(t * s.speed * 6 + s.phase));

    // V3: subtle light bleed, Layer 3 (bright/rare) stars only
    if (s.layer === 3) {
      const bleedR = s.r * 7;
      const bleed = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, bleedR);
      bleed.addColorStop(0, `rgba(200,210,255,${a * 0.18})`);
      bleed.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bleed;
      ctx.beginPath();
      ctx.arc(s.x, s.y, bleedR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,210,255,${a})`;
    ctx.fill();
  }
}

// ─────────────────────────────────────────────
//  PARTICLES
// ─────────────────────────────────────────────
function updateAndDrawParticles(dt) {
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.x < 0) p.x += WORLD_W;
    if (p.x > WORLD_W) p.x -= WORLD_W;
    if (p.y < 0) p.y += WORLD_H;
    if (p.y > WORLD_H) p.y -= WORLD_H;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(140,160,220,${p.alpha})`;
    ctx.fill();
  }
}

// ─── V3.1: drift + draw Big Bang particle field ───
function drawBigBangParticles(ts) {
  const cx = bigBangParticles.originX;
  const cy = bigBangParticles.originY;

  for (const p of bigBangParticles) {
    p.angle += p.orbitSpeed * (ts - (p._lastTs || ts));
    p._lastTs = ts;

    const x = cx + Math.cos(p.angle) * p.orbitRadius;
    const y = cy + Math.sin(p.angle) * p.orbitRadius * 0.6; // slight ellipse, feels less mechanical

    const shimmer = 0.6 + 0.4 * Math.sin(ts * p.shimmerSpeed + p.phase);
    const alpha = p.alpha * shimmer;

    ctx.beginPath();
    ctx.arc(x, y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(190,200,245,${alpha})`;
    ctx.fill();
  }
}

// ─── V2: Binary thread rendering ───
function drawBinaryThreads(ts) {
  const t = ts * 0.001;
  const drawn = new Set();

  for (const star of stars) {
    if (!star.linkedStarId) continue;
    const key = [star.id, star.linkedStarId].sort().join(":");
    if (drawn.has(key)) continue;
    drawn.add(key);

    const partner = stars.find(s => s.id === star.linkedStarId);
    if (!partner) continue;

    const pulseBoost = startupPulse * 0.35;
    const baseAlpha  = 0.10 + pulseBoost;
    const shimmer    = 0.03 * Math.sin(t * 1.4 + hashPhase(star.id) * 6.28);
    const alpha      = Math.min(0.55, baseAlpha + shimmer);

    const grad = ctx.createLinearGradient(star.x, star.y, partner.x, partner.y);
    grad.addColorStop(0,   `rgba(180,195,255,${alpha})`);
    grad.addColorStop(0.5, `rgba(200,210,255,${alpha * 1.3})`);
    grad.addColorStop(1,   `rgba(180,195,255,${alpha})`);

    ctx.beginPath();
    ctx.moveTo(star.x, star.y);
    ctx.lineTo(partner.x, partner.y);
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 0.6;
    ctx.stroke();
  }
}

// ─────────────────────────────────────────────
//  DRAW INDIVIDUAL STAR
// ─────────────────────────────────────────────
function drawStar(star, ts) {
  const t = ts * 0.001;

  if (star.type === "bigbang") {
    drawBigBang(star, t);
  } else if (star.type === "confession") {
    drawConfessionStar(star, t);
  } else {
    drawMemoryStar(star, ts);
  }
}

function drawBigBang(star, t) {
  const pulse = 0.7 + 0.3 * Math.sin(t * 0.9);

  // Outer glow
  const og = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, 36 * pulse);
  og.addColorStop(0, `rgba(160,175,240,${0.18 * pulse})`);
  og.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = og;
  ctx.beginPath();
  ctx.arc(star.x, star.y, 36 * pulse, 0, Math.PI * 2);
  ctx.fill();

  // Core
  ctx.beginPath();
  ctx.arc(star.x, star.y, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(220,225,255,${0.88 + 0.12 * Math.sin(t * 1.2)})`;
  ctx.fill();

  // Inner ring
  ctx.beginPath();
  ctx.arc(star.x, star.y, 9, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(160,175,240,${0.22 * pulse})`;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Label
  ctx.font = "300 9px 'Inter', sans-serif";
  ctx.fillStyle = `rgba(180,190,240,0.55)`;
  ctx.letterSpacing = "0.08em";
  ctx.textAlign = "center";
  ctx.fillText("Big Bang", star.x, star.y + 22);
}

function drawConfessionStar(star, t) {
  const pulse = 0.75 + 0.25 * Math.sin(t * 1.1 + 0.8);

  // Glow
  const g = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, 22 * pulse);
  g.addColorStop(0, `rgba(190,180,255,${0.2 * pulse})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(star.x, star.y, 22 * pulse, 0, Math.PI * 2);
  ctx.fill();

  // Core
  ctx.beginPath();
  ctx.arc(star.x, star.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(210,205,255,${0.9 + 0.1 * Math.sin(t * 1.4)})`;
  ctx.fill();

  // Label
  ctx.font = "300 8px 'Inter', sans-serif";
  ctx.fillStyle = `rgba(180,175,240,0.5)`;
  ctx.textAlign = "center";
  ctx.fillText("Confession", star.x, star.y + 16);
}

function drawMemoryStar(star, ts) {
  const t       = ts * 0.001;
  const phase   = hashPhase(star.id);
  const twinkle = 0.7 + 0.3 * Math.sin(t * (1.0 + phase * 0.5) + phase * 6.28);

// ── V3.2: celestial override — takes priority over normal size/color ──
  const isCelestial = star.isCelestial === true;

   // ── Birthday Nebula — drawn behind the star so it stays the focal point ──
  if (star.birthdayNebula === true) {
    drawBirthdayNebula(star, ts);
  }

  // ── V2: size ──
  const size = star.size || "standard";
  let sizeScale = size === "tiny" ? 0.55 : size === "big" ? 2.6 : 1.0;
  if (isCelestial) sizeScale = 4.2; // larger than "big" (2.6)

  // ── V2: age-based brightness (uses existing timestamp, no new field) ──
  const ageMs      = Date.now() - (star.timestamp || 0);
  const ageDays    = ageMs / 86400000;
  // Caps at 30 days → +0.28 max glow boost, logarithmic curve
  let ageBrightness = Math.min(0.28, Math.log1p(ageDays) * 0.07);
  if (isCelestial) ageBrightness += 0.22; // stronger glow, always

  // ── V2: color palette (celestial keeps its stored random color) ──
  const [coreRGB, glowRGB] = starColorPalette(star.color || "white");

  // ── Glow ──
  const gR = (12 + ageBrightness * 40) * twinkle * sizeScale;
  const gAlpha = (0.12 + ageBrightness) * twinkle;
  const g = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, gR);
  g.addColorStop(0, `rgba(${glowRGB},${gAlpha})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(star.x, star.y, gR, 0, Math.PI * 2);
  ctx.fill();

  // ── V2: halo aura ──
  if ((star.aura || "none") === "halo") {
    const haloR = (7 + ageBrightness * 8) * sizeScale;
    const startupBoost = startupPulse * 0.18;
    ctx.beginPath();
    ctx.arc(star.x, star.y, haloR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${glowRGB},${0.18 + startupBoost})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

// ── V3.1: radiant aura — delicate four-point glint ──
  if ((star.aura || "none") === "radiant") {
    drawRadiantGlint(star.x, star.y, glowRGB, twinkle, sizeScale);
  }

  // ── V3.2: celestial — elegant six-point glint, always present ──
  if (isCelestial) {
    drawCelestialGlint(star.x, star.y, glowRGB, twinkle, sizeScale);
  }

  // ── Core dot ──
  const coreR = (1.8 + 0.6 * twinkle) * sizeScale;
  const coreAlpha = 0.75 + 0.25 * twinkle + ageBrightness * 0.5;
  ctx.beginPath();
  ctx.arc(star.x, star.y, coreR, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${coreRGB},${Math.min(1, coreAlpha)})`;
  ctx.fill();
}

// ─── V3.1: radiant glint — short vertical + horizontal rays ───
function drawRadiantGlint(x, y, glowRGB, twinkle, sizeScale) {
  const rayLength = 18 * sizeScale * twinkle;
  const rayAlpha  = 0.60 * twinkle;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Vertical ray
  const vGrad = ctx.createLinearGradient(x, y - rayLength, x, y + rayLength);
  vGrad.addColorStop(0,   "rgba(0,0,0,0)");
  vGrad.addColorStop(0.5, `rgba(${glowRGB},${rayAlpha})`);
  vGrad.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.strokeStyle = vGrad;
  ctx.lineWidth   = 1.6 * sizeScale;
  ctx.beginPath();
  ctx.moveTo(x, y - rayLength);
  ctx.lineTo(x, y + rayLength);
  ctx.stroke();

  // Horizontal ray
  const hGrad = ctx.createLinearGradient(x - rayLength, y, x + rayLength, y);
  hGrad.addColorStop(0,   "rgba(0,0,0,0)");
  hGrad.addColorStop(0.5, `rgba(${glowRGB},${rayAlpha})`);
  hGrad.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.strokeStyle = hGrad;
  ctx.lineWidth   = 1.6 * sizeScale;
  ctx.beginPath();
  ctx.moveTo(x - rayLength, y);
  ctx.lineTo(x + rayLength, y);
  ctx.stroke();

  ctx.restore();
}

// ─── V3.2: celestial glint — six soft rays, evenly spaced ───
function drawCelestialGlint(x, y, glowRGB, twinkle, sizeScale) {
  const rayLength = 22 * sizeScale * twinkle;
  const rayAlpha  = 0.5 * twinkle;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i; // 60° apart
    const dx = Math.cos(angle) * rayLength;
    const dy = Math.sin(angle) * rayLength;

    const grad = ctx.createLinearGradient(x, y, x + dx, y + dy);
    grad.addColorStop(0,   `rgba(${glowRGB},${rayAlpha})`);
    grad.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 1.1 * sizeScale;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }

  ctx.restore();
}

// ─── Birthday Nebula: persistent dust-particle state per star ───
const nebulaParticleState = new Map();

// Fixed visual size for every Birthday Nebula — deliberately independent of
// the star's own size setting, so it's always as noticeable as a Celestial Star.
// NOTE: this value is also read by findStarAtWorld() for tap/click hit-testing.
const NEBULA_VISUAL_RADIUS = 80;

// Smoothly-interpolated irregular boundary radius (0.55–1.35 × base) so the
// cloud's silhouette has organic protrusions and gaps instead of being circular.
function lobeBoundary(id, angle) {
  const lobeCount = 10;
  const norm     = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const segAngle = (Math.PI * 2) / lobeCount;
  const idx      = Math.floor(norm / segAngle);
  const frac     = (norm - idx * segAngle) / segAngle;
  const idxNext  = (idx + 1) % lobeCount;
  const v0 = hashPhase(id + "lobe" + idx);
  const v1 = hashPhase(id + "lobe" + idxNext);
  const smooth = frac * frac * (3 - 2 * frac);
  return 0.55 + (v0 + (v1 - v0) * smooth) * 0.8;
}

function getNebulaParticles(starId) {
  if (!nebulaParticleState.has(starId)) {
    const N = 260; // hundreds of particles, generated once and cached
    const palette = [
      { c: "255,150,190", w: 0.34 }, // rose
      { c: "225,90,175",  w: 0.28 }, // magenta
      { c: "180,155,235", w: 0.28 }, // lavender
      { c: "235,205,150", w: 0.10 }  // gold, rare accent
    ];
    const pickColor = () => {
      let r = Math.random();
      for (const p of palette) {
        if (r < p.w) return p.c;
        r -= p.w;
      }
      return palette[0].c;
    };

    const particles = Array.from({ length: N }, () => {
      const angle     = Math.random() * Math.PI * 2;
      const isWisp    = Math.random() < 0.18; // strays that dissolve into space
      const radiusFrac = isWisp
        ? 1.0 + Math.random() * 0.5
        : Math.pow(Math.random(), 0.55); // biased dense toward center

      return {
        angle,
        radiusFrac,
        size: isWisp
          ? (0.5 + Math.random() * 1.0)
          : (0.6 + (1 - radiusFrac) * 1.8 + Math.random() * 0.9),
        baseAlpha: isWisp
          ? 0.05 + Math.random() * 0.08
          : Math.max(0.06, (1 - radiusFrac) * 0.55 + 0.10) * (0.75 + Math.random() * 0.5),
        color: pickColor(),
        phase: Math.random() * Math.PI * 2,
        speed: 0.15 + Math.random() * 0.25,
        jitter: 1.5 + Math.random() * 2.5,
        angularVelocity: (Math.random() - 0.5) * 0.006, // slow independent orbital drift (rad/sec)
        radDriftSpeed:   0.03 + Math.random() * 0.05,    // very slow radial breathing
        radDriftPhase:   Math.random() * Math.PI * 2,
        glowSpeed:       0.02 + Math.random() * 0.05,    // slow independent brighten/fade
        glowPhase:       Math.random() * Math.PI * 2
      };
    });
    nebulaParticleState.set(starId, particles);
  }
  return nebulaParticleState.get(starId);
}

function drawBirthdayNebula(star, ts) {
  const t  = ts * 0.001;
  const id = star.id || "";

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  const particles = getNebulaParticles(id);

  // Very slow whole-cloud rotation so the silhouette evolves gradually
  // over minutes, rather than the nebula ever pulsing as one unit.
  const shapeDrift = t * 0.0008;

  particles.forEach(p => {
    const driftedAngle = p.angle + shapeDrift + t * p.angularVelocity;
    const boundaryR = lobeBoundary(id, driftedAngle) * NEBULA_VISUAL_RADIUS;

    // slow, independent radial breathing per particle — flowing gas, not a pulse
    const radBreathe = 1 + Math.sin(t * p.radDriftSpeed + p.radDriftPhase) * 0.06;
    const baseR = p.radiusFrac * boundaryR * radBreathe;

    // gentle organic jitter so the cloud feels alive, not static
    const jx = Math.sin(t * p.speed + p.phase) * p.jitter;
    const jy = Math.cos(t * p.speed * 0.8 + p.phase) * p.jitter;

    const px = star.x + Math.cos(driftedAngle) * baseR + jx;
    const py = star.y + Math.sin(driftedAngle) * baseR + jy;

    // fast subtle flicker + slow independent regional brighten/fade,
    // decoupled per particle so the cloud never pulses as a whole
    const flicker   = 0.85 + 0.15 * Math.sin(t * (p.speed + 0.3) + p.phase * 2);
    const glowDrift = 0.85 + 0.15 * Math.sin(t * p.glowSpeed + p.glowPhase);
    const alpha = Math.min(0.85, p.baseAlpha * flicker * glowDrift);

    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.color},${alpha})`;
    ctx.fill();
  });

  ctx.restore();
}
   
// ─── V3.2: advance and draw the single active starlight, if any ───
function updateAndDrawStarlight(ts) {
  if (!starlight) {
    if (ts >= starlightIdleUntil) startStarlightJourney(ts);
    return;
  }

  const { route, legIndex, legStartTs, legDuration } = starlight;
  const from = route[legIndex];
  const to   = route[legIndex + 1];

  const elapsed  = ts - legStartTs;
  const progress = Math.min(1, elapsed / legDuration);

  // gentle ease (no linear, mechanical motion)
  const eased = progress < 0.5
    ? 2 * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 2) / 2;

  const x = from.x + (to.x - from.x) * eased;
  const y = from.y + (to.y - from.y) * eased;

  // ── draw the wandering light itself ──
  let opacity = 1;
  if (starlight.fadingOut) {
    const fadeElapsed = ts - starlight.fadeStartTs;
    opacity = Math.max(0, 1 - fadeElapsed / 900);
  }

  if (opacity > 0) {
    const shimmer = 0.7 + 0.3 * Math.sin(ts * 0.004);
    const glowR = 9 * shimmer;
    const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    g.addColorStop(0, `rgba(225,220,255,${0.5 * opacity * shimmer})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 1.4 * shimmer, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(240,235,255,${0.85 * opacity})`;
    ctx.fill();
  }

  // ── arrival blessing pulse (drawn independently of the light's own fade) ──
  if (starlight.pulseStarId) {
    const pulseElapsed = ts - starlight.pulseStartTs;
    if (pulseElapsed < 1500) {
      const pulseStar = route.find(s => s.id === starlight.pulseStarId);
      if (pulseStar) {
        const pulseFade = 1 - pulseElapsed / 1500;
        const pulseR = 18 + pulseElapsed * 0.015;
        const pg = ctx.createRadialGradient(pulseStar.x, pulseStar.y, 0, pulseStar.x, pulseStar.y, pulseR);
        pg.addColorStop(0, `rgba(220,215,255,${0.35 * pulseFade})`);
        pg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(pulseStar.x, pulseStar.y, pulseR, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      starlight.pulseStarId = null;
    }
  }

  // ── handle fade-out completion ──
  if (starlight.fadingOut) {
    if (ts - starlight.fadeStartTs >= 900) {
      starlight = null;
      starlightIdleUntil = ts + 4000 + Math.random() * 4000; // several seconds of silence
    }
    return;
  }

  // ── leg complete: trigger blessing, advance or finish ──
  if (progress >= 1) {
    starlight.pulseStarId  = to.id;
    starlight.pulseStartTs = ts;

    const isLastLeg = legIndex + 2 >= route.length;
    if (isLastLeg) {
      starlight.fadingOut  = true;
      starlight.fadeStartTs = ts;
    } else {
      starlight.legIndex   = legIndex + 1;
      starlight.legStartTs = ts;
    }
  }
}

// ─── V3.2: begin a new wandering starlight journey ───
function startStarlightJourney(ts) {
  const origin = pickCelestialOrigin();
  if (!origin) {
    starlightIdleUntil = ts + 8000; // nothing to do yet; check again later
    return;
  }

  const route = buildStarlightRoute(origin);
  if (route.length < 2) {
    starlightIdleUntil = ts + 8000; // only one star total; nothing to travel to
    return;
  }

  starlight = {
    route:       route,
    legIndex:    0,
    legStartTs:  ts,
    legDuration: 2600 + Math.random() * 1800, // ms per leg, slow and gentle
    pulseStarId: null,
    pulseStartTs: 0,
    fadingOut:   false,
    fadeStartTs: 0
  };
}

// ─── V3.2: build a random route of 1–4 stops, starting from origin ───
function buildStarlightRoute(origin) {
  const others = stars.filter(s => s.type === "memory" && s.id !== origin.id);
  const stopCount = Math.min(others.length, 1 + Math.floor(Math.random() * 4)); // 1–4 stops
  const shuffled = [...others].sort(() => Math.random() - 0.5);
  return [origin, ...shuffled.slice(0, stopCount)];
}

// ─── V3.2: choose a random Celestial star to start a journey from ───
function pickCelestialOrigin() {
  const celestials = stars.filter(s => s.type === "memory" && s.isCelestial === true);
  if (celestials.length === 0) return null;
  return celestials[Math.floor(Math.random() * celestials.length)];
}

// Simple hash for consistent per-star phase
function hashPhase(id) {
  if (!id) return 0.5;
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  }
  return (h >>> 0) / 0xffffffff;
}

// ─── V2: star color palette ───
// Returns [coreRGB, glowRGB] as strings, soft and unsaturated
function starColorPalette(color) {
  switch (color) {
    case "blue":     return ["190,210,255", "130,170,255"];
    case "lavender": return ["210,195,255", "170,140,255"];
    case "rose":     return ["255,195,205", "230,150,165"];
    case "amber":    return ["255,225,175", "230,185,110"];
    default:         return ["235,238,255", "180,195,255"]; // white
  }
}

// ─────────────────────────────────────────────
//  COORDINATE HELPERS
// ─────────────────────────────────────────────
function screenToWorld(sx, sy) {
  const W = canvas.width;
  const H = canvas.height;
  return {
    x: (sx - W / 2) / cam.zoom + cam.x + W / 2,
    y: (sy - H / 2) / cam.zoom + cam.y + H / 2
  };
}

function worldToScreen(wx, wy) {
  const W = canvas.width;
  const H = canvas.height;
  return {
    x: (wx - cam.x - W / 2) * cam.zoom + W / 2,
    y: (wy - cam.y - H / 2) * cam.zoom + H / 2
  };
}

function distWorld(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// ─────────────────────────────────────────────
//  INTERACTION EVENTS
// ─────────────────────────────────────────────
function attachPointerEvents() {
  // ── Touch events ──
  canvas.addEventListener("touchstart",  onTouchStart,  { passive: false });
  canvas.addEventListener("touchmove",   onTouchMove,   { passive: false });
  canvas.addEventListener("touchend",    onTouchEnd,    { passive: false });
  canvas.addEventListener("touchcancel", onTouchCancel, { passive: false });

  // ── Mouse events ──
  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup",   onMouseUp);
  canvas.addEventListener("wheel",     onWheel, { passive: false });

  // Click for star tap (after mouseup without drag)
  canvas.addEventListener("click", onCanvasClick);
}

// ─── Mouse ───
function onMouseDown(e) {
  e.preventDefault();
  dragStartX    = e.clientX;
  dragStartY    = e.clientY;
  dragStartCamX = cam.x;
  dragStartCamY = cam.y;
  isDragging    = true;
  hasDragged    = false;

  startLongPress(e.clientX, e.clientY);
}

function onMouseMove(e) {
  if (!isDragging) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    hasDragged = true;
    cancelLongPress();
  }
  cam.x = dragStartCamX - dx / cam.zoom;
  cam.y = dragStartCamY - dy / cam.zoom;
}

function onMouseUp(e) {
  if (!hasDragged) {
    cancelLongPress();
  }
  isDragging = false;
}

function onWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.92 : 1.09;
  zoomAtPoint(e.clientX, e.clientY, delta);
}

// ─── Touch ───
let touch1 = null, touch2 = null;

function onTouchStart(e) {
  e.preventDefault();

  if (e.touches.length === 1) {
    const t = e.touches[0];
    touch1        = { id: t.identifier, x: t.clientX, y: t.clientY };
    touch2        = null;
    dragStartX    = t.clientX;
    dragStartY    = t.clientY;
    dragStartCamX = cam.x;
    dragStartCamY = cam.y;
    isDragging    = true;
    hasDragged    = false;
    isPinching    = false;

    // Record for tap detection in onTouchEnd
    touchTapStartX = t.clientX;
    touchTapStartY = t.clientY;

    startLongPress(t.clientX, t.clientY);
  }

  if (e.touches.length === 2) {
    cancelLongPress();
    isPinching = true;
    isDragging = false;

    const a = e.touches[0];
    const b = e.touches[1];
    pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    pinchStartZoom = cam.zoom;
    touch1 = { id: a.identifier, x: a.clientX, y: a.clientY };
    touch2 = { id: b.identifier, x: b.clientX, y: b.clientY };
  }
}

function onTouchMove(e) {
  e.preventDefault();

  if (e.touches.length === 2 && isPinching) {
    const a = e.touches[0];
    const b = e.touches[1];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const scale = dist / pinchStartDist;
    const midX = (a.clientX + b.clientX) / 2;
    const midY = (a.clientY + b.clientY) / 2;
    const newZoom = clampZoom(pinchStartZoom * scale);
    zoomAtPoint(midX, midY, newZoom / cam.zoom);
    return;
  }

  if (e.touches.length === 1 && isDragging && !isPinching) {
    const t = e.touches[0];
    const dx = t.clientX - dragStartX;
    const dy = t.clientY - dragStartY;

    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      hasDragged = true;
      cancelLongPress();
    }
    cam.x = dragStartCamX - dx / cam.zoom;
    cam.y = dragStartCamY - dy / cam.zoom;
  }
}

function onTouchEnd(e) {
  e.preventDefault();

  if (e.touches.length === 0) {
    isPinching = false;
    isDragging = false;

    if (!hasDragged && !longPressTriggered) {
      // Clean short tap — cancel the pending long press timer and check for a star hit
      cancelLongPress();

      const now = Date.now();
      if (now - lastTapTime > 300) {
        lastTapTime = now;
        const world = screenToWorld(touchTapStartX, touchTapStartY);

        // V2: linking mode intercept
        if (linkingMode) {
          const partner = findStarAtWorld(world.x, world.y);
          if (partner && partner.id !== linkingSourceId && partner.type === "memory") {
            confirmBinaryLink(partner);
          }
          longPressTriggered = false;
          return;
        }

        const hit = findStarAtWorld(world.x, world.y);
        if (hit) openMemoryModal(hit);
      }
    } else if (hasDragged) {
      cancelLongPress();
    }

    // Reset long press flag after handling
    longPressTriggered = false;
  }

  if (e.touches.length === 1) {
    isPinching = false;
    const t = e.touches[0];
    dragStartX    = t.clientX;
    dragStartY    = t.clientY;
    dragStartCamX = cam.x;
    dragStartCamY = cam.y;
    isDragging    = true;
    hasDragged    = false;
  }
}

function onTouchCancel(e) {
  cancelLongPress();
  isDragging = false;
  isPinching = false;
}

// ─── Canvas click (tap star) ───
function onCanvasClick(e) {
  if (hasDragged) return;
  if (longPressTriggered) { longPressTriggered = false; return; }

  // Prevent double-tap accidental
  const now = Date.now();
  if (now - lastTapTime < 300) return;
  lastTapTime = now;

  const world = screenToWorld(e.clientX, e.clientY);

  // V2: if in linking mode, this tap selects the partner star
  if (linkingMode) {
    const partner = findStarAtWorld(world.x, world.y);
    if (partner && partner.id !== linkingSourceId && partner.type === "memory") {
      confirmBinaryLink(partner);
    } else if (partner && partner.id === linkingSourceId) {
      showLinkingToast("tap a different star to link it.");
    }
    return;
  }

  const hit = findStarAtWorld(world.x, world.y);
  if (hit) openMemoryModal(hit);
}

// ─── Long press ───
function startLongPress(sx, sy) {
  longPressTriggered = false;
  const world = screenToWorld(sx, sy);
  longPressWorldX  = world.x;
  longPressWorldY  = world.y;
  longPressScreenX = sx;
  longPressScreenY = sy;

  showPressRipple(sx, sy);

  pendingLongPress = setTimeout(() => {
    if (!hasDragged && !isPinching) {
      longPressTriggered = true;
      hidePressRipple();
      onLongPress(longPressWorldX, longPressWorldY);
    }
  }, LONG_PRESS_MS);
}

function cancelLongPress() {
  if (pendingLongPress) {
    clearTimeout(pendingLongPress);
    pendingLongPress = null;
  }
  hidePressRipple();
}

function onLongPress(wx, wy) {
  if (creationLock) return;

  // Check for overlap
  if (isOccupied(wx, wy)) {
    showToast();
    return;
  }

  pendingCreatePos = { x: wx, y: wy };
  openCreationModal();
}

// ─────────────────────────────────────────────
//  ZOOM HELPERS
// ─────────────────────────────────────────────
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3.5;

function clampZoom(z) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

function zoomAtPoint(sx, sy, factor) {
  const worldBefore = screenToWorld(sx, sy);
  cam.zoom = clampZoom(cam.zoom * factor);
  const worldAfter  = screenToWorld(sx, sy);
  cam.x += worldBefore.x - worldAfter.x;
  cam.y += worldBefore.y - worldAfter.y;
}

// ─────────────────────────────────────────────
//  HIT DETECTION
// ─────────────────────────────────────────────
function findStarAtWorld(wx, wy) {
  // Use screen-space radius for comfortable tap target
  const tapRadiusWorld = 18 / cam.zoom;

  for (let i = stars.length - 1; i >= 0; i--) {
    const s = stars[i];
    const hitR = s.type === "bigbang"    ? 22 / cam.zoom :
                 s.type === "confession" ? 16 / cam.zoom :
                 s.birthdayNebula === true ? NEBULA_VISUAL_RADIUS / cam.zoom :
                 tapRadiusWorld;
    if (distWorld(wx, wy, s.x, s.y) < hitR) return s;
  }
  return null;
}

function isOccupied(wx, wy) {
  for (const s of stars) {
    if (distWorld(wx, wy, s.x, s.y) < MIN_STAR_RADIUS) return true;
  }
  return false;
}

// ─────────────────────────────────────────────
//  MEMORY MODAL
// ─────────────────────────────────────────────
function openMemoryModal(star) {
  openModalStar = star; // V2: remember which star is open

  document.getElementById("modal-title").textContent   = star.title   || "Untitled memory";
  document.getElementById("modal-date").textContent    = star.createdAt || "";
  document.getElementById("modal-memory").textContent  = star.memory  || "";
  document.getElementById("modal-creator").textContent = star.creator ? `— ${star.creator}` : "";

  // V2: binary link button — only show for memory stars, not specials
  const binaryBtn = document.getElementById("binary-link-btn");
  if (binaryBtn) {
    if (star.type === "memory") {
      binaryBtn.classList.remove("hidden");
      if (star.linkedStarId) {
        binaryBtn.textContent = "binary link exists";
        binaryBtn.disabled    = true;
      } else {
        binaryBtn.textContent = "create binary link";
        binaryBtn.disabled    = false;
      }
    } else {
      binaryBtn.classList.add("hidden");
    }
  }

  document.getElementById("memory-modal").classList.remove("hidden");
}

function closeMemoryModal(fromLinking) {
  document.getElementById("memory-modal").classList.add("hidden");
  // V2: only cancel linking state when NOT closing in order to start linking
  if (!fromLinking) {
    linkingMode     = false;
    linkingSourceId = null;
    canvas.classList.remove("linking-mode");
  }
  openModalStar = null;
}

// ─────────────────────────────────────────────
//  CREATION MODAL
// ─────────────────────────────────────────────
function openCreationModal() {
  document.getElementById("input-memory").value  = "";
  document.getElementById("input-title").value   = "";
  document.getElementById("input-creator").value = "";
  document.getElementById("creation-error").textContent = "";
  document.getElementById("memory-char-count").textContent = "0 / 50000";
  // V2: reset dropdowns to defaults
  if (document.getElementById("input-size"))  document.getElementById("input-size").value  = "standard";
  if (document.getElementById("input-color")) document.getElementById("input-color").value = "white";
  if (document.getElementById("input-aura"))  document.getElementById("input-aura").value  = "none";
  // V3.2: reset celestial toggle
  if (document.getElementById("input-celestial")) document.getElementById("input-celestial").checked = false;
   if (document.getElementById("input-birthday-nebula")) document.getElementById("input-birthday-nebula").checked = false;

  document.getElementById("creation-modal").classList.remove("hidden");
  setTimeout(() => document.getElementById("input-memory").focus(), 400);
}

function closeCreationModal() {
  document.getElementById("creation-modal").classList.add("hidden");
  pendingCreatePos = null;
  creationLock     = false;
}

async function handleCreateStar() {
  if (creationLock) return;

  const memory  = document.getElementById("input-memory").value.trim();
  const title   = document.getElementById("input-title").value.trim();
  const creator = document.getElementById("input-creator").value.trim();
  // V2 fields
  const size    = document.getElementById("input-size")  ? document.getElementById("input-size").value  : "standard";
  let   color   = document.getElementById("input-color") ? document.getElementById("input-color").value : "white";
  const aura    = document.getElementById("input-aura")  ? document.getElementById("input-aura").value  : "none";
  // V3.2: celestial toggle
  const isCelestial = document.getElementById("input-celestial") ? document.getElementById("input-celestial").checked : false;
   const birthdayNebula = document.getElementById("input-birthday-nebula") ? document.getElementById("input-birthday-nebula").checked : false;
  if (isCelestial) {
    const palette = ["white", "blue", "lavender", "rose", "amber"];
    color = palette[Math.floor(Math.random() * palette.length)];
  }
   
  const errEl   = document.getElementById("creation-error");
  if (!memory) {
    errEl.textContent = "a memory is required to birth a star.";
    document.getElementById("input-memory").focus();
    return;
  }

  if (!pendingCreatePos) {
    errEl.textContent = "position lost — please try again.";
    return;
  }

  // Re-check overlap (in case another user created one)
  if (isOccupied(pendingCreatePos.x, pendingCreatePos.y)) {
    errEl.textContent = "this region of space is now occupied.";
    return;
  }

  creationLock = true;
  setCreateBtnLoading(true);

  try {
    const { db, collection, addDoc, serverTimestamp } = window._firebase;

    await addDoc(collection(db, "stars"), {
      title:     title,
      memory:    memory,
      creator:   creator,
      x:         Math.round(pendingCreatePos.x * 10) / 10,
      y:         Math.round(pendingCreatePos.y * 10) / 10,
      timestamp: Date.now(),
      createdAt: serverTimestamp(),
      // V2 fields
      size:      size,
      color:     color,
      aura:      aura,
// V3.2 field
      isCelestial: isCelestial,
      // Birthday Nebula field
      birthdayNebula: birthdayNebula
    });

    closeCreationModal();
    creationLock = false;
  } catch (err) {
    console.error("Star creation failed:", err);
    errEl.textContent = "something went wrong. please try again.";
    creationLock = false;
    setCreateBtnLoading(false);
  }
}

function setCreateBtnLoading(on) {
  const btn    = document.getElementById("create-star-btn");
  const text   = document.getElementById("create-btn-text");
  const loader = document.getElementById("create-btn-loader");
  btn.disabled = on;
  text.textContent = on ? "planting…" : "plant this star";
  loader.classList.toggle("hidden", !on);
}

// ─────────────────────────────────────────────
//  ATTACH MODAL EVENTS
// ─────────────────────────────────────────────
function attachModalEvents() {
  // Memory modal close
  document.getElementById("modal-close-btn").addEventListener("click", closeMemoryModal);
  document.getElementById("memory-modal").querySelector(".modal-backdrop")
    .addEventListener("click", closeMemoryModal);

  // Creation modal close
  document.getElementById("creation-close-btn").addEventListener("click", closeCreationModal);
  document.getElementById("creation-modal").querySelector(".modal-backdrop")
    .addEventListener("click", closeCreationModal);

  // Create button
  document.getElementById("create-star-btn").addEventListener("click", handleCreateStar);

  // Char counter
  document.getElementById("input-memory").addEventListener("input", function() {
    document.getElementById("memory-char-count").textContent = `${this.value.length} / 50000`;
  });

  // Keyboard: Enter on inputs (not textarea)
  document.getElementById("input-title").addEventListener("keydown",   e => { if (e.key === "Enter") handleCreateStar(); });
  document.getElementById("input-creator").addEventListener("keydown", e => { if (e.key === "Enter") handleCreateStar(); });

  // Global escape
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeMemoryModal();
      closeCreationModal();
      // V2: also cancel linking mode
      linkingMode     = false;
      linkingSourceId = null;
      canvas.classList.remove("linking-mode");
    }
  });

  // V2: binary link button
  const binaryBtn = document.getElementById("binary-link-btn");
  if (binaryBtn) {
    binaryBtn.addEventListener("click", () => {
      if (!openModalStar) return;
      linkingSourceId = openModalStar.id;
      linkingMode     = true;
      canvas.classList.add("linking-mode");
      closeMemoryModal(true);
      showLinkingToast();
    });
  }
}

// ─────────────────────────────────────────────
//  RIPPLE
// ─────────────────────────────────────────────
function showPressRipple(sx, sy) {
  const el = document.getElementById("press-ripple");
  el.style.left = sx + "px";
  el.style.top  = sy + "px";
  el.classList.remove("hidden");
  el.classList.remove("animate");
  void el.offsetWidth; // reflow
  el.classList.add("animate");
}

function hidePressRipple() {
  const el = document.getElementById("press-ripple");
  el.classList.remove("animate");
  el.classList.add("hidden");
}

// ─────────────────────────────────────────────
//  OVERLAP TOAST
// ─────────────────────────────────────────────
let toastTimer = null;
function showToast() {
  const el = document.getElementById("overlap-toast");
  el.classList.remove("hidden");
  requestAnimationFrame(() => el.classList.add("show"));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.classList.add("hidden"), 400);
  }, 2400);
}

// ─────────────────────────────────────────────
//  V2: BINARY LINK HELPERS
// ─────────────────────────────────────────────
let linkingToastTimer = null;
function showLinkingToast(msg) {
  const el = document.getElementById("overlap-toast");
  el.textContent = msg || "tap another star to create a binary link. tap empty space to cancel.";
  el.classList.remove("hidden");
  requestAnimationFrame(() => el.classList.add("show"));
  if (linkingToastTimer) clearTimeout(linkingToastTimer);
  linkingToastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => {
      el.classList.add("hidden");
      el.textContent = "this region of space is already occupied."; // restore default
    }, 400);
  }, 3500);
}

function confirmBinaryLink(partnerStar) {
  const sourceId  = linkingSourceId;
  const partnerId = partnerStar.id;

  // Exit linking mode first
  linkingMode     = false;
  linkingSourceId = null;
  canvas.classList.remove("linking-mode");

  const ok = window.confirm(`link "${stars.find(s => s.id === sourceId)?.title || "this star"}" and "${partnerStar.title || "this star"}" as binary stars?`);
  if (!ok) return;

  saveBinaryLink(sourceId, partnerId);
}

async function saveBinaryLink(idA, idB) {
  try {
    const { db } = window._firebase;
    const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    await updateDoc(doc(db, "stars", idA), { linkedStarId: idB });
    await updateDoc(doc(db, "stars", idB), { linkedStarId: idA });
  } catch (err) {
    console.error("Binary link failed:", err);
    alert("Could not save binary link. Please try again.");
  }
}

// ─────────────────────────────────────────────
//  HINT
// ─────────────────────────────────────────────
function showHint() {
  if (hintShown) return;
  hintShown = true;
  const el = document.getElementById("hint-bar");
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 4000);
}

// ─────────────────────────────────────────────
//  TIMESTAMP FORMATTING
// ─────────────────────────────────────────────
function formatTimestamp(ts) {
  if (!ts) return "";
  // Firestore Timestamp object
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString("en-US", {
    year:  "numeric",
    month: "long",
    day:   "numeric"
  });
}
