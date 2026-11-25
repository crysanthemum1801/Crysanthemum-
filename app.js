/* ═══════════════════════════════════════════
   CHRYSANTHEMUM — app.js
   Vanilla JS · No frameworks · Firebase CDN
   ═══════════════════════════════════════════ */

"use strict";

// ─────────────────────────────────────────────
//  LOGIN BACKEND
//  The shared password is verified by the Cloudflare Worker, never in the browser.
//  Set this to your Worker's address (Cloudflare → Workers → chrysanthemum-auth → "Visit").
//  The address is public and is not a secret.
// ─────────────────────────────────────────────
const AUTH_WORKER_URL = "https://chrysanthemum-auth.crysanthemum-1801.workers.dev/";

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
let ccPinched       = false;   // a 2-finger gesture occurred during the current touch sequence
let controlCentre   = null;

// Canvas & context
let canvas, ctx;
let particles = [];
const PARTICLE_COUNT = 90;

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
  const PW_TINTS = ["246,248,255", "246,248,255", "255,245,234", "216,228,255"];
  const pwStars = Array.from({ length: 260 }, () => {
    const big = Math.random() < 0.05;
    return {
      x: Math.random(),
      y: Math.random(),
      r: big ? Math.random() * 0.5 + 0.9 : Math.random() * 0.6 + 0.25,
      alpha: big ? Math.random() * 0.3 + 0.45 : Math.random() * 0.5 + 0.1,
      speed: Math.random() * 0.003 + 0.001,
      phase: Math.random() * Math.PI * 2,
      tint: PW_TINTS[(Math.random() * PW_TINTS.length) | 0],
      big: big
    };
  });

  let t = 0;
  function drawBg() {
    const W = bgCanvas.width;
    const H = bgCanvas.height;
    bgCtx.clearRect(0, 0, W, H);
    t += 0.012;
    for (const s of pwStars) {
      const a = s.alpha * (0.55 + 0.45 * Math.sin(t * s.speed * 700 + s.phase));
      if (s.big) {                                    // the brighter few get a faint halo
        bgCtx.beginPath();
        bgCtx.arc(s.x * W, s.y * H, s.r * 4.5, 0, Math.PI * 2);
        bgCtx.fillStyle = `rgba(${s.tint},${a * 0.10})`;
        bgCtx.fill();
      }
      bgCtx.beginPath();
      bgCtx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      bgCtx.fillStyle = `rgba(${s.tint},${a})`;
      bgCtx.fill();
    }
    requestAnimationFrame(drawBg);
  }
  drawBg();

  // Password submit — checked by the backend, then exchanged for a Firebase session
  const input  = document.getElementById("password-input");
  const btn    = document.getElementById("enter-btn");
  const errMsg = document.getElementById("password-error");

  const MSG_WRONG   = "the stars don't recognize that.";
  const MSG_WAIT    = "too many tries. rest a little, then try again.";
  const MSG_FAILED  = "the stars can't be reached right now. try again in a moment.";
  let busy = false;

  function setBusy(on) {
    busy = on;
    btn.disabled = on;
    input.readOnly = on;
  }

  function enterUniverse() {
    errMsg.textContent = "";
    document.getElementById("password-screen").classList.add("fade-out");
    setTimeout(launchUniverse, 900);
  }

  async function tryEnter() {
    if (busy) return;                       // one login request at a time
    const val = input.value.trim();
    if (!val) {
      errMsg.textContent = MSG_WRONG;
      input.focus();
      return;
    }
    setBusy(true);
    errMsg.textContent = "";
    try {
      const fb = await whenFirebaseReady();
      const customToken = await requestCustomToken(val, MSG_WRONG, MSG_WAIT, MSG_FAILED);
      input.value = "";
      await fb.signInWithCustomToken(fb.auth, customToken);
      enterUniverse();                      // stays locked (busy) while the screen fades out
    } catch (err) {
      const userMsg = err && err.chrUserMessage;
      if (!userMsg) console.error("Sign-in failed:", err && err.code ? err.code : "unknown");
      errMsg.textContent = userMsg || MSG_FAILED;
      if (userMsg === MSG_WRONG) input.value = "";
      setBusy(false);
      input.focus();
    }
  }

  btn.addEventListener("click", tryEnter);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") tryEnter();
  });

  // Page refresh: reuse the Firebase session if there still is a valid one.
  (async () => {
    try {
      const fb = await whenFirebaseReady();
      await fb.auth.authStateReady();
      if (!fb.auth.currentUser) return;
      await fb.auth.currentUser.getIdToken(true);   // fails if the session was revoked/expired
      if (!busy) { setBusy(true); enterUniverse(); }
    } catch (err) {
      console.warn("Saved session not usable:", err && err.code ? err.code : "unknown");
    }
  })();
}

// Resolves with window._firebase once index.html has initialised Firebase (incl. Authentication).
function whenFirebaseReady() {
  if (window._firebase && window._firebase.auth) return Promise.resolve(window._firebase);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("firebase-timeout")), 10000);
    window.addEventListener("firebase-ready", () => {
      clearTimeout(timer);
      window._firebase && window._firebase.auth ? resolve(window._firebase) : reject(new Error("firebase-no-auth"));
    }, { once: true });
  });
}

// Sends the password to the Worker; returns the Firebase custom token.
// The password is only ever sent in the request body; nothing is stored.
async function requestCustomToken(password, msgWrong, msgWait, msgFailed) {
  const fail = (m) => Object.assign(new Error("login-failed"), { chrUserMessage: m });
  if (AUTH_WORKER_URL.includes("REPLACE-WITH")) {
    console.error("AUTH_WORKER_URL is not set in app.js");
    throw fail(msgFailed);
  }
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(AUTH_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", password }),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: ctrl.signal
    });
  } catch (_) {
    throw fail(msgFailed);                  // offline, blocked, or timed out
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) throw fail(msgWrong);
  if (res.status === 429) throw fail(msgWait);
  if (!res.ok) throw fail(msgFailed);
  let data;
  try { data = await res.json(); } catch (_) { throw fail(msgFailed); }
  if (!data || data.ok !== true || typeof data.customToken !== "string") throw fail(msgFailed);
  return data.customToken;
}

// Called when Firestore refuses the signed-in session: never keep a half-open universe.
function handleAuthLost() {
  const fb = window._firebase;
  if (window.ChrMedia) ChrMedia.clearAll();
  const done = () => window.location.reload();
  if (fb && fb.auth && fb.signOut) fb.signOut(fb.auth).then(done, done); else done();
}

// ─────────────────────────────────────────────
//  LAUNCH UNIVERSE
// ─────────────────────────────────────────────
let universeLaunched = false;
function launchUniverse() {
  if (universeLaunched) return;             // never start the universe (or its listener) twice
  universeLaunched = true;
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
  const rnd = _softRng(20260);
  const H0 = SPECIAL_STARS[0];

  // ── 1 · Pinprick dust: three tiled textures, each painted once ──
  // Thousands of tiny stars per screen for the price of a handful of drawImage calls.
  bgTiles = [];
  try {
    bgTiles = [
      // Six pinprick layers (two per depth). Each twinkles on its own rate and phase, so the sky sparkles
      // star-by-star instead of pulsing as one. All white, all very small.
      _bgBuildTile({ pl: 0, size: 576, dens: 1.50e-3, rMin: 0.28, rMax: 0.55, aMin: 0.30, aMax: 0.85, seed: 101, tw: 1.10, amp: 0.50, lag: 0.84, dr: 0.9, zk: 0.20 }),
      _bgBuildTile({ pl: 0, size: 704, dens: 1.30e-3, rMin: 0.28, rMax: 0.55, aMin: 0.30, aMax: 0.85, seed: 102, tw: 1.70, amp: 0.55, lag: 0.84, dr: 0.8, zk: 0.20 }),
      _bgBuildTile({ pl: 1, size: 640, dens: 0.80e-3, rMin: 0.36, rMax: 0.70, aMin: 0.38, aMax: 0.92, seed: 202, tw: 0.85, amp: 0.55, lag: 0.66, dr: 1.5, zk: 0.14 }),
      _bgBuildTile({ pl: 1, size: 768, dens: 0.70e-3, rMin: 0.36, rMax: 0.70, aMin: 0.38, aMax: 0.92, seed: 203, tw: 1.45, amp: 0.60, lag: 0.66, dr: 1.4, zk: 0.14 }),
      _bgBuildTile({ pl: 2, size: 832, dens: 0.34e-3, rMin: 0.45, rMax: 0.80, aMin: 0.45, aMax: 0.98, seed: 303, tw: 0.70, amp: 0.55, lag: 0.48, dr: 2.3, zk: 0.08 }),
      _bgBuildTile({ pl: 2, size: 960, dens: 0.28e-3, rMin: 0.45, rMax: 0.80, aMin: 0.45, aMax: 0.98, seed: 304, tw: 1.25, amp: 0.60, lag: 0.48, dr: 2.1, zk: 0.08 })
    ].filter(Boolean);
  } catch (e) { bgTiles = []; }

  // ── 2 · Coloured glints: small soft stars (some with hairline diffraction spikes) ──
  // Deliberately smaller and dimmer than any memory star so they add depth without competing.
  bgStars = [];
  bgGlintSprites = null;
  try {
    bgGlintSprites = BG_GLINT_COLORS.map(c => [_bgGlintSprite(c[0], false), _bgGlintSprite(c[0], true)]);
  } catch (e) { bgGlintSprites = null; }
  if (!bgGlintSprites) return;

  const pickColor = () => {
    let u = rnd();
    for (let i = 0; i < BG_GLINT_COLORS.length; i++) { u -= BG_GLINT_COLORS[i][1]; if (u <= 0) return i; }
    return 0;
  };
  const span = 4600, list = [];
  const scaleOf = [0.72, 0.86, 1];
  const add = (count, spiked) => {
    for (let i = 0; i < count; i++) {
      const u = rnd(), pl = u < 0.34 ? 0 : u < 0.67 ? 1 : 2;
      const hs = (spiked ? 4 + 5 * Math.pow(rnd(), 1.8) : 1.5 + 1.7 * Math.pow(rnd(), 1.6)) * scaleOf[pl];
      list.push({
        x: H0.x + (rnd() * 2 - 1) * span,
        y: H0.y + (rnd() * 2 - 1) * span,
        hs: hs,
        ci: pickColor(),
        sp: spiked ? 1 : 0,
        alpha: spiked ? 0.38 + rnd() * 0.38 : 0.28 + rnd() * 0.38,
        phase: rnd() * Math.PI * 2,
        speed: 0.002 + rnd() * 0.008,
        pl: pl,
        dim: [0.5, 0.72, 1][pl]
      });
    }
  };
  add(130, true);
  add(650, false);
  list.sort((a, b) => a.pl - b.pl);
  bgStars = list;
}

// ── tiled pinprick texture (wraps seamlessly: stars near an edge are repeated on the opposite one) ──
var bgTiles = [];
var bgGlintSprites = null;
const BG_TINTS = [[0.80, "246,242,234"], [0.93, "255,240,222"], [1, "226,230,242"]];
function _bgTint(u) {
  for (let i = 0; i < BG_TINTS.length; i++) if (u <= BG_TINTS[i][0]) return BG_TINTS[i][1];
  return BG_TINTS[0][1];
}
function _bgBuildTile(o) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = o.size;
  const x = cv.getContext("2d");
  if (!x) return null;
  const rnd = _softRng(o.seed), S = o.size, n = Math.round(S * S * o.dens);
  for (let i = 0; i < n; i++) {
    const px = rnd() * S, py = rnd() * S;
    const r = o.rMin + (o.rMax - o.rMin) * Math.pow(rnd(), 2.2);
    const a = o.aMin + (o.aMax - o.aMin) * Math.pow(rnd(), 1.4);
    x.fillStyle = `rgba(${_bgTint(rnd())},${a.toFixed(3)})`;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const sx = px + ox * S, sy = py + oy * S;
        if (sx < -2 || sx > S + 2 || sy < -2 || sy > S + 2) continue;
        x.beginPath();
        x.arc(sx, sy, r, 0, 6.2832);
        x.fill();
      }
    }
  }
  return { cv: cv, size: S, pl: o.pl, lag: o.lag, tw: o.tw, amp: o.amp || 0.1, dr: o.dr || 0, zk: o.zk || 0, ph: rnd() * 6.28 };
}

// ── glint sprites: soft glow + (optional) hairline 4-point spikes + a white-hot pinpoint ──
const BG_GLINT_COLORS = [["248,242,232", 0.46], ["232,234,244", 0.24], ["255,238,218", 0.30]];
function _bgGlintSprite(rgb, spiked) {
  const N = 64, H = N / 2, c = _softCanvas(N), x = c.getContext("2d");
  x.fillStyle = _softGradient(x, H, H, H, r =>
    [rgb, (0.34 * Math.exp(-Math.pow(r / 0.22, 2)) + 0.12 * Math.exp(-Math.pow(r / 0.54, 2))) * _softWindow(r)]);
  x.fillRect(0, 0, N, N);
  x.globalCompositeOperation = "lighter";
  if (spiked) {
    const L = 30, taper = [[0, 0], [0.22, 0.03], [0.40, 0.12], [0.5, 0.32], [0.60, 0.12], [0.78, 0.03], [1, 0]];
    let g = x.createLinearGradient(H - L, 0, H + L, 0);
    for (const s of taper) g.addColorStop(s[0], `rgba(${rgb},${s[1]})`);
    x.fillStyle = g;
    x.fillRect(H - L, H - 0.6, L * 2, 1.2);
    g = x.createLinearGradient(0, H - L, 0, H + L);
    for (const s of taper) g.addColorStop(s[0], `rgba(${rgb},${s[1]})`);
    x.fillStyle = g;
    x.fillRect(H - 0.6, H - L, 1.2, L * 2);
  }
  const g2 = x.createRadialGradient(H, H, 0, H, H, 3.4);
  g2.addColorStop(0,   `rgba(${rgb},0.60)`);
  g2.addColorStop(0.5, `rgba(${rgb},0.20)`);
  g2.addColorStop(1,   `rgba(${rgb},0)`);
  x.fillStyle = g2;
  x.fillRect(H - 4, H - 4, 8, 8);
  return c;
}

// ─────────────────────────────────────────────
//  V3: DUST PATCHES (generated once, not per-frame)
// ─────────────────────────────────────────────
   
// ─────────────────────────────────────────────
//  NEBULAE — each distinct nebula is painted ONCE into a soft sprite (domain-warped fractal noise:
//  glowing filaments, dark dust lanes, rust-lit edges, a few embedded specks). The work is time-sliced
//  across frames by pumpNebulaBuild(), so it never blocks a frame, and each nebula fades in when ready.
//  Per frame a nebula is a single drawImage().
// ─────────────────────────────────────────────
var nebulaJobs = [];

function _nbHash(ix, iy, seed) {
  let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967295;
}
function _nbNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = _nbHash(xi, yi, seed), b = _nbHash(xi + 1, yi, seed);
  const c = _nbHash(xi, yi + 1, seed), d = _nbHash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function _nbFbm(x, y, seed, oct) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * _nbNoise(x * f + i * 5.3, y * f + i * 3.7, seed + i * 13);
    n += a; a *= 0.5; f *= 2.02;
  }
  return s / n;
}

// ex/ey: size of the glowing band (sprite-normalised) · warp: how ragged · gain: brightness
// side: which end of the band runs hottest (+1 / -1) · deep/mid/hot/rust: colour ramp, faint → bright, + dust-edge light
var NEBULA_DEFS = [
  { key: "mauve", w: 448, h: 320, seed: 11, ex: 0.88, ey: 0.50, warp: 0.60, gain: 1.00, maxA: 0.50, side:  1,
    deep: [58, 42, 92],  mid: [158, 98, 148], hot: [236, 150, 128], rust: [204, 100, 62] },
  { key: "amber", w: 448, h: 320, seed: 29, ex: 0.86, ey: 0.50, warp: 0.60, gain: 1.05, maxA: 0.50, side: -1,
    deep: [64, 46, 92],  mid: [172, 108, 128], hot: [252, 182, 98], rust: [206, 106, 48] },
  { key: "haze",  w: 448, h: 192, seed: 47, ex: 0.92, ey: 0.62, warp: 0.65, gain: 0.85, maxA: 0.34, side:  1,
    deep: [50, 38, 86],  mid: [118, 88, 156], hot: [214, 164, 176], rust: [170, 96, 90] },
  { key: "blue",  w: 448, h: 320, seed: 83, ex: 0.86, ey: 0.50, warp: 0.65, gain: 0.90, maxA: 0.34, side:  1,
    deep: [34, 40, 92],  mid: [78, 90, 168],  hot: [152, 150, 222], rust: [150, 100, 170] }
];

// one row of a nebula sprite: writes RGBA into p and a brightness map into E
function _nbRow(d, py, p, E) {
  const W = d.w, H = d.h, v = (py + 0.5) / H * 2 - 1;
  for (let px = 0; px < W; px++) {
    const u = (px + 0.5) / W * 2 - 1, k = py * W + px, i = k * 4;
    const rr = Math.hypot(u, v);
    if (rr >= 1) { p[i + 3] = 0; E[k] = 0; continue; }

    // domain warp: the band wanders and tears instead of being an ellipse
    const wx = (_nbFbm(u * 1.5 + 4.1, v * 1.5 + 1.7, d.seed, 3) - 0.5) * 2;
    const wy = (_nbFbm(u * 1.5 + 9.3, v * 1.5 + 6.2, d.seed + 71, 3) - 0.5) * 2;
    const qx = u + wx * d.warp * 0.5, qy = v + wy * d.warp * 0.5;

    const env  = Math.exp(-(qx * qx) / (d.ex * d.ex) - (qy * qy) / (d.ey * d.ey));
    const dens = _nbFbm(qx * 3.0 + 2.0, qy * 3.0 + 8.0, d.seed + 3, 5);
    const rid  = 1 - Math.abs(2 * _nbFbm(qx * 5.4 + 5.0, qy * 5.4 + 1.0, d.seed + 31, 4) - 1);
    const fil  = rid * rid * rid;                                            // fine bright filaments
    const dust = _smooth(0.53, 0.68, _nbFbm(qx * 2.4 + 7.0, qy * 2.4 + 3.0, d.seed + 57, 4));   // dark lanes

    let e = env * (0.20 + 1.15 * _smooth(0.32, 0.72, dens)) * (0.60 + 0.9 * fil) * (1 - 0.80 * dust) * d.gain;
    const rim = 4 * dust * (1 - dust);                                       // light catching the dust edges
    const em2 = env * rim * (0.35 + dens) * 0.30 * d.gain;
    const tot = e + em2 * 0.6;

    const win = 1 - _smooth(0.74, 1.0, rr);
    const a   = d.maxA * _smooth(0.02, 0.62, tot) * win;
    E[k] = tot * win;

    const side = _smooth(-0.85, 0.85, u * d.side);
    const k1 = _smooth(0.06, 0.42, tot);
    const k2 = _smooth(0.50, 1.05, tot) * (0.35 + 0.9 * side);
    let r = d.deep[0] + (d.mid[0] - d.deep[0]) * k1, g = d.deep[1] + (d.mid[1] - d.deep[1]) * k1, b = d.deep[2] + (d.mid[2] - d.deep[2]) * k1;
    const k2c = k2 > 1 ? 1 : k2;
    r += (d.hot[0] - r) * k2c; g += (d.hot[1] - g) * k2c; b += (d.hot[2] - b) * k2c;
    const m = Math.min(0.8, em2 * 1.3);
    r += (d.rust[0] - r) * m; g += (d.rust[1] - g) * m; b += (d.rust[2] - b) * m;

    p[i] = r; p[i + 1] = g; p[i + 2] = b; p[i + 3] = a * 255;
  }
}

function _nbStartJob(def) {
  const c = document.createElement("canvas");
  c.width = def.w; c.height = def.h;
  const x = c.getContext("2d");
  if (!x) return null;
  return { def: def, c: c, x: x, img: x.createImageData(def.w, def.h), E: new Float32Array(def.w * def.h), row: 0 };
}

function _nbFinish(j) {
  const d = j.def, W = d.w, H = d.h, p = j.img.data;
  for (let i = 3; i < p.length; i += 4) {                 // ±1.5/255 alpha jitter: no banding in the faint gradients
    if (p[i] > 0) { const v = p[i] + (Math.random() - 0.5) * 3; p[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
  }
  j.x.putImageData(j.img, 0, 0);
  // a scattering of tiny stars caught inside the glow (denser where it is brighter)
  const rng = _softRng(d.seed * 131 + 7);
  j.x.globalCompositeOperation = "lighter";
  for (let n = 0, placed = 0; n < 5000 && placed < 240; n++) {
    const px = (rng() * W) | 0, py = (rng() * H) | 0, e = j.E[py * W + px];
    if (rng() > e * 1.7) continue;
    const col = rng() < 0.5 ? "255,238,226" : rng() < 0.5 ? "255,196,156" : "196,206,255";
    j.x.fillStyle = `rgba(${col},${(0.22 + 0.5 * rng()).toFixed(2)})`;
    j.x.fillRect(px + 0.2, py + 0.2, 0.7, 0.7);
    placed++;
  }
  j.x.globalCompositeOperation = "source-over";
  d.sprite = j.c;
  d.readyAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
  j.img = null; j.E = null;
}

// Called once per frame: spends at most budgetMs painting nebula rows.
function pumpNebulaBuild(budgetMs) {
  if (!nebulaJobs.length) return;
  const t0 = performance.now();
  while (nebulaJobs.length && performance.now() - t0 < budgetMs) {
    const j = nebulaJobs[0];
    try {
      for (let k = 0; k < 4 && j.row < j.def.h; k++) _nbRow(j.def, j.row++, j.img.data, j.E);
      if (j.row >= j.def.h) { _nbFinish(j); nebulaJobs.shift(); }
    } catch (e) {
      nebulaJobs.shift();                                  // a nebula that fails to build is simply skipped
    }
  }
}

function generateDustPatches() {
  dustPatches = [];
  nebulaJobs = [];
  const H0 = SPECIAL_STARS[0];
  const defs = NEBULA_DEFS.map(d => Object.assign({}, d, { sprite: null, readyAt: 0 }));
  const D = {};
  for (const d of defs) {
    D[d.key] = d;
    try { const j = _nbStartJob(d); if (j) nebulaJobs.push(j); } catch (e) { /* skipped */ }
  }
  // placements are relative to the home point, so the first view always matches the reference composition:
  // a dark, rust-edged violet-rose nebula upper right, a warm amber one lower left, a thin haze through the middle
  const P = (key, dx, dy, w, h, ang, flip, a) =>
    dustPatches.push({ d: D[key], x: H0.x + dx, y: H0.y + dy, w: w, h: h, ang: ang, flip: flip, a: a, ph: dustPatches.length * 1.93 + 0.4 });
  P("mauve",   500, -300, 1560, 1110,  0.42,  1, 1.00);
  P("amber",  -540,  260, 1560, 1110,  0.48,  1, 1.00);
  P("haze",     40,  -20, 1500,  640, -0.08,  1, 0.85);
  P("blue",  -1500, -1000, 1800, 1280, -0.50,  1, 0.80);
  P("mauve",  1500,  1050, 1800, 1280, -0.30, -1, 0.75);
  P("amber", -1700,  1350, 1700, 1210,  0.20, -1, 0.70);
  P("blue",   1750, -1300, 1700, 1210,  0.50, -1, 0.70);
  P("haze",   -300,  1750, 1700,  730,  0.10,  1, 0.70);
  P("mauve",  -200, -1800, 1600, 1140, -0.20,  1, 0.65);
  P("amber",  2900,   150, 1700, 1210,  0.30,  1, 0.55);
  P("blue",  -2900,   100, 1700, 1210, -0.40, -1, 0.55);
  P("haze",   3000, -700, 1600,  690,  0.40, -1, 0.50);
  P("mauve", -1100, -3000, 1700, 1210,  0.10, -1, 0.50);
  P("amber",  1200,  3000, 1700, 1210, -0.20,  1, 0.50);

  pxGalaxies = [];                                          // (the old faint galaxy smudges are not part of the new look)
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
    alpha: Math.random() * 0.08 + 0.02,
    ci:   (Math.random() * MOTE_RGB.length) | 0,
    ph:   Math.random() * Math.PI * 2,
    tw:   0.25 + Math.random() * 0.55
  }));
}

// ─────────────────────────────────────────────
//  FIRESTORE SUBSCRIPTION
// ─────────────────────────────────────────────
let firestoreSubscribed = false;
function subscribeToFirestore() {
  if (firestoreSubscribed) return;
  firestoreSubscribed = true;
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
        birthdayNebula: data.birthdayNebula === true,
        // Media references (Drive file ids + type); validated again in media.js before use
        media: Array.isArray(data.media) ? data.media : []
      });
    });

    refreshOpenModalStar();
    updateStarCount();
  }, (err) => {
    console.error("Firestore error:", err);
    if (err && err.code === "permission-denied") handleAuthLost();
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
// ─────────────────────────────────────────────
//  UNIVERSE PARALLAX — camera-pan only (no pointer input); saved coordinates are never touched.
//  Index 0 = Layer 6 (farthest) … index 5 = Layer 1 (closest):
//  6 faint specks · 5 distant stars, galaxies, glow patches · 4 visible bg stars ·
//  3 nebula memory stars · 2 ordinary memory stars · 1 large/celestial stars + Big Bang/Confession core.
// ─────────────────────────────────────────────
const PX_DEPTH = [0, 0.15, 0.30, 0.50, 0.75, 1.00];
// A layer travels at depth^1.5 of the camera's speed, i.e. it lags the camera by PX_LAG × (view centre − home).
// Layer 1 has lag 0, so it is exactly the saved-coordinate space; every layer aligns at the home view.
const PX_PAN_SCALE = 0.38;  // overall parallax intensity — slightly deeper depth without motion sickness
const PX_LAG = PX_DEPTH.map(d => PX_PAN_SCALE * (1 - Math.pow(d, 1.5)));
let pxAX = 0, pxAY = 0;                                    // translation currently applied this frame (world units)
let pxDX = 0, pxDY = 0;                                    // view centre − home point (world units)
let pxOX = [0, 0, 0, 0, 0, 0], pxOY = [0, 0, 0, 0, 0, 0]; // per-layer pan offset (world units)
let pxGalaxies = [];                                       // faint galaxies (layer 5), generated once

// Layer from the star's own existing fields — no ids, no stored depth.
function pxLayerOf(star) {
  if (star.type === "bigbang" || star.type === "confession") return 5;   // Layer 1
  if (star.birthdayNebula === true) return 3;                            // Layer 3
  if (star.isCelestial === true || star.size === "big") return 5;        // Layer 1
  return 4;                                                              // Layer 2
}

// offset (world units) applied to a star's drawn position
function pxWx(star) { return pxOX[pxLayerOf(star)]; }
function pxWy(star) { return pxOY[pxLayerOf(star)]; }

// saved-coordinate correction for a NEW star (starDoc holds its type fields) so it lands where pressed
function pxCreateAdjust(sd, pc) {
  const k = PX_LAG[pxLayerOf(sd)];
  return { x: k * ((pc && pc.dx) || 0), y: k * ((pc && pc.dy) || 0) };
}

// once per frame, right after the camera transform is applied
function pxBegin(dt) {
  pxAX = 0; pxAY = 0;
  const pan = binaryReduceMotion ? 0 : 1;   // reduced motion: flat camera, normal navigation
  pxDX = cam.x + canvas.width  / 2 - SPECIAL_STARS[0].x;
  pxDY = cam.y + canvas.height / 2 - SPECIAL_STARS[0].y;
  for (let i = 0; i < 6; i++) {
    pxOX[i] = PX_LAG[i] * pan * pxDX;
    pxOY[i] = PX_LAG[i] * pan * pxDY;
  }
  bgGlideStep(dt);
}

// Background-only glide. The sky (dust, glints, nebulae) trails the camera a little while you pan and then
// settles in with a soft inertia, which gives the far layers weight. It touches only decorative layers:
// stars, hit-testing and the saved-coordinate correction (pxCreateAdjust) keep using the exact offsets above,
// and the lead is zero whenever the camera is still, so every layer still aligns at rest.
const BG_GLIDE = 0.35;      // how much of the camera's recent motion the sky trails (0 = none)
const BG_GLIDE_MAX = 160;   // world units, keeps fast flicks from dragging the sky too far behind
let bgSmX = 0, bgSmY = 0, bgLeadX = 0, bgLeadY = 0, bgSmReady = false;
function bgGlideStep(dt) {
  if (binaryReduceMotion || !bgSmReady) {
    bgSmX = pxDX; bgSmY = pxDY; bgLeadX = 0; bgLeadY = 0;
    bgSmReady = !binaryReduceMotion;
    return;
  }
  const e = 1 - Math.pow(0.90, dt || 1);
  bgSmX += (pxDX - bgSmX) * e;
  bgSmY += (pxDY - bgSmY) * e;
  bgLeadX = Math.max(-BG_GLIDE_MAX, Math.min(BG_GLIDE_MAX, pxDX - bgSmX));
  bgLeadY = Math.max(-BG_GLIDE_MAX, Math.min(BG_GLIDE_MAX, pxDY - bgSmY));
}
// extra zoom depth: a far layer grows a little less than the world when you zoom in (and shrinks less when you zoom out)
function bgZoomK(k) {
  return binaryReduceMotion || !k ? 1 : Math.pow(cam.zoom, -k);
}

// shift the world-space draw origin to a layer (composes with the camera); -1 = no shift
function pxSet(l) {
  const x = l < 0 ? 0 : pxOX[l], y = l < 0 ? 0 : pxOY[l];
  ctx.translate(x - pxAX, y - pxAY);
  pxAX = x; pxAY = y;
}



let lastTime = 0;
function renderLoop(ts) {
  const dt = Math.min((ts - lastTime) / 16.67, 3);  // cap delta
  lastTime = ts;

  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  pumpNebulaBuild(4);   // paints nebula sprites a few rows per frame (time-sliced)
  pumpSpriteWarm(3);    // pre-builds star sprites a little per frame, so no star ever stalls a frame when it first appears

  // Space background: deep indigo-black with two very faint, very distant pools of colour
  drawSkyBase(W, H);

  ctx.save();

  // Apply camera transform
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x - W / 2, -cam.y - H / 2);

  // Draw background nebula haze
    pxBegin(dt);
  pxSet(1);
  drawNebula(ts);

  // Draw bg stars (twinkle)
  drawBgStars(ts);

  // Drift particles
    pxSet(5);
  updateAndDrawParticles(dt, ts);

  // V2: tick startup pulse (fades from 1 → 0 over ~1.2s)
  if (startupPulse > 0) startupPulse = Math.max(0, startupPulse - dt * 0.014);

// V2: draw binary threads beneath stars
  pxSet(-1);
  drawBinaryThreads(ts);

  // V3.1: Big Bang particle field (drawn once per frame, not per star)
  pxSet(5);
  drawBigBangParticles(ts);

  // Cosmic core: Big Bang × Confession binary (visual layer only)
    // Draw far → near: Layer 3 nebula stars, Layer 2 ordinary stars, then Layer 1 (core + large/celestial)
  // Stars outside the view (plus room for their glow) are skipped entirely.
  const cvw = W / cam.zoom, cvh = H / cam.zoom;
  const cvl = cam.x + W / 2 - cvw / 2, cvt = cam.y + H / 2 - cvh / 2, CM = 280;
  for (let pl = 3; pl <= 5; pl++) {
    if (pl === 5) drawBinarySystem(ts);
    const ox = pxOX[pl], oy = pxOY[pl];
    for (const star of stars) {
      if (pxLayerOf(star) !== pl) continue;
      const sx = star.x + ox, sy = star.y + oy;
      if (sx < cvl - CM || sx > cvl + cvw + CM || sy < cvt - CM || sy > cvt + cvh + CM) continue;
      drawStar(star, ts);
    }
  }

  // V3.2: wandering starlight (drawn above stars, last)
  pxSet(-1);
  updateAndDrawStarlight(ts);

  ctx.restore();

  drawVignette(W, H);

  requestAnimationFrame(renderLoop);
}
   
// ─────────────────────────────────────────────
//  NEBULA HAZE
// ─────────────────────────────────────────────
// Distant layers get their own, stronger parallax (a larger share of the camera move is "lagged"):
// the further a layer is, the less it travels across the screen.
const NEBULA_LAG = 0.78;
const NEBULA_ALPHA = 0.30;
const NEBULA_ZK = 0.15;      // zoom depth of the nebula layer (see bgZoomK)
let _lagX = 0, _lagY = 0;
function pxSetLag(k) {
  const pan = binaryReduceMotion ? 0 : 1;      // reduced motion: flat camera, as for every other layer
  _lagX = k * pan * (pxDX + BG_GLIDE * bgLeadX); _lagY = k * pan * (pxDY + BG_GLIDE * bgLeadY);
  ctx.translate(_lagX - pxAX, _lagY - pxAY);
  pxAX = _lagX; pxAY = _lagY;
}

function drawNebula(ts) {
  const zoom = cam.zoom, t = ts * 0.001, still = binaryReduceMotion;
  const W = canvas.width, H = canvas.height;
  pxSetLag(NEBULA_LAG);
  const zs  = bgZoomK(NEBULA_ZK);
  const ccx = cam.x + W / 2 - _lagX, ccy = cam.y + H / 2 - _lagY;   // view centre in this layer's own coordinates
  const vw = W / (zoom * zs), vh = H / (zoom * zs);
  const l = ccx - vw / 2, tp = ccy - vh / 2;
  ctx.save();
  if (zs !== 1) { ctx.translate(ccx, ccy); ctx.scale(zs, zs); ctx.translate(-ccx, -ccy); }
  for (const p of dustPatches) {
    const spr = p.d.sprite;
    if (!spr) continue;                                       // still being painted
    if (zoom < 0.5 && p.a < 0.6) continue;                    // far out, the faintest clouds are not worth the fill cost
    const rad = 0.5 * Math.hypot(p.w, p.h) + 30;              // +30: room for the slow drift
    if (p.x + rad < l || p.x - rad > l + vw || p.y + rad < tp || p.y - rad > tp + vh) continue;
    const fade = Math.min(1, Math.max(0, (ts - p.d.readyAt) / 3200));
    if (fade <= 0) continue;
    // each cloud slowly breathes, drifts and turns on its own clock: a living sky, never a pulse
    const ph = p.ph || 0;
    const ox = still ? 0 : Math.sin(t * 0.021 + ph) * 14;
    const oy = still ? 0 : Math.cos(t * 0.017 + ph * 1.3) * 10;
    const rot = still ? 0 : 0.02 * Math.sin(t * 0.013 + ph * 0.7);
    const breath = still ? 1 : 0.90 + 0.10 * Math.sin(t * 0.07 + ph * 2);
    ctx.save();
    ctx.translate(p.x + ox, p.y + oy);
    ctx.rotate(p.ang + rot);
    ctx.scale(p.flip, 1);
    ctx.globalAlpha = p.a * NEBULA_ALPHA * breath * fade * fade * (3 - 2 * fade);
    ctx.drawImage(spr, -p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ─────────────────────────────────────────────
//  BACKGROUND STAR RENDERING
// ─────────────────────────────────────────────
function drawBgStars(ts) {
  const t = ts * 0.001, zoom = cam.zoom, still = binaryReduceMotion;
  const W = canvas.width, H = canvas.height;
  const cxw = cam.x + W / 2, cyw = cam.y + H / 2;        // view centre in world units

  // pinprick dust (tiled textures; each layer on its own parallax plane, drifting very slowly)
  for (let n = 0; n < bgTiles.length; n++) {
    const tl = bgTiles[n], S = tl.size;
    pxSetLag(tl.lag);
    const zs  = bgZoomK(tl.zk);
    const ccx = cxw - _lagX, ccy = cyw - _lagY;
    const lw = W / (zoom * zs), lh = H / (zoom * zs);
    const offX = still ? 0 : t * tl.dr, offY = still ? 0 : t * tl.dr * 0.45;
    const l = ccx - lw / 2 - offX, tp = ccy - lh / 2 - offY;
    const i0 = Math.floor(l / S), i1 = Math.floor((l + lw) / S);
    const j0 = Math.floor(tp / S), j1 = Math.floor((tp + lh) / S);
    ctx.save();
    if (zs !== 1) { ctx.translate(ccx, ccy); ctx.scale(zs, zs); ctx.translate(-ccx, -ccy); }
    ctx.globalAlpha = 1 - tl.amp + tl.amp * (0.5 + 0.5 * Math.sin(t * tl.tw + tl.ph));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) ctx.drawImage(tl.cv, i * S + offX, j * S + offY);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // coloured glints (three depth groups: 6 / 5 / 4)
  if (!bgGlintSprites) return;
  const GZK = [0.12, 0.09, 0.06];
  let pxL = -1, l = 0, tp = 0, r = 0, b = 0, minHs = 0, open = false;
  for (const s of bgStars) {
    if (s.pl !== pxL) {
      if (open) ctx.restore();
      pxL = s.pl;
      pxSetLag(PX_LAG[pxL]);
      const zs  = bgZoomK(GZK[pxL]);
      const ccx = cxw - _lagX, ccy = cyw - _lagY;
      const lw = W / (zoom * zs), lh = H / (zoom * zs);
      l = ccx - lw / 2; tp = ccy - lh / 2; r = l + lw; b = tp + lh;
      minHs = 1.6 / (zoom * zs);
      ctx.save(); open = true;
      if (zs !== 1) { ctx.translate(ccx, ccy); ctx.scale(zs, zs); ctx.translate(-ccx, -ccy); }
    }
    const hs = s.hs > minHs ? s.hs : minHs;
    if (s.x < l - hs || s.x > r + hs || s.y < tp - hs || s.y > b + hs) continue;
    // slow shimmer, plus a faster flicker on the spiked ones: they now visibly breathe instead of sitting still
    const tw = 0.76 + 0.24 * Math.sin(t * s.speed * 70 + s.phase);
    const fl = s.sp ? 0.92 + 0.08 * Math.sin(t * s.speed * 190 + s.phase * 3.1) : 1;
    ctx.globalAlpha = s.alpha * s.dim * tw * fl;
    ctx.drawImage(bgGlintSprites[s.ci][s.sp], s.x - hs, s.y - hs, hs * 2, hs * 2);
  }
  if (open) ctx.restore();
  ctx.globalAlpha = 1;
}

// Sky base, drawn in screen space before the camera transform: near-pure black, a hair lighter in the middle.
let _skyKey = "", _skyBase = null;
function drawSkyBase(W, H) {
  const key = W + "x" + H;
  if (key !== _skyKey) {
    _skyKey = key;
    _skyBase = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.88);
    _skyBase.addColorStop(0,    "#030307");
    _skyBase.addColorStop(0.50, "#010103");
    _skyBase.addColorStop(1,    "#000000");
  }
  ctx.fillStyle = _skyBase;
  ctx.fillRect(0, 0, W, H);
}

// Soft vignette in screen space: deepens the edges of the sky and keeps the eye on the centre.
let _vigKey = "", _vigGrad = null;
function drawVignette(W, H) {
  const key = W + "x" + H;
  if (key !== _vigKey) {
    _vigKey = key;
    _vigGrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.hypot(W, H) * 0.68);
    _vigGrad.addColorStop(0,    "rgba(3,1,8,0)");
    _vigGrad.addColorStop(0.50, "rgba(3,1,8,0.10)");
    _vigGrad.addColorStop(0.78, "rgba(3,1,8,0.30)");
    _vigGrad.addColorStop(1,    "rgba(3,1,8,0.66)");
  }
  ctx.fillStyle = _vigGrad;
  ctx.fillRect(0, 0, W, H);
}

// ─────────────────────────────────────────────
//  PARTICLES
// ─────────────────────────────────────────────
const MOTE_RGB = ["214,198,190", "248,230,206", "200,208,222"];
let moteSprites = null;
function _buildMoteSprite(rgb) {
  const N = 32, H = N / 2, c = _softCanvas(N), x = c.getContext("2d");
  const g = x.createRadialGradient(H, H, 0, H, H, H);
  g.addColorStop(0,    `rgba(${rgb},0.90)`);
  g.addColorStop(0.40, `rgba(${rgb},0.30)`);
  g.addColorStop(1,    `rgba(${rgb},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, N, N);
  return c;
}

function updateAndDrawParticles(dt, ts) {
  if (!moteSprites) moteSprites = MOTE_RGB.map(_buildMoteSprite);
  const t = (ts || 0) * 0.001, still = binaryReduceMotion;
  ctx.globalCompositeOperation = "lighter";
  for (const p of particles) {
    if (!still) {
      // slow drift plus a gentle wander, so the motes float instead of sliding in straight lines
      p.x += (p.vx + Math.sin(t * 0.30 + p.ph) * 0.03) * dt;
      p.y += (p.vy + Math.cos(t * 0.25 + p.ph * 1.3) * 0.03) * dt;
    }
    if (p.x < 0) p.x += WORLD_W;
    if (p.x > WORLD_W) p.x -= WORLD_W;
    if (p.y < 0) p.y += WORLD_H;
    if (p.y > WORLD_H) p.y -= WORLD_H;

    const tw = 0.55 + 0.45 * Math.sin(t * p.tw + p.ph);
    const sz = p.r * 4.2;
    ctx.globalAlpha = Math.min(1, p.alpha * 2.4 * tw);
    ctx.drawImage(moteSprites[p.ci], p.x - sz, p.y - sz, sz * 2, sz * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
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
    ctx.fillStyle = `rgba(255,226,190,${alpha})`;
    ctx.fill();
  }
}

// ─── V2: Binary thread rendering ───
const _thrById = new Map();
function drawBinaryThreads(ts) {
  const t = ts * 0.001;
  let anyLink = false;
  for (const s0 of stars) { if (s0.linkedStarId) { anyLink = true; break; } }
  if (!anyLink) return;
  _thrById.clear();
  for (const s0 of stars) _thrById.set(s0.id, s0);
  const drawn = new Set();

  for (const star of stars) {
    if (!star.linkedStarId) continue;
    const key = [star.id, star.linkedStarId].sort().join(":");
    if (drawn.has(key)) continue;
    drawn.add(key);

    const partner = _thrById.get(star.linkedStarId);
    if (!partner) continue;

    const pulseBoost = startupPulse * 0.35;
    const baseAlpha  = 0.10 + pulseBoost;
    const shimmer    = 0.03 * Math.sin(t * 1.4 + hashPhase(star.id) * 6.28);
    const alpha      = Math.min(0.55, baseAlpha + shimmer);

        const ax = star.x + pxWx(star), ay = star.y + pxWy(star);
    const bx = partner.x + pxWx(partner), by = partner.y + pxWy(partner);
    const grad = ctx.createLinearGradient(ax, ay, bx, by);
    grad.addColorStop(0,   `rgba(206,198,190,${alpha})`);
    grad.addColorStop(0.5, `rgba(222,214,206,${alpha * 1.3})`);
    grad.addColorStop(1,   `rgba(206,198,190,${alpha})`);

    ctx.beginPath();
        ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
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

  if (star.type === "bigbang" || star.type === "confession") {
    return; // rendered by drawBinarySystem()
  } else {
                pxSet(pxLayerOf(star));
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

// ─────────────────────────────────────────────
//  BIG BANG × CONFESSION — COSMIC CORE (VISUAL BINARY)
//  Render-layer only. Saved coordinates are never modified or written.
// ─────────────────────────────────────────────
var BIN = {
  period: 60000,            // ms — 2.5× the previous 150000 ms
  cosI: 0.88, sinI: 0.475,  // slight orbital inclination
  tilt: -0.32,              // orbit rotation on screen (rad)
  staticTh: 0.9,            // static phase for reduced motion
  ringR: 132,               // the single orbital ring
  haloR: 340,               // central halo radius (world units)
  bb: { R: 90, r: 19, ph: 0,       lonOff: 0.0, rot:  0.06, bph: 0.0,
        core: "240,214,168", mid: "222,176,112", edge: "160,108,58",
        glow: "218,178,114", bright: "232,196,140", dark: "128,80,36",
        label: "rgba(235,205,150,0.62)", text: "Big Bang", fs: 10 },
  cf: { R: 108, r: 15, ph: Math.PI, lonOff: 2.3, rot: -0.08, bph: 2.1,
        core: "230,206,208", mid: "206,152,156", edge: "140,84,96",
        glow: "212,160,164", bright: "218,176,180", dark: "104,54,64",
        label: "rgba(236,176,206,0.6)", text: "Confession", fs: 9 }
};
var binarySpots = null;
var binaryParts = null;
var binaryReduceMotion = false;
try {
  var binaryMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  binaryReduceMotion = binaryMQ.matches;
  var binaryMQHandler = function (e) { binaryReduceMotion = e.matches; };
  if (binaryMQ.addEventListener) binaryMQ.addEventListener("change", binaryMQHandler);
  else if (binaryMQ.addListener) binaryMQ.addListener(binaryMQHandler);
} catch (e) { binaryReduceMotion = false; }

function binaryCentre() {
  const b = SPECIAL_STARS.find(s => s.id === "bigbang");
  const c = SPECIAL_STARS.find(s => s.id === "confession");
  return { b: b, c: c, cx: (b.x + c.x) / 2, cy: (b.y + c.y) / 2 };
}

function binaryTheta(now) {
  return binaryReduceMotion ? BIN.staticTh : ((now % BIN.period) / BIN.period) * Math.PI * 2;
}

function binaryOrbitPoint(R, a, cx, cy) {
  const s = Math.sin(a);
  const ox = R * Math.cos(a);
  const oy = R * s * BIN.cosI;
  const ct = Math.cos(BIN.tilt), st = Math.sin(BIN.tilt);
  return { x: cx + ox * ct - oy * st, y: cy + ox * st + oy * ct, z: R * s * BIN.sinI };
}

function binaryRadius(spec, z) {
  return Math.max(spec.r * (1 + z / 500), 3.8 / cam.zoom);
}

// Animated visual position + radius of Big Bang / Confession (used for hit detection)
function binaryVisualPos(star) {
  try {
    const k = binaryCentre();
    const spec = star.type === "bigbang" ? BIN.bb : BIN.cf;
    const p = binaryOrbitPoint(spec.R, binaryTheta(Date.now()) + spec.ph, k.cx, k.cy);
    p.r = binaryRadius(spec, p.z);
    return p;
  } catch (e) {
    return star;
  }
}

function binaryGetSpots() {
  if (binarySpots) return binarySpots;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  binarySpots = [];
  for (let i = 0; i < 14; i++) {
    binarySpots.push({
      lon: rnd() * Math.PI * 2,
      lat: (rnd() - 0.5) * 2.2,
      size: 0.10 + rnd() * 0.16,
      a: 0.06 + rnd() * 0.09,
      bright: rnd() < 0.4
    });
  }
  return binarySpots;
}

function binaryGetParts() {
  if (binaryParts) return binaryParts;
  let seed = 31;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  binaryParts = [];
  for (let i = 0; i < 28; i++) {
    const ring = i % 3 === 0;
    binaryParts.push({
      ring: ring,
            rho: ring ? BIN.ringR + (rnd() - 0.5) * 8 : (i % 4 === 1 ? 40 + rnd() * 48 : 108 + rnd() * 70),
      a0: rnd() * Math.PI * 2,
      sp: ring ? 0.10 + rnd() * 0.06 : (0.03 + rnd() * 0.06) * (rnd() < 0.5 ? 1 : -1),
      wob: ring ? 0 : 3 + rnd() * 6,
      r: 0.5 + rnd() * 0.8,
      a: 0.35 + rnd() * 0.4,
      ph: rnd() * Math.PI * 2,
      tw: 0.8 + rnd() * 1.4,
      h: rnd()
    });
  }
  return binaryParts;
}

// ─────────────────────────────────────────────
//  COSMIC CORE V3 — MULTI-LAYER PARTICLE ENVIRONMENT
//  Purely visual. Particles are never stored, selectable or hit-tested.
// ─────────────────────────────────────────────
// f      parallax/depth factor (<1 distant, 1 core plane, >1 near)
// n      particle count     ns  number of streams
// r      stream radius band th  stream thickness band   ci  ellipse minor ratio band
// sp     orbital speed band (rad/s)   dir  base direction   retro  chance a stream runs retrograde
// brk    chance a stream is broken    sz/al  size / alpha bands   big  chance of a larger particle
// neu    chance of a neutral (desaturated) particle   dr  radial drift   wa  layer wander   glim  glimmer chance
var BENV_LAYERS = [
  { f: 0.70, n:  60, ns: 3, r: [300, 470], th: [40, 90], ci: [0.50, 0.85], sp: [0.006, 0.014], dir: -1, retro: 0.25, brk: 0.5,  sz: [0.30, 0.60], big: 0,    bigSz: [0, 0],     al: [0.10, 0.22], neu: 1.0,  dr: 10, wa: 18, glim: 0.05, front: 0 },
  { f: 0.80, n:  70, ns: 4, r: [220, 380], th: [35, 80], ci: [0.45, 0.80], sp: [0.012, 0.024], dir:  1, retro: 0.30, brk: 0.5,  sz: [0.35, 0.80], big: 0.04, bigSz: [1.2, 1.8], al: [0.12, 0.28], neu: 0.8,  dr:  9, wa: 16, glim: 0.06, front: 0 },
  { f: 0.88, n:  90, ns: 4, r: [140, 260], th: [26, 56], ci: [0.40, 0.85], sp: [0.025, 0.050], dir: -1, retro: 0.30, brk: 0.45, sz: [0.40, 1.00], big: 0.05, bigSz: [1.4, 2.0], al: [0.16, 0.36], neu: 0.45, dr:  8, wa: 13, glim: 0.08, front: 0 },
  { f: 0.95, n: 110, ns: 5, r: [112, 210], th: [ 3,  9], ci: [0.50, 0.95], sp: [0.045, 0.085], dir:  1, retro: 0.35, brk: 0.40, sz: [0.40, 1.10], big: 0.06, bigSz: [1.5, 2.2], al: [0.28, 0.55], neu: 0.15, dr:  4, wa:  9, glim: 0.10, front: 0 },
  { f: 1.00, n: 190, ns: 6, r: [106, 170], th: [ 3, 16], ci: [0.55, 0.98], sp: [0.080, 0.160], dir:  1, retro: 0.35, brk: 0.30, sz: [0.35, 1.00], big: 0.07, bigSz: [1.4, 2.2], al: [0.40, 0.85], neu: 0,    dr:  3, wa:  5, glim: 0.12, front: 0 },
  { f: 1.06, n:  90, ns: 4, r: [108, 160], th: [ 2, 10], ci: [0.55, 0.95], sp: [0.070, 0.140], dir: -1, retro: 0.30, brk: 0.50, sz: [0.30, 0.80], big: 0.05, bigSz: [1.2, 1.8], al: [0.35, 0.70], neu: 0,    dr:  3, wa:  6, glim: 0.12, front: 1 },
  { f: 1.00, n:  32, sat: 1,   r: [ 22,  40], th: [ 1,  3], ci: [0.55, 0.95], sp: [0.280, 0.450], dir:  1, retro: 0.30, brk: 0,    sz: [0.30, 0.70], big: 0.08, bigSz: [1.0, 1.4], al: [0.50, 0.90], neu: 0,    dr:  1, wa:  0, glim: 0.15, front: 0 },
  { f: 1.14, n:  16, ns: 2, r: [120, 300], th: [50, 90], ci: [0.50, 0.90], sp: [0.010, 0.025], dir:  1, retro: 0.30, brk: 0,    sz: [2.00, 4.20], big: 0,    bigSz: [0, 0],     al: [0.08, 0.18], neu: 0.5,  dr: 12, wa: 22, glim: 0.10, front: 1 },
  { f: 0.74, n:  50, ns: 3, r: [260, 460], th: [30, 70], ci: [0.55, 0.90], sp: [0.008, 0.016], dir:  1, retro: 0.40, brk: 0.6,  sz: [0.30, 0.55], big: 0,    bigSz: [0, 0],     al: [0.08, 0.18], neu: 1.0,  dr: 10, wa: 20, glim: 0.04, front: 0 }
];
var BENV_GAIN = 0.85;
var binaryEnv = null;
var binaryPerf = { init: false, last: 0, ema: 16.7, q: 1, qMax: 1, frames: 0 };

function binaryPerfTick(ts) {
  const P = binaryPerf;
  if (!P.init) {
    P.init = true;
    P.last = ts;
    let mob = false;
    try { mob = /Android|Mobi|Tablet/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4; } catch (e) { mob = false; }
    P.q = mob ? 0.7 : 1;
    P.qMax = mob ? 0.85 : 1;
    return;
  }
  const dt = ts - P.last;
  P.last = ts;
  if (dt <= 0 || dt > 120) return;           // ignore tab-resume gaps
  P.ema += (dt - P.ema) * 0.04;
  if (++P.frames >= 45) {
    P.frames = 0;
    if (P.ema > 27) P.q = Math.max(0.3, P.q - 0.12);
    else if (P.ema < 20 && P.q < P.qMax) P.q = Math.min(P.qMax, P.q + 0.04);
  }
}

function binaryEnvColor(t, neutral) {
  const S = [[0, 236, 196, 120], [0.3, 244, 222, 184], [0.5, 236, 232, 226], [0.7, 226, 200, 198], [1, 202, 156, 156]];
  let i = 0;
  while (i < S.length - 2 && t > S[i + 1][0]) i++;
  const a = S[i], b = S[i + 1], u = (t - a[0]) / (b[0] - a[0]);
  let r = a[1] + (b[1] - a[1]) * u, g = a[2] + (b[2] - a[2]) * u, bl = a[3] + (b[3] - a[3]) * u;
  if (neutral) { r = r * 0.4 + 214 * 0.6; g = g * 0.4 + 210 * 0.6; bl = bl * 0.4 + 206 * 0.6; }
  return [Math.round(r), Math.round(g), Math.round(bl)];
}

function binaryEnvSprite(c) {
  const cv = document.createElement("canvas");
  cv.width = 32; cv.height = 32;
  const x = cv.getContext("2d");
  if (!x) return null;
  const w = [Math.round(c[0] * 0.5 + 127), Math.round(c[1] * 0.5 + 127), Math.round(c[2] * 0.5 + 127)];
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0,    `rgba(${w[0]},${w[1]},${w[2]},1)`);
  g.addColorStop(0.18, `rgba(${c[0]},${c[1]},${c[2]},0.85)`);
  g.addColorStop(0.5,  `rgba(${c[0]},${c[1]},${c[2]},0.18)`);
  g.addColorStop(1,    `rgba(${c[0]},${c[1]},${c[2]},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  return cv;
}

function binaryEnvBuild() {
  let seed = 977;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lerp = (r, u) => r[0] + (r[1] - r[0]) * u;
  const TAU = Math.PI * 2;
  const env = { layers: [], sprites: [], off: false, B: null, F: null, total: 0 };

  for (let ri = 0; ri < 2; ri++) {
    for (let i = 0; i < 8; i++) {
      const sp = binaryEnvSprite(binaryEnvColor(i / 7, ri === 1));
      if (!sp) { env.off = true; return env; }
      env.sprites.push(sp);
    }
  }

  for (const C of BENV_LAYERS) {
    const L = { f: C.f, front: !!C.front, sat: !!C.sat, parts: [], streams: [],
                wa: C.wa || 0, ww: 0.05 + rnd() * 0.07, wp: rnd() * TAU };
    const ns = C.sat ? 2 : C.ns;
    let wsum = 0;
    for (let si = 0; si < ns; si++) {
      const th = lerp(C.th, rnd());
      const r0 = C.sat
        ? (si === 0 ? 26 + rnd() * 14 : 22 + rnd() * 12)
        : C.r[0] + (C.r[1] - C.r[0]) * Math.pow(rnd(), 1.4);
      const st = {
        r0: r0, th: th, ci: lerp(C.ci, rnd()),
        t0: rnd() * Math.PI, prec: C.sat ? 0 : (rnd() - 0.5) * 0.012,
        sp: lerp(C.sp, rnd()), dir: rnd() < C.retro ? -C.dir : C.dir,
        owner: C.sat ? si + 1 : 0,
        w: (0.6 + rnd() * 0.8) / Math.sqrt(th),
        arcs: null, ct: 1, st: 0, k: 2 + ((rnd() * 2) | 0), kp: rnd() * TAU
      };
      st.si = Math.sqrt(1 - st.ci * st.ci);
      if (!C.sat && rnd() < C.brk) {
        const na = 2 + ((rnd() * 3) | 0);
        let pos = rnd() * TAU, tot = 0;
        st.arcs = [];
        for (let a = 0; a < na; a++) {
          const len = 0.5 + rnd() * 1.3;
          st.arcs.push([pos, len]);
          tot += len;
          pos += len + 0.4 + rnd() * 1.2;
        }
        st.arcTot = tot;
      }
      wsum += st.w;
      L.streams.push(st);
    }
    const rMid = C.sat ? 30 : (C.r[0] + C.r[1]) / 2;
    for (let i = 0; i < C.n; i++) {
      let u = rnd() * wsum, st = L.streams[0];
      for (let s = 0; s < L.streams.length; s++) {
        u -= L.streams[s].w;
        if (u <= 0) { st = L.streams[s]; break; }
      }
      let a;
      if (st.arcs) {
        let q = rnd() * st.arcTot, arc = st.arcs[0];
        for (let s = 0; s < st.arcs.length; s++) {
          q -= st.arcs[s][1];
          if (q <= 0) { arc = st.arcs[s]; break; }
        }
        a = arc[0] + arc[1] * rnd();
      } else {
        const v = rnd();
        a = TAU * (v + 0.06 * Math.sin(TAU * st.k * v + st.kp));
      }
      const g = (rnd() + rnd() + rnd() - 1.5) * 0.667;
      const rho = Math.max(6, st.r0 + g * st.th * (C.sat ? 1 : 0.5));
      const kf = C.sat ? 1 : Math.min(1.6, Math.max(0.6, Math.pow(rMid / rho, 1.5)));
      const big = rnd() < C.big;
      let sz = big ? lerp(C.bigSz, rnd()) : C.sz[0] + (C.sz[1] - C.sz[0]) * Math.pow(rnd(), 1.6);
      let al = lerp(C.al, rnd()) * (big ? 0.7 : 1);
      if (!C.sat) al *= 1.1 - 0.7 * Math.min(1, rho / 460);
      L.parts.push({
        s: st, a0: a, rho: rho, w: st.dir * st.sp * kf,
        sz: sz, al: al * BENV_GAIN,
        tf: 0.5 + rnd() * 1.7, tp: rnd() * TAU,
        gf: rnd() < C.glim ? 0.9 + rnd() * 1.3 : 0, gp: rnd() * TAU,
        da: 1 + rnd() * C.dr, dw: 0.1 + rnd() * 0.3, dp: rnd() * TAU,
        hj: (rnd() - 0.5) * 0.22, neu: rnd() < C.neu ? 8 : 0
      });
    }
    env.total += L.parts.length;
    env.layers.push(L);
  }
  const mk = () => ({ n: 0, cap: env.total + 8, x: new Float32Array(env.total + 8), y: new Float32Array(env.total + 8),
                      h: new Float32Array(env.total + 8), a: new Float32Array(env.total + 8), c: new Uint8Array(env.total + 8) });
  env.B = mk();
  env.F = mk();
  return env;
}

// Computes every visible particle once per frame into a back and a front buffer.
function binaryEnvPrepare(k, pa, pb, rA, rB, now) {
  if (!binaryEnv) binaryEnv = binaryEnvBuild();
  const e = binaryEnv;
  if (e.off) return false;
  e.B.n = 0; e.F.n = 0;

  const reduced = binaryReduceMotion;
  const t = reduced ? 0 : now / 1000;
  const zoom = cam.zoom;
  const vw = canvas.width / zoom, vh = canvas.height / zoom;
  const vx = cam.x + canvas.width / 2, vy = cam.y + canvas.height / 2;
  const left = vx - vw / 2 - 24, right = vx + vw / 2 + 24;
  const top = vy - vh / 2 - 24, bottom = vy + vh / 2 + 24;

  // Camera offset from the core, softly clamped so layers never drift away from it
  let dx = vx - k.cx, dy = vy - k.cy;
  const len = Math.hypot(dx, dy);
  if (len > 1) { const m = 260 * Math.tanh(len / 260) / len; dx *= m; dy *= m; }

  const lod = zoom < 0.2 ? 0.4 : zoom < 0.35 ? 0.65 : 1;
  const qe = Math.min(1, binaryPerf.q * lod);
  const minH = 1.6 / zoom;

  for (let li = 0; li < e.layers.length; li++) {
    const L = e.layers[li];
    const f = L.f;
    const ls = Math.pow(zoom, f - 1);
    const shx = (1 - f) * dx + (reduced ? 0 : L.wa * Math.sin(t * L.ww + L.wp));
    const shy = (1 - f) * dy + (reduced ? 0 : L.wa * Math.cos(t * L.ww * 0.83 + L.wp * 1.7));
    for (let si = 0; si < L.streams.length; si++) {
      const s = L.streams[si];
      const ang = s.t0 + s.prec * t;
      s.ct = Math.cos(ang); s.st = Math.sin(ang);
    }
    const n = Math.floor(L.parts.length * qe);
    for (let i = 0; i < n; i++) {
      const p = L.parts[i];
      const s = p.s;
      const a = p.a0 + p.w * t;
      const rr = reduced ? p.rho : p.rho + p.da * Math.sin(t * p.dw + p.dp);
      const sa = Math.sin(a), ca = Math.cos(a);
      const ox = rr * ca, oy = rr * sa * s.ci;
      const lx = ox * s.ct - oy * s.st, ly = ox * s.st + oy * s.ct;
      let X, Y;
      if (s.owner) {
        const o = s.owner === 1 ? pa : pb;
        X = o.x + lx; Y = o.y + ly;
      } else {
        X = k.cx + lx * ls + shx; Y = k.cy + ly * ls + shy;
      }
      if (X < left || X > right || Y < top || Y > bottom) continue;

      const z = sa * s.si;                      // +1 toward viewer, −1 away
      let al = p.al * (1 + 0.25 * z);
      if (reduced) al *= 0.8;
      else {
        al *= 0.62 + 0.38 * Math.sin(t * p.tf + p.tp);
        if (p.gf > 0) {
          let g = (Math.sin(t * p.gf + p.gp) - 0.88) / 0.12;
          if (g > 0) al *= 1 + 1.6 * g * g;
        }
      }
      let h = Math.max(p.sz * (1 + 0.22 * z) * (s.owner ? 1 : ls) * 2.6, minH);

      const dAx = X - pa.x, dAy = Y - pa.y, dBx = X - pb.x, dBy = Y - pb.y;
      const dA = Math.sqrt(dAx * dAx + dAy * dAy), dB = Math.sqrt(dBx * dBx + dBy * dBy);
      let ci;
      if (s.owner) ci = s.owner === 1 ? 1 : 6;
      else {
        ci = Math.round((dA / (dA + dB + 1e-6) + p.hj) * 7);
        ci = ci < 0 ? 0 : ci > 7 ? 7 : ci;
        ci += p.neu;
            }

      if (!s.owner) {
        // The orbit ring is the epicentre: its interior stays sparse (dim, never empty)
        const ex = X - k.cx, ey = Y - k.cy;
        const eu = (ex * 0.94923 - ey * 0.31457) / BIN.ringR;
        const ev = (ex * 0.31457 + ey * 0.94923) / (BIN.ringR * BIN.cosI);
        let kk = (Math.sqrt(eu * eu + ev * ev) - 0.9) / 0.2;
        kk = kk < 0 ? 0 : kk > 1 ? 1 : kk;
        al *= 0.2 + 0.8 * kk * kk * (3 - 2 * kk);
      }

      const front = L.front || (s.owner && z > 0);
      if (front) {
        // never obscure the two stars
        const fa = (dA - rA * 1.3) / (rA * 1.4), fb = (dB - rB * 1.3) / (rB * 1.4);
        const fd = Math.min(fa, fb);
        if (fd <= 0) continue;
        if (fd < 1) al *= fd;
      }
      if (al > 1) al = 1;
      if (al < 0.01) continue;
      const B = front ? e.F : e.B;
      if (B.n >= B.cap) continue;
      const j = B.n++;
      B.x[j] = X; B.y[j] = Y; B.h[j] = h; B.a[j] = al; B.c[j] = ci;
    }
  }
  return true;
}

function binaryEnvDraw(front) {
  const e = binaryEnv;
  if (!e || e.off) return;
  const B = front ? e.F : e.B;
  try {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < B.n; i++) {
      const h = B.h[i];
      ctx.globalAlpha = B.a[i];
      ctx.drawImage(e.sprites[B.c[i]], B.x[i] - h, B.y[i] - h, h * 2, h * 2);
    }
  } finally {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

function binaryDrawHalo(k, pa, pb, t) {
  const hp = 0.90 + 0.10 * Math.sin(t * 0.55);
  const H = BIN.haloR;
  ctx.globalCompositeOperation = "lighter";
  let g = ctx.createRadialGradient(k.cx, k.cy, 0, k.cx, k.cy, H * 1.22);
  g.addColorStop(0, `rgba(215,215,235,${0.035 * hp})`);
  g.addColorStop(1, "rgba(215,215,235,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(k.cx, k.cy, H * 1.22, 0, Math.PI * 2); ctx.fill();

  g = ctx.createRadialGradient(pa.x, pa.y, 0, pa.x, pa.y, H * 0.95);
  g.addColorStop(0, `rgba(218,178,114,${0.075 * hp})`);
  g.addColorStop(1, "rgba(218,178,114,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(pa.x, pa.y, H * 0.95, 0, Math.PI * 2); ctx.fill();

  g = ctx.createRadialGradient(pb.x, pb.y, 0, pb.x, pb.y, H * 0.90);
  g.addColorStop(0, `rgba(212,160,164,${0.07 * hp})`);
  g.addColorStop(1, "rgba(212,160,164,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(pb.x, pb.y, H * 0.90, 0, Math.PI * 2); ctx.fill();

    // Soft glow spread across the whole orbit ring (decorative only)
  g = ctx.createRadialGradient(k.cx, k.cy, 0, k.cx, k.cy, BIN.ringR * 1.12);
  g.addColorStop(0,   `rgba(255,238,215,${0.035 * hp})`);
  g.addColorStop(0.7, `rgba(200,215,255,${0.055 * hp})`);
  g.addColorStop(1,   "rgba(200,215,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(k.cx, k.cy, BIN.ringR * 1.12, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

function binaryDrawRing(k, th) {
  const R = BIN.ringR, ry = R * BIN.cosI;
  const ct = Math.cos(BIN.tilt), st = Math.sin(BIN.tilt);
  const lg = ctx.createLinearGradient(k.cx - R * ct, k.cy - R * st, k.cx + R * ct, k.cy + R * st);
  lg.addColorStop(0,   "rgba(212,160,164,0.15)");
  lg.addColorStop(0.5, "rgba(228,214,212,0.08)");
  lg.addColorStop(1,   "rgba(218,178,114,0.15)");
  ctx.lineCap = "round";
  ctx.lineWidth = 1.2 / cam.zoom;
  ctx.strokeStyle = lg;
  ctx.beginPath();
  ctx.ellipse(k.cx, k.cy, R, ry, BIN.tilt, 0, Math.PI * 2);
  ctx.stroke();

  // Moving light accent along the same ring
  const a0 = th * 1.6;
  const mix = (Math.cos(a0) + 1) / 2;
  const cr = Math.round(225 + 30 * mix), cg = Math.round(140 + 56 * mix), cb = Math.round(190 - 90 * mix);
  const tail = [[0.9, 0.6, 0.06], [0.6, 0.3, 0.13], [0.3, 0.0, 0.24]];
  ctx.lineWidth = 2.2 / cam.zoom;
  for (let i = 0; i < tail.length; i++) {
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${tail[i][2]})`;
    ctx.beginPath();
    ctx.ellipse(k.cx, k.cy, R, ry, BIN.tilt, a0 - tail[i][0], a0 - tail[i][1]);
    ctx.stroke();
  }
}

function binaryDrawParticles(k, now) {
  const parts = binaryGetParts();
  const s = now / 1000;
  const fl = 0.7 / cam.zoom;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const a = binaryReduceMotion ? p.a0 : p.a0 + p.sp * s;
    const rho = binaryReduceMotion ? p.rho : p.rho + p.wob * Math.sin(s * 0.4 + p.ph);
    const pt = binaryOrbitPoint(rho, a, k.cx, k.cy);
    const tw = binaryReduceMotion ? 0.8 : 0.55 + 0.45 * Math.sin(s * p.tw + p.ph);
    const cr = Math.round(240 - 12 * p.h), cg = Math.round(214 - 56 * p.h), cb = Math.round(168 - 10 * p.h);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, Math.max(p.r, fl), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${p.a * tw})`;
    ctx.fill();
  }
}

function binaryDrawTrail(spec, th, k) {
  if (binaryReduceMotion) return;
  const N = 14, span = 0.85;
  let prev = binaryOrbitPoint(spec.R, th + spec.ph, k.cx, k.cy);
  ctx.lineWidth = 1.1 / cam.zoom;
  ctx.lineCap = "round";
  for (let i = 1; i <= N; i++) {
    const p = binaryOrbitPoint(spec.R, th + spec.ph - span * i / N, k.cx, k.cy);
    const a = 0.2 * Math.pow(1 - (i - 1) / N, 2);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = `rgba(${spec.glow},${a})`;
    ctx.stroke();
    prev = p;
  }
}

function binaryDrawBody(p, spec, o, now, dimOv) {
  const t = now / 1000;
  const breathe = binaryReduceMotion ? 0 : Math.sin(t * 1.2 + spec.bph);
  const R = binaryRadius(spec, p.z) * (1 + 0.02 * breathe);
  const x = p.x, y = p.y;

  // Restrained corona (independent gentle breathing)
  ctx.globalCompositeOperation = "lighter";
  // Corona: gaussian-eased, many-stop glow — luminous near the star, dissolving without a visible edge
  const cr = R * 6.0, ck = 0.26 * (1 + 0.10 * breathe) * (1 - 0.4 * dimOv);
  let g = ctx.createRadialGradient(x, y, R * 0.6, x, y, cr);
  for (let gi = 0; gi <= 12; gi++) {
    const gr = gi / 12, gd = 0.6 + gr * 5.4;           // gd = distance in star radii
    const ga = ck * (0.75 * Math.exp(-gd * gd / 3.61) + 0.30 * Math.exp(-gd * gd / 12.96)) * (1 - _smooth(0.7, 1, gr));
    g.addColorStop(gr, `rgba(${spec.glow},${ga.toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, cr, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // Stellar body (limb-darkened sphere, clipped detail)
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.clip();
  g = ctx.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0,    `rgb(${spec.core})`);
  g.addColorStop(0.45, `rgb(${spec.mid})`);
  g.addColorStop(1,    `rgb(${spec.edge})`);
  ctx.fillStyle = g;
  ctx.fillRect(x - R, y - R, R * 2, R * 2);

  // Subtle rotating surface variation (more detail when zoomed in)
  const spots = binaryGetSpots();
  const n = cam.zoom > 1.4 ? spots.length : cam.zoom > 0.8 ? 8 : 4;
  const rot = t * spec.rot;
  for (let i = 0; i < n; i++) {
    const s = spots[i];
    const lon = s.lon + spec.lonOff + rot;
    const c = Math.cos(s.lat);
    const vis = c * Math.cos(lon);
    if (vis < 0.08) continue;
    const px = x + R * c * Math.sin(lon);
    const py = y + R * Math.sin(s.lat);
    ctx.beginPath();
    ctx.arc(px, py, s.size * R * (0.5 + 0.5 * vis), 0, Math.PI * 2);
    ctx.fillStyle = s.bright
      ? `rgba(${spec.bright},${s.a * vis})`
      : `rgba(${spec.dark},${s.a * 1.3 * vis})`;
    ctx.fill();
  }

  // Light interaction: faint tint on the side facing the companion
  const dx = o.x - x, dy = o.y - y;
  const d = Math.hypot(dx, dy) || 1;
  const ox = x + dx / d * R * 0.9, oy = y + dy / d * R * 0.9;
  const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, R * 1.4);
  og.addColorStop(0, `rgba(${o.glow},0.08)`);
  og.addColorStop(1, `rgba(${o.glow},0)`);
  ctx.fillStyle = og;
  ctx.fillRect(x - R, y - R, R * 2, R * 2);

  // Subtle illumination change while partially eclipsed
  if (dimOv > 0) {
    ctx.fillStyle = `rgba(0,0,0,${0.22 * dimOv})`;
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
  }
  ctx.restore();

  // Feathered limb: the body melts into its corona instead of ending on a hard edge
  ctx.globalCompositeOperation = "lighter";
  const fg = ctx.createRadialGradient(x, y, R * 0.82, x, y, R * 1.7);
  fg.addColorStop(0,   `rgba(${spec.mid},0)`);
  fg.addColorStop(0.2, `rgba(${spec.mid},0.16)`);
  fg.addColorStop(0.5, `rgba(${spec.mid},0.06)`);
  fg.addColorStop(1,   `rgba(${spec.mid},0)`);
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.arc(x, y, R * 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // Filigree rings that ambiently fade in and out
  ctx.globalCompositeOperation = "lighter";
  ctx.lineWidth = 0.9 / cam.zoom;
  for (let k = 0; k < 2; k++) {
    const v = binaryReduceMotion ? 0.7 : _smooth(0.2, 0.8, 0.5 + 0.5 * Math.sin(t * (0.42 + 0.15 * k) + spec.bph * 3 + k * 2.1));
    if (v < 0.02) continue;
    ctx.strokeStyle = `rgba(${spec.glow},${(0.07 * v).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, R * (2.8 + k * 1.15), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  return R;
}

// Cached hairline-cross sprite per star colour (one long cross + two shorter diagonals)
var _binSpikeCache = {};
function binarySpikeSprite(rgb) {
  if (_binSpikeCache[rgb] !== undefined) return _binSpikeCache[rgb];
  let c = null;
  try {
    const N = 256, H = 128;
    c = _softCanvas(N);
    const x = c.getContext("2d"), white = _rgbMix(rgb, "255,255,255", 0.3);
    const taper = [[0, 0], [0.2, 0.03], [0.38, 0.12], [0.5, 0.45], [0.62, 0.12], [0.8, 0.03], [1, 0]];
    x.translate(H, H);
    x.globalCompositeOperation = "lighter";
    for (const arm of [[0, H - 1, 1], [Math.PI / 2, H - 1, 1], [Math.PI / 4, (H - 1) * 0.5, 0.45], [-Math.PI / 4, (H - 1) * 0.5, 0.45]]) {
      x.save();
      x.rotate(arm[0]);
      const g = x.createLinearGradient(-arm[1], 0, arm[1], 0);
      for (const s of taper) g.addColorStop(s[0], `rgba(${white},${(s[1] * arm[2]).toFixed(3)})`);
      x.fillStyle = g;
      x.fillRect(-arm[1], -0.6, arm[1] * 2, 1.2);
      x.restore();
    }
  } catch (e) { c = null; }
  _binSpikeCache[rgb] = c;
  return c;
}

// A faint luminous bridge of gas between the two stars
function binaryDrawBridge(pa, pb, now) {
  const hp = binaryReduceMotion ? 0.8 : 0.8 + 0.2 * Math.sin(now / 1000 * 0.6);
  const g = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
  g.addColorStop(0,   `rgba(${BIN.bb.glow},${0.10 * hp})`);
  g.addColorStop(0.5, `rgba(246,190,190,${0.05 * hp})`);
  g.addColorStop(1,   `rgba(${BIN.cf.glow},${0.10 * hp})`);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.strokeStyle = g;
  ctx.lineWidth = BIN.bb.r * 2.2;
  ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  ctx.lineWidth = BIN.bb.r * 0.9;
  ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

function binaryDrawFallback() {
  for (const s of SPECIAL_STARS) {
    if (s.type !== "bigbang" && s.type !== "confession") continue;
    const spec = s.type === "bigbang" ? BIN.bb : BIN.cf;
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(spec.r * 0.6, 3.8 / cam.zoom), 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${spec.mid})`;
    ctx.fill();
  }
}

function drawBinarySystem(ts) {
  binaryPerfTick(ts);
  try {
    const k = binaryCentre();
    const vw = canvas.width / cam.zoom, vh = canvas.height / cam.zoom;
    const left = cam.x + canvas.width / 2 - vw / 2;
    const top  = cam.y + canvas.height / 2 - vh / 2;
        const m = 520;
        let seen = false;   // core layers (back particles 4 / body, halo, front 5) sit at different pan offsets
    for (let l = 4; l <= 5 && !seen; l++) {
      const cx = k.cx + pxOX[l], cy = k.cy + pxOY[l];
      seen = !(cx < left - m || cx > left + vw + m || cy < top - m || cy > top + vh + m);
    }
    if (!seen) return;

    const now = Date.now();
    const t = now / 1000;
    const th = binaryTheta(now);
    const pa = binaryOrbitPoint(BIN.bb.R, th + BIN.bb.ph, k.cx, k.cy);
    const pb = binaryOrbitPoint(BIN.cf.R, th + BIN.cf.ph, k.cx, k.cy);
    const rA = binaryRadius(BIN.bb, pa.z);
    const rB = binaryRadius(BIN.cf, pb.z);

    // V3 particle environment (graceful: disabled on any failure)
    let envOn = false;
    try {
      envOn = binaryEnvPrepare(k, pa, pb, rA, rB, now);
    } catch (err) {
      binaryEnv = { off: true };
      envOn = false;
    }

            pxSet(5);
    binaryDrawHalo(k, pa, pb, t);
    pxSet(4);
    if (envOn) binaryEnvDraw(false);
    pxSet(5);
    binaryDrawRing(k, th);
    binaryDrawParticles(k, now);
    binaryDrawTrail(BIN.bb, th, k);
    binaryDrawTrail(BIN.cf, th, k);

    // Eclipse overlap (only when geometry truly overlaps)
    const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    const ov = dist < rA + rB ? 1 - dist / (rA + rB) : 0;

    // Depth ordering: smaller z (farther) drawn first, nearer occludes it
    const oa = { x: pb.x, y: pb.y, glow: BIN.cf.glow };
    const ob = { x: pa.x, y: pa.y, glow: BIN.bb.glow };
    let ra, rb;
    if (pa.z <= pb.z) {
      ra = binaryDrawBody(pa, BIN.bb, oa, now, ov);
      rb = binaryDrawBody(pb, BIN.cf, ob, now, 0);
    } else {
      rb = binaryDrawBody(pb, BIN.cf, ob, now, ov);
      ra = binaryDrawBody(pa, BIN.bb, oa, now, 0);
    }

    if (envOn) binaryEnvDraw(true);

    // Labels
    ctx.textAlign = "center";
    ctx.font = `300 ${BIN.bb.fs}px 'Inter', sans-serif`;
    ctx.fillStyle = BIN.bb.label;
    ctx.fillText(BIN.bb.text, pa.x, pa.y + ra + 13);
    ctx.font = `300 ${BIN.cf.fs}px 'Inter', sans-serif`;
    ctx.fillStyle = BIN.cf.label;
    ctx.fillText(BIN.cf.text, pb.x, pb.y + rb + 12);
  } catch (e) {
    pxSet(5);
    binaryDrawFallback();
  }
}

// ═════════════════════════════════════════════════════════════
//  ORDINARY MEMORY STARS — soft light renderer
//  Ambience over brightness. Each light layer (core, bloom + outer
//  glow, aura ring, radiant cloud) is rendered ONCE per colour into a
//  small offscreen sprite using many-stop, gaussian-eased gradients
//  with a little dither (no banding, no visible edge). Per frame a star
//  is only a few drawImage() calls — no gradient creation, no blur
//  filters, no per-frame geometry. Celestial and nebula stars keep the
//  previous renderer (drawMemoryStarLegacy) for now.
// ═════════════════════════════════════════════════════════════
const SOFT_SPRITES = new Map();
const SOFT_RADIANT_VARIANTS = 4;

function _rgbParse(s) { return s.split(",").map(Number); }
function _rgbMix(a, b, t) {
  const A = _rgbParse(a), B = _rgbParse(b);
  return `${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)}`;
}
function _smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
// 1 up to ~55% of the radius, then eases to exactly 0 at the rim: no visible circular edge
function _softWindow(r) { return 1 - _smooth(0.55, 1, r); }

function _softCanvas(n) {
  const c = document.createElement("canvas");
  c.width = c.height = n;
  return c;
}
// ±1.5/255 alpha jitter, once per sprite, to break up 8-bit banding in very faint gradients
function _softDither(c) {
  try {
    const x = c.getContext("2d");
    const img = x.getImageData(0, 0, c.width, c.height);
    const p = img.data;
    for (let i = 3; i < p.length; i += 4) {
      if (p[i] > 0) {
        const v = p[i] + (Math.random() - 0.5) * 3;
        p[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    x.putImageData(img, 0, 0);
  } catch (e) { /* dither is optional */ }
}
// Radial gradient from a function r(0..1) -> [rgbString, alpha]
function _softGradient(x, cx, cy, rad, fn) {
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
  const STEPS = 40;
  for (let i = 0; i <= STEPS; i++) {
    const r = i / STEPS, v = fn(r);
    g.addColorStop(r, `rgba(${v[0]},${Math.min(1, Math.max(0, v[1])).toFixed(4)})`);
  }
  return g;
}
function _softRng(seed) {                 // tiny deterministic PRNG so sprites look the same every session
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _buildSoftSprite(kind, color, variant) {
  const [coreRGB0, glowRGB0] = starColorPalette(color);
  const _pm = kind === "ring" ? 0.10 : kind === "radiant" || kind === "rays" ? 0.08 : 0;   // slight softening only; colours stay true
  const coreRGB = _pm ? _rgbMix(coreRGB0, "240,232,222", _pm) : coreRGB0, glowRGB = _pm ? _rgbMix(glowRGB0, "240,232,222", _pm) : glowRGB0;
    const bloomRGB = _rgbMix(glowRGB, coreRGB, 0.45);   // slightly lighter, softer than the outer glow

  // ── private light-building tools (local to this builder, nothing global added) ──
  const rnd = _softRng(variant * 7919 + color.length * 104729 + color.charCodeAt(0) * 31 + kind.length * 977);
  const cG = _rgbParse(glowRGB), cB = _rgbParse(bloomRGB), cC = _rgbParse(coreRGB);
  // closed angular curve, 360 samples: a few sines with random phases (higher harmonics weaker)
  const wave = (ks, amp) => {
    const T = new Float32Array(360), ph = ks.map(() => rnd() * 6.283185);
    for (let i = 0; i < 360; i++) {
      let s = 0;
      for (let j = 0; j < ks.length; j++) s += Math.sin(ks[j] * i * 0.0174533 + ph[j]) * (amp / (1 + j * 0.45));
      T[i] = s;
    }
    return T;
  };
  // sample a 360-table at f = fraction of a full turn (0..1), linearly interpolated
  const at = (T, f) => { const s = f * 360, i = s | 0, w = s - i; return T[i % 360] * (1 - w) + T[(i + 1) % 360] * w; };
  // angle of (dx,dy) as a fraction of a full turn (0..1)
  const turn = (dx, dy) => { const f = Math.atan2(dy, dx) / 6.283185; return f < 0 ? f + 1 : f; };
  // smooth value noise on an n x n lattice; sample with u,v in 0..1
  const lattice = (n) => {
    const g = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return (u, v) => {
      const fu = u * n, fv = v * n;
      const i = Math.min(n - 1, fu | 0), j = Math.min(n - 1, fv | 0);
      const a = fu - i, b = fv - j, sa = a * a * (3 - 2 * a), sb = b * b * (3 - 2 * b), k = j * (n + 1) + i;
      return (g[k] * (1 - sa) + g[k + 1] * sa) * (1 - sb) + (g[k + n + 1] * (1 - sa) + g[k + n + 2] * sa) * sb;
    };
  };
  // write one pixel: q = glow->bloom blend, k = push toward the core tint, a = alpha 0..1
  const put = (p, i, q, k, a) => {
    q = q < 0 ? 0 : q > 1 ? 1 : q; k = k < 0 ? 0 : k > 1 ? 1 : k;
    const r0 = cG[0] + (cB[0] - cG[0]) * q, g0 = cG[1] + (cB[1] - cG[1]) * q, b0 = cG[2] + (cB[2] - cG[2]) * q;
    p[i] = r0 + (cC[0] - r0) * k; p[i + 1] = g0 + (cC[1] - g0) * k; p[i + 2] = b0 + (cC[2] - b0) * k;
    p[i + 3] = a <= 0 ? 0 : a >= 1 ? 255 : a * 255;
  };
  // tiny additive speck of light (3-stop radial gradient)
  const dot = (cx, px, py, rad, a, rgb) => {
    const g = cx.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0,    `rgba(${rgb},${a.toFixed(3)})`);
    g.addColorStop(0.45, `rgba(${rgb},${(a * 0.32).toFixed(3)})`);
    g.addColorStop(1,    `rgba(${rgb},0)`);
    cx.fillStyle = g;
    cx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  };

  if (kind === "spike") {
    // hairline four-point diffraction glint: thin, tapering, tinted toward white
    const N = 128, H = N / 2, c = _softCanvas(N), x = c.getContext("2d");
    const rgb = _rgbMix(glowRGB, "255,255,255", 0.25), L = H - 1;
    const taper = [[0, 0], [0.18, 0.03], [0.36, 0.12], [0.5, 0.40], [0.64, 0.12], [0.82, 0.03], [1, 0]];
    x.globalCompositeOperation = "lighter";
    for (let ax = 0; ax < 2; ax++) {
      const g = ax === 0 ? x.createLinearGradient(H - L, 0, H + L, 0) : x.createLinearGradient(0, H - L, 0, H + L);
      for (const s of taper) g.addColorStop(s[0], `rgba(${rgb},${s[1]})`);
      x.fillStyle = g;
      if (ax === 0) x.fillRect(H - L, H - 0.55, L * 2, 1.1); else x.fillRect(H - 0.55, H - L, 1.1, L * 2);
    }
    const g2 = x.createRadialGradient(H, H, 0, H, H, 9);
    g2.addColorStop(0, `rgba(${rgb},0.25)`);
    g2.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g2;
    x.fillRect(H - 9, H - 9, 18, 18);
    return c;
  }

  if (kind === "star6") {
    // six-point jewel glint: three hairline lines through the centre + a wider, softer under-glow + a bloom
    const N = 256, H = N / 2, c = _softCanvas(N), x = c.getContext("2d");
    const rgb = _rgbMix(glowRGB, "255,255,255", 0.5);
    const taper = [[0, 0], [0.18, 0.05], [0.36, 0.22], [0.5, 0.85], [0.64, 0.22], [0.82, 0.05], [1, 0]];
    x.translate(H, H);
    x.globalCompositeOperation = "lighter";
    for (let k = 0; k < 3; k++) {
      for (const w of [[1.2, 1], [5, 0.16]]) {
        x.save();
        x.rotate(k * Math.PI / 3);
        const L = H - 1, g = x.createLinearGradient(-L, 0, L, 0);
        for (const s of taper) g.addColorStop(s[0], `rgba(${rgb},${(s[1] * w[1]).toFixed(3)})`);
        x.fillStyle = g;
        x.fillRect(-L, -w[0] / 2, L * 2, w[0]);
        x.restore();
      }
    }
    const g2 = x.createRadialGradient(0, 0, 0, 0, 0, 22);
    g2.addColorStop(0, `rgba(${rgb},0.5)`);
    g2.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g2;
    x.fillRect(-22, -22, 44, 44);
    return c;
  }

    if (kind === "core") {
    // living light: softer off-centre heart, gentler mottling, more blended contour
    const N = 64, H = N / 2, c = _softCanvas(N), x = c.getContext("2d");
    const img = x.createImageData(N, N), p = img.data;
    const cw = wave([2, 3, 5], 0.03);
    const m1 = rnd() * 6.283, m2 = rnd() * 6.283, hx = (rnd() - 0.5) * 0.06, hy = (rnd() - 0.5) * 0.06;
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const dx = (px + 0.5 - H) / H, dy = (py + 0.5 - H) / H;
        const rr = Math.hypot(dx, dy) / (1 + at(cw, turn(dx, dy)));
        const lum = Math.exp(-Math.pow(Math.hypot(dx - hx, dy - hy) / 0.58, 2));
        const mot = Math.sin(dx * 4.8 + m1) * Math.sin(dy * 4.2 + m2);
        put(p, (py * N + px) * 4, 0.30 + 0.10 * mot, 0.06 + 0.40 * lum + 0.03 * mot,
            0.72 * (1 - _smooth(0.10, 1, rr)) * (1 + 0.02 * mot));
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }

    const N = kind === "ambient" ? 128 : kind === "ring" || kind === "radiant" ? 192 : 160, H = N / 2, c = _softCanvas(N), x = c.getContext("2d");

  if (kind === "ambient") {
    // softer, wider ambient: tighter bright heart + longer gentle falloff + faint outer veil
    // reach and tint still wander slightly with angle (no perfect disc)
    const img = x.createImageData(N, N), p = img.data;
    const aw = wave([2, 3, 5], 0.035), tw = wave([1, 3, 4], 0.15);
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const dx = (px + 0.5 - H) / H, dy = (py + 0.5 - H) / H;
        const r = Math.hypot(dx, dy), f = turn(dx, dy);
        const rr = r / (1 + at(aw, f)), t = at(tw, f);
        const a1 = 0.20 * Math.exp(-Math.pow(rr / 0.17, 2));
        const a2 = 0.15 * Math.exp(-Math.pow(rr / 0.50, 2)) * (1 + 0.10 * t);
        const a3 = 0.06 * Math.exp(-Math.pow(rr / 0.88, 2));
        const s = a1 + a2 + a3 + 1e-9;
        put(p, (py * N + px) * 4, a1 / s + 0.04 * t, 0.06 * a1 / s, s * _softWindow(r));
      }
    }
    x.putImageData(img, 0, 0);
  } else if (kind === "ring") {
    // a soft, even glow radius, like the lit air around a firefly: perfectly round, no edge, no peak ring,
    // no cloud. Three gaussian shoulders blend into one smooth falloff.
    const img = x.createImageData(N, N), p = img.data;
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const dx = (px + 0.5 - H) / H, dy = (py + 0.5 - H) / H, r = Math.hypot(dx, dy);
        const a = 0.085 * Math.exp(-Math.pow(r / 0.28, 2)) + 0.07 * Math.exp(-Math.pow(r / 0.52, 2)) + 0.03 * Math.exp(-Math.pow(r / 0.86, 2));
        put(p, (py * N + px) * 4, 0.3, 0, a * _softWindow(r));
      }
    }
    x.putImageData(img, 0, 0);
  } else if (kind === "radiant") {
    // realistic scattered starlight: a white-hot heart with an inverse-power halo (tight and bright, long soft tail),
    // a faint uneven veil of lit air, tinted outward. No disc, no rim. The streaks are a separate sprite ("rays").
    const lobes = wave([2, 3, 5], 0.30), nA = lattice(4), nB = lattice(7);
    const img = x.createImageData(N, N), p = img.data;
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const dx = (px + 0.5 - H) / H, dy = (py + 0.5 - H) / H;
        const r = Math.hypot(dx, dy), f = turn(dx, dy);
        const u = (px + 0.5) / N, v = (py + 0.5) / N;
        const ang = 1 + at(lobes, f) * _smooth(0.05, 0.4, r);
        const mot = 0.75 + 0.5 * nA(u, v) + 0.25 * (nB(v, u) - 0.5);
        const psf = 1 / Math.pow(1 + Math.pow(r / 0.055, 2), 1.05);
        const veil = 0.07 * Math.exp(-Math.pow(r / 0.34, 2)) * ang * mot;
        const a = (0.34 * psf * (0.9 + 0.1 * ang) + veil) * _softWindow(r);
        put(p, (py * N + px) * 4, 0.35 + 0.3 * _smooth(0.1, 0.5, r), 0.45 * (1 - _smooth(0, 0.22, r)), a);
      }
    }
    x.putImageData(img, 0, 0);
  } else if (kind === "rays") {
    // fine diffraction streaks (each runs both ways through the centre); drawn twice, counter-rotating, twinkling
    const rays = [];
    for (let n = 0; n < 13; n++) rays.push({ f: rnd(), th: 0.006 + 0.006 * rnd(), L: 0.45 + 0.5 * rnd(), b: 0.35 + 0.65 * rnd() });
    const img = x.createImageData(N, N), p = img.data;
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const dx = (px + 0.5 - H) / H, dy = (py + 0.5 - H) / H;
        const r = Math.hypot(dx, dy), i = (py * N + px) * 4;
        if (r >= 1 || r < 0.02) { p[i + 3] = 0; continue; }
        const f = turn(dx, dy), f2 = f < 0.5 ? f + 0.5 : f - 0.5;
        let s = 0;
        for (let n = 0; n < rays.length; n++) {
          const q = rays[n];
          let da = Math.abs(f - q.f); if (da > 0.5) da = 1 - da;
          let db = Math.abs(f2 - q.f); if (db > 0.5) db = 1 - db;
          da = da < db ? da : db;
          if (da > 0.12 || r >= q.L) continue;
          const pd = Math.sin(da * 6.283185) * r;
          s += q.b * Math.exp(-Math.pow(pd / q.th, 2)) * Math.pow(1 - r / q.L, 1.6) / (1 + r * 5);
        }
        put(p, i, 0.5, 0.20 * (1 - _smooth(0, 0.5, r)), 0.24 * s * _softWindow(r) * _smooth(0.02, 0.1, r));
      }
    }
    x.putImageData(img, 0, 0);
  }
  _softDither(c);
  return c;
}

let _heartSprite = null;
function getHeartSprite() {
  if (!_heartSprite) {
    const N = 32, H = N / 2, c = _softCanvas(N), x = c.getContext("2d");
    const g = x.createRadialGradient(H, H, 0, H, H, H);
    g.addColorStop(0,    "rgba(255,255,255,1)");
    g.addColorStop(0.30, "rgba(255,255,255,0.48)");
    g.addColorStop(0.65, "rgba(255,255,255,0.10)");
    g.addColorStop(1,    "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, N, N);
    _heartSprite = c;
  }
  return _heartSprite;
}

let _warmQueue = null, _warmIdx = 0;
function pumpSpriteWarm(budgetMs) {
  if (_warmQueue && _warmIdx >= _warmQueue.length) return;
  if (!_warmQueue) {
    const colors = ["white", "blue", "lavender", "rose", "amber"], q = [];
    for (const c of colors) q.push(["ambient", c, 0], ["core", c, 0], ["spike", c, 0]);
    for (let v = 0; v < SOFT_RADIANT_VARIANTS; v++) {
      for (const c of colors) { q.push(["radiant", c, v], ["rays", c, v]); if (v === 0) q.push(["ring", c, 0]); }
    }
    _warmQueue = q;
  }
  const t0 = performance.now();
  while (_warmIdx < _warmQueue.length && performance.now() - t0 < budgetMs) {
    const k = _warmQueue[_warmIdx++];
    try { getSoftSprite(k[0], k[1], k[2]); } catch (e) { /* built on demand instead */ }
  }
}

function getSoftSprite(kind, color, variant) {
  const key = kind + "|" + color + "|" + (variant || 0);
  let s = SOFT_SPRITES.get(key);
  if (!s) { s = _buildSoftSprite(kind, color, variant || 0); SOFT_SPRITES.set(key, s); }
  return s;
}

function drawMemoryStar(star, ts) {
  // Celestial + birthday-nebula stars: their own richer soft-light renderer
  if (star.isCelestial === true || star.birthdayNebula === true) {
    try {
      drawSpecialMemoryStar(star, ts);
    } catch (e) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      drawMemoryStarLegacy(star, ts);
    }
    return;
  }
  try {
    drawSoftMemoryStar(star, ts);
  } catch (e) {
    ctx.globalAlpha = 1;
    drawMemoryStarLegacy(star, ts);
  }
}

function drawSoftMemoryStar(star, ts, opt) {
  const t     = ts * 0.001;
  const phase = hashPhase(star.id);
  // slower, shallower breathing — pure ambience, almost still
  const br    = 0.88 + 0.075 * Math.sin(t * (0.55 + phase * 0.35) + phase * 6.28)
                      + 0.035 * Math.sin(t * (1.1 + phase * 0.7) + phase * 41);

  const size = star.size || "standard";
  // tiny: 0.55 -> 0.75 so the smallest memory stars read ~35% larger than background stars
  const sizeScale = (opt && opt.scale) || (size === "tiny" ? 0.7 : size === "big" ? 2.0 : 1.0);
  const glowScale = Math.pow(sizeScale, 0.88);   // glow grows a little more with size for softer presence

  const ageDays = (Date.now() - (star.timestamp || 0)) / 86400000;
  const ageBrightness = Math.min(0.32, Math.log1p(ageDays) * 0.075);   // slightly warmer age glow

  const color = star.color || "white";
  const aura  = star.aura || "none";
  const x = star.x, y = star.y;

  // 1 · Ambient light: wider, softer bloom + diffuse glow (the main source of ambience)
  const R = (30 + ageBrightness * 34) * glowScale;
  ctx.globalAlpha = Math.min(1, (0.70 + ageBrightness * 0.55) * br);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(phase * Math.PI * 2 + 0.9);
  ctx.drawImage(getSoftSprite("ambient", color), -R, -R, R * 2, R * 2);
  ctx.restore();

  // 1b · Wide, faint second bloom of the same colour: gives each star a deeper pool of light around it
  ctx.globalCompositeOperation = "lighter";
  const Rb = R * 1.6;
  ctx.globalAlpha = Math.min(1, (0.09 + ageBrightness * 0.10) * br);
  ctx.drawImage(getSoftSprite("ambient", color), x - Rb, y - Rb, Rb * 2, Rb * 2);
  ctx.globalCompositeOperation = "source-over";

  // 2 · Radiant aura: realistic scattered starlight — a luminous veil plus fine streaks that scintillate
  if (aura === "radiant") {
    const Rr = (56 + ageBrightness * 18) * glowScale;
    const variant = Math.floor(phase * 997) % SOFT_RADIANT_VARIANTS;
    const veilB = 0.88 + 0.12 * Math.sin(t * (0.38 + phase * 0.35) + phase * 9.1);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.min(1, 0.62 * veilB);
    ctx.drawImage(getSoftSprite("radiant", color, variant), x - Rr, y - Rr, Rr * 2, Rr * 2);
    const Rs = Rr * 1.18;
    const scint = (0.80 + 0.20 * (0.5 + 0.5 * Math.sin(t * (0.28 + phase * 0.18) + phase * 17))) * (0.95 + 0.05 * Math.sin(t * (0.9 + phase * 0.5) + phase * 31));
    ctx.globalAlpha = Math.min(1, 0.45 * scint);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(phase * 6.283);
    ctx.drawImage(getSoftSprite("rays", color, variant), -Rs, -Rs, Rs * 2, Rs * 2);
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }

  // 3 · Halo aura: a soft glow radius that slowly swells and settles, two layers breathing out of step (firefly-like)
  if (aura === "halo") {
    const haloR = (21 + ageBrightness * 11) * Math.pow(sizeScale, 0.9);
    const half  = haloR / 0.30;
    const base  = Math.min(1, 0.85 + startupPulse * 0.14);
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < 2; k++) {
      const v  = 0.5 + 0.5 * Math.sin(t * (0.34 + 0.09 * k + phase * 0.06) + phase * 23 + k * 2.4);
      const tw = 0.55 + 0.45 * v * v * (3 - 2 * v);
      const sc = (k ? 1.4 : 1) * (0.94 + 0.10 * v);
      ctx.globalAlpha = Math.min(1, base * tw * (k ? 0.6 : 1));
      ctx.drawImage(getSoftSprite("ring", color, 0), x - half * sc, y - half * sc, half * 2 * sc, half * 2 * sc);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // 4 · Core: smaller, softer, more integrated with the glow (less "dot")
  const coreR = 1.95 * sizeScale;
  const coreHalf = coreR * 1.95;
  ctx.globalAlpha = Math.min(1, (0.64 + ageBrightness * 0.25) * (0.9 + 0.1 * br));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(phase * Math.PI * 2 + 2.6);
  ctx.drawImage(getSoftSprite("core", color), -coreHalf, -coreHalf, coreHalf * 2, coreHalf * 2);
  ctx.restore();

  // 4b · White-hot heart: a tiny additive point so the centre reads as light, not as a tinted dot
  const heartHalf = coreHalf * 0.9;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = Math.min(1, (0.20 + ageBrightness * 0.12) * br);
  ctx.drawImage(getHeartSprite(), x - heartHalf, y - heartHalf, heartHalf * 2, heartHalf * 2);
  ctx.globalCompositeOperation = "source-over";

  // 5 · Diffraction glint: quieter hairline four-point cross, with a faint independent shimmer
  const shim = 0.90 + 0.10 * Math.sin(t * (0.9 + phase * 0.8) + phase * 53);
  const spikeHalf = (8 + ageBrightness * 6) * Math.pow(sizeScale, 0.88) * (0.96 + 0.04 * shim);
  ctx.globalAlpha = Math.min(1, (0.11 + ageBrightness * 0.10) * br * shim);
  ctx.globalCompositeOperation = "lighter";
  if (!(opt && opt.noSpike)) ctx.drawImage(getSoftSprite("spike", color), x - spikeHalf, y - spikeHalf, spikeHalf * 2, spikeHalf * 2);
  ctx.globalCompositeOperation = "source-over";

  ctx.globalAlpha = 1;
}

// Previous renderer — still used for celestial + birthday-nebula stars
function drawMemoryStarLegacy(star, ts) {
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
  try {
    const aR = (30 + ageBrightness * 34) * Math.pow(sizeScale, 0.85);
    ctx.globalAlpha = Math.min(1, (0.85 + ageBrightness * 0.8) * (0.8 + 0.2 * twinkle));
    ctx.drawImage(getSoftSprite("ambient", star.color || "white"), star.x - aR, star.y - aR, aR * 2, aR * 2);
  } catch (e) { /* glow is optional */ }
  ctx.globalAlpha = 1;

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

// ─────────────────────────────────────────────
//  SPECIAL MEMORY STARS — same soft-light language as ordinary stars, but unmistakably "foreground":
//  · Celestial star : a jewel — large luminous heart, slowly turning six-point glint, a pair of wide rings that
//                     fade in and out, and a few sparks orbiting it.
//  · Nebula star    : a compact, warm rose/gold/magenta bloom around the star (swirled, ragged, with a bright
//                     heart and drifting sparks) — small and radiant, unlike the vast cool bands of the sky.
//  Everything is a cached sprite: per frame it is only a handful of drawImage() calls.
// ─────────────────────────────────────────────
const nebulaMoteState = new Map();
const NEB_MOTE_RGB = [[236, 176, 176], [202, 130, 136], [210, 186, 192], [238, 214, 176]];
let _nebMoteSpr = null;
const NEBSTAR_SPRITES = [];

function _nebMotes(id) {
  let m = nebulaMoteState.get(id);
  if (!m) {
    const rnd = _softRng(Math.floor(hashPhase(id) * 1e6) + 11);
    m = Array.from({ length: 9 }, () => ({
      a0: rnd() * 6.283, rf: 0.25 + rnd() * 0.95, sp: (0.02 + rnd() * 0.05) * (rnd() < 0.5 ? -1 : 1),
      w: rnd() * 6.283, tf: 0.4 + rnd() * 1.2, ci: (rnd() * 4) | 0, sz: 1.6 + rnd() * 1.6
    }));
    nebulaMoteState.set(id, m);
  }
  return m;
}

// compact swirled cloud: ragged outline, spiral filaments, small dust lanes, gold heart → rose → magenta → lavender rim
function _buildNebStarSprite(variant) {
  const N = 128, H = N / 2, c = _softCanvas(N), x = c.getContext("2d");
  const img = x.createImageData(N, N), p = img.data, seed = 301 + variant * 57, ph1 = variant * 1.7;
  const ramp = [[0, 240, 210, 168], [0.35, 232, 164, 164], [0.70, 190, 116, 130], [1, 176, 164, 178]];
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const dx = (px + 0.5 - H) / H, dy = (py + 0.5 - H) / H, r = Math.hypot(dx, dy), i = (py * N + px) * 4;
      if (r >= 1) { p[i + 3] = 0; continue; }
      const a = Math.atan2(dy, dx);
      const sw = (1 - r) * 0.9, ca = Math.cos(sw), sa = Math.sin(sw);
      const sx = dx * ca - dy * sa, sy = dx * sa + dy * ca;                       // swirl
      const lobe = 1 + 0.22 * Math.sin(3 * a + ph1) + 0.14 * Math.sin(5 * a + 2 * ph1 + 1) + 0.08 * Math.sin(7 * a + 3 * ph1);
      const rr = r / (0.62 * lobe);
      const dens = _nbFbm(sx * 3.0 + 2, sy * 3.0 + 5, seed, 4);
      let rid = 1 - Math.abs(2 * _nbFbm(sx * 5.5 + 1, sy * 5.5 + 9, seed + 31, 3) - 1); rid *= rid;
      const dust = _smooth(0.56, 0.70, _nbFbm(sx * 2.6 + 7, sy * 2.6 + 3, seed + 57, 3));
      const body = Math.exp(-rr * rr * 1.6) * (0.35 + 1.1 * _smooth(0.3, 0.7, dens)) * (0.55 + 0.9 * rid) * (1 - 0.7 * dust);
      const core = Math.exp(-Math.pow(r / 0.14, 2));
      const tot = body * 0.9 + core * 0.4;
      let q = rr * 0.9 + (dens - 0.5) * 0.5; q = q < 0 ? 0 : q > 1 ? 1 : q;
      let s = 0; while (s < 2 && q > ramp[s + 1][0]) s++;
      const A = ramp[s], B = ramp[s + 1], u = (q - A[0]) / (B[0] - A[0]);
      p[i] = A[1] + (B[1] - A[1]) * u; p[i + 1] = A[2] + (B[2] - A[2]) * u; p[i + 2] = A[3] + (B[3] - A[3]) * u;
      let al = (tot > 1 ? 1 : tot) * (1 - _smooth(0.7, 1, r)) * 0.85 * 255;
      if (al > 0) al += (Math.random() - 0.5) * 3;
      p[i + 3] = al;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}
function getNebStarSprite(v) {
  if (!NEBSTAR_SPRITES[v]) NEBSTAR_SPRITES[v] = _buildNebStarSprite(v);
  return NEBSTAR_SPRITES[v];
}

// Birthday-nebula bloom: two counter-rotating cloud layers (flowing gas, never a pulse) + drifting sparks
function drawBirthdayNebula(star, ts) {
  const t = ts * 0.001, id = star.id || "", ph = hashPhase(id);
  const R = NEBULA_VISUAL_RADIUS * 1.45;                      // sprite half-size (cloud reaches ~1.2 × the hit radius)
  const br = 0.88 + 0.12 * Math.sin(t * (0.18 + ph * 0.1) + ph * 9);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < 2; k++) {
    const sc = 1 + 0.03 * Math.sin(t * 0.21 + ph * 7 + k * 2);
    ctx.globalAlpha = (k ? 0.40 : 0.62) * br * (0.85 + 0.15 * Math.sin(t * 0.3 + k * 2 + ph * 5));
    ctx.save();
    ctx.translate(star.x, star.y);
    ctx.rotate((k ? -1 : 1) * t * 0.004 * (0.7 + ph) + ph * 6.283 + k * 2.1);
    ctx.drawImage(getNebStarSprite((Math.floor(ph * 17) + k) % 2), -R * sc, -R * sc, R * 2 * sc, R * 2 * sc);
    ctx.restore();
  }
  if (!_nebMoteSpr) _nebMoteSpr = NEB_MOTE_RGB.map(c => binaryEnvSprite(c));
  const R0 = NEBULA_VISUAL_RADIUS * 0.95, m = _nebMotes(id);
  for (let i = 0; i < m.length; i++) {
    const q = m[i], a = q.a0 + q.sp * t, tw = 0.5 + 0.5 * Math.sin(t * q.tf + q.w);
    const sz = q.sz * (0.8 + 0.4 * tw);
    ctx.globalAlpha = 0.10 + 0.45 * tw * tw;
    ctx.drawImage(_nebMoteSpr[q.ci], star.x + Math.cos(a) * q.rf * R0 - sz, star.y + Math.sin(a) * q.rf * R0 * 0.82 - sz, sz * 2, sz * 2);
  }
  ctx.restore();
}

// Celestial star: a natural bright star — power-law glow, fixed hairline diffraction spikes (same orientation as
// every other star's optics), a faint scattered veil. No ornaments, no rotation; only a barely-there scintillation.
function drawCelestialOrnaments(star, ts, sc) {
  const t = ts * 0.001, ph = hashPhase(star.id), color = star.color || "white", x = star.x, y = star.y;
  const sci = 0.94 + 0.06 * Math.sin(t * (0.9 + ph * 0.5) + ph * 40);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const Rg = 22 * sc;
  ctx.globalAlpha = 0.55 * sci;
  ctx.drawImage(getSoftSprite("radiant", color, 0), x - Rg, y - Rg, Rg * 2, Rg * 2);
  const spk = binarySpikeSprite(starColorPalette(color)[1]);
  if (spk) {
    const SL = 26 * sc;
    ctx.globalAlpha = 0.14 * sci;
    ctx.drawImage(spk, x - SL, y - SL, SL * 2, SL * 2);
  }
  ctx.restore();
}

function drawSpecialMemoryStar(star, ts) {
  const cel = star.isCelestial === true, neb = star.birthdayNebula === true;
  ctx.save();
  if (neb) drawBirthdayNebula(star, ts);
  const size = star.size || "standard";
  const base = size === "tiny" ? 0.7 : size === "big" ? 2.0 : 1.0;
  const sc = cel ? 1.9 : Math.max(1.4, base);
  if (cel) drawCelestialOrnaments(star, ts, sc);
  drawSoftMemoryStar(star, ts, { scale: sc, noSpike: cel });
  ctx.restore();
  ctx.globalAlpha = 1;
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

    const fx = from.x + pxWx(from), fy = from.y + pxWy(from);
  const tx = to.x + pxWx(to),     ty = to.y + pxWy(to);
  const x = fx + (tx - fx) * eased;
  const y = fy + (ty - fy) * eased;

  // ── draw the wandering light itself ──
  let opacity = 1;
  if (starlight.fadingOut) {
    const fadeElapsed = ts - starlight.fadeStartTs;
    opacity = Math.max(0, 1 - fadeElapsed / 900);
  }

  if (opacity > 0) {
    const shimmer = 0.75 + 0.25 * Math.sin(ts * 0.0035);
    const glowR = 11 * shimmer;
    const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    g.addColorStop(0, `rgba(225,220,255,${0.42 * opacity * shimmer})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 1.25 * shimmer, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(240,235,255,${0.78 * opacity})`;
    ctx.fill();
  }

  // ── arrival blessing pulse (drawn independently of the light's own fade) ──
  if (starlight.pulseStarId) {
    const pulseElapsed = ts - starlight.pulseStartTs;
    if (pulseElapsed < 1500) {
      const pulseStar = route.find(s => s.id === starlight.pulseStarId);
            if (pulseStar) {
                        pxSet(pxLayerOf(pulseStar));
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
const _phaseMemo = new Map();
function hashPhase(id) {
  if (!id) return 0.5;
  let v = _phaseMemo.get(id);
  if (v === undefined) {
    let h = 0;
    for (let i = 0; i < id.length; i++) {
      h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
    }
    v = (h >>> 0) / 0xffffffff;
    if (_phaseMemo.size > 4000) _phaseMemo.clear();
    _phaseMemo.set(id, v);
  }
  return v;
}

// ─── V2: star color palette ───
// Returns [coreRGB, glowRGB] as strings, soft and unsaturated
function starColorPalette(color) {
  switch (color) {
    case "blue":     return ["194,206,228", "124,148,190"];
    case "lavender": return ["206,120,118", "152,46,56"];     // dark red
    case "rose":     return ["232,200,200", "190,138,142"];
    case "amber":    return ["248,228,188", "218,178,114"];
    default:         return ["244,238,226", "214,198,172"]; // soft warm white
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
    ccPinched = false;

    startLongPress(t.clientX, t.clientY);
  }

  if (e.touches.length === 2) {
    cancelLongPress();
        isPinching = true;
    ccPinched = true;
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
          handleLinkingTap(world);
          longPressTriggered = false;
          return;
        }

        const hit = findStarAtWorld(world.x, world.y);
                if (hit) openMemoryModal(hit);
        else if (!ccPinched && hitControlCentre(world.x, world.y)) openControlCentre();
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
    handleLinkingTap(world);
    return;
  }

  const hit = findStarAtWorld(world.x, world.y);
    if (hit) openMemoryModal(hit);
  else if (hitControlCentre(world.x, world.y)) openControlCentre();
}

// ─── Control Centre: invisible activation at the shared centre of Big Bang × Confession ───
function hitControlCentre(wx, wy) {
  try {
    const k  = binaryCentre();
    const a  = binaryVisualPos(k.b);
    const b  = binaryVisualPos(k.c);
    const ox = pxOX[5], oy = pxOY[5];            // same layer offset the binary is drawn with
    const mx = k.cx + ox, my = k.cy + oy;        // animated shared centre (orbit centre)
    const hrA = Math.max(22 / cam.zoom, a.r ? a.r * 1.2 : 0);   // same radii as findStarAtWorld()
    const hrB = Math.max(16 / cam.zoom, b.r ? b.r * 1.2 : 0);
    const r = Math.min(
      30 / cam.zoom,
      Math.hypot(mx - (a.x + ox), my - (a.y + oy)) - hrA,
      Math.hypot(mx - (b.x + ox), my - (b.y + oy)) - hrB
    );
    return r > 0 && distWorld(wx, wy, mx, my) < r;
  } catch (e) {
    return false;
  }
}

function openControlCentre() {
  const el = document.getElementById("control-centre");
  if (!el || !window.ChrysanthemumControlCentre) return;
  cancelLongPress();
  isDragging = false;
  isPinching = false;
  el.style.display = "block";
  el.setAttribute("aria-hidden", "false");
    if (!controlCentre) controlCentre = ChrysanthemumControlCentre.mount(el, { onExit: closeControlCentre });
  else controlCentre.resize();
}

function closeControlCentre() {
  const el = document.getElementById("control-centre");
  if (!el) return;
  el.style.display = "none";
  el.setAttribute("aria-hidden", "true");
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

  // A star is still being resolved (or kept its text after a failure): reopen THAT one, never start another.
  if (currentAttempt && currentAttempt.state !== "saved") { openCreationModal(); return; }

  // Check for overlap
  if (isOccupied(wx, wy)) {
    showToast();
    return;
  }

    pendingCreatePos = { x: wx, y: wy, dx: binaryReduceMotion ? 0 : pxDX, dy: binaryReduceMotion ? 0 : pxDY };
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
  let best = null, bestL = -1;   // nearest layer wins when stars overlap

  for (let i = stars.length - 1; i >= 0; i--) {
    const s = stars[i];
    const hitR = s.type === "bigbang"    ? 22 / cam.zoom :
                 s.type === "confession" ? 16 / cam.zoom :
                 s.birthdayNebula === true ? NEBULA_VISUAL_RADIUS / cam.zoom :
                 tapRadiusWorld;
    const isBin = s.type === "bigbang" || s.type === "confession";
        const hp = isBin ? binaryVisualPos(s) : s;
    const hr = isBin && hp.r ? Math.max(hitR, hp.r * 1.2) : hitR;
        if (distWorld(wx, wy, hp.x + pxWx(s), hp.y + pxWy(s)) < hr) {
      const pl = pxLayerOf(s);
      if (pl > bestL) { best = s; bestL = pl; }
    }
  }
  return best;
}

function isOccupied(wx, wy, ignoreId) {
  for (const s of stars) {
    if (ignoreId && s.id === ignoreId) continue;   // a star being retried must not collide with itself
        if (distWorld(wx, wy, s.x + pxWx(s), s.y + pxWy(s)) < MIN_STAR_RADIUS) return true;
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

  updateBinaryButton(star);

  if (window.ChrMedia) ChrMedia.renderInto(document.getElementById("modal-media"), star.media);   // no-op for special stars (no media)

  document.getElementById("memory-modal").classList.remove("hidden");
}

// V2: binary link button — only for memory stars; reflects the star's CURRENT link state.
function updateBinaryButton(star) {
  const binaryBtn = document.getElementById("binary-link-btn");
  if (!binaryBtn) return;
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

// The listener rebuilds `stars` on every change; keep the open modal pointing at the fresh copy.
function refreshOpenModalStar() {
  if (!openModalStar || openModalStar.type !== "memory") return;
  const fresh = stars.find((s) => s.id === openModalStar.id);
  if (fresh) { openModalStar = fresh; updateBinaryButton(fresh); }
}

function closeMemoryModal(fromLinking) {
  document.getElementById("memory-modal").classList.add("hidden");
  if (window.ChrMedia) ChrMedia.clearView(document.getElementById("modal-media"));   // revoke blob: URLs
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
  // An earlier star is still being resolved (or failed and kept its text): reopen THAT attempt untouched,
  // so text, attachments and the star's fixed id are never wiped while the star could still reach the server.
  if (currentAttempt && currentAttempt.state !== "saved") {
    document.getElementById("creation-modal").classList.remove("hidden");
    applyAttemptUi(currentAttempt, false);
    return;
  }
  currentAttempt = null;
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

  setFormLocked(false);
  if (window.ChrMedia) ChrMedia.resetCreationUi();
  refreshPlantButton();
  document.getElementById("creation-modal").classList.remove("hidden");
  setTimeout(() => document.getElementById("input-memory").focus(), 400);
}

function closeCreationModal() {
  if (creationLock) return;   // a submit is in flight: closing now would wipe its data
  const modal = document.getElementById("creation-modal");
  if (modal.classList.contains("hidden")) return;   // already closed: never wipe a kept attempt (e.g. on Escape)
  // A star that may still reach the server keeps its text, attachments and id: closing only hides the window.
  if (attemptUnresolved(currentAttempt)) { modal.classList.add("hidden"); return; }
  finishCreation();
}

// Ends the current creation for good (saved, or the user chose to close after a confirmed failure).
function finishCreation() {
  currentAttempt = null;
  setFormLocked(false);
  document.getElementById("creation-modal").classList.add("hidden");
  if (window.ChrMedia) ChrMedia.resetCreationUi();
  pendingCreatePos = null;
  refreshPlantButton();
}

// ─────────────────────────────────────────────
//  STAR CREATION — one logical attempt = one fixed Firestore document id
//
//  An attempt is created the first time a star is sent and keeps the same id, data and media references
//  for every later try, so re-sending or re-checking it can never produce a second star:
//    "writing"  the request is in flight (at most STAR_WRITE_TIMEOUT_MS)
//    "pending"  sent, but the server has not answered: it MAY still be committed later
//    "unknown"  the write ended with a connection-type error: the server may or may not have it
//    "failed"   the server refused it: confirmed, nothing was created
//    "saved"    the server confirmed it
//  Only "saved" and "failed" are certainties. A "document not found on the server" read proves nothing
//  about a write that is still queued, so it is never treated as a failure.
//  NOTE: Firestore's write queue lives in this page's memory only (persistence is not enabled): a reload
//  or closed page loses an unconfirmed star, and the UI says so instead of promising recovery.
// ─────────────────────────────────────────────
const FIRESTORE_MODULE_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const STAR_WRITE_TIMEOUT_MS   = 8000;
const SERVER_CHECK_TIMEOUT_MS = 10000;
const LINK_TIMEOUT_MS         = 20000;
const STAR_LIMITS = { memory: 50000, title: 60, creator: 40, coord: 1000000 };   // keep equal to firestore.rules
let currentAttempt = null;

// Same module URL as index.html, so this is the same Firestore instance. window.__chrFirestore is a test seam only.
function loadFirestore() {
  return window.__chrFirestore ? Promise.resolve(window.__chrFirestore) : import(FIRESTORE_MODULE_URL);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "deadline-exceeded" })), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function attemptUnresolved(a) {
  return !!a && (a.state === "writing" || a.state === "pending" || a.state === "unknown");
}

const FORM_FIELD_IDS = ["input-memory", "input-title", "input-creator", "input-size", "input-color",
                        "input-aura", "input-celestial", "input-birthday-nebula"];
function setFormLocked(on) {
  FORM_FIELD_IDS.forEach((id) => { const el = document.getElementById(id); if (el) el.disabled = !!on; });
}

function plantButtonLabel() {
  return currentAttempt && (currentAttempt.state === "pending" || currentAttempt.state === "unknown")
    ? "check again" : "plant this star";
}
function refreshPlantButton() {
  const text = document.getElementById("create-btn-text");
  if (text) text.textContent = plantButtonLabel();
}

// Mirrors firestore.rules so a star that would be refused is caught BEFORE any media is uploaded.
function validateStarInput(f) {
  if (!f.memory) return "a memory is required to birth a star.";
  if (f.memory.length > STAR_LIMITS.memory) return "that memory is too long (50000 characters max).";
  if (f.title.length > STAR_LIMITS.title) return "that title is too long (60 characters max).";
  if (f.creator.length > STAR_LIMITS.creator) return "that name is too long (40 characters max).";
  if (!Number.isFinite(f.x) || !Number.isFinite(f.y) ||
      Math.abs(f.x) > STAR_LIMITS.coord || Math.abs(f.y) > STAR_LIMITS.coord) return "position lost — please try again.";
  return null;
}

const MSG_PENDING = "not confirmed yet. your star is waiting to be sent from this page and is not stored anywhere else: " +
  "if you reload or close this page first, it can be lost. please don't plant it again. tap \"check again\" to look for it.";
const MSG_UNKNOWN = "the connection broke before the star was confirmed, so it may or may not have reached the sky. " +
  "your text and attachments are kept here. tap \"check again\": it checks this same star first and only re-sends this same star, so it can't be duplicated.";

function describeWriteError(err) {
  const c = err && err.code ? String(err.code) : "";
  return c === "permission-denied"
    ? "the server refused it (your session may have ended). your text is still here: copy it somewhere safe before reloading"
    : "the server refused it" + (c ? " (" + c + ")" : "");
}

function showPlantNotice(msg, persist) {
  let el = document.getElementById("plant-notice");
  if (!el) {
    el = document.createElement("div");
    el.id = "plant-notice";
    el.setAttribute("role", "status");
    el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:min(92vw,420px);" +
      "padding:12px 16px;border-radius:12px;background:rgba(16,18,40,0.96);color:#e8e8f4;font-size:14px;" +
      "line-height:1.4;text-align:center;z-index:100000;box-shadow:0 4px 24px rgba(0,0,0,0.5);cursor:pointer;";
    el.addEventListener("click", () => el.remove());
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(showPlantNotice._t);
  if (!persist) showPlantNotice._t = setTimeout(() => { if (el.parentNode) el.remove(); }, 6000);
}

function isAmbiguousWriteError(err) {
  const c = err && err.code;
  return c === "unavailable" || c === "deadline-exceeded" || c === "cancelled" || c === "aborted" || c === "unknown";
}

// Brings the modal, the form lock and the button in line with the attempt's state. `late` = the change
// arrived after the user had already been given an answer (so a toast is also shown).
function applyAttemptUi(a, late, note) {
  if (a.state !== "saved" && currentAttempt !== a) return;     // an attempt that is no longer current
  const errEl = document.getElementById("creation-error");
  if (a.state === "saved") {
    if (late) showPlantNotice("your star reached the sky and is saved.", false);
    finishCreation();
    if (errEl) errEl.textContent = "";
    return;
  }
  if (a.state === "pending" || a.state === "unknown") {
    setFormLocked(true);
    if (window.ChrMedia && ChrMedia.setBusy) ChrMedia.setBusy(true);
    if (errEl) errEl.textContent = (note ? note + " " : "") + (a.state === "pending" ? MSG_PENDING : MSG_UNKNOWN);
    if (late) showPlantNotice("your star isn't confirmed yet. please don't plant it again.", false);
    refreshPlantButton();
    return;
  }
  if (a.state === "failed") {
    setFormLocked(false);
    if (window.ChrMedia && ChrMedia.setBusy) ChrMedia.setBusy(false);
    if (errEl) errEl.textContent = "the star wasn't saved: " + describeWriteError(a.error) +
      ". nothing was created. your text and attachments are kept; tap plant to try again.";
    if (late) showPlantNotice("the star wasn't saved. nothing was created. open the planting window to try again.", false);
    refreshPlantButton();
  }
}

// Asks the SERVER whether this attempt's document exists: true / false / null (couldn't reach the server).
async function serverHas(attempt, fs) {
  try {
    const snap = await withTimeout(fs.getDocFromServer(attempt.ref), SERVER_CHECK_TIMEOUT_MS);
    return snap.exists();
  } catch (_) {
    return null;
  }
}

// Sends the attempt's document (same id, same data) and settles attempt.state. Resolves once the user can be
// given an answer: confirmed, refused, errored, or (after STAR_WRITE_TIMEOUT_MS) still pending.
function runAttemptWrite(attempt, fs) {
  let p;
  try { p = fs.setDoc(attempt.ref, attempt.payload); } catch (e) { p = Promise.reject(e); }
  return new Promise((resolve) => {
    let answered = false;
    const answer = () => { if (answered) return false; answered = true; resolve(); return true; };
    const timer = setTimeout(() => {
      if (attempt.state === "writing") attempt.state = "pending";
      answer();
    }, STAR_WRITE_TIMEOUT_MS);
    p.then(() => {
      clearTimeout(timer);
      attempt.state = "saved";
      if (!answer()) applyAttemptUi(attempt, true);
    }, async (err) => {
      clearTimeout(timer);
      attempt.error = err;
      let state = isAmbiguousWriteError(err) ? "unknown" : "failed";
      // A refused RE-send can simply mean "this star already exists": ask the server before believing a failure.
      if (state === "unknown" || attempt.sends > 1) {
        if ((await serverHas(attempt, fs)) === true) state = "saved";
      }
      attempt.state = state;
      if (!answer()) applyAttemptUi(attempt, true);
    });
  });
}

// "check again": looks for THIS attempt's document. Re-sends (same id, same data) only when the earlier write
// is known to have ended in a connection error. Never starts a new star.
async function recheckAttempt(a, userInitiated) {
  if (creationLock || !attemptUnresolved(a)) return;
  creationLock = true;
  setCreateBtnLoading(true);
  let note = "";
  try {
    const fs = await loadFirestore();
    const found = await serverHas(a, fs);
    if (found === true) {
      a.state = "saved";
    } else if (found === false && a.state === "unknown" && userInitiated) {
      a.sends++;
      a.state = "writing";
      await runAttemptWrite(a, fs);
    } else if (userInitiated) {
      note = found === null
        ? (navigator.onLine === false ? "still offline." : "couldn't reach the server.")
        : "it isn't on the server yet; it's still waiting to be sent.";
    }
  } catch (err) {
    console.error("Star check failed:", err);
  } finally {
    creationLock = false;
    setCreateBtnLoading(false);
  }
  applyAttemptUi(a, !userInitiated && a.state === "saved", note);
}

async function handleCreateStar() {
  if (creationLock) return;

  // An earlier star is still unresolved: look at THAT star (same id). Never start another one.
  if (attemptUnresolved(currentAttempt)) { return recheckAttempt(currentAttempt, true); }

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

  const errEl = document.getElementById("creation-error");
  if (!memory) {
    errEl.textContent = "a memory is required to birth a star.";
    document.getElementById("input-memory").focus();
    return;
  }

  if (!pendingCreatePos) {
    errEl.textContent = "position lost — please try again.";
    return;
  }

  // A confirmed-failed attempt is retried under the SAME id (its media is already uploaded and cached).
  const prior = currentAttempt && currentAttempt.state === "failed" ? currentAttempt : null;

  // Validate everything BEFORE any upload, so a star that can't be saved never leaves media behind.
  const pos = { x: Math.round(pendingCreatePos.x * 10) / 10, y: Math.round(pendingCreatePos.y * 10) / 10 };   // snapshot
  const invalid = validateStarInput({ memory, title, creator, x: pos.x, y: pos.y });
  if (invalid) { errEl.textContent = invalid; return; }

  // Re-check overlap (in case another user created one); the attempt's own earlier star doesn't count.
  if (isOccupied(pendingCreatePos.x, pendingCreatePos.y, prior && prior.id)) {
    errEl.textContent = "this region of space is now occupied.";
    return;
  }

  // Offline: nothing has been uploaded or written, and the form + attachments are kept untouched.
  if (navigator.onLine === false) {
    errEl.textContent = "you're offline, so nothing was sent. your star and attachments are kept here; tap plant once you're back online.";
    return;
  }
  const fbNow = window._firebase;
  if (!fbNow || !fbNow.auth || !fbNow.auth.currentUser) {
    errEl.textContent = "your session ended, so nothing was sent. your text is still here: copy it somewhere safe, then reload and sign in again.";
    return;
  }

  // A recording still running, or an attachment that failed to attach, must never be dropped silently.
  const mediaBlock = (window.ChrMedia && ChrMedia.preflight) ? ChrMedia.preflight() : null;
  if (mediaBlock) {
    errEl.textContent = mediaBlock;
    return;
  }

  errEl.textContent = "";
  creationLock = true;
  setCreateBtnLoading(true);
  if (window.ChrMedia && ChrMedia.setBusy) ChrMedia.setBusy(true);

  let attempt = null;
  let thrown = false;
  try {
    const fs = await loadFirestore();                 // load first: a failure here happens before any upload
    const { db, collection, serverTimestamp } = window._firebase;

    // Upload photo / voice note (if any). Any failure aborts BEFORE a star is created, and no text-only
    // star is ever created behind the user's back. Finished uploads are cached by media.js, so a retry
    // never re-uploads them.
    let media = [];
    if (window.ChrMedia && ChrMedia.hasPending()) {
      try {
        media = await ChrMedia.uploadPending((m) => { errEl.textContent = m; });
        errEl.textContent = "";
      } catch (upErr) {
        throw Object.assign(new Error("media-upload-failed"), {
          userMessage: "the star wasn't planted: " + ((upErr && upErr.userMessage) || "the attachment couldn't be sent.") +
                       " your attachment is kept; tap plant to try again."
        });
      }
    }

    const starDoc = {
      title:     title,
      memory:    memory,
      creator:   creator,
      x:         pos.x,
      y:         pos.y,
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
    };
    if (media.length) starDoc.media = media;       // field is omitted entirely when there is no media

    // The star id is fixed BEFORE writing and reused by every retry of this attempt.
    attempt = prior || { id: null, ref: null, sends: 0 };
    if (!attempt.ref) { attempt.ref = fs.doc(collection(db, "stars")); attempt.id = attempt.ref.id; }
        {   // pan-parallax: save layer-space coords so the star lands exactly where it was pressed
            const adj = pxCreateAdjust(starDoc, pendingCreatePos);
      starDoc.x = Math.round((pos.x - adj.x) * 10) / 10;
      starDoc.y = Math.round((pos.y - adj.y) * 10) / 10;
    }
    attempt.payload = starDoc;
    attempt.error   = null;
    attempt.sends++;
    attempt.state   = "writing";
    currentAttempt  = attempt;
    await runAttemptWrite(attempt, fs);
  } catch (err) {
    thrown = true;
    console.error("Star creation failed:", err);
    errEl.textContent = (err && err.userMessage) || "the star wasn't saved. nothing was created; please try again.";
    if (attempt && attempt.state === "writing") attempt.state = "failed";
  } finally {
    // Always runs: success, upload failure, Firestore failure, or an unconfirmed write.
    creationLock = false;
    setCreateBtnLoading(false);
    if (window.ChrMedia && ChrMedia.setBusy && !attemptUnresolved(currentAttempt)) ChrMedia.setBusy(false);
  }
  if (attempt && !thrown) applyAttemptUi(attempt, false);
}

function setCreateBtnLoading(on) {
  const btn    = document.getElementById("create-star-btn");
  const text   = document.getElementById("create-btn-text");
  const loader = document.getElementById("create-btn-loader");
  btn.disabled = on;
  text.textContent = on ? (attemptUnresolved(currentAttempt) && currentAttempt.state !== "writing" ? "checking…" : "planting…") : plantButtonLabel();
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

  // Media inputs (photo / voice note)
  if (window.ChrMedia) ChrMedia.initCreationUi();

  // Char counter
  document.getElementById("input-memory").addEventListener("input", function() {
    document.getElementById("memory-char-count").textContent = `${this.value.length} / 50000`;
  });

  // Keyboard: Enter on inputs (not textarea)
  document.getElementById("input-title").addEventListener("keydown",   e => { if (e.key === "Enter") handleCreateStar(); });
  document.getElementById("input-creator").addEventListener("keydown", e => { if (e.key === "Enter") handleCreateStar(); });

  // Connectivity back: look (read-only) for a star that was still waiting. Never re-sends on its own.
  window.addEventListener("online", () => {
    if (attemptUnresolved(currentAttempt) && !creationLock) recheckAttempt(currentAttempt, false);
  });

  // A star that isn't confirmed yet exists only in this page: warn before it can be lost.
  window.addEventListener("beforeunload", (e) => {
    if (creationLock || attemptUnresolved(currentAttempt)) { e.preventDefault(); e.returnValue = ""; }
  });

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
      if (!openModalStar || linkSaving) return;
      // Never trust the star object captured when the modal opened: another device may have linked it since.
      const fresh = stars.find((s) => s.id === openModalStar.id);
      if (!fresh) { closeMemoryModal(); return; }
      openModalStar = fresh;
      updateBinaryButton(fresh);
      if (fresh.linkedStarId) { showLinkingToast("this star is already linked to another star."); return; }
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

// A link is two reciprocal pointers (A.linkedStarId = B and B.linkedStarId = A). planBinaryLink decides what,
// if anything, may be written. It never replaces an existing pointer to a different star. `a` / `b` are
// { linkedStarId } or null when the star doesn't exist.
function planBinaryLink(idA, idB, a, b) {
  const fail = (code, message) => Object.assign(new Error(message), { chrLinkCode: code, userMessage: message });
  if (!idA || !idB || idA === idB) throw fail("self", "a star can't be linked to itself.");
  if (!a || !b) throw fail("missing", "one of these stars couldn't be found, so nothing was changed.");
  const clean = (v) => (typeof v === "string" && v ? v : null);
  const la = clean(a.linkedStarId), lb = clean(b.linkedStarId);
  if (la === idB && lb === idA) return { action: "noop", writes: [] };            // already linked: idempotent
  if ((la === null || la === idB) && (lb === null || lb === idA)) {               // free, or completing a half-written link
    const writes = [];
    if (la !== idB) writes.push({ id: idA, linkedStarId: idB });
    if (lb !== idA) writes.push({ id: idB, linkedStarId: idA });
    return { action: "write", writes };
  }
  throw fail("conflict", "one of these stars is already linked to a different star. the existing link was kept and nothing was changed.");
}

let linkSaving = false;   // a link is being saved: blocks repeated submissions

function cancelLinkingMode(msg) {
  linkingMode     = false;
  linkingSourceId = null;
  if (canvas) canvas.classList.remove("linking-mode");
  if (msg) showLinkingToast(msg);
}

// One tap while in linking mode (shared by the mouse and touch paths).
function handleLinkingTap(world) {
  const hit = findStarAtWorld(world.x, world.y);
  if (!hit) { cancelLinkingMode("linking cancelled. nothing was changed."); return; }      // empty space cancels, as promised
  if (hit.id === linkingSourceId) { showLinkingToast("tap a different star to link it."); return; }
  if (hit.type !== "memory") { showLinkingToast("only memory stars can be linked. tap empty space to cancel."); return; }
  confirmBinaryLink(hit);
}

function confirmBinaryLink(partnerStar) {
  const sourceId  = linkingSourceId;
  const partnerId = partnerStar.id;

  // Exit linking mode first
  linkingMode     = false;
  linkingSourceId = null;
  if (canvas) canvas.classList.remove("linking-mode");

  if (linkSaving) { showLinkingToast("a link is already being saved. please wait."); return; }

  // Fresh local check (the live listener keeps `stars` current) so an outdated modal can't start a bad link.
  // The transaction in saveBinaryLink repeats this check against the server and is the real authority.
  const source  = stars.find((s) => s.id === sourceId);
  const partner = stars.find((s) => s.id === partnerId);
  let plan;
  try {
    plan = planBinaryLink(sourceId, partnerId, source || null, partner || null);
  } catch (e) {
    alert(e.userMessage || "these stars can't be linked.");
    return;
  }
  if (plan.action === "noop") { showLinkingToast("these two stars are already linked."); return; }

  const ok = window.confirm(`link "${(source && source.title) || "this star"}" and "${partnerStar.title || "this star"}" as binary stars?`);
  if (!ok) return;

  saveBinaryLink(sourceId, partnerId);
}

// Both pointers are written in ONE Firestore transaction (all or nothing). The transaction reads both stars
// from the server first, so it also fails fast when offline instead of leaving a queued half-write.
async function linkStarsTransaction(idA, idB) {
  const { db } = window._firebase;
  const fs   = await loadFirestore();
  const refA = fs.doc(db, "stars", idA);
  const refB = fs.doc(db, "stars", idB);
  return fs.runTransaction(db, async (tx) => {
    const sa = await tx.get(refA);
    const sb = await tx.get(refB);
    const plan = planBinaryLink(
      idA, idB,
      sa.exists() ? { linkedStarId: sa.data().linkedStarId } : null,
      sb.exists() ? { linkedStarId: sb.data().linkedStarId } : null
    );
    for (const w of plan.writes) tx.update(w.id === idA ? refA : refB, { linkedStarId: w.linkedStarId });
    return plan.action;
  });
}

// After a connection-type failure: ask the server what really happened.
async function readLinkState(idA, idB) {
  const { db } = window._firebase;
  const fs = await loadFirestore();
  const [sa, sb] = await withTimeout(Promise.all([
    fs.getDocFromServer(fs.doc(db, "stars", idA)),
    fs.getDocFromServer(fs.doc(db, "stars", idB))
  ]), SERVER_CHECK_TIMEOUT_MS);
  return planBinaryLink(
    idA, idB,
    sa.exists() ? { linkedStarId: sa.data().linkedStarId } : null,
    sb.exists() ? { linkedStarId: sb.data().linkedStarId } : null
  );
}

async function saveBinaryLink(idA, idB) {
  if (linkSaving) return;
  if (!idA || !idB || idA === idB) { alert("a star can't be linked to itself."); return; }
  linkSaving = true;
  try {
    const action = await withTimeout(linkStarsTransaction(idA, idB), LINK_TIMEOUT_MS);
    showLinkingToast(action === "noop" ? "these two stars are already linked." : "binary link saved.");
  } catch (err) {
    if (err && err.chrLinkCode) { alert(err.userMessage); return; }       // refused on purpose: nothing was written
    console.error("Binary link failed:", err);
    // The failure may have happened after the server committed: look instead of guessing.
    let state = null, conflict = false;
    try { state = await readLinkState(idA, idB); } catch (e2) { conflict = !!(e2 && e2.chrLinkCode); }
    if (state && state.action === "noop") {
      showLinkingToast("binary link saved.");
    } else if (conflict) {
      alert("the link wasn't saved: one of these stars is now linked to a different star. the existing link was kept.");
    } else if (state && state.writes.length === 2) {
      alert("the link wasn't saved and nothing was changed. please try again.");
    } else if (state) {
      alert("only half of the link was saved. nothing was overwritten. tap link again on these two stars to finish it; that is safe to repeat.");
    } else {
      alert("couldn't confirm whether the link was saved. nothing has been overwritten. the sky will show the real state once the connection is back; linking the same two stars again is safe.");
    }
  } finally {
    linkSaving = false;
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
