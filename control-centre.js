/* ═══════════════════════════════════════════════════════════
   CHRYSANTHEMUM — control-centre.js
   Cosmic artwork for the Control Centre (Phase 1: visuals only)

   Self-contained and isolated: no Firebase, no app.js globals, no
   storage, no network. The only global it adds is
   window.ChrysanthemumControlCentre.

   Usage:
     const cc = ChrysanthemumControlCentre.mount(containerElement);
     cc.featureButton   // the single Constellations & Tags hit target
     cc.destroy();

   Layers, bottom to top:
     canvas   background (nebula, galaxy, starfield)   — painted once
     canvas   far dust (twinkles + stardust behind the star)
     SVG      receding halves of both orbits + far stars
     HTML/CSS central star (+ one painted surface texture)
     SVG      approaching halves of both orbits + near stars
     canvas   near dust (stardust in front of the star)
     HTML     label + hit target
   ═══════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var TAU = Math.PI * 2;
  var rad = function (d) { return d * Math.PI / 180; };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (a, b, v) {
    var t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  var hex = function (h) {
    var n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  var mixc = function (a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  };
  var rgbS = function (c) {
    return "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")";
  };
  var rgbaS = function (c, a) {
    return "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + a + ")";
  };
  var angDiff = function (a, b) {
    var d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };

  // ─── Palette (from the brief) ───
  var C = {
    deep:   hex("#060a12"),
    space:  hex("#0d1524"),
    warm:   hex("#0f1829"),
    amber:  hex("#d89b48"),
    gold:   hex("#f2c47d"),
    cream:  hex("#fff2d6"),
    light:  hex("#fff7e6"),
    blue:   hex("#7fa8c9"),
    ice:    hex("#a8cde8"),
    lane:   hex("#121926")
  };

  // ─── Seeded random + value noise (deterministic art) ───
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(seed) {
    var rand = rng(seed);
    var perm = new Uint8Array(512);
    var vals = new Float32Array(256);
    var p = [], i, j, tmp;
    for (i = 0; i < 256; i++) p.push(i);
    for (i = 255; i > 0; i--) {
      j = (rand() * (i + 1)) | 0;
      tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
    for (i = 0; i < 256; i++) vals[i] = rand();
    var fade = function (t) { return t * t * t * (t * (t * 6 - 15) + 10); };

    function n2(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y);
      var xf = x - xi, yf = y - yi;
      var X = xi & 255, Y = yi & 255;
      var a = vals[perm[perm[X] + Y]];
      var b = vals[perm[perm[X + 1] + Y]];
      var c = vals[perm[perm[X] + Y + 1]];
      var d = vals[perm[perm[X + 1] + Y + 1]];
      var u = fade(xf), v = fade(yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function h3(X, Y, Z) { return vals[perm[perm[perm[X] + Y] + Z]]; }
    function n3(x, y, z) {
      var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      var xf = x - xi, yf = y - yi, zf = z - zi;
      var X = xi & 255, Y = yi & 255, Z = zi & 255;
      var u = fade(xf), v = fade(yf), w = fade(zf);
      var x00 = lerp(h3(X, Y, Z),         h3(X + 1, Y, Z),         u);
      var x10 = lerp(h3(X, Y + 1, Z),     h3(X + 1, Y + 1, Z),     u);
      var x01 = lerp(h3(X, Y, Z + 1),     h3(X + 1, Y, Z + 1),     u);
      var x11 = lerp(h3(X, Y + 1, Z + 1), h3(X + 1, Y + 1, Z + 1), u);
      return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
    }
    function fbm2(x, y, oct) {
      var s = 0, a = 0.5, f = 1, n = 0;
      for (var k = 0; k < oct; k++) {
        s += a * n2(x * f + k * 17.3, y * f - k * 9.1);
        n += a; a *= 0.5; f *= 2.03;
      }
      return s / n;
    }
    function fbm3(x, y, z, oct) {
      var s = 0, a = 0.5, f = 1, n = 0;
      for (var k = 0; k < oct; k++) {
        s += a * n3(x * f + k * 13.7, y * f - k * 7.9, z * f + k * 5.3);
        n += a; a *= 0.5; f *= 2.07;
      }
      return s / n;
    }
    return { n2: n2, n3: n3, fbm2: fbm2, fbm3: fbm3 };
  }

  // ═══════════════════════════════════════════════════════════
  //  LAYOUT — adapts the composition to the viewport
  // ═══════════════════════════════════════════════════════════
  function computeLayout(W, H) {
    var aspect = W / H;
    var wide = aspect > 1.25;
    // Star radius: ~12% of the height (diameter ≈ 24%), limited by width on narrow screens
    var r = Math.min(H * 0.122, W * 0.15);
    // Taller screens spread the two orbits further apart vertically
    var vs = clamp(H / (W * 0.5625), 1, 1.5);
    var cx = W * (wide ? 0.555 : 0.5);
    var cy = H * (wide ? 0.505 : 0.52);
    var u = r / 108;
    var RxU = Math.min(W * 0.435, r * 6.6);

    return {
      W: W, H: H, aspect: aspect, r: r, u: u, cx: cx, cy: cy, vs: vs,
      galaxy: {
        x: W * (wide ? 0.38 : 0.36),
        y: H * (wide ? 0.32 : 0.28),
        a: Math.max(W * 0.56, H * 0.46),
        ratio: 0.42,
        tilt: rad(-24)
      },
      upper: {
        cx: cx, cy: cy, Rx: RxU, Rz: RxU * 0.74,
        pitch: rad(15 + 14 * (vs - 1)), yaw: rad(13), roll: rad(-15),
        yc: -r * 1.9 * vs, F: RxU * 3.9
      },
      lower: {
        cx: cx, cy: cy, Rx: RxU * 0.95, Rz: RxU * 0.95 * 0.72,
        pitch: rad(14 + 14 * (vs - 1)), yaw: rad(-12), roll: rad(-13),
        yc: r * 1.75 * vs, F: RxU * 3.9
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  ORBITS — real 3D ellipses, projected with perspective
  //  Stars, dust and drawn paths all call the same function, so
  //  everything stays physically attached to the path.
  // ═══════════════════════════════════════════════════════════
  function makeOrbit(cfg) {
    var sp = Math.sin(cfg.pitch), cp = Math.cos(cfg.pitch);
    var sy = Math.sin(cfg.yaw),   cyw = Math.cos(cfg.yaw);
    var sr = Math.sin(cfg.roll),  cr = Math.cos(cfg.roll);
    var orbit = { zmin: 0, zmax: 1 };

    // theta: angle round the orbit; rs: radius multiplier; lift: offset off the orbital plane
    orbit.point = function (theta, rs, lift) {
      rs = rs === undefined ? 1 : rs;
      lift = lift || 0;
      var x0 = cfg.Rx * rs * Math.cos(theta);
      var z0 = cfg.Rz * rs * Math.sin(theta);
      var y1 = -z0 * sp + lift * cp;
      var z1 = z0 * cp + lift * sp;
      var x2 = x0 * cyw + z1 * sy;
      var z2 = -x0 * sy + z1 * cyw;
      var x3 = x2 * cr - y1 * sr;
      var y3 = x2 * sr + y1 * cr + cfg.yc;
      var s = cfg.F / (cfg.F + z2);
      return {
        x: cfg.cx + x3 * s,
        y: cfg.cy + y3 * s,
        z: z2,
        s: s,
        d: (z2 - orbit.zmin) / (orbit.zmax - orbit.zmin) // 0 = nearest, 1 = farthest
      };
    };

    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < 180; i++) {
      var p = orbit.point(i / 180 * TAU);
      if (p.z < lo) lo = p.z;
      if (p.z > hi) hi = p.z;
    }
    orbit.zmin = lo;
    orbit.zmax = hi;
    return orbit;
  }

  // Brightness along an orbit: gentle noise plus a few luminous stretches
  function makeBrightness(seed, bumps) {
    var r = rng(seed);
    var p1 = r() * TAU, p2 = r() * TAU, p3 = r() * TAU;
    return function (th) {
      var v = 0.62 + 0.20 * Math.sin(3 * th + p1) + 0.13 * Math.sin(7 * th + p2) + 0.07 * Math.sin(13 * th + p3);
      for (var i = 0; i < bumps.length; i++) {
        var d = angDiff(th, bumps[i][0]) / bumps[i][1];
        v += bumps[i][2] * Math.exp(-d * d);
      }
      return clamp(v, 0.28, 1.35);
    };
  }

  var ORBIT_STYLE = {
    upper: {
      near: hex("#fff0cf"), far: hex("#8fb3d0"),
      edge: hex("#f1f6fb"),
      glow: hex("#d89b48"), glowFar: hex("#7fa8c9"),
      bright: makeBrightness(11, [[rad(-115), 0.55, 0.38], [rad(35), 0.5, 0.25], [rad(150), 0.4, 0.15]]),
      wob: makeBrightness(5, [])
    },
    lower: {
      near: hex("#f7cd8a"), far: hex("#b4b8b0"),
      edge: hex("#fff2d6"),
      glow: hex("#d89b48"), glowFar: hex("#a8cde8"),
      bright: makeBrightness(23, [[rad(-70), 0.5, 0.4], [rad(95), 0.45, 0.22], [rad(200), 0.5, 0.2]]),
      wob: makeBrightness(9, [])
    }
  };

  function bandOf(d) {
    if (d < 0.40) return 0;
    if (d < 0.50) return 1;
    if (d < 0.62) return 2;
    if (d < 0.80) return 3;
    return 4;
  }
  var BAND_BLUR = [0, 0.35, 0.7, 1.2, 1.9];

  function ln(a, b, color, w, op) {
    return '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) +
      '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
      '" stroke="' + color + '" stroke-width="' + w.toFixed(2) +
      '" stroke-opacity="' + op.toFixed(3) + '"/>';
  }

  // Builds the far-half and near-half markup for one orbit
    function buildOrbitMarkup(orbit, style, u, st) {
    var N = 420, i;
    var far = [[], [], [], [], []], near = [[], [], [], [], []];
    var glowFar = [], glowNear = [];
    var pts = [], edge = [];
    for (i = 0; i <= N; i++) {
      var th = i / N * TAU;
      pts.push(orbit.point(th));
      edge.push(orbit.point(th, 0.986));
    }
    for (i = 0; i < N; i++) {
      var a = pts[i], b = pts[i + 1];
      var thm = (i + 0.5) / N * TAU;
      var z = (a.z + b.z) / 2, d = (a.d + b.d) / 2, n = 1 - d;
            var br = style.bright(thm);
      var mx = (a.x + b.x) / 2 - st.cx, my = (a.y + b.y) / 2 - st.cy;
      var nb = smooth(1.5, 0.75, Math.sqrt(mx * mx + my * my) / st.r);
      var back = z > 0 ? 0.64 - 0.3 * nb : 1 - 0.4 * nb;
      var body = mixc(style.near, style.far, smooth(0.25, 0.9, d));
      var w = u * lerp(0.6, 2.0, Math.pow(n, 1.25)) * (0.82 + 0.34 * style.wob(thm)) * (1 - 0.25 * nb);
      var op = clamp(lerp(0.16, 0.95, Math.pow(n, 1.1)) * br * back, 0.04, 1);
      var bucket = (z > 0 ? far : near)[bandOf(d)];
      bucket.push(ln(a, b, rgbS(body), w, op));
      bucket.push(ln(edge[i], edge[i + 1], rgbS(style.edge), w * 0.42, clamp(op * 0.95, 0, 1)));
      if (i % 3 === 0) {
        var c = pts[Math.min(i + 3, N)];
        var gl = ln(a, c, rgbS(mixc(style.glow, style.glowFar, smooth(0.2, 0.9, d))),
                    w * 4.2, (0.035 + 0.07 * n * br) * back * back);
        (z > 0 ? glowFar : glowNear).push(gl);
      }
    }
    return { far: far, near: near, glowFar: glowFar, glowNear: glowNear };
  }

  // ═══════════════════════════════════════════════════════════
  //  FOUR-POINTED STARS
  // ═══════════════════════════════════════════════════════════
  function star4(rx, ry, c) {
    var cx = (c * rx).toFixed(2), cy = (c * ry).toFixed(2);
    return "M0 " + (-ry) + " Q" + cx + " " + (-cy) + " " + rx + " 0 " +
      "Q" + cx + " " + cy + " 0 " + ry + " " +
      "Q" + (-cx) + " " + cy + " " + (-rx) + " 0 " +
      "Q" + (-cx) + " " + (-cy) + " 0 " + (-ry) + "Z";
  }

  var TINTS = {
    cream: { glow: C.cream, core: C.light, spike: C.cream },
    gold:  { glow: C.gold,  core: hex("#ffe7b8"), spike: C.gold },
    ice:   { glow: C.ice,   core: hex("#eef8ff"), spike: C.ice }
  };

  function defsMarkup(id, W, H, u) {
    var s = "";
    // Depth blur bands + soft glow filter (full-viewport user-space regions)
    for (var b = 1; b < BAND_BLUR.length; b++) {
      s += '<filter id="' + id + "-b" + b + '" filterUnits="userSpaceOnUse" x="0" y="0" width="' + W +
        '" height="' + H + '"><feGaussianBlur stdDeviation="' + (BAND_BLUR[b] * Math.max(u, 0.8)).toFixed(2) + '"/></filter>';
    }
    s += '<filter id="' + id + '-gl" filterUnits="userSpaceOnUse" x="0" y="0" width="' + W +
      '" height="' + H + '"><feGaussianBlur stdDeviation="' + (4.2 * Math.max(u, 0.8)).toFixed(2) + '"/></filter>';
    // Star glows
    Object.keys(TINTS).forEach(function (k) {
      var t = TINTS[k];
      s += '<radialGradient id="' + id + "-g-" + k + '"><stop offset="0" stop-color="#fff" stop-opacity="0.95"/>' +
        '<stop offset="0.16" stop-color="' + rgbS(t.glow) + '" stop-opacity="0.55"/>' +
        '<stop offset="0.42" stop-color="' + rgbS(t.glow) + '" stop-opacity="0.16"/>' +
        '<stop offset="1" stop-color="' + rgbS(t.glow) + '" stop-opacity="0"/></radialGradient>';
      s += '<linearGradient id="' + id + "-s-" + k + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="' + rgbS(t.spike) + '" stop-opacity="0"/>' +
        '<stop offset="1" stop-color="' + rgbS(t.spike) + '" stop-opacity="0.9"/></linearGradient>';
    });
    return "<defs>" + s + "</defs>";
  }

  function starMarkup(id, tint, feature) {
    var t = TINTS[tint];
    var glowR = feature ? 34 : 24;
    var long = feature ? 58 : 36;
    var mid = feature ? 26 : 16;
    var core = feature ? 8 : 5.5;
    var coreY = feature ? 24 : 17;
    return '<circle r="' + glowR + '" fill="url(#' + id + "-g-" + tint + ')"/>' +
      '<path d="' + star4(long * 0.1, long, 0.04) + '" fill="url(#' + id + "-g-" + tint + ')" opacity="0.85"/>' +
      '<path d="' + star4(long, long * 0.1, 0.04) + '" fill="url(#' + id + "-g-" + tint + ')" opacity="0.85"/>' +
            '<path d="' + star4(long * 0.045, long * 1.5, 0.02) + '" fill="#fff6e2" opacity="0.5"/>' +
      '<path d="' + star4(long * 1.5, long * 0.045, 0.02) + '" fill="#fff6e2" opacity="0.5"/>' +
      '<path d="' + star4(mid * 0.5, mid, 0.1) + '" fill="' + rgbS(t.glow) + '" opacity="0.55"/>' +
      '<path d="' + star4(core, coreY, 0.09) + '" fill="' + rgbS(t.core) + '"/>' +
      '<circle r="' + (feature ? 2.2 : 1.6) + '" fill="#fff"/>';
  }

  // ═══════════════════════════════════════════════════════════
  //  BACKGROUND — deep space, galaxy, nebula, starfield (painted once)
  // ═══════════════════════════════════════════════════════════
  function paintBackground(canvas, L, dpr, noise) {
    var W = L.W, H = L.H;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Deep space base
    var base = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, Math.max(W, H) * 0.85);
    base.addColorStop(0, rgbS(C.warm));
    base.addColorStop(0.45, rgbS(C.space));
    base.addColorStop(1, rgbS(C.deep));
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // ── Galaxy + faint ambient nebula rendered per-pixel at low resolution
        var sc = Math.min(0.5, 800 / W) * ((L.perf || 1) < 1 ? 0.8 : 1);
    var bw = Math.max(2, Math.ceil(W * sc)), bh = Math.max(2, Math.ceil(H * sc));
    var buf = document.createElement("canvas");
    buf.width = bw; buf.height = bh;
    var bctx = buf.getContext("2d");
    var img = bctx.createImageData(bw, bh);
    var data = img.data;
    var G = L.galaxy;
    var cosA = Math.cos(G.tilt), sinA = Math.sin(G.tilt);
    var ga = G.a, gb = G.a * G.ratio;
    var fq = 1 / ga;

    for (var j = 0; j < bh; j++) {
      for (var i = 0; i < bw; i++) {
        var x = i / sc, y = j / sc;
        var dx = x - G.x, dy = y - G.y;
        var u = dx * cosA + dy * sinA;
        var v = -dx * sinA + dy * cosA;
        var nu = u / ga, nv = v / gb;
        var e2 = nu * nu + nv * nv;

        var r = 0, g = 0, b = 0;

        if (e2 < 5) {
          var px = u * fq, py = v * fq;
          var warp = noise.fbm2(px * 1.3 + 3.1, py * 1.3 + 1.7, 3);
          var base1 = Math.exp(-e2 * 1.55);

          // Overlapping translucent gas bands: golden-amber and icy-blue
          var bandA = Math.exp(-Math.pow((nv + 0.14 + 0.4 * (warp - 0.5)) / 0.5, 2)) * Math.exp(-(nu - 0.1) * (nu - 0.1) * 0.8);
          var bandB = Math.exp(-Math.pow((nv - 0.30 + 0.45 * (warp - 0.5)) / 0.42, 2)) * Math.exp(-(nu + 0.15) * (nu + 0.15) * 0.8);
          var mA = noise.fbm2(px * 1.4 + 11.0, py * 1.4 + 4.0, 3);
          var mB = noise.fbm2(px * 1.6 - 7.0, py * 1.6 + 9.0, 3);
          var texA = 0.5 + 1.2 * smooth(0.25, 0.75, mA);
          var texB = 0.4 + 1.2 * smooth(0.25, 0.75, mB);
          var gasA = bandA * texA * Math.pow(base1, 0.35);
          var gasB = bandB * texB * Math.pow(base1, 0.35);

          // Soft cream-gold illuminated region
          var coreD = Math.pow((nu - 0.12) / 0.5, 2) + Math.pow((nv + 0.14) / 0.3, 2);
          var mC = noise.fbm2(px * 2.0 + 2.0, py * 2.0 - 6.0, 3);
          var core = Math.exp(-coreD * 1.3) * (0.55 + 0.7 * mC);

          // Dark molecular dust lanes
          var lane = Math.exp(-Math.pow((nv - 0.58 + 0.3 * (warp - 0.5)) / 0.15, 2)) * smooth(2.6, 0.4, e2);
          var keep = 1 - 0.86 * lane;

          var kA = 0.46 * keep, kB = 0.46 * keep, kC = 0.34 * keep, kH = 0.05;
          r = C.amber[0] * gasA * kA + C.blue[0] * gasB * kB + C.cream[0] * core * kC + C.gold[0] * base1 * kH;
          g = C.amber[1] * gasA * kA + C.blue[1] * gasB * kB + C.cream[1] * core * kC + C.gold[1] * base1 * kH;
          b = C.amber[2] * gasA * kA + C.blue[2] * gasB * kB + C.cream[2] * core * kC + C.gold[2] * base1 * kH;
        }

        // Very faint ambient clouds elsewhere, cool far from the star and warm near it
        var amb = noise.fbm2(x / W * 2.4 + 40.0, y / H * 2.0 + 12.0, 4);
        var am = smooth(0.50, 0.78, amb) * 0.085;
        var dxs = (x - L.cx) / W, dys = (y - L.cy) / H;
        var warmth = Math.exp(-(dxs * dxs + dys * dys) * 5.0);
        r += lerp(C.blue[0], C.amber[0], warmth) * am;
        g += lerp(C.blue[1], C.amber[1], warmth) * am;
        b += lerp(C.blue[2], C.amber[2], warmth) * am;

                // Wispy gas filaments (domain-warped ridged noise) + dark dust ridges
        var fx = x / W, fy = y / H;
        var qx = noise.fbm2(fx * 2.0 + 17.0, fy * 2.0 + 3.0, 3), qy = noise.fbm2(fx * 2.0 + 41.0, fy * 2.0 + 29.0, 3);
        var rg = 1 - Math.abs(2 * noise.fbm2(fx * 3.4 + 2.4 * qx, fy * 3.4 + 2.4 * qy, 4) - 1);
        var fil = Math.pow(rg, 7) * smooth(0.38, 0.7, noise.fbm2(fx * 1.7 + 60.0, fy * 1.7 + 10.0, 3)) *
          (0.18 + clamp(Math.abs(dxs) * 1.7, 0, 1)) * (1 - 0.65 * warmth);
        var hue = smooth(0.46, 0.54, noise.fbm2(fx * 1.3 + 90.0, fy * 1.3 + 50.0, 2));
        r += lerp(C.blue[0], C.amber[0], hue) * fil * 0.9;
        g += lerp(C.blue[1], C.amber[1], hue) * fil * 0.9;
        b += lerp(C.blue[2], C.amber[2], hue) * fil * 0.9;
        var dk = 1 - 0.34 * smooth(0.74, 0.97, 1 - Math.abs(2 * noise.fbm2(fx * 2.6 + 3.0 * qy, fy * 2.6 + 3.0 * qx + 7.0, 4) - 1)) * smooth(3.2, 0.3, e2);
        r *= dk; g *= dk; b *= dk;

        var k = (j * bw + i) * 4;
        data[k]     = r > 255 ? 255 : r;
        data[k + 1] = g > 255 ? 255 : g;
        data[k + 2] = b > 255 ? 255 : b;
        data[k + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(buf, 0, 0, W, H);
    ctx.restore();

    // Vignette: deep corners
    var vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.35, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.56);
    vg.addColorStop(0, "rgba(6,10,18,0)");
    vg.addColorStop(1, "rgba(6,10,18,0.62)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // ── Sparse starfield (+ a denser scatter of tiny stars through the galaxy)
    var rand = rng(90210);
    var colors = [C.cream, C.cream, C.cream, C.ice, C.ice, C.gold];
        function dot(x, y, rr, a, col) {
      ctx.fillStyle = rgbaS(col, a);
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.fill();
      if (rr > 0.9) {
        var gr = ctx.createRadialGradient(x, y, 0, x, y, rr * 5);
        gr.addColorStop(0, rgbaS(col, a * 0.35));
        gr.addColorStop(1, rgbaS(col, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(x - rr * 5, y - rr * 5, rr * 10, rr * 10);
      }
      if (rr > 1.15) {
        ctx.strokeStyle = rgbaS(col, a * 0.5);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x - rr * 6, y); ctx.lineTo(x + rr * 6, y);
        ctx.moveTo(x, y - rr * 6); ctx.lineTo(x, y + rr * 6);
        ctx.stroke();
      }
    }
    var count = Math.round(W * H / 7000 * (L.perf || 1)), s;
    for (s = 0; s < count; s++) {
            dot(rand() * W, rand() * H, 0.25 + Math.pow(rand(), 4.2) * 1.5,
        0.18 + 0.62 * rand() * rand(), colors[(rand() * colors.length) | 0]);
    }
        var gcount = Math.round(W * H / 14000 * (L.perf || 1));
    for (s = 0; s < gcount; s++) {
      var gu = (rand() * 2 - 1) * ga * 0.85, gv = (rand() * 2 - 1) * gb * 0.8;
      if ((gu * gu) / (ga * ga * 0.72) + (gv * gv) / (gb * gb * 0.72) > 1) continue;
      var gxp = G.x + gu * cosA - gv * sinA, gyp = G.y + gu * sinA + gv * cosA;
      dot(gxp, gyp, 0.28 + rand() * 0.55, 0.15 + 0.5 * rand(), colors[(rand() * colors.length) | 0]);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CENTRAL STAR SURFACE — granulation painted once on a small canvas
  // ═══════════════════════════════════════════════════════════
  var RAMP = [
    [-0.05, hex("#a86a2a")],
    [0.16,  hex("#d89b48")],
    [0.42,  hex("#f2c47d")],
    [0.70,  hex("#ffe6b4")],
    [0.92,  hex("#fff2d6")],
    [1.10,  hex("#fff9ee")]
  ];
  function ramp(w) {
    if (w <= RAMP[0][0]) return RAMP[0][1];
    for (var i = 1; i < RAMP.length; i++) {
      if (w <= RAMP[i][0]) {
        var t = (w - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0]);
        return mixc(RAMP[i - 1][1], RAMP[i][1], t);
      }
    }
    return RAMP[RAMP.length - 1][1];
  }

    function paintStarSurface(canvas, size, noise, perf) {
    var S = clamp(Math.round(size), 160, 1100);
    canvas.width = S; canvas.height = S;
    var ctx = canvas.getContext("2d");
    var h = S / 2, rand = rng(31337), k = S / 560;
    ctx.globalCompositeOperation = "lighter";
    var g = ctx.createRadialGradient(h, h, 0, h, h, h);
    [[0, "255,250,238,1"], [0.04, "255,240,205,0.9"], [0.1, "255,222,160,0.62"], [0.22, "246,200,124,0.38"],
     [0.4, "220,160,76,0.17"], [0.62, "190,150,110,0.07"], [0.82, "150,190,225,0.025"], [1, "150,190,225,0"]
    ].forEach(function (s) { g.addColorStop(s[0], "rgba(" + s[1] + ")"); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // Particles: soft spiral arms, flattened along the orbital plane
    var ca = Math.cos(rad(-18)), sa = Math.sin(rad(-18));
    var n = Math.round(S * 120 * (perf || 1)), i = 0, guard = 0;
    while (i < n && guard++ < n * 8) {
      var a = rand() * TAU, rho = Math.pow(rand(), 1.7) * 0.94;
      var arm = 0.5 + 0.5 * Math.cos(2 * (a - rho * 3.2));
      var ex = Math.cos(a) * rho, ey = Math.sin(a) * rho * 0.82;
      var x = h + (ex * ca - ey * sa) * h, y = h + (ex * sa + ey * ca) * h;
      var d = noise.fbm2(x / S * 4.6 + 3.0, y / S * 4.6 + 8.0, 4);
      if (rand() > (0.18 + 0.9 * d) * (0.45 + 0.7 * arm) * (1 - rho * 0.5)) continue;
      var col = rho < 0.2 ? C.cream : rho < 0.5 ? mixc(C.cream, C.gold, (rho - 0.2) / 0.3) : mixc(C.gold, rand() < 0.3 ? C.ice : C.amber, (rho - 0.5) / 0.44);
      var rr = (0.2 + Math.pow(rand(), 4) * 1.1) * k;
      ctx.fillStyle = rgbaS(col, (0.12 + 0.5 * rand()) * (1 - rho * 0.5));
      ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
      if (rr > 0.9 * k) {
        ctx.fillStyle = rgbaS(col, 0.05);
        ctx.beginPath(); ctx.arc(x, y, rr * 2.6, 0, TAU); ctx.fill();
      }
      i++;
    }
  }

  // Four slim spikes that start at the stellar limb and fade outward
  function raysMarkup() {
    function spike(len, half, op, rot) {
      return '<path transform="rotate(' + rot + ')" d="M' + (-half) + ' -46 Q' + (-half * 0.25) + ' ' + (-len * 0.4) +
        ' 0 ' + (-len) + ' Q' + (half * 0.25) + ' ' + (-len * 0.4) + ' ' + half + ' -46Z" fill="url(#CCRAY)" opacity="' + op + '"/>';
    }
    var s = "";
    [0, 90, 180, 270].forEach(function (rot) {
      s += spike(210, 3.0, 0.4, rot);
      s += spike(150, 5.0, 0.75, rot);
    });
    return '<defs><linearGradient id="CCRAY" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#fff2d6" stop-opacity="0"/>' +
      '<stop offset="0.55" stop-color="#fff2d6" stop-opacity="0.18"/>' +
      '<stop offset="1" stop-color="#fff7e6" stop-opacity="0.9"/></linearGradient></defs>' + s;
  }

  // ═══════════════════════════════════════════════════════════
  //  DUST SPRITES
  // ═══════════════════════════════════════════════════════════
  function makeSprite(col) {
    var c = document.createElement("canvas");
    c.width = c.height = 48;
    var g = c.getContext("2d");
    var gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, rgbaS(col, 1));
    gr.addColorStop(0.16, rgbaS(col, 0.8));
    gr.addColorStop(0.42, rgbaS(col, 0.2));
    gr.addColorStop(1, rgbaS(col, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 48, 48);
    return c;
  }

  // ═══════════════════════════════════════════════════════════
  //  STAR DEFINITIONS
  // ═══════════════════════════════════════════════════════════
  var STARS = [
    // The single designated feature control
    { id: "constellations", orbit: "upper", theta: rad(-122), size: 1.0, tint: "cream", feature: true },
    // Purely decorative companions (no names, no interaction)
    { orbit: "upper", theta: rad(22),  size: 0.50, tint: "ice" },
    { orbit: "upper", theta: rad(103), size: 0.36, tint: "cream" },
    { orbit: "upper", theta: rad(-42), size: 0.58, tint: "gold" },
    { orbit: "lower", theta: rad(-98), size: 0.74, tint: "gold" },
    { orbit: "lower", theta: rad(50),  size: 0.40, tint: "ice" },
    { orbit: "lower", theta: rad(158), size: 0.52, tint: "cream" },
    { orbit: "lower", theta: rad(-28), size: 0.34, tint: "ice" }
  ];
  // Seconds per revolution; the two orbits turn at different rates and in opposite senses
  var ORBIT_MOTION = {
    upper: { period: 300, dir: -1 },
    lower: { period: 400, dir: 1 }
  };

  // ═══════════════════════════════════════════════════════════
  //  MOUNT
  // ═══════════════════════════════════════════════════════════
  var instanceCount = 0;

  function mount(container, options) {
    options = options || {};
    var uid = "cc" + (++instanceCount);
    var noise = makeNoise(7741);

    // ── DOM
    var root = document.createElement("div");
    root.className = "cc-root";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Control Centre");
    root.innerHTML =
      '<canvas class="cc-layer cc-bg" aria-hidden="true"></canvas>' +
            '<canvas class="cc-layer cc-anim" aria-hidden="true"></canvas>' +
      '<canvas class="cc-layer cc-dust-far" aria-hidden="true"></canvas>' +
      '<svg class="cc-layer cc-svg-far" aria-hidden="true" focusable="false"></svg>' +
      '<svg class="cc-layer cc-stars-far" aria-hidden="true" focusable="false"></svg>' +
      '<div class="cc-star" aria-hidden="true">' +
        '<div class="cc-star__halo"></div>' +
        '<div class="cc-star__corona cc-star__corona--cool"></div>' +
        '<div class="cc-star__corona"></div>' +
        '<div class="cc-star__body"><canvas class="cc-star__surface"></canvas><div class="cc-star__shade"></div></div>' +
        '<svg class="cc-star__rays" viewBox="-300 -300 600 600" focusable="false"></svg>' +
      '</div>' +
      '<svg class="cc-layer cc-svg-near" aria-hidden="true" focusable="false"></svg>' +
      '<svg class="cc-layer cc-stars-near" aria-hidden="true" focusable="false"></svg>' +
      '<canvas class="cc-layer cc-dust-near" aria-hidden="true"></canvas>' +
      '<div class="cc-ui">' +
        '<span class="cc-label">Constellations</span>' +
        '<button type="button" class="cc-feature" aria-label="Constellations"></button>' +
      '</div>';
    container.appendChild(root);

    var q = function (s) { return root.querySelector(s); };
    var bgCanvas = q(".cc-bg"), farCanvas = q(".cc-dust-far"), nearCanvas = q(".cc-dust-near");
        var svgFar = q(".cc-svg-far"), svgNear = q(".cc-svg-near");
    var animCanvas = q(".cc-anim"), animCtx = animCanvas.getContext("2d");
    var starsFar = q(".cc-stars-far"), starsNear = q(".cc-stars-near");
    var starEl = q(".cc-star"), surface = q(".cc-star__surface"), rays = q(".cc-star__rays");
    var label = q(".cc-label"), feature = q(".cc-feature");
    rays.innerHTML = raysMarkup();
    // Unique ray gradient id per instance
    rays.innerHTML = rays.innerHTML.replace(/CCRAY/g, uid + "-ray");

    var farCtx = farCanvas.getContext("2d");
    var nearCtx = nearCanvas.getContext("2d");

    var sprites = {
      cream: makeSprite(C.cream), gold: makeSprite(C.gold),
      ice: makeSprite(C.ice), amber: makeSprite(C.amber)
    };

    var state = {
      L: null, orbits: null, dust: null, stars: [], ambient: [], twinkles: [],
            dynDpr: 1, animDpr: 1, surfaceSize: 0, labelW: 0, labelH: 0, off: { upper: 0, lower: 0 }, path: null,
      perf: 1, time: 0, last: 0, suppress: false,
      reduced: false, raf: 0, t0: 0, destroyed: false, resizeTimer: 0, lastKey: ""
    };

        // Device capability: tablets / low-core / low-memory devices get fewer particles and a lower DPR cap
    var nav = global.navigator || {};
    var lowPower = !!(global.matchMedia && global.matchMedia("(pointer: coarse)").matches) ||
      (nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory || 8) <= 4;

    var mq = global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : null;
    state.reduced = !!(mq && mq.matches);
    root.classList.toggle("cc-reduced", state.reduced);

    // ── Dust: clustered along selected stretches of each orbit
    function makeDust(L) {
      var rand = rng(4242);
            var per = clamp(Math.round(L.W * L.H / 3600 * L.perf), 160, 480);
      var out = { upper: [], lower: [] };
      ["upper", "lower"].forEach(function (name, oi) {
        var centres = [];
        for (var c = 0; c < 4; c++) centres.push([rand() * TAU, 0.35 + rand() * 0.35, 0.5 + rand() * 0.6]);
        centres[0] = oi ? [rad(172), 0.7, 1.9] : [rad(160), 0.6, 1.0];
        var ph = rand() * TAU;
        var density = function (th) {
          var v = 0.16 + 0.22 * (0.5 + 0.5 * Math.sin(5 * th + ph));
          for (var k = 0; k < centres.length; k++) {
            var d = angDiff(th, centres[k][0]) / centres[k][1];
            v += centres[k][2] * Math.exp(-d * d);
          }
          return v;
        };
        var cols = oi === 0 ? ["cream", "cream", "ice", "gold"] : ["gold", "gold", "cream", "amber", "ice"];
        var guard = 0;
        while (out[name].length < per && guard++ < per * 40) {
          var th = rand() * TAU;
          if (rand() * 1.5 > density(th)) continue;
          var gauss = (rand() + rand() + rand() - 1.5) * 0.9;
          out[name].push({
            th: th,
            rs: 1 + gauss * (rand() < 0.12 ? 0.04 : 0.011),
            lift: (rand() + rand() + rand() - 1.5) * 9,
            sp: 0.6 + rand() * 0.9,
            size: 0.55 + Math.pow(rand(), 2.2) * 1.9,
            a: 0.25 + rand() * 0.6,
            ph: rand() * TAU,
            col: cols[(rand() * cols.length) | 0]
          });
        }
      });
      return out;
    }

    function makeAmbient(L) {
      var rand = rng(777);
            var n = clamp(Math.round(L.W * L.H / 24000 * L.perf), 20, 80);
      var list = [];
      for (var i = 0; i < n; i++) {
        list.push({
          x: rand() * L.W, y: rand() * L.H,
          ax: 6 + rand() * 18, ay: 5 + rand() * 14,
          fx: 0.03 + rand() * 0.05, fy: 0.025 + rand() * 0.05,
          px: rand() * TAU, py: rand() * TAU,
          size: 0.5 + rand() * 1.1, a: 0.12 + rand() * 0.32,
          col: ["cream", "gold", "ice"][(rand() * 3) | 0]
        });
      }
      var tw = [];
      var tn = clamp(Math.round(L.W * L.H / 70000), 8, 24);
      for (var k = 0; k < tn; k++) {
        tw.push({
          x: rand() * L.W, y: rand() * L.H, size: 1.0 + rand() * 1.4,
          f: 0.25 + rand() * 0.5, ph: rand() * TAU, col: rand() < 0.3 ? "ice" : "cream"
        });
      }
      return { ambient: list, twinkles: tw };
    }

    // ── Full (re)build for a given size
    function rebuild() {
      var W = container.clientWidth, H = container.clientHeight;
      if (W < 40 || H < 40) return;
      var L = computeLayout(W, H);
      state.L = L;
            state.perf = lowPower ? 0.65 : 1;
      L.perf = state.perf;
      var dpr = Math.min(global.devicePixelRatio || 1, lowPower ? 1.5 : 2);
            state.dynDpr = dpr;
      state.animDpr = Math.min(global.devicePixelRatio || 1, lowPower ? 1 : 1.5);
      animCanvas.width = Math.round(W * state.animDpr);
      animCanvas.height = Math.round(H * state.animDpr);

      root.style.setProperty("--cc-d", (L.r * 2).toFixed(1) + "px");

      // Canvases
      paintBackground(bgCanvas, L, dpr, noise);
      [farCanvas, nearCanvas].forEach(function (cv) {
        cv.width = Math.round(W * state.dynDpr);
        cv.height = Math.round(H * state.dynDpr);
      });

      // Orbits
            state.orbits = { upper: makeOrbit(L.upper), lower: makeOrbit(L.lower) };
      // Fixed path samples used to map a drag position onto an orbit
      state.path = {};
      ["upper", "lower"].forEach(function (name) {
        var P = [];
        for (var pi = 0; pi < 360; pi++) { var pth = pi / 360 * TAU, pp = state.orbits[name].point(pth); P.push({ x: pp.x, y: pp.y, th: pth }); }
        state.path[name] = P;
      });
            var mu = buildOrbitMarkup(state.orbits.upper, ORBIT_STYLE.upper, L.u, L);
            var ml = buildOrbitMarkup(state.orbits.lower, ORBIT_STYLE.lower, L.u, L);

      function layerMarkup(half, glowKey, idp) {
        var s = '<g fill="none" stroke-linecap="butt">';
        s += '<g filter="url(#' + idp + '-gl)">' + mu[glowKey].join("") + ml[glowKey].join("") + "</g>";
        for (var b = 4; b >= 0; b--) {
          s += "<g" + (b > 0 ? ' filter="url(#' + idp + "-b" + b + ')"' : "") + ">" +
            mu[half][b].join("") + ml[half][b].join("") + "</g>";
        }
        return s + "</g>";
      }
      [svgFar, svgNear, starsFar, starsNear].forEach(function (sv) {
        sv.setAttribute("viewBox", "0 0 " + W + " " + H);
        sv.setAttribute("preserveAspectRatio", "none");
      });
      svgFar.innerHTML = defsMarkup(uid + "f", W, H, L.u) + layerMarkup("far", "glowFar", uid + "f");
      svgNear.innerHTML = defsMarkup(uid + "n", W, H, L.u) + layerMarkup("near", "glowNear", uid + "n");

      // Stars (one <g> each, moved between the far and near layers as they travel)
      starsFar.innerHTML = defsMarkup(uid + "sf", W, H, L.u);
      starsNear.innerHTML = defsMarkup(uid + "sn", W, H, L.u);
      state.stars = STARS.map(function (def) {
        var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.innerHTML = starMarkup(uid + "sf", def.tint, !!def.feature);
        return { def: def, g: g, layer: null, ph: rad(def.theta * 57.3) + def.size * 9 };
      });
      // Gradients are defined once per star SVG: rebuild markup per layer so ids resolve
      state.stars.forEach(function (s) { s.mk = { far: starMarkup(uid + "sf", s.def.tint, !!s.def.feature), near: starMarkup(uid + "sn", s.def.tint, !!s.def.feature) }; });

      // Central star
      starEl.style.transform = "translate(" + L.cx.toFixed(1) + "px," + L.cy.toFixed(1) + "px)";
            var surfPx = Math.round(L.r * 2 * 2.6 * dpr);
      if (Math.abs(surfPx - state.surfaceSize) > 24 || !state.surfaceSize) {
                paintStarSurface(surface, surfPx, noise, state.perf);
        state.surfaceSize = surfPx;
      }

      // Particles
      var key = Math.round(W / 40) + "x" + Math.round(H / 40);
      if (!state.dust || state.lastKey !== key) {
        state.dust = makeDust(L);
        var amb = makeAmbient(L);
        state.ambient = amb.ambient;
        state.twinkles = amb.twinkles;
        state.lastKey = key;
      }

      state.labelW = label.offsetWidth;
      state.labelH = label.offsetHeight;
            drawStatic();
      placeStars();
      render(state.time);
    }

    // ── Per-frame drawing
    function drawSprite(ctx, name, x, y, size, alpha) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprites[name], x - size, y - size, size * 2, size * 2);
    }

        // Static stardust: painted once per build, never redrawn per frame
    function drawStatic() {
      var L = state.L, dpr = state.dynDpr;
      [farCtx, nearCtx].forEach(function (c) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, c.canvas.width, c.canvas.height);
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.globalCompositeOperation = "lighter";
      });
      ["upper", "lower"].forEach(function (name) {
        var orbit = state.orbits[name], list = state.dust[name];
        for (var k = 0; k < list.length; k++) {
          var d = list[k];
          var pt = orbit.point(d.th, d.rs, d.lift * L.u);
          var n = 1 - pt.d;
          var nb = smooth(1.5, 0.75, Math.hypot(pt.x - L.cx, pt.y - L.cy) / L.r);
          var a = d.a * (0.28 + 0.85 * n) * (pt.z > 0 ? 0.7 : 1) * (1 - 0.55 * nb);
          var sz = (d.size * L.u * pt.s * (0.5 + 0.8 * n) * 1.9) + 0.5;
          drawSprite(pt.z > 0 ? farCtx : nearCtx, d.col, pt.x, pt.y, sz, a > 1 ? 1 : a);
        }
      });
      farCtx.globalAlpha = 1;
      nearCtx.globalAlpha = 1;
    }

    // Stars sit at (fixed angle + their orbit's drag offset); depth layer follows position
    function placeStars() {
      var L = state.L;
      if (!L) return;
      var W = L.W, H = L.H, i, featurePos = null;
      for (i = 0; i < state.stars.length; i++) {
        var s = state.stars[i], def = s.def;
        var pos = state.orbits[def.orbit].point(def.theta + state.off[def.orbit], 1, (def.lift || 0) * L.u);
        var nn = 1 - pos.d;
        var sc = def.size * L.u * pos.s * (0.6 + 0.55 * nn) * (def.feature ? 1.15 : 1);
        var layer = pos.z > 0 ? "far" : "near";
        if (s.layer !== layer) {
          s.g.innerHTML = s.mk[layer];
          (layer === "far" ? starsFar : starsNear).appendChild(s.g);
          s.layer = layer;
        }
        var hide = layer === "far" ? 1 - 0.6 * smooth(1.3, 0.6, Math.hypot(pos.x - L.cx, pos.y - L.cy) / L.r) : 1;
        s.g.setAttribute("transform", "translate(" + pos.x.toFixed(1) + " " + pos.y.toFixed(1) + ") scale(" + sc.toFixed(3) + ")");
        s.g.setAttribute("opacity", (clamp(0.42 + 0.58 * Math.pow(nn, 0.8), 0, 1) * hide).toFixed(3));
        if (def.feature) featurePos = { x: pos.x, y: pos.y, sc: sc, n: nn };
      }
      if (featurePos) {
        feature.style.transform = "translate(" + featurePos.x.toFixed(1) + "px," + featurePos.y.toFixed(1) + "px)";
        var lw = state.labelW, lh = state.labelH, pad = 14;
        var lx = clamp(featurePos.x - lw / 2, pad, W - lw - pad);
        var ly = clamp(featurePos.y + 26 * L.u + 14 * featurePos.sc, pad, H - lh - pad);
        label.style.transform = "translate(" + lx.toFixed(1) + "px," + ly.toFixed(1) + "px)";
        label.style.opacity = (0.32 + 0.26 * featurePos.n).toFixed(3);
      }
    }

    // Animated particles only: drifting motes and twinkles on one shared canvas
    function render(t) {
      var L = state.L;
      if (!L) return;
      var dpr = state.animDpr, c = animCtx, i, p, tw;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, animCanvas.width, animCanvas.height);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.globalCompositeOperation = "lighter";
      for (i = 0; i < state.ambient.length; i++) {
        p = state.ambient[i];
        drawSprite(c, p.col,
          p.x + Math.sin(t * p.fx + p.px) * p.ax, p.y + Math.cos(t * p.fy + p.py) * p.ay,
          p.size * 2.4 * L.u + 1, p.a);
      }
      for (i = 0; i < state.twinkles.length; i++) {
        p = state.twinkles[i];
        tw = 0.55 + 0.45 * Math.sin(t * p.f + p.ph);
        drawSprite(c, p.col, p.x, p.y, p.size * 3.2, 0.14 + 0.5 * tw);
      }
      c.globalAlpha = 1;
    }
    function loop(now) {
      if (state.destroyed) return;
      state.raf = global.requestAnimationFrame(loop);
      var dt = Math.min((now - state.last) / 1000, 0.1);
      if (dt * 1000 < (lowPower ? 40 : 28)) return;
      state.last = now;
      state.time += dt;
      render(state.time);
    }
    function start() {
      cancelAnimationFrame(state.raf);
      if (state.reduced || document.hidden) { render(state.time); return; }
      state.last = performance.now();
      state.raf = global.requestAnimationFrame(loop);
    }
    function onVis() {
      if (document.hidden) cancelAnimationFrame(state.raf); else start();
    }
    document.addEventListener("visibilitychange", onVis);

    // ── Drag along an orbit: the path is fixed, only the attached stars slide
    var drag = null;
    function localXY(e) {
      var b = root.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    }
    function nearest(name, x, y, around, span) {
      var P = state.path[name], best = -1, bd = 1e12;
      for (var i = 0; i < P.length; i++) {
        if (around !== undefined && Math.abs(angDiff(P[i].th, around)) > span) continue;
        var dx = P[i].x - x, dy = P[i].y - y, dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = i; }
      }
      return best < 0 ? null : { th: P[best].th, d: Math.sqrt(bd) };
    }
    function pickOrbit(p) {
      var tol = Math.max(22, 30 * state.L.u), pick = null;
      ["upper", "lower"].forEach(function (name) {
        var h = nearest(name, p.x, p.y);
        if (h && h.d < tol && (!pick || h.d < pick.d)) pick = { name: name, th: h.th, d: h.d };
      });
      return pick;
    }
    function onDown(e) {
      if (!state.L || (e.pointerType === "mouse" && e.button !== 0)) return;
      var p = localXY(e), pick = pickOrbit(p);
      if (!pick) return;
      drag = { id: e.pointerId, name: pick.name, x0: p.x, y0: p.y, last: pick.th, acc: 0, off0: state.off[pick.name], moved: false };
    }
    function onMove(e) {
      var p = localXY(e);
      if (!drag) {
        if (e.pointerType === "mouse" && state.L) root.style.cursor = pickOrbit(p) ? "grab" : "";
        return;
      }
      if (e.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.hypot(p.x - drag.x0, p.y - drag.y0) < 9) return;
        drag.moved = true;
        try { root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        root.classList.add("cc-dragging");
      }
      var h = nearest(drag.name, p.x, p.y, drag.last, rad(70));
      if (!h) return;
      drag.acc += angDiff(h.th, drag.last);
      drag.last = h.th;
      state.off[drag.name] = drag.off0 + drag.acc;
      placeStars();
      e.preventDefault();
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved) {
        state.suppress = true;
        setTimeout(function () { state.suppress = false; }, 0);
        try { root.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        root.classList.remove("cc-dragging");
      }
      drag = null;
    }
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    feature.addEventListener("click", function (e) {
      if (state.suppress) { e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);

    // ── Events
      
          
    function onMotionChange() {
      state.reduced = !!(mq && mq.matches);
      root.classList.toggle("cc-reduced", state.reduced);
      start();
    }
    if (mq) {
      if (mq.addEventListener) mq.addEventListener("change", onMotionChange);
      else if (mq.addListener) mq.addListener(onMotionChange);
    }

    var ro = null;
    function scheduleRebuild() {
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(function () { rebuild(); }, 120);
    }
    if (global.ResizeObserver) {
      ro = new ResizeObserver(scheduleRebuild);
      ro.observe(container);
    } else {
      global.addEventListener("resize", scheduleRebuild);
    }

    // Wait for the serif face so the label is measured correctly
    function boot() {
      rebuild();
      start();
    }
    if (document.fonts && document.fonts.load) {
      var fired = false;
      var go = function () { if (!fired) { fired = true; boot(); } };
      setTimeout(go, 600);
      document.fonts.load('400 20px "Cormorant Garamond"').then(go, go);
    } else {
      boot();
    }

    return {
      root: root,
      // The single designated feature control. No action is attached yet.
      featureButton: feature,
      resize: rebuild,
      destroy: function () {
                state.destroyed = true;
        document.removeEventListener("visibilitychange", onVis);
        root.removeEventListener("pointerdown", onDown);
        root.removeEventListener("pointermove", onMove);
        root.removeEventListener("pointerup", onUp);
        root.removeEventListener("pointercancel", onUp);
        cancelAnimationFrame(state.raf);
        clearTimeout(state.resizeTimer);
        if (ro) ro.disconnect(); else global.removeEventListener("resize", scheduleRebuild);
        if (mq) {
          if (mq.removeEventListener) mq.removeEventListener("change", onMotionChange);
          else if (mq.removeListener) mq.removeListener(onMotionChange);
        }
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  global.ChrysanthemumControlCentre = { mount: mount };
})(window);
