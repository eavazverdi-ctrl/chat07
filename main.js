// v7: بدون Firebase Storage — فایل‌ها و تصاویر inline داخل Firestore
const ROOM_ID = "global-room-1";
const POLL_MS = 3000;
const MAX_INLINE = 800 * 1024; // ~800KB base64 length cap
const IMG_MAX_W = 1280;
const IMG_QUALITY = 0.72;

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Init
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

// local UID
const uid = (() => {
  const k = "local_uid_v7";
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
async function fileToDataUrl(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(file);
  });
}
async function imageToCompressedDataUrl(file){
  const dataUrl = await fileToDataUrl(file);
  const img = new Image();
  img.decoding = 'async';
  return await new Promise((resolve, reject)=>{
    img.onload = ()=>{
      const scale = Math.min(1, IMG_MAX_W / img.naturalWidth || 1);
      const w = Math.round((img.naturalWidth||IMG_MAX_W) * scale);
      const h = Math.round((img.naturalHeight||IMG_MAX_W) * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      // prefer webp, fallback jpeg
      let out;
      try { out = cv.toDataURL('image/webp', IMG_QUALITY); }
      catch { out = cv.toDataURL('image/jpeg', IMG_QUALITY); }
      resolve(out);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Choose & "upload" (inline) file
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0];
  if (!file) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  const safeName = (file.name || 'file').replace(/[^\w.\-]+/g,'_');

  // feedback tile
  const temp = document.createElement('div'); temp.className='txt'; temp.textContent = `در حال آماده‌سازی فایل — ${safeName}`;
  addTile({you:true, who:uid, el: temp});

  try{
    if ((safeName).match(/\.(png|jpe?g|gif|webp|heic)$/i)) {
      // compress & inline
      const dataUrl = await imageToCompressedDataUrl(file);
      if (dataUrl.length > MAX_INLINE) {
        temp.textContent = 'تصویر خیلی بزرگ است (بعد از فشرده‌سازی هم). لطفاً عکس کوچک‌تر بفرست.';
        return;
      }
      // optimistic render
      temp.parentElement.remove();
      renderImage({name:safeName, dataUrl, uid, cid});
      await addDoc(msgsCol, {type:'img', name:safeName, dataUrl, uid, cid, t: serverTimestamp()});
    } else {
      // generic small files only
      const dataUrl = await fileToDataUrl(file);
      if (dataUrl.length > MAX_INLINE) {
        temp.textContent = 'حجم فایل زیاد است (حداکثر ~800KB).';
        return;
      }
      temp.parentElement.remove();
      renderBlob({name:safeName, dataUrl, uid, cid});
      await addDoc(msgsCol, {type:'blob', name:safeName, dataUrl, uid, cid, t: serverTimestamp()});
    }
    fileInput.value='';
  }catch(e){
    temp.textContent = 'خطا در پردازش فایل (مرورگر/حافظه).';
  }
});
