/* ═══════════════════════════════════════════
   CHRYSANTHEMUM — media.js
   Photo + voice-note upload and viewing.
   Security properties:
     - Media tokens live only in this closure (never localStorage/sessionStorage/cookies/window).
     - Upload tokens are single-use and fetched per upload; read tokens are cached in memory until ~30 s before expiry.
     - Photos are re-encoded through a canvas, which also strips EXIF/GPS metadata.
     - Fetched media is shown via blob: URLs that are revoked when the modal closes.
   ═══════════════════════════════════════════ */
"use strict";

window.ChrMedia = (function () {
  // ── CONFIG (both URLs are public identifiers, not secrets) ──
  const WORKER_URL      = "https://chrysanthemum-auth.crysanthemum-1801.workers.dev/";
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyT6Smk9lBPS-31w4lDtguDWTbGBYPOKi4fwr7kw_FaRRkjOulRRaH9csXdqYhUFidbmA/exec";

  // Client limits equal the server caps (Worker, Apps Script and Firestore rules use the same numbers).
  const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
  const MAX_AUDIO_BYTES = 2.5 * 1024 * 1024;
  const MAX_RECORD_MS   = 3 * 60 * 1000;
  const MAX_SOURCE_PHOTO_BYTES = 30 * 1024 * 1024;   // refuse to decode absurd inputs
  const MAX_MEDIA_PER_STAR = 3;                       // up to 3 attachments in any mix (equal to the firestore.rules cap)
  const MAX_CAPTION = 80;                             // optional caption length (equal to firestore.rules)

  const AUDIO_ALLOWED = ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm"];
  const IMAGE_ALLOWED = ["image/jpeg", "image/png", "image/webp"];
  const AUDIO_ALIASES = { "audio/mp3": "audio/mpeg", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav" };
  const ID_RE = /^[A-Za-z0-9_-]{20,80}$/;

  // ── In-memory state ──
  let readToken = null;             // { token, exp }
  let readTokenPromise = null;
  let viewGeneration = 0;           // bumps to cancel in-flight renders
  let objectUrls = [];
  let pending = [];                 // ordered attachments: { uid, blob, mime, kind, caption, state, error, uploaded, inflight, url, el }
  let recorder = null;              // { rec, stream, chunks, timer }
  let finishing = false;            // a recording is being stopped/processed
  let busy = false;                 // a star submit is in flight: attachments are frozen
  let issues = [];                  // failed attach attempts: { kind, msg }
  let uidSeq = 0, preparing = 0, uiGen = 0;   // preparing = files being re-encoded; uiGen cancels stale async work
  let viewer = null, audios = [], trayAudio = null;
  let issueAcked = false;           // user was told once; a second plant tap proceeds without the attachment

  const userError = (message) => Object.assign(new Error(message), { userMessage: message });

  // ───────────── tokens ─────────────
  async function fetchMediaToken(body) {
    const fb = window._firebase;
    if (!fb || !fb.auth || !fb.auth.currentUser) throw userError("please sign in again.");
    const idToken = await fb.auth.currentUser.getIdToken();
    let res;
    try {
      res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + idToken },
        body: JSON.stringify({ action: "mediaToken", ...body }),
        cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
      });
    } catch (_) { throw userError("couldn't reach the stars. try again."); }
    if (res.status === 401) throw userError("session expired. please reload and sign in again.");
    if (res.status === 429) throw userError("too many requests. wait a minute.");
    if (!res.ok) throw userError("media isn't available right now.");
    let data;
    try { data = await res.json(); } catch (_) { throw userError("media isn't available right now."); }
    if (!data || data.ok !== true || typeof data.mediaToken !== "string") throw userError("media isn't available right now.");
    return { token: data.mediaToken, exp: Date.now() + (Number(data.expiresIn) || 300) * 1000 };
  }

  async function getReadToken() {
    if (readToken && readToken.exp - Date.now() > 30000) return readToken.token;
    if (!readTokenPromise) {
      readTokenPromise = fetchMediaToken({ op: "read" })
        .then((t) => { readToken = t; return t.token; })
        .finally(() => { readTokenPromise = null; });
    }
    return readTokenPromise;
  }

  // ───────────── Apps Script calls ─────────────
  async function callAppsScript(payload, timeoutMs) {
    if (APPS_SCRIPT_URL.includes("REPLACE-WITH")) throw userError("media isn't set up yet.");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        // text/plain keeps this a "simple" request: Apps Script cannot answer CORS preflights.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: "follow", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
        signal: ctrl.signal
      });
    } catch (_) { throw userError("couldn't reach the media vault. try again."); }
    finally { clearTimeout(timer); }
    let data;
    try { data = await res.json(); } catch (_) { throw userError("the media vault answered strangely."); }
    if (!data || data.ok !== true) {
      if (data && data.code === "UNAUTHORIZED") readToken = null;   // drop a rejected/expired read token
      const isRead = payload && payload.action === "read";
      const map = { LIMIT: "daily upload limit reached.", UNSUPPORTED_TYPE: "that file type isn't supported.", BAD_PAYLOAD: "that file couldn't be accepted.",
        NOT_PRIVATE: isRead
          ? "this attachment isn't shown because storage isn't configured privately. it hasn't been deleted."   // refused to serve, not removed
          : "storage isn't configured privately.",
        // A read that fails for another reason must not read as "deleted": the file may simply be unavailable.
        NOT_FOUND: "this attachment couldn't be opened. it may be unavailable right now.",
        STORAGE_ERROR: "the media vault is having trouble right now. try again later.",
        SERVER_ERROR: "the media vault had a problem. try again later.",
        UNAUTHORIZED: "access to the media vault couldn't be confirmed. try again." };
      throw userError((data && map[data.code]) || "the media vault refused that request.");
    }
    return data;
  }

  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = () => reject(new Error("read-failed"));
    r.readAsDataURL(blob);
  });

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function uploadOne(item) {
    if (item.uploaded) return item.uploaded;                 // retry after a failed addDoc must not re-upload
    const t = await fetchMediaToken({ op: "upload", mime: item.mime, bytes: item.blob.size });
    const data = await callAppsScript({
      action: "upload", token: t.token, mimeType: item.mime, base64: await blobToBase64(item.blob)
    }, 90000);
    if (!ID_RE.test(String(data.fileId || ""))) throw userError("the media vault answered strangely.");
    item.uploaded = { id: data.fileId, kind: item.kind, mime: item.mime, bytes: item.blob.size };
    return item.uploaded;
  }

  // Uploads one attachment at a time, tracking its state. A finished upload is cached on the item and an
  // in-flight upload is shared, so a retry or a second plant tap can never upload the same file twice.
  function uploadTracked(item) {
    if (item.uploaded) { if (item.state !== "done") { item.state = "done"; paintItem(item); } return Promise.resolve(item.uploaded); }
    if (item.inflight) return item.inflight;
    item.state = "uploading"; item.error = ""; paintItem(item);
    item.inflight = uploadOne(item).then(
      (u) => { item.inflight = null; item.state = "done"; paintItem(item); return u; },
      (e) => {
        item.inflight = null; item.state = "failed";
        item.error = ((e && e.userMessage) || "couldn't send this one.").replace(/\.$/, "");
        paintItem(item); throw e;
      });
    return item.inflight;
  }

  function descriptor(item) {
    const d = { ...item.uploaded };
    const cap = String(item.caption || "").trim().slice(0, MAX_CAPTION);
    if (cap) d.cap = cap;                                     // field is omitted when there is no caption
    return d;
  }

  // Uploads whatever is pending (sequentially, in the chosen order) and returns descriptors for the star document.
  async function uploadPending(onStatus) {
    if (pending.length > MAX_MEDIA_PER_STAR) throw userError("too many attachments.");
    const out = [];
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      if (onStatus && !item.uploaded) onStatus("sending attachment " + (i + 1) + " of " + pending.length + "…");
      await uploadTracked(item);
      out.push(descriptor(item));
    }
    return out;
  }

  // ───────────── photo preparation ─────────────
  async function decodeImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) { /* fall through */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode-failed")); };
      img.src = url;
    });
  }

  const canvasToBlob = (canvas, q) => new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", q));

  async function preparePhoto(file) {
    if (!file) throw userError("no photo chosen.");
    if (file.size > MAX_SOURCE_PHOTO_BYTES) throw userError("that photo is too large.");
    let src;
    try { src = await decodeImage(file); } catch (_) { throw userError("that photo couldn't be read. try a JPEG or PNG."); }
    const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    if (!w0 || !h0) throw userError("that photo couldn't be read.");
    let maxEdge = 1600, quality = 0.82, blob = null;
    for (let attempt = 0; attempt < 5 && (!blob || blob.size > MAX_PHOTO_BYTES); attempt++) {
      const scale = Math.min(1, maxEdge / Math.max(w0, h0));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      const c = canvas.getContext("2d");
      c.fillStyle = "#000"; c.fillRect(0, 0, canvas.width, canvas.height);   // flatten transparency
      c.drawImage(src, 0, 0, canvas.width, canvas.height);
      blob = await canvasToBlob(canvas, quality);                              // re-encode => EXIF/GPS dropped
      quality = Math.max(0.5, quality - 0.1); maxEdge = Math.round(maxEdge * 0.85);
    }
    if (src.close) src.close();
    if (!blob || blob.size > MAX_PHOTO_BYTES) throw userError("that photo is too large even after shrinking.");
    return { blob, mime: "image/jpeg", kind: "image" };
  }

  // ───────────── audio preparation / recording ─────────────
  function normalizeAudioMime(m) {
    const base = String(m || "").toLowerCase().split(";")[0].trim();
    return AUDIO_ALIASES[base] || base;
  }

  function prepareAudio(blobOrFile) {
    const mime = normalizeAudioMime(blobOrFile.type);
    if (AUDIO_ALLOWED.indexOf(mime) === -1) throw userError("that audio type isn't supported.");
    if (blobOrFile.size > MAX_AUDIO_BYTES) throw userError("that recording is too large (about 2.5 MB max).");
    if (blobOrFile.size < 1) throw userError("that recording is empty.");
    return { blob: blobOrFile, mime, kind: "audio" };
  }

  function pickRecorderMime() {
    if (!window.MediaRecorder) return null;
    const cands = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
    return cands.find((c) => MediaRecorder.isTypeSupported(c)) || "";
  }

  async function startRecording(onAutoStop) {
    if (recorder) return;
    const mimeType = pickRecorderMime();
    if (mimeType === null) throw userError("recording isn't supported in this browser.");
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (_) { throw userError("microphone access was not allowed."); }
    const rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 });
    const chunks = [];
    let total = 0, stopped = false;
    const autoStop = () => { if (!stopped) { stopped = true; if (onAutoStop) onAutoStop(); } };
    // Some browsers ignore audioBitsPerSecond; stop before the recording can exceed the size cap.
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) { chunks.push(e.data); total += e.data.size; }
      if (total >= MAX_AUDIO_BYTES - 150 * 1024) autoStop();
    };
    recorder = { rec, stream, chunks, timer: setTimeout(autoStop, MAX_RECORD_MS) };
    rec.start(1000);
  }

  function stopRecording() {
    return new Promise((resolve, reject) => {
      if (!recorder) return reject(userError("not recording."));
      const { rec, stream, chunks, timer } = recorder;
      recorder = null;
      clearTimeout(timer);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: normalizeAudioMime(rec.mimeType) || "audio/webm" });
        try { resolve(prepareAudio(blob)); } catch (e) { reject(e); }
      };
      try { rec.stop(); } catch (e) { stream.getTracks().forEach((t) => t.stop()); reject(e); }
    });
  }

  // ───────────── creation-modal wiring ─────────────
  const $ = (id) => document.getElementById(id);

  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmtBytes = (n) => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB";
  const fmtTime = (s) => { if (!isFinite(s) || s < 0) return "–:–"; const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ":" + (r < 10 ? "0" : "") + r; };
  const statusMsg = (m) => { const n = $("media-status"); if (n) n.textContent = m || ""; };

  const SVGNS = "http://www.w3.org/2000/svg";
  const ICON_PATHS = { play: ["M8 5.5v13l11-6.5z"], pause: ["M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"] };
  function icon(name) {                                       // built with DOM calls only: no innerHTML anywhere
    const s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
    ICON_PATHS[name].forEach((d) => { const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", d); s.appendChild(p); });
    return s;
  }

  const STATE_TEXT = { waiting: "waiting to send", uploading: "sending…", done: "sent" };

  function newItem(prepared) {
    return { uid: ++uidSeq, blob: prepared.blob, mime: prepared.mime, kind: prepared.kind, caption: "", capOpen: false,
             state: "waiting", error: "", uploaded: null, inflight: null, url: URL.createObjectURL(prepared.blob), el: null };
  }

  function setEnabled(node, on) {
    if (!node) return;
    node.disabled = !on;
    (node.closest(".media-act") || node).classList.toggle("is-off", !on);
  }

  function refreshControls() {
    const reserved = pending.length + preparing + (recorder || finishing ? 1 : 0);
    const free = !busy && !finishing && reserved < MAX_MEDIA_PER_STAR;
    setEnabled($("input-photo"), free);
    setEnabled($("input-audio"), free);
    setEnabled($("record-audio-btn"), !busy && !finishing && (!!recorder || free));
  }

  function setRecordLabel(on) {
    const l = $("record-audio-label"); if (l) l.textContent = on ? "stop" : "record";
    const b = $("record-audio-btn"); if (b) { b.classList.toggle("rec", !!on); b.setAttribute("aria-pressed", String(!!on)); }
  }

  // Small local preview of a selected voice note (separate from the memory-modal players).
  function stopTrayAudio() {
    if (!trayAudio) return;
    const t = trayAudio; trayAudio = null;
    try { t.audio.pause(); } catch (_) {}
    t.btn.replaceChildren(icon("play")); t.btn.setAttribute("aria-label", "play voice note");
  }
  function toggleTrayAudio(item, btn) {
    if (trayAudio && trayAudio.item === item) return stopTrayAudio();
    stopTrayAudio();
    const audio = new Audio(item.url);
    trayAudio = { item, audio, btn };
    btn.replaceChildren(icon("pause")); btn.setAttribute("aria-label", "pause voice note");
    const own = () => trayAudio && trayAudio.audio === audio;
    audio.addEventListener("ended", () => { if (own()) stopTrayAudio(); });
    audio.addEventListener("error", () => { if (own()) { stopTrayAudio(); statusMsg("that voice note couldn't be played."); } });
    const p = audio.play(); if (p && p.catch) p.catch(() => { if (own()) stopTrayAudio(); });
  }

  function buildTrayItem(item, i) {
    const li = mk("li", "tray-item");
    li.dataset.state = item.state;
    item.el = li;
    const isImg = item.kind === "image";
    const thumb = mk("button", "tray-thumb" + (isImg ? "" : " aud")); thumb.type = "button"; thumb.disabled = busy;
    if (isImg) {
      const img = mk("img"); img.src = item.url; img.alt = ""; thumb.appendChild(img);
      thumb.setAttribute("aria-label", "preview photo " + (i + 1));
      thumb.addEventListener("click", () => openTrayViewer(item, thumb));
    } else {
      thumb.appendChild(icon("play")); thumb.setAttribute("aria-label", "play voice note");
      thumb.addEventListener("click", () => toggleTrayAudio(item, thumb));
    }
    const meta = mk("div", "tray-meta");
    meta.appendChild(mk("span", "tray-name", (isImg ? "photo " : "voice note ") + (i + 1) + " · " + fmtBytes(item.blob.size)));
    meta.appendChild(mk("span", "tray-state", item.state === "failed" ? "failed: " + (item.error || "couldn't send") : STATE_TEXT[item.state]));
    const ctl = mk("div", "tray-ctl");
    const btn = (act, label, text, fn, off) => {
      const b = mk("button", "tray-btn" + (act === "retry" ? " retry" : ""), text);
      b.type = "button"; b.dataset.act = act; b.setAttribute("aria-label", label); b.disabled = busy || !!off;
      b.addEventListener("click", fn); return b;
    };
    if (item.state === "failed") ctl.appendChild(btn("retry", "retry sending this attachment", "retry", () => retryItem(item)));
    ctl.append(
      btn("up", "move earlier", "↑", () => moveItem(item, -1), i === 0),
      btn("down", "move later", "↓", () => moveItem(item, 1), i === pending.length - 1),
      btn("cap", "add a caption", "✎", () => openCaption(item)),
      btn("remove", "remove this attachment", "✕", () => removeItem(item)));
    li.append(thumb, meta, ctl);
    if (item.capOpen || item.caption) {
      const wrap = mk("div", "tray-cap");
      const inp = mk("input"); inp.type = "text"; inp.maxLength = MAX_CAPTION; inp.autocomplete = "off";
      inp.placeholder = "add a caption (optional)"; inp.value = item.caption; inp.disabled = busy;
      inp.setAttribute("aria-label", "caption for attachment " + (i + 1));
      inp.addEventListener("input", () => { item.caption = inp.value; });
      wrap.appendChild(inp); li.appendChild(wrap);
    }
    return li;
  }

  function renderTray() {
    const tray = $("media-tray");
    if (tray) {
      stopTrayAudio();
      const nodes = pending.map(buildTrayItem);
      for (let k = 0; k < preparing; k++) {
        const s = mk("li", "tray-item tray-skel media-loading"); s.appendChild(mk("span", "tray-state", "preparing…")); nodes.push(s);
      }
      tray.replaceChildren(...nodes);
      tray.classList.toggle("is-busy", busy);
    }
    refreshControls();
  }

  // Repaints one item (state change) without touching the others, so a caption being typed elsewhere keeps focus.
  function paintItem(item) {
    if (trayAudio && trayAudio.item === item) stopTrayAudio();
    const i = pending.indexOf(item);
    if (i < 0 || !item.el || !item.el.parentNode) return;
    item.el.replaceWith(buildTrayItem(item, i));
  }

  function retryItem(item) {
    if (busy || item.inflight || item.state !== "failed") return;
    statusMsg("");
    uploadTracked(item).catch(() => { /* shown on the item */ });
  }

  function moveItem(item, d) {
    if (busy) return;
    const i = pending.indexOf(item), j = i + d;
    if (i < 0 || j < 0 || j >= pending.length) return;
    pending.splice(i, 1); pending.splice(j, 0, item);
    renderTray();
    const first = item.el && item.el.querySelector('[data-act="' + (d < 0 ? "up" : "down") + '"]');
    const other = item.el && item.el.querySelector('[data-act="' + (d < 0 ? "down" : "up") + '"]');
    const f = first && !first.disabled ? first : other;
    if (f && !f.disabled) f.focus();
  }

  function removeItem(item) {
    if (busy) return;
    const i = pending.indexOf(item);
    if (i < 0) return;
    pending.splice(i, 1);
    URL.revokeObjectURL(item.url);
    statusMsg("");
    renderTray();
    const t = $("media-tray"), next = t && t.children[Math.min(i, pending.length - 1)];
    const f = next && next.querySelector('[data-act="remove"]');
    if (f && !f.disabled) f.focus();
  }

  function openCaption(item) {
    if (busy) return;
    item.capOpen = true; renderTray();
    const inp = item.el && item.el.querySelector(".tray-cap input");
    if (inp) inp.focus();
  }

  function openTrayViewer(item, returnEl) {
    const photos = pending.filter((p) => p.kind === "image");
    openViewer(photos.map((p) => ({ get: () => Promise.resolve(p.url), cap: p.caption })), photos.indexOf(item), returnEl, "tray");
  }

  function resetCreationUi() {
    uiGen++; preparing = 0;
    closeViewer(); stopTrayAudio();
    if (recorder) { clearTimeout(recorder.timer); try { recorder.rec.stop(); } catch (_) {} recorder.stream.getTracks().forEach((t) => t.stop()); recorder = null; }
    pending.forEach((i) => URL.revokeObjectURL(i.url));
    pending = [];
    issues = []; issueAcked = false; finishing = false; busy = false;
    ["input-photo", "input-audio"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
    statusMsg(""); setRecordLabel(false);
    renderTray();
  }

  function setBusy(on) { busy = !!on; renderTray(); }

  // Called before a star is planted. Returns a message when planting must pause, else null.
  function preflight() {
    if (recorder || finishing) return "stop the recording first, then plant the star.";
    if (preparing) return "your attachments are still being prepared. one moment, then plant the star.";
    if (pending.some((i) => i.inflight)) return "an attachment is still sending. one moment, then plant the star.";
    if (issues.length && !issueAcked) {
      issueAcked = true;
      const more = issues.length > 1;
      return issues[0].msg + (more ? " (and " + (issues.length - 1) + " more)" : "") +
        " tap plant again to plant the star without " + (more ? "them" : "it") + ", or choose another file.";
    }
    return null;
  }

  function failedAttach(kind, e, fallback) {
    const msg = (e && e.userMessage) || fallback;
    issues.push({ kind, msg: "a " + (kind === "image" ? "photo" : "voice note") + " wasn't attached (" + msg.replace(/\.$/, "") + ")." });
    issueAcked = false; statusMsg(msg);
  }

  // Prepares each chosen file (photos are re-encoded: EXIF/GPS dropped) and adds it, in order, to the tray.
  async function addFiles(kind, files) {
    const gen = uiGen;
    statusMsg(""); issues = issues.filter((i) => i.kind !== kind);
    const room = Math.max(0, MAX_MEDIA_PER_STAR - pending.length - preparing - (recorder || finishing ? 1 : 0));
    const take = files.slice(0, room);
    if (!take.length) { if (files.length) statusMsg("one star holds up to " + MAX_MEDIA_PER_STAR + " attachments."); return; }
    preparing += take.length; renderTray();
    for (const file of take) {
      let prepared = null;
      try { prepared = kind === "image" ? await preparePhoto(file) : prepareAudio(file); }
      catch (e) { if (gen === uiGen) failedAttach(kind, e, kind === "image" ? "that photo couldn't be used." : "that audio couldn't be used."); }
      if (gen !== uiGen) return;
      preparing--;
      if (prepared) pending.push(newItem(prepared));
      renderTray();
    }
    if (files.length > take.length) statusMsg("one star holds up to " + MAX_MEDIA_PER_STAR + " attachments; the rest weren't added.");
  }

  function initCreationUi() {
    const photoIn = $("input-photo"), audioIn = $("input-audio"), recBtn = $("record-audio-btn");
    if (!photoIn || !audioIn || !recBtn) return;   // media UI not present in this page version

    const onPick = (kind, input) => () => {
      const files = Array.from(input.files || []);
      input.value = "";                              // the same file can be chosen again later
      if (!busy && files.length) addFiles(kind, files);
    };
    photoIn.addEventListener("change", onPick("image", photoIn));
    audioIn.addEventListener("change", onPick("audio", audioIn));

    const finishRecording = async () => {
      if (!recorder) return;                         // already stopped or modal reset: nothing to finish
      const gen = uiGen;
      finishing = true; refreshControls();
      try {
        const prepared = await stopRecording();
        if (gen === uiGen) { issues = issues.filter((i) => i.kind !== "audio"); pending.push(newItem(prepared)); statusMsg(""); }
      } catch (e) { if (gen === uiGen) failedAttach("audio", e, "recording failed."); }
      if (gen !== uiGen) return;
      finishing = false; setRecordLabel(false); renderTray();
    };
    recBtn.addEventListener("click", async () => {
      if (busy || finishing) return;
      statusMsg(""); issues = issues.filter((i) => i.kind !== "audio");
      if (recorder) return finishRecording();
      if (pending.length + preparing >= MAX_MEDIA_PER_STAR) { statusMsg("one star holds up to " + MAX_MEDIA_PER_STAR + " attachments."); return; }
      stopTrayAudio();
      try { await startRecording(finishRecording); setRecordLabel(true); refreshControls(); }
      catch (e) { failedAttach("audio", e, "recording failed."); }
    });
    renderTray();
  }

  // ───────────── memory-modal rendering ─────────────
  function validItem(m) {
    return m && typeof m === "object" && ID_RE.test(String(m.id)) &&
      ((m.kind === "image" && IMAGE_ALLOWED.indexOf(m.mime) !== -1) ||
       (m.kind === "audio" && AUDIO_ALLOWED.indexOf(m.mime) !== -1));
  }

  function clearView(container) {
    viewGeneration++;
    if (viewer && viewer.scope === "view") closeViewer();
    audios.forEach((a) => { try { a.pause(); } catch (_) {} });
    audios = [];
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls = [];
    if (container) container.replaceChildren();
  }

  const retryBtn = (fn) => { const b = mk("button", "media-retry", "retry"); b.type = "button"; b.addEventListener("click", fn); return b; };
  function showFail(box, msg, again) {
    box.classList.remove("media-loading"); box.classList.add("is-fail");
    box.replaceChildren(mk("span", "media-note", msg), retryBtn(again));
  }

  // Fetches one attachment through the existing token + Apps Script read path. One shared request per item.
  function loadRec(rec, gen) {
    if (rec.url) return Promise.resolve(rec.url);
    if (!rec.p) {
      rec.p = (async () => {
        const token = await getReadToken();
        const data = await callAppsScript({ action: "read", token, fileId: rec.m.id }, 60000);
        if (gen !== viewGeneration) throw Object.assign(new Error("cancelled"), { cancelled: true });   // modal closed or changed meanwhile
        const url = URL.createObjectURL(base64ToBlob(data.base64, rec.m.mime));                          // trust our allow-listed descriptor, not the response
        objectUrls.push(url);
        rec.url = url;
        return url;
      })().finally(() => { rec.p = null; });
    }
    return rec.p;
  }

  function buildGrid(photos, gen) {
    const grid = mk("div", "photo-grid");
    grid.dataset.n = String(photos.length);
    photos.forEach((rec, i) => {
      const tile = mk("div", "photo-tile");
      const fill = async () => {
        tile.className = "photo-tile media-loading";
        tile.replaceChildren(mk("span", "media-note", "loading photo…"));
        try {
          const url = await loadRec(rec, gen);
          if (gen !== viewGeneration) return;
          const open = mk("button", "photo-open"); open.type = "button";
          open.setAttribute("aria-label", "open photo " + (i + 1) + " of " + photos.length + (rec.cap ? ": " + rec.cap : ""));
          const img = mk("img"); img.alt = ""; img.decoding = "async";
          img.addEventListener("error", () => { rec.url = null; if (gen === viewGeneration) showFail(tile, "this photo couldn't be displayed.", fill); });
          img.src = url;
          open.appendChild(img);
          open.addEventListener("click", () => openViewer(
            photos.map((r) => ({ get: (force) => { if (force) r.url = null; return loadRec(r, gen); }, cap: r.cap })), i, open, "view"));
          tile.className = "photo-tile";
          tile.replaceChildren(open);
        } catch (e) {
          if (gen !== viewGeneration) return;
          showFail(tile, (e && e.userMessage) || "this photo couldn't be loaded.", fill);
        }
      };
      grid.appendChild(tile); fill();
    });
    return grid;
  }

  function mountPlayer(box, url, rec, label, reload) {
    const audio = new Audio();                       // never autoplays; metadata only until the person presses play
    audio.preload = "metadata";
    audios.push(audio);
    const play = mk("button", "voice-play"); play.type = "button";
    play.setAttribute("aria-label", "play " + label); play.appendChild(icon("play"));
    const wave = mk("div", "voice-wave");
    let h = Array.from(rec.m.id).reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
    for (let k = 0; k < 32; k++) {                   // decorative, deterministic bars (not real audio analysis)
      h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
      const b = mk("i"); b.style.setProperty("--h", (28 + ((h >>> 16) % 72)) + "%"); b.style.setProperty("--i", String(k)); wave.appendChild(b);
    }
    const bars = wave.querySelectorAll("i");
    const seek = mk("input", "voice-seek"); seek.type = "range"; seek.min = "0"; seek.max = "1000"; seek.step = "1"; seek.value = "0"; seek.disabled = true;
    seek.setAttribute("aria-label", "seek " + label);
    wave.appendChild(seek);
    const time = mk("div", "voice-time"), cur = mk("span", null, "0:00"), dur = mk("span", null, "–:–");
    time.append(cur, dur);
    box.append(play, wave, time);
    if (rec.cap) box.appendChild(mk("p", "voice-cap", rec.cap));

    let seeking = false, fixing = false;
    const paint = () => {
      const d = audio.duration, ok = isFinite(d) && d > 0;
      const frac = ok ? Math.min(1, audio.currentTime / d) : 0;
      const lit = Math.round(frac * bars.length);
      bars.forEach((b, k) => b.classList.toggle("on", k < lit));
      cur.textContent = fmtTime(audio.currentTime); dur.textContent = ok ? fmtTime(d) : "–:–";
      if (!seeking) seek.value = String(Math.round(frac * 1000));
      seek.disabled = !ok;
    };
    audio.addEventListener("loadedmetadata", () => {
      if (audio.duration === Infinity) {             // some recorders write no duration: make the browser work it out
        fixing = true; audio.currentTime = 1e101;
        audio.addEventListener("timeupdate", function f() { audio.removeEventListener("timeupdate", f); audio.currentTime = 0; fixing = false; paint(); });
      }
      paint();
    });
    audio.addEventListener("durationchange", paint);
    audio.addEventListener("timeupdate", () => { if (!fixing) paint(); });
    audio.addEventListener("play", () => {
      audios.forEach((o) => { if (o !== audio) o.pause(); });    // only one voice note plays at a time
      box.classList.add("playing"); play.replaceChildren(icon("pause")); play.setAttribute("aria-label", "pause " + label);
    });
    const idle = () => { box.classList.remove("playing"); play.replaceChildren(icon("play")); play.setAttribute("aria-label", "play " + label); };
    audio.addEventListener("pause", idle);
    audio.addEventListener("ended", () => { idle(); audio.currentTime = 0; paint(); });
    audio.addEventListener("error", () => { box.classList.remove("playing"); showFail(box, "this voice note couldn't be played.", reload); });
    play.addEventListener("click", () => {
      if (audio.paused) { const p = audio.play(); if (p && p.catch) p.catch(() => {}); } else audio.pause();
    });
    seek.addEventListener("input", () => {
      seeking = true;
      if (isFinite(audio.duration)) { audio.currentTime = (Number(seek.value) / 1000) * audio.duration; paint(); }
    });
    seek.addEventListener("change", () => { seeking = false; });
    audio.src = url;
  }

  function buildVoices(voices, gen) {
    const list = mk("div", "voice-list");
    voices.forEach((rec, i) => {
      const box = mk("div", "voice");
      const fill = async () => {
        box.className = "voice media-loading";
        box.replaceChildren(mk("span", "media-note", "loading voice note…"));
        try {
          const url = await loadRec(rec, gen);
          if (gen !== viewGeneration) return;
          box.className = "voice"; box.replaceChildren();
          mountPlayer(box, url, rec, "voice note " + (i + 1), () => { rec.url = null; fill(); });
        } catch (e) {
          if (gen !== viewGeneration) return;
          showFail(box, (e && e.userMessage) || "this voice note couldn't be loaded.", fill);
        }
      };
      list.appendChild(box); fill();
    });
    return list;
  }

  function mediaGroup(label, n, showHead, body) {
    const g = mk("section", "media-group");
    if (showHead) { const h = mk("div", "media-group-head"); h.append(mk("span", null, label), mk("b", null, String(n))); g.appendChild(h); }
    g.appendChild(body);
    return g;
  }

  async function renderInto(container, mediaList) {
    clearView(container);
    if (!container || !Array.isArray(mediaList)) return;
    const gen = viewGeneration;
    const recs = mediaList.slice(0, MAX_MEDIA_PER_STAR).filter(validItem)
      .map((m) => ({ m, url: null, p: null, cap: typeof m.cap === "string" ? m.cap.slice(0, MAX_CAPTION) : "" }));   // order preserved
    const photos = recs.filter((r) => r.m.kind === "image"), voices = recs.filter((r) => r.m.kind === "audio");
    const both = photos.length > 0 && voices.length > 0;
    if (photos.length) {
      const g = mediaGroup(photos.length === 1 ? "photo" : "photos", photos.length, both || photos.length > 1, buildGrid(photos, gen));
      if (photos.length === 1 && photos[0].cap) g.appendChild(mk("p", "media-cap", photos[0].cap));
      container.appendChild(g);
    }
    if (voices.length) container.appendChild(mediaGroup(voices.length === 1 ? "voice note" : "voice notes", voices.length, both || voices.length > 1, buildVoices(voices, gen)));
  }

  // ───────────── immersive photo viewer (no dependencies) ─────────────
  function closeViewer() {
    if (!viewer) return;
    const v = viewer; viewer = null;
    window.removeEventListener("keydown", v.onKey, true);
    v.root.remove();
    if (v.ret && v.ret.isConnected) { try { v.ret.focus(); } catch (_) {} }
  }

  // items: [{ get(force) -> Promise<blob URL>, cap }]. scope "view" closes with the memory modal; "tray" with the creation modal.
  function openViewer(items, index, returnEl, scope) {
    closeViewer();
    if (!items.length) return;
    const n = items.length;
    let idx = Math.max(0, Math.min(n - 1, index | 0)), token = 0, img = null, z = { s: 1, x: 0, y: 0 };

    const root = mk("div", "cv"); root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "photo viewer");
    const top = mk("div", "cv-top"), pos = mk("span", "cv-pos");
    const close = mk("button", "cv-btn cv-close", "✕"); close.type = "button"; close.setAttribute("aria-label", "close viewer");
    top.append(pos, close);
    const stage = mk("div", "cv-stage"), slide = mk("div", "cv-slide");
    const prev = mk("button", "cv-btn cv-nav cv-prev", "‹"), next = mk("button", "cv-btn cv-nav cv-next", "›");
    prev.type = next.type = "button"; prev.setAttribute("aria-label", "previous photo"); next.setAttribute("aria-label", "next photo");
    stage.append(slide); if (n > 1) stage.append(prev, next);
    const bottom = mk("div", "cv-bottom"), cap = mk("p", "cv-cap"), dots = mk("div", "cv-dots");
    for (let k = 0; k < n && n > 1; k++) {
      const d = mk("button", "cv-dot"); d.type = "button"; d.setAttribute("aria-label", "go to photo " + (k + 1));
      d.addEventListener("click", () => go(k)); dots.appendChild(d);
    }
    bottom.append(cap, dots);
    root.append(top, stage, bottom);

    const apply = () => { if (img) img.style.transform = "translate(" + z.x + "px," + z.y + "px) scale(" + z.s + ")"; };
    const clampZ = () => {
      z.s = Math.max(1, Math.min(5, z.s));
      const mx = (z.s - 1) * stage.clientWidth / 2, my = (z.s - 1) * stage.clientHeight / 2;
      z.x = z.s === 1 ? 0 : Math.max(-mx, Math.min(mx, z.x));
      z.y = z.s === 1 ? 0 : Math.max(-my, Math.min(my, z.y));
      apply();
    };
    const fail = (msg) => { img = null; slide.className = "cv-slide"; slide.replaceChildren(mk("span", "media-note", msg), retryBtn(() => show(true))); };
    const show = async (force) => {
      const my = ++token, it = items[idx];
      img = null; z = { s: 1, x: 0, y: 0 };
      pos.textContent = (idx + 1) + " / " + n;
      cap.textContent = it.cap || "";
      prev.disabled = idx === 0; next.disabled = idx === n - 1;
      Array.from(dots.children).forEach((d, k) => { d.classList.toggle("on", k === idx); d.setAttribute("aria-current", k === idx ? "true" : "false"); });
      slide.className = "cv-slide media-loading"; slide.style.transform = "";
      slide.replaceChildren(mk("span", "media-note", "loading photo…"));
      try {
        const url = await it.get(force);
        if (my !== token || viewer !== v) return;
        const im = mk("img", "cv-img"); im.alt = it.cap || "photo " + (idx + 1) + " of " + n; im.draggable = false;
        im.addEventListener("error", () => { if (my === token && viewer === v) fail("this photo couldn't be displayed."); });
        im.src = url; img = im;
        slide.className = "cv-slide"; slide.replaceChildren(im);
      } catch (e) {
        if (my === token && viewer === v) fail((e && e.userMessage) || "this photo couldn't be loaded.");
      }
    };
    const go = (k) => { if (k < 0 || k >= n || k === idx) return; idx = k; show(false); };
    close.addEventListener("click", closeViewer);
    prev.addEventListener("click", () => go(idx - 1));
    next.addEventListener("click", () => go(idx + 1));

    // touch / mouse: swipe to navigate, pinch or double-tap to zoom, drag to pan while zoomed, wheel to zoom
    const pts = new Map();
    let g = null, lastTap = 0, sdx = 0, sdy = 0;
    const dist = () => { const [a, b] = Array.from(pts.values()); return Math.hypot(a.x - b.x, a.y - b.y); };
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      g = { s: z.s, x: z.x, y: z.y, px: e.clientX, py: e.clientY, d: pts.size === 2 ? dist() : 0, moved: pts.size === 2 };
      sdx = sdy = 0;
      if (img) img.classList.add("moving");
    });
    stage.addEventListener("pointermove", (e) => {
      if (!g || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { if (g.d) { z.s = g.s * dist() / g.d; g.moved = true; clampZ(); } return; }
      const dx = e.clientX - g.px, dy = e.clientY - g.py;
      if (Math.abs(dx) + Math.abs(dy) > 8) g.moved = true;
      if (z.s > 1) { z.x = g.x + dx; z.y = g.y + dy; clampZ(); }
      else { sdx = dx; sdy = dy; slide.style.transform = "translateX(" + dx * 0.4 + "px)"; }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size > 0) { const p = Array.from(pts.values())[0]; g = { s: z.s, x: z.x, y: z.y, px: p.x, py: p.y, d: 0, moved: true }; return; }
      const was = g; g = null;
      if (img) img.classList.remove("moving");
      slide.style.transform = "";
      if (!was) return;
      if (z.s === 1 && was.moved && Math.abs(sdx) > 50 && Math.abs(sdx) > Math.abs(sdy)) { go(idx + (sdx < 0 ? 1 : -1)); }
      else if (!was.moved && e.type === "pointerup" && img) {
        const now = Date.now();
        if (now - lastTap < 320) {
          lastTap = 0;
          if (z.s > 1) { z = { s: 1, x: 0, y: 0 }; }
          else { const r = stage.getBoundingClientRect(); z = { s: 2.5, x: (r.left + r.width / 2 - e.clientX) * 1.5, y: (r.top + r.height / 2 - e.clientY) * 1.5 }; }
          clampZ();
        } else lastTap = now;
      }
      sdx = sdy = 0;
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("wheel", (e) => { if (!img) return; e.preventDefault(); z.s *= e.deltaY < 0 ? 1.15 : 1 / 1.15; clampZ(); }, { passive: false });

    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeViewer(); }   // closes only the viewer, not the modal behind it
      else if (e.key === "ArrowLeft") { e.stopImmediatePropagation(); go(idx - 1); }
      else if (e.key === "ArrowRight") { e.stopImmediatePropagation(); go(idx + 1); }
      else if (e.key === "Tab") {
        const f = Array.from(root.querySelectorAll("button:not(:disabled)"));
        if (!f.length) return;
        const a = document.activeElement;
        if (!root.contains(a) || (e.shiftKey && a === f[0])) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
        else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    const v = { root, ret: returnEl, scope, onKey };
    viewer = v;
    window.addEventListener("keydown", onKey, true);
    document.body.appendChild(root);
    close.focus();
    show(false);
  }

  // ───────────── lifecycle ─────────────
  function clearAll() {
    readToken = null; readTokenPromise = null;
    clearView($("modal-media"));
    resetCreationUi();
  }
  window.addEventListener("pagehide", clearAll);

  return { initCreationUi, resetCreationUi, preflight, setBusy, uploadPending, renderInto, clearView, clearAll,
           hasPending: () => pending.length > 0 };
})();
