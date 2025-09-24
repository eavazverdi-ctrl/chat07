// v6: کنترل‌ها یک‌خطی، دکمه‌ها سمت چپ ورودی، حذف کپی لینک، آپلود با uploadBytes (بدون گیر 0%)
const ROOM_ID = "global-room-1";
const POLL_MS = 3000;

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

// Init
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const storage = getStorage(app);

// local UID
const uid = (() => {
  const k = "local_uid_v6";
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

// Upload file (non-resumable to avoid 0% stuck)
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0];
  if (!file) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  const safeName = (file.name || 'file').replace(/[^\w.\-]+/g,'_');
  const path = `rooms/${ROOM_ID}/files/${cid}_${safeName}`;
  const storageRef = ref(storage, path);

  // quick feedback
  const temp = document.createElement('div'); temp.className='txt'; temp.textContent = `در حال آپلود… — ${safeName}`;
  addTile({you:true, who:uid, el: temp});

  // guess contentType if missing
  let ct = file.type;
  if (!ct) {
    if (/\.(heic)$/i.test(safeName)) ct = 'image/heic';
    else if (/\.(jpe?g)$/i.test(safeName)) ct = 'image/jpeg';
    else if (/\.(png)$/i.test(safeName)) ct = 'image/png';
    else if (/\.(gif)$/i.test(safeName)) ct = 'image/gif';
    else if (/\.(webp)$/i.test(safeName)) ct = 'image/webp';
    else ct = 'application/octet-stream';
  }

  try{
    await uploadBytes(storageRef, file, { contentType: ct });
    const url = await getDownloadURL(storageRef);
    temp.parentElement.remove();
    renderFile({name:safeName, url, uid, cid});
    await addDoc(msgsCol, {type:'file', name:safeName, url, uid, cid, t: serverTimestamp()});
    fileInput.value='';
  }catch(e){
    temp.textContent = 'آپلود ناموفق بود (Rules/Network).';
  }
});
