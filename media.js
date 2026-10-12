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
  const APPS_SCRIPT_URL = "REPLACE-WITH-PRODUCTION-APPS-SCRIPT-EXEC-URL";

  // Client limits equal the server caps (Worker, Apps Script and Firestore rules use the same numbers).
  const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
  const MAX_AUDIO_BYTES = 2.5 * 1024 * 1024;
  const MAX_RECORD_MS   = 3 * 60 * 1000;
  const MAX_SOURCE_PHOTO_BYTES = 30 * 1024 * 1024;   // refuse to decode absurd inputs
  const MAX_MEDIA_PER_STAR = 2;                       // 1 photo + 1 voice note in this UI (rules allow up to 3)

  const AUDIO_ALLOWED = ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm"];
  const IMAGE_ALLOWED = ["image/jpeg", "image/png", "image/webp"];
  const AUDIO_ALIASES = { "audio/mp3": "audio/mpeg", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav" };
  const ID_RE = /^[A-Za-z0-9_-]{20,80}$/;

  // ── In-memory state ──
  let readToken = null;             // { token, exp }
  let readTokenPromise = null;
  let viewGeneration = 0;           // bumps to cancel in-flight renders
  let objectUrls = [];
  let pending = { photo: null, audio: null };   // { blob, mime, kind, uploaded? }
  let recorder = null;              // { rec, stream, chunks, timer }
  let finishing = false;            // a recording is being stopped/processed
  let busy = false;                 // a star submit is in flight: attachments are frozen
  let issues = { photo: null, audio: null };    // last failed attach attempt per kind (message)
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
      const map = { LIMIT: "daily upload limit reached.", UNSUPPORTED_TYPE: "that file type isn't supported.", BAD_PAYLOAD: "that file couldn't be accepted.", NOT_PRIVATE: "storage isn't configured privately." };
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

  // Uploads whatever is pending (sequentially) and returns descriptors for the star document.
  async function uploadPending(onStatus) {
    const out = [];
    for (const key of ["photo", "audio"]) {
      if (!pending[key]) continue;
      if (onStatus) onStatus(key === "photo" ? "sending the photo…" : "sending the voice note…");
      out.push(await uploadOne(pending[key]));
    }
    if (out.length > MAX_MEDIA_PER_STAR) throw userError("too many attachments.");
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

  function setPreview(kind) {
    const item = pending[kind];
    const el = $(kind === "photo" ? "photo-preview" : "audio-preview");
    if (!el) return;
    if (el.dataset.url) { URL.revokeObjectURL(el.dataset.url); delete el.dataset.url; el.removeAttribute("src"); }
    if (!item) { el.classList.add("hidden"); return; }
    const url = URL.createObjectURL(item.blob);
    el.dataset.url = url; el.src = url; el.classList.remove("hidden");
  }

  function resetCreationUi() {
    if (recorder) { clearTimeout(recorder.timer); try { recorder.rec.stop(); } catch (_) {} recorder.stream.getTracks().forEach((t) => t.stop()); recorder = null; }
    pending = { photo: null, audio: null };
    issues = { photo: null, audio: null }; issueAcked = false; finishing = false; busy = false;
    setBusy(false);
    setPreview("photo"); setPreview("audio");
    ["input-photo", "input-audio"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
    const st = $("media-status"); if (st) st.textContent = "";
    const rb = $("record-audio-btn"); if (rb) rb.textContent = "record a voice note";
  }

  function setBusy(on) {
    busy = !!on;
    ["input-photo", "input-audio", "record-audio-btn"].forEach((id) => { const el = $(id); if (el) el.disabled = busy; });
  }

  // Called before a star is planted. Returns a message when planting must pause, else null.
  function preflight() {
    if (recorder || finishing) return "stop the recording first, then plant the star.";
    const msg = issues.photo || issues.audio;
    if (msg && !issueAcked) {
      issueAcked = true;
      return msg + " tap plant again to plant the star without it, or choose another file.";
    }
    return null;
  }

  function initCreationUi() {
    const status = (m) => { const el = $("media-status"); if (el) el.textContent = m || ""; };
    const photoIn = $("input-photo"), audioIn = $("input-audio"), recBtn = $("record-audio-btn");
    if (!photoIn) return;   // media UI not present in this page version

    const failed = (kind, e, fallback) => {
      const msg = (e && e.userMessage) || fallback;
      pending[kind] = null; setPreview(kind); issues[kind] = "the " + (kind === "photo" ? "photo" : "voice note") + " wasn't attached (" + msg.replace(/\.$/, "") + ").";
      issueAcked = false; status(msg);
    };
    photoIn.addEventListener("change", async () => {
      if (busy) return;
      status(""); issues.photo = null;
      if (!photoIn.files || !photoIn.files[0]) return;
      try { pending.photo = await preparePhoto(photoIn.files[0]); setPreview("photo"); }
      catch (e) { photoIn.value = ""; failed("photo", e, "that photo couldn't be used."); }
    });
    audioIn.addEventListener("change", () => {
      if (busy) return;
      status(""); issues.audio = null;
      if (!audioIn.files || !audioIn.files[0]) return;
      try { pending.audio = prepareAudio(audioIn.files[0]); setPreview("audio"); }
      catch (e) { audioIn.value = ""; failed("audio", e, "that audio couldn't be used."); }
    });
    const finishRecording = async () => {
      if (!recorder) return;                       // already stopped or modal reset: nothing to finish
      finishing = true;
      try { pending.audio = await stopRecording(); issues.audio = null; setPreview("audio"); status(""); }
      catch (e) { failed("audio", e, "recording failed."); }
      finishing = false;
      recBtn.textContent = "record a voice note";
    };
    recBtn.addEventListener("click", async () => {
      if (busy || finishing) return;
      status(""); issues.audio = null;
      if (recorder) return finishRecording();
      try { await startRecording(finishRecording); recBtn.textContent = "stop recording"; }
      catch (e) { failed("audio", e, "recording failed."); }
    });
  }

  // ───────────── memory-modal rendering ─────────────
  function validItem(m) {
    return m && typeof m === "object" && ID_RE.test(String(m.id)) &&
      ((m.kind === "image" && IMAGE_ALLOWED.indexOf(m.mime) !== -1) ||
       (m.kind === "audio" && AUDIO_ALLOWED.indexOf(m.mime) !== -1));
  }

  function clearView(container) {
    viewGeneration++;
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls = [];
    if (container) container.replaceChildren();
  }

  async function renderInto(container, mediaList) {
    clearView(container);
    if (!container || !Array.isArray(mediaList)) return;
    const gen = viewGeneration;
    for (const m of mediaList.slice(0, 3)) {
      if (!validItem(m)) continue;
      const slot = document.createElement("div");
      slot.className = "media-slot";
      slot.textContent = m.kind === "image" ? "loading photo…" : "loading voice note…";   // textContent only: no innerHTML anywhere
      container.appendChild(slot);
      try {
        const token = await getReadToken();
        const data = await callAppsScript({ action: "read", token, fileId: m.id }, 60000);
        if (gen !== viewGeneration) return;                    // modal closed or changed meanwhile
        const mime = m.mime;                                   // trust our allow-listed descriptor, not the response
        const url = URL.createObjectURL(base64ToBlob(data.base64, mime));
        objectUrls.push(url);
        const el = document.createElement(m.kind === "image" ? "img" : "audio");
        el.src = url;
        if (m.kind === "image") { el.alt = ""; el.className = "media-photo"; }
        else { el.controls = true; el.preload = "metadata"; el.className = "media-audio"; }
        slot.replaceChildren(el);
      } catch (e) {
        if (gen !== viewGeneration) return;
        slot.textContent = (e && e.userMessage) || "this attachment couldn't be loaded.";
      }
    }
  }

  // ───────────── lifecycle ─────────────
  function clearAll() {
    readToken = null; readTokenPromise = null;
    clearView($("modal-media"));
    resetCreationUi();
  }
  window.addEventListener("pagehide", clearAll);

  return { initCreationUi, resetCreationUi, preflight, setBusy, uploadPending, renderInto, clearView, clearAll,
           hasPending: () => !!(pending.photo || pending.audio) };
})();
