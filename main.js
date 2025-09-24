// v8: inline-only, smart image compression loop, buttons left, 70% width
const ROOM_ID = "global-room-1";
const POLL_MS = 3000;
// Firestore doc hard limit ~1MB; هدف امن: <= 850KB دیتا
const MAX_BYTES = 850 * 1024;
// فشرده‌سازی اولیه
const START_MAX_W = 2048;
const START_QUALITY = 0.82;
const MIN_QUALITY = 0.4;
const MIN_WIDTH = 360;

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Init
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

// local UID
const uid = (() => {
  const k = "local_uid_v8";
  let v = localStorage.getItem(k);
  if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(k, v); }
  return v;
})();

// UI
const board = document.getElementById("board");
const form = document.getElementById("chatForm");
const input = document.getElementById("text");
const fileInput = document.getElementById("fileInput");

function colorFromId(id){ let h=0; for(let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))%360; return `hsl(${h} 70% 35%)`; }
function addTile({you, who, el}){
  const tile = document.createElement('div'); tile.className = 'tile' + (you? ' you' : '');
  if (!you) tile.style.background = colorFromId(who);
  const w = document.createElement('div'); w.className='who'; w.textContent = you? 'شما' : who.slice(0,6);
  tile.appendChild(w); tile.appendChild(el);
  board.appendChild(tile); board.scrollTop = board.scrollHeight;
}
function renderText(m){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('div'); el.className='txt'; el.textContent = m.text;
  addTile({you: m.uid===uid, who: m.uid, el});
}
function renderImage(m){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('div');
  const img = document.createElement('img');
  img.src = m.dataUrl; img.className = 'thumb'; img.alt = m.name || 'image';
  const link = document.createElement('a');
  link.href = m.dataUrl; link.textContent = 'دانلود تصویر'; link.className='filelink'; link.download = m.name || 'image.jpg';
  el.appendChild(img); el.appendChild(link);
  addTile({you: m.uid===uid, who: m.uid, el});
}
function renderBlob(m){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('a');
  el.href = m.dataUrl; el.textContent = '📄 '+(m.name||'file'); el.className='filelink'; el.download = m.name || 'file';
  addTile({you: m.uid===uid, who: m.uid, el});
}

// Firestore refs
const roomDoc = doc(db, "rooms", ROOM_ID);
await setDoc(roomDoc, { exists: true }, { merge: true });
const msgsCol = collection(db, "rooms", ROOM_ID, "messages");

// Polling
const rendered = new Set();
async function poll(){
  try{
    const snap = await getDocs(query(msgsCol, orderBy('t','asc')));
    snap.forEach(d=>{
      const m = d.data(); m.cid = m.cid || d.id;
      if (m.type==='txt') renderText(m);
      if (m.type==='img') renderImage(m);
      if (m.type==='blob') renderBlob(m);
    });
  }catch(e){ /* Rules/Network */ }
}
await poll();
setInterval(poll, POLL_MS);

// Send text (optimistic)
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const text = (input.value||'').trim();
  if (!text) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  renderText({text, uid, cid});
  input.value='';
  try{
    await addDoc(msgsCol, {type:'txt', text, uid, cid, t: serverTimestamp()});
  }catch(e){ /* ignore */ }
});

// Helpers
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
  // Load
  const dataUrl = await readAsDataURL(file);
  const img = new Image(); img.decoding='async';
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=dataUrl; });
  let width = Math.min(START_MAX_W, img.naturalWidth || START_MAX_W);
  let quality = START_QUALITY;
  let mime = 'image/webp';
  // Safari fallback
  const testCanvas = document.createElement('canvas');
  testCanvas.width = 1; testCanvas.height = 1;
  try { testCanvas.toDataURL('image/webp', .5); } catch { mime = 'image/jpeg'; }

  for (let i=0;i<12;i++){
    const cv = await drawToCanvas(img, width);
    let out;
    try { out = cv.toDataURL(mime, quality); }
    catch { out = cv.toDataURL('image/jpeg', quality); mime='image/jpeg'; }
    if (b64Bytes(out) <= MAX_BYTES) return out;
    // reduce quality until MIN_QUALITY, then reduce width
    if (quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality * 0.85);
    } else if (width > MIN_WIDTH) {
      width = Math.max(MIN_WIDTH, Math.floor(width * 0.85));
    } else {
      // last-resort: force JPEG low quality
      mime='image/jpeg'; quality = Math.max(0.3, quality * 0.8);
    }
  }
  // return last attempt even if still a bit over (rare)
  const cv = await drawToCanvas(img, width);
  let out;
  try { out = cv.toDataURL(mime, quality); } catch { out = cv.toDataURL('image/jpeg', quality); }
  return out;
}

// Choose & inline file (images auto-fit, others up to ~850KB)
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0];
  if (!file) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  const safeName = (file.name || 'file').replace(/[^\w.\-]+/g,'_');

  const temp = document.createElement('div'); temp.className='txt'; temp.textContent = `در حال آماده‌سازی فایل — ${safeName}`;
  addTile({you:true, who:uid, el: temp});

  try{
    if ((safeName).match(/\.(png|jpe?g|gif|webp|heic|heif)$/i) || (file.type||'').startsWith('image/')) {
      const dataUrl = await compressImageSmart(file);
      // اطمینان نهایی
      if (b64Bytes(dataUrl) > MAX_BYTES) {
        temp.textContent = 'خطا: تصویر بسیار بزرگ است. لطفاً دوباره تلاش کنید.';
        return;
      }
      temp.parentElement.remove();
      renderImage({name:safeName, dataUrl, uid, cid});
      await addDoc(msgsCol, {type:'img', name:safeName, dataUrl, uid, cid, t: serverTimestamp()});
    } else {
      const raw = await readAsDataURL(file);
      if (b64Bytes(raw) > MAX_BYTES) {
        temp.textContent = 'حجم فایل زیاد است (حداکثر ~850KB).';
        return;
      }
      temp.parentElement.remove();
      renderBlob({name:safeName, dataUrl: raw, uid, cid});
      await addDoc(msgsCol, {type:'blob', name:safeName, dataUrl: raw, uid, cid, t: serverTimestamp()});
    }
    fileInput.value='';
  }catch(e){
    temp.textContent = 'خطا در پردازش فایل (مرورگر/حافظه).';
  }
});
