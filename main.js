// v13: fixed page, smart autoscroll, stronger image compression, timestamps, bottom-align on empty
const ROOM_ID = "global-room-1";
const POLL_MS = 3000;
// Firestore doc limit ~1MB; aim below:
const MAX_BYTES = 900 * 1024;
const START_MAX_W = 2560, START_QUALITY = 0.85, MIN_QUALITY = 0.2, MIN_WIDTH = 96;
const ENTRY_PASSCODE = "2025";
const WIPE_PASSWORD = "delete all";

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query, doc, setDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Init
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

// Identity
const UID_KEY = "local_uid_v13";
const NAME_KEY = "display_name_v13";
const PASS_OK_KEY = "entry_ok_v13";
const uid = localStorage.getItem(UID_KEY) || (() => {
  const v = Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(UID_KEY, v);
  return v;
})();
let displayName = localStorage.getItem(NAME_KEY) || "";

const nameModal = document.getElementById("nameModal");
const nameInput = document.getElementById("nameInput");
const passInput = document.getElementById("passInput");
const saveName = document.getElementById("saveName");

function openNameModal(){ nameModal.setAttribute("open",""); setTimeout(()=> nameInput && nameInput.focus(), 0); }
function closeNameModal(){ nameModal.removeAttribute("open"); }
function tryEnter(e){
  if (e) e.preventDefault();
  const n = (nameInput.value || "").trim();
  const p = (passInput.value || "").trim();
  if (!n) { nameInput.focus(); return; }
  if (p !== ENTRY_PASSCODE) { passInput.value=""; passInput.placeholder="اشتباه است"; passInput.focus(); return; }
  displayName = n;
  try {
    localStorage.setItem(NAME_KEY, displayName);
    localStorage.setItem(PASS_OK_KEY, "1");
  } catch {}
  closeNameModal();
}
saveName.addEventListener("click", tryEnter);
nameInput.addEventListener("keydown", (e)=>{ if (e.key === "Enter") tryEnter(e); });
passInput.addEventListener("keydown", (e)=>{ if (e.key === "Enter") tryEnter(e); });
if (!localStorage.getItem(PASS_OK_KEY) || !displayName) openNameModal();

// UI
const board = document.getElementById("board");
const form = document.getElementById("chatForm");
const input = document.getElementById("text");
const fileInput = document.getElementById("fileInput");
const settingsBtn = document.getElementById("settingsBtn");

// Prevent page moving on touch except within board
document.addEventListener('touchmove', (e)=>{
  if (!e.target.closest('#board') && !e.target.closest('.modal[open]')) {
    e.preventDefault();
  }
}, {passive:false});

function hashHue(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%360; return h; }
function pad(n){ return n<10 ? '0'+n : ''+n; }
function fmt(ts){
  const d = new Date(ts);
  const Y = d.getFullYear();
  const M = pad(d.getMonth()+1);
  const D = pad(d.getDate());
  const H = pad(d.getHours());
  const m = pad(d.getMinutes());
  const S = pad(d.getSeconds());
  return `${Y}/${M}/${D}, ${H}:${m}:${S}`;
}
function getTs(m){
  if (m.ts) return m.ts;
  if (m.t && m.t.seconds!=null) return m.t.seconds*1000 + Math.floor((m.t.nanoseconds||0)/1e6);
  return Date.now();
}
function scrollToBottom(){ board.scrollTop = board.scrollHeight; }

let userPinnedToBottom = true;
function isNearBottom(){
  return (board.scrollHeight - board.scrollTop - board.clientHeight) < 24;
}
board.addEventListener('scroll', ()=>{
  userPinnedToBottom = isNearBottom();
});

function addTile({you, who, el, ts}){
  const tile = document.createElement('div'); tile.className = 'tile' + (you? ' you' : '');
  if (!you){
    const hue = hashHue(who||"");
    tile.style.background = `hsla(${hue},70%,40%,0.22)`;
    tile.style.borderColor = `hsla(${hue},70%,55%,0.35)`;
  }
  const w = document.createElement('div'); w.className='who'; w.textContent = who || "ناشناس";
  const meta = document.createElement('div'); meta.className='meta'; meta.textContent = fmt(ts||Date.now());
  tile.appendChild(w); tile.appendChild(el); tile.appendChild(meta);
  board.appendChild(tile);
}

const rendered = new Set();
function renderText(m, forceScroll=false){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('div'); el.className='txt'; el.textContent = m.text;
  addTile({you: m.uid===uid, who: m.name || "ناشناس", el, ts: getTs(m)});
  if (forceScroll || userPinnedToBottom) scrollToBottom();
}
function renderImage(m, forceScroll=false){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('div');
  const img = document.createElement('img');
  img.src = m.dataUrl; img.className = 'thumb'; img.alt = m.name || 'image';
  const link = document.createElement('a');
  link.href = m.dataUrl; link.textContent = 'دانلود تصویر'; link.className='filelink'; link.download = m.name || 'image.jpg';
  el.appendChild(img); el.appendChild(link);
  addTile({you: m.uid===uid, who: m.name || "ناشناس", el, ts: getTs(m)});
  if (forceScroll || userPinnedToBottom) scrollToBottom();
}
function renderBlob(m, forceScroll=false){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('a');
  el.href = m.dataUrl; el.textContent = '📄 '+(m.name||'file'); el.className='filelink'; el.download = m.name || 'file';
  addTile({you: m.uid===uid, who: m.name || "ناشناس", el, ts: getTs(m)});
  if (forceScroll || userPinnedToBottom) scrollToBottom();
}

// Firestore
const roomDoc = doc(db, "rooms", ROOM_ID);
await setDoc(roomDoc, { exists: true }, { merge: true });
const msgsCol = collection(db, "rooms", ROOM_ID, "messages");

// Polling
async function poll(){
  try{
    const snap = await getDocs(query(msgsCol, orderBy('t','asc')));
    snap.forEach(d=>{
      const m = d.data(); m.cid = m.cid || d.id;
      if (m.type==='txt') renderText(m, false);
      if (m.type==='img') renderImage(m, false);
      if (m.type==='blob') renderBlob(m, false);
    });
    // No forced autoscroll here; only if user is near bottom
    if (userPinnedToBottom) scrollToBottom();
  }catch(e){ /* ignore */ }
}
// initial load -> force scroll after first poll
await poll();
setTimeout(()=> scrollToBottom(), 50);
setInterval(poll, POLL_MS);

// Submit on Enter (force autoscroll)
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!localStorage.getItem(PASS_OK_KEY) || !displayName) { openNameModal(); return; }
  const text = (input.value||'').trim();
  if (!text) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  const ts = Date.now();
  renderText({text, uid, name: displayName, cid, ts}, true);
  input.value='';
  try{
    await addDoc(msgsCol, {type:'txt', text, uid, name: displayName, cid, ts, t: serverTimestamp()});
  }catch(e){ /* ignore */ }
});

// File inline
const b64Bytes = (dataUrl)=>{
  const b64 = (dataUrl.split(',')[1]||'').replace(/\s+/g,'');
  const pad = (b64.endsWith('==')?2:(b64.endsWith('=')?1:0));
  return Math.floor(b64.length*3/4) - pad;
};
const readAsDataURL = (file)=> new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(file); });
async function drawToCanvas(img, width){
  const scale = width / img.naturalWidth;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return cv;
}
async function compressImageSmart(file){
  const dataUrl = await readAsDataURL(file);
  const img = new Image(); img.decoding='async';
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=dataUrl; });
  let width = Math.min(START_MAX_W, img.naturalWidth || START_MAX_W);
  let quality = START_QUALITY;
  let mime = 'image/webp';
  const cv0 = document.createElement('canvas'); cv0.width = 1; cv0.height = 1;
  try { cv0.toDataURL('image/webp', .5); } catch { mime = 'image/jpeg'; }

  let lastOut = null;
  for (let i=0;i<22;i++){
    const cv = await drawToCanvas(img, width);
    let out;
    try { out = cv.toDataURL(mime, quality); }
    catch { out = cv.toDataURL('image/jpeg', quality); mime='image/jpeg'; }
    lastOut = out;
    if (b64Bytes(out) <= MAX_BYTES) return out;
    if (quality > MIN_QUALITY) quality = Math.max(MIN_QUALITY, quality * 0.80);
    else if (width > MIN_WIDTH) width = Math.max(MIN_WIDTH, Math.floor(width * 0.80));
    else break;
  }
  return lastOut;
}

fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0];
  if (!file) return;
  if (!localStorage.getItem(PASS_OK_KEY) || !displayName) { openNameModal(); return; }

  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  const safeName = (file.name || 'file').replace(/[^\w.\-]+/g,'_');
  const ts = Date.now();

  const temp = document.createElement('div'); temp.className='txt'; temp.textContent = `در حال آماده‌سازی فایل — ${safeName}`;
  addTile({you:true, who: displayName || "من", el: temp, ts});
  scrollToBottom(); // force on own upload

  try{
    if ((safeName).match(/\.(png|jpe?g|gif|webp|heic|heif)$/i) || (file.type||'').startsWith('image/')) {
      const dataUrl = await compressImageSmart(file);
      if (!dataUrl) { temp.textContent = 'خطا در فشرده‌سازی تصویر'; return; }
      if (b64Bytes(dataUrl) > MAX_BYTES) { temp.textContent = 'تصویر بسیار بزرگ است؛ دوباره تلاش کنید.'; return; }
      temp.parentElement.remove();
      renderImage({name:safeName, dataUrl, uid, name: displayName, cid, ts}, true);
      await addDoc(msgsCol, {type:'img', name:safeName, dataUrl, uid, name: displayName, cid, ts, t: serverTimestamp()});
    } else {
      const raw = await readAsDataURL(file);
      if (b64Bytes(raw) > MAX_BYTES) { temp.textContent = 'حجم فایل زیاد است (~900KB).'; return; }
      temp.parentElement.remove();
      renderBlob({name:safeName, dataUrl: raw, uid, name: displayName, cid, ts}, true);
      await addDoc(msgsCol, {type:'blob', name:safeName, dataUrl: raw, uid, name: displayName, cid, ts, t: serverTimestamp()});
    }
    fileInput.value='';
  }catch(e){
    temp.textContent = 'خطا در پردازش فایل (مرورگر/حافظه).';
  }
});

// Settings modal logic
const settingsModal = document.getElementById("settingsModal");
const newName = document.getElementById("newName");
const applyName = document.getElementById("applyName");
const wipePass = document.getElementById("wipePass");
const wipeBtn = document.getElementById("wipeBtn");
const settingsOK = document.getElementById("settingsOK");

settingsBtn.addEventListener("click", ()=>{
  settingsModal.setAttribute("open","");
  newName.value = displayName || "";
  setTimeout(()=> newName && newName.focus(), 0);
});
settingsOK.addEventListener("click", ()=> settingsModal.removeAttribute("open"));

applyName.addEventListener("click", (e)=>{
  e.preventDefault();
  const v = (newName.value || "").trim();
  if (!v) { newName.focus(); return; }
  displayName = v;
  try { localStorage.setItem(NAME_KEY, displayName); } catch {}
});

wipeBtn.addEventListener("click", async (e)=>{
  e.preventDefault();
  const pw = (wipePass.value || "").trim();
  const status = document.getElementById("wipeStatus");
  if (pw != WIPE_PASSWORD) { status.textContent = "رمز حذف صحیح نیست."; return; }
  status.textContent = "در حال حذف...";
  try{
    let total = 0;
    while (true){
      const snap = await getDocs(query(msgsCol));
      if (snap.empty) break;
      const batch = writeBatch(db);
      let count = 0;
      snap.forEach(d=>{ if (count < 450){ batch.delete(d.ref); count++; } });
      if (count === 0) break;
      await batch.commit();
      total += count;
    }
    // clear UI
    const tiles = document.querySelectorAll('#board .tile');
    tiles.forEach(t=>t.remove());
    rendered.clear();
    status.textContent = "همهٔ پیام‌ها حذف شد.";
    scrollToBottom();
  }catch(e){
    status.textContent = "خطا در حذف (Rules/Network).";
  }
});
