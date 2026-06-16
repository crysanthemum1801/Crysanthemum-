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
const BG_STAR_COUNT = 220;

let hintShown        = false;
let hintTimeout      = null;
let creationLock     = false;  // debounce creation
let pendingCreatePos = null;   // {x, y} world coords

// ─── V2 state ───
let linkingMode      = false;  // true when user is picking a binary partner
let linkingSourceId  = null;   // id of the star waiting for a partner
let openModalStar    = null;   // star currently shown in memory modal
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
  const layer1 = Array.from({ length: 140 }, () => ({
    x:     Math.random() * WORLD_W,
    y:     Math.random() * WORLD_H,
    r:     Math.random() * 0.2 + 0.1,
    alpha: Math.random() * 0.10 + 0.05,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.010 + 0.002,
    layer: 1
  }));

  // Layer 2: mid stars — ~70
  const layer2 = Array.from({ length: 70 }, () => ({
    x:     Math.random() * WORLD_W,
    y:     Math.random() * WORLD_H,
    r:     Math.random() * 0.4 + 0.3,
    alpha: Math.random() * 0.20 + 0.15,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.008 + 0.002,
    layer: 2
  }));

  // Layer 3: rare bright stars with light bleed — ~12
  const layer3 = Array.from({ length: 12 }, () => ({
    x:     Math.random() * WORLD_W,
    y:     Math.random() * WORLD_H,
    r:     Math.random() * 0.6 + 0.8,
    alpha: Math.random() * 0.30 + 0.40,
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
        linkedStarId: data.linkedStarId  || null
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

  // Draw memory stars
  for (const star of stars) {
    drawStar(star, ts);
  }

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
    const a = s.alpha * (0.6 + 0.4 * Math.sin(t * s.speed * 6 + s.phase));

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

  // ── V2: size ──
  const size = star.size || "standard";
  const sizeScale = size === "tiny" ? 0.55 : size === "big" ? 1.7 : 1.0;

  // ── V2: age-based brightness (uses existing timestamp, no new field) ──
  const ageMs      = Date.now() - (star.timestamp || 0);
  const ageDays    = ageMs / 86400000;
  // Caps at 30 days → +0.28 max glow boost, logarithmic curve
  const ageBrightness = Math.min(0.28, Math.log1p(ageDays) * 0.07);

  // ── V2: color palette ──
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

  // ── Core dot ──
  const coreR = (1.8 + 0.6 * twinkle) * sizeScale;
  const coreAlpha = 0.75 + 0.25 * twinkle + ageBrightness * 0.5;
  ctx.beginPath();
  ctx.arc(star.x, star.y, coreR, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${coreRGB},${Math.min(1, coreAlpha)})`;
  ctx.fill();
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
  document.getElementById("memory-char-count").textContent = "0 / 1000";
  // V2: reset dropdowns to defaults
  if (document.getElementById("input-size"))  document.getElementById("input-size").value  = "standard";
  if (document.getElementById("input-color")) document.getElementById("input-color").value = "white";
  if (document.getElementById("input-aura"))  document.getElementById("input-aura").value  = "none";

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
  const color   = document.getElementById("input-color") ? document.getElementById("input-color").value : "white";
  const aura    = document.getElementById("input-aura")  ? document.getElementById("input-aura").value  : "none";
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
      aura:      aura
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
    document.getElementById("memory-char-count").textContent = `${this.value.length} / 1000`;
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
