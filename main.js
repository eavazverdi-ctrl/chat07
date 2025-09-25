// v11: settings, passcode gate, left-side file button, fixed page, inline-only
const ROOM_ID = "global-room-1";
const POLL_MS = 3000;
const MAX_BYTES = 850 * 1024;
const START_MAX_W = 2048, START_QUALITY = 0.82, MIN_QUALITY = 0.4, MIN_WIDTH = 360;
const ENTRY_PASSCODE = "2025";
const WIPE_PASSWORD = "delete all";

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query, doc, setDoc, writeBatch, deleteDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Init
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

// Identity
const UID_KEY = "local_uid_v11";
const NAME_KEY = "display_name_v11";
const PASS_OK_KEY = "entry_ok_v11";
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

function openNameModal(){
  nameModal.setAttribute("open","");
  setTimeout(()=> nameInput && nameInput.focus(), 0);
}
function closeNameModal(){
  nameModal.removeAttribute("open");
}
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

function hashHue(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%360; return h; }
function addTile({you, who, el}){
  const tile = document.createElement('div'); tile.className = 'tile' + (you? ' you' : '');
  if (!you){
    const hue = hashHue(who||"");
    tile.style.background = `hsla(${hue},70%,40%,0.22)`;
    tile.style.borderColor = `hsla(${hue},70%,55%,0.35)`;
  }
  const w = document.createElement('div'); w.className='who'; w.textContent = who || "ناشناس";
  tile.appendChild(w); tile.appendChild(el);
  board.appendChild(tile); board.scrollTop = board.scrollHeight;
}
const rendered = new Set();
function renderText(m){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('div'); el.className='txt'; el.textContent = m.text;
  addTile({you: m.uid===uid, who: m.name || "ناشناس", el});
}
function renderImage(m){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('div');
  const img = document.createElement('img');
  img.src = m.dataUrl; img.className = 'thumb'; img.alt = m.name || 'image';
  const link = document.createElement('a');
  link.href = m.dataUrl; link.textContent = 'دانلود تصویر'; link.className='filelink'; link.download = m.name || 'image.jpg';
  el.appendChild(img); el.appendChild(link);
  addTile({you: m.uid===uid, who: m.name || "ناشناس", el});
}
function renderBlob(m){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('a');
  el.href = m.dataUrl; el.textContent = '📄 '+(m.name||'file'); el.className='filelink'; el.download = m.name || 'file';
  addTile({you: m.uid===uid, who: m.name || "ناشناس", el});
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
      if (m.type==='txt') renderText(m);
      if (m.type==='img') renderImage(m);
      if (m.type==='blob') renderBlob(m);
    });
  }catch(e){ /* ignore */ }
}
await poll();
setInterval(poll, POLL_MS);

// Submit on Enter
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if (!localStorage.getItem(PASS_OK_KEY) || !displayName) { openNameModal(); return; }
  const text = (input.value||'').trim();
  if (!text) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  renderText({text, uid, name: displayName, cid});
  input.value='';
  try{
    await addDoc(msgsCol, {type:'txt', text, uid, name: displayName, cid, t: serverTimestamp()});
  }catch(e){ /* ignore */ }
});

// File handling (inline)
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
  for (let i=0;i<14;i++){
    const cv = await drawToCanvas(img, width);
    let out;
    try { out = cv.toDataURL(mime, quality); }
    catch { out = cv.toDataURL('image/jpeg', quality); mime='image/jpeg'; }
    lastOut = out;
    if (b64Bytes(out) <= MAX_BYTES) return out;
    if (quality > MIN_QUALITY) quality = Math.max(MIN_QUALITY, quality * 0.85);
    else if (width > MIN_WIDTH) width = Math.max(MIN_WIDTH, Math.floor(width * 0.85));
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

  const temp = document.createElement('div'); temp.className='txt'; temp.textContent = `در حال آماده‌سازی فایل — ${safeName}`;
  addTile({you:true, who: displayName || "من", el: temp});

  try{
    if ((safeName).match(/\.(png|jpe?g|gif|webp|heic|heif)$/i) || (file.type||'').startsWith('image/')) {
      const dataUrl = await compressImageSmart(file);
      if (!dataUrl) { temp.textContent = 'خطا در فشرده‌سازی تصویر'; return; }
      if (b64Bytes(dataUrl) > MAX_BYTES) { temp.textContent = 'تصویر بسیار بزرگ است؛ دوباره تلاش کنید.'; return; }
      temp.parentElement.remove();
      renderImage({name:safeName, dataUrl, uid, name: displayName, cid});
      await addDoc(msgsCol, {type:'img', name:safeName, dataUrl, uid, name: displayName, cid, t: serverTimestamp()});
    } else {
      const raw = await readAsDataURL(file);
      if (b64Bytes(raw) > MAX_BYTES) { temp.textContent = 'حجم فایل زیاد است (~850KB).'; return; }
      temp.parentElement.remove();
      renderBlob({name:safeName, dataUrl: raw, uid, name: displayName, cid});
      await addDoc(msgsCol, {type:'blob', name:safeName, dataUrl: raw, uid, name: displayName, cid, t: serverTimestamp()});
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
const closeSettings = document.getElementById("closeSettings");
const wipeStatus = document.getElementById("wipeStatus");

settingsBtn.addEventListener("click", ()=>{
  settingsModal.setAttribute("open","");
  newName.value = displayName || "";
  setTimeout(()=> newName && newName.focus(), 0);
});
closeSettings.addEventListener("click", ()=> settingsModal.removeAttribute("open"));

applyName.addEventListener("click", (e)=>{
  e.preventDefault();
  const v = (newName.value || "").trim();
  if (!v) { newName.focus(); return; }
  displayName = v;
  try { localStorage.setItem(NAME_KEY, displayName); } catch {}
  settingsModal.removeAttribute("open");
});

wipeBtn.addEventListener("click", async (e)=>{
  e.preventDefault();
  const pw = (wipePass.value || "").trim();
  if (pw !== WIPE_PASSWORD) { wipeStatus.textContent = "رمز حذف صحیح نیست."; return; }
  wipeStatus.textContent = "در حال حذف...";
  try{
    const snap = await getDocs(query(msgsCol));
    const batch = writeBatch(db);
    let count = 0;
    snap.forEach(d=>{ batch.delete(d.ref); count++; });
    await batch.commit();
    wipeStatus.textContent = "همهٔ پیام‌ها حذف شد.";
    // Reset UI
    const tiles = document.querySelectorAll('#board .tile');
    tiles.forEach(t=>t.remove());
    rendered.clear();
  }catch(e){
    wipeStatus.textContent = "خطا در حذف (Rules/Network).";
  }
});
