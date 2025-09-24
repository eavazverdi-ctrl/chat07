// v5: دکمه‌ها سمت چپ ورودی (RTL)، حذف کپی لینک، رفع گیر 0% با fallback، 50% عرض، Polling 3s
const ROOM_ID = "global-room-1";
const POLL_MS = 3000;

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, uploadBytes } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

// Init
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const storage = getStorage(app);

// local UID (بدون Auth)
const uid = (() => {
  const k = "local_uid_v5";
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
function renderFile(m){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  let el;
  if ((m.name||'').match(/\.(png|jpe?g|gif|webp|heic)$/i)) {
    el = document.createElement('div');
    const img = document.createElement('img');
    img.src = m.url; img.className = 'thumb'; img.alt = m.name || 'image';
    const link = document.createElement('a');
    link.href = m.url; link.textContent = 'دانلود تصویر'; link.className='filelink'; link.download = m.name || 'image';
    el.appendChild(img); el.appendChild(link);
  } else {
    el = document.createElement('a'); el.href=m.url; el.textContent='📄 '+m.name; el.className='filelink'; el.download = m.name;
  }
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
      if (m.type==='file') renderFile(m);
    });
  }catch(e){
    // احتمالاً Rules
  }
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

// Upload file with fallback if stuck at 0%
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0];
  if (!file) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  const safeName = (file.name || 'file').replace(/[^\w.\-]+/g,'_');
  const path = `rooms/${ROOM_ID}/files/${cid}_${safeName}`;
  const storageRef = ref(storage, path);
  const metadata = { contentType: file.type || 'application/octet-stream' };

  // Temporary uploading tile
  const temp = document.createElement('div'); temp.className='txt'; temp.textContent = `در حال آپلود: 0% — ${safeName}`;
  addTile({you:true, who:uid, el: temp});

  let progressed = false;
  let completed = false;
  const watchdogMs = 10000; // 10s
  const startedAt = Date.now();

  try {
    const task = uploadBytesResumable(storageRef, file, metadata);
    task.on('state_changed', (snap)=>{
      progressed = true;
      const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
      temp.textContent = `در حال آپلود: ${pct}% — ${safeName}`;
    }, async (err)=>{
      if (completed) return;
      temp.textContent = 'خطا در آپلود فایل';
    }, async ()=>{
      completed = true;
      const url = await getDownloadURL(task.snapshot.ref);
      temp.parentElement.remove();
      renderFile({name:safeName, url, uid, cid});
      await addDoc(msgsCol, {type:'file', name:safeName, url, uid, cid, t: serverTimestamp()});
      fileInput.value='';
    });

    // Watchdog: if no progress within 10s, cancel & fallback to uploadBytes
    const check = setInterval(async ()=>{
      if (completed) { clearInterval(check); return; }
      const elapsed = Date.now() - startedAt;
      if (!progressed && elapsed > watchdogMs) {
        try { task.cancel(); } catch {}
        clearInterval(check);
        try {
          const snap = await uploadBytes(storageRef, file, metadata);
          const url = await getDownloadURL(storageRef);
          temp.parentElement.remove();
          renderFile({name:safeName, url, uid, cid});
          await addDoc(msgsCol, {type:'file', name:safeName, url, uid, cid, t: serverTimestamp()});
          fileInput.value='';
        } catch (e) {
          temp.textContent = 'آپلود ناموفق بود (Rules/Network).';
        }
      }
    }, 2000);

  } catch (e) {
    temp.textContent = 'آپلود مجاز نیست (Rules/Network).';
  }
});
