// نسخه مینیمال: دکمه‌ای + Polling 3s + اتاق ثابت، بدون Service Worker
const ROOM_ID = "global-room-1";
const POLL_MS = 3000;

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

// Init
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const storage = getStorage(app);

// local UID (بدون Auth)
const uid = (() => {
  const k = "local_uid";
  let v = localStorage.getItem(k);
  if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(k, v); }
  return v;
})();

// UI
const board = document.getElementById("board");
const form = document.getElementById("chatForm");
const input = document.getElementById("text");
const fileInput = document.getElementById("fileInput");
const copyInvite = document.getElementById("copyInvite");

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
  const a = document.createElement('a'); a.href=m.url; a.textContent='📄 '+m.name; a.className='filelink'; a.download = m.name;
  addTile({you: m.uid===uid, who: m.uid, el:a});
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
    // احتمالا مشکل Rules؛ فعلا نادیده می‌گیریم
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

// Choose & upload file (optimistic after upload)
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0];
  if (!file) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  try{
    const path = `rooms/${ROOM_ID}/files/${cid}_${file.name}`;
    const task = uploadBytesResumable(ref(storage, path), file);
    task.on('state_changed', ()=>{}, ()=>{}, async ()=>{
      const url = await getDownloadURL(task.snapshot.ref);
      renderFile({name:file.name, url, uid, cid});
      await addDoc(msgsCol, {type:'file', name:file.name, url, uid, cid, t: serverTimestamp()});
      fileInput.value='';
    });
  }catch(e){ /* ignore */ }
});

copyInvite.addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText(location.href); }catch{}
});
