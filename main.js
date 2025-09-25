// v21: 5 rooms + per-room password & rename (change only with current password)
const ROOM_IDS = ["chat-1","chat-2","chat-3","chat-4","chat-5"];
const POLL_MS = 3000;
const MAX_BYTES = 900 * 1024;
let START_MAX_W = 2560, START_QUALITY = 0.85, MIN_QUALITY = 0.15, MIN_WIDTH = 64;
const APP_ENTRY_PASSCODE = "2025";  // ورود اولیهٔ اپ

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query,
  doc, setDoc, getDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

// Identity
const LS = (k)=>'v21_'+k;
const uid = localStorage.getItem(LS('uid')) || (()=>{ const v=Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem(LS('uid'),v); return v; })();
let displayName = localStorage.getItem(LS('name')) || "";
let fontSize = localStorage.getItem(LS('fsize')) || "16px";
document.documentElement.style.setProperty('--msg-fs', fontSize);

// Elements
const mainEl = document.querySelector('main');
const roomsView = document.getElementById("roomsView");
const chatView  = document.getElementById("chatView");
const backBtn   = document.getElementById("backBtn");
const board     = document.getElementById("board");
const form      = document.getElementById("chatForm");
const input     = document.getElementById("text");
const fileInput = document.getElementById("fileInput");
const settingsBtn = document.getElementById("settingsBtn");
const errToast = document.getElementById('errToast');
function toast(msg){ errToast.textContent=msg; errToast.style.display='block'; setTimeout(()=> errToast.style.display='none', 4000); }
window.addEventListener('error', e=> toast('JS: '+(e.message||'خطای ناشناخته')));
window.addEventListener('unhandledrejection', e=> toast('Promise: '+(e.reason && e.reason.message ? e.reason.message : 'خطای ناشناخته')));

// Gate (app entry)
const nameModal = document.getElementById("nameModal");
const nameInput = document.getElementById("nameInput");
const passInput = document.getElementById("passInput");
const saveName  = document.getElementById("saveName");
function openNameModal(){ nameModal.setAttribute("open",""); }
function closeNameModal(){ nameModal.removeAttribute("open"); }
function tryEnter(e){
  if (e) e.preventDefault();
  const n=(nameInput.value||"").trim();
  const p=(passInput.value||"").trim();
  if (!n){ nameInput.focus(); return; }
  if (p!==APP_ENTRY_PASSCODE){ passInput.value=""; passInput.placeholder="اشتباه است"; passInput.focus(); return; }
  displayName=n; localStorage.setItem(LS('name'),displayName); localStorage.setItem(LS('entryOk'),"1");
  closeNameModal(); startApp();
}
saveName.addEventListener("click", tryEnter);
nameInput.addEventListener("keydown",(e)=>{ if(e.key==="Enter") tryEnter(e); });
passInput.addEventListener("keydown",(e)=>{ if(e.key==="Enter") tryEnter(e); });
if (!localStorage.getItem(LS('entryOk')) || !displayName) openNameModal(); else startApp();

function showRooms(){ chatView.classList.add("hidden"); roomsView.classList.remove("hidden"); }
function showChat(){ roomsView.classList.add("hidden"); chatView.classList.remove("hidden"); }

// Room-gate (per-room password)
const gateModal = document.getElementById("gateModal");
const gateTitle = document.getElementById("gateTitle");
const gateName  = document.getElementById("gateName");
const gatePass  = document.getElementById("gatePass");
const gateEnter = document.getElementById("gateEnter");
const gateCancel= document.getElementById("gateCancel");
const gateHint  = document.getElementById("gateHint");
function openGate(){ gateModal.setAttribute("open",""); }
function closeGate(){ gateModal.removeAttribute("open"); }

// Settings modal
const settingsModal = document.getElementById("settingsModal");
const newName = document.getElementById("newName");
const applyName = document.getElementById("applyName");
const fontSizeSel = document.getElementById("fontSizeSel");
const applyFont = document.getElementById("applyFont");
const settingsOK = document.getElementById("settingsOK");
const roomNameInput = document.getElementById("roomNameInput");
const roomOldPass   = document.getElementById("roomOldPass");
const roomNewPass   = document.getElementById("roomNewPass");
const saveRoomName  = document.getElementById("saveRoomName");
const saveRoomPass  = document.getElementById("saveRoomPass");

settingsBtn.addEventListener("click", ()=>{
  if (!current) return;
  settingsModal.setAttribute("open","");
  newName.value = displayName || "";
  fontSizeSel.value = fontSize;
  roomNameInput.value = current.roomName || "";
  roomOldPass.value = "";
  roomNewPass.value = "";
});
settingsOK.addEventListener("click", ()=> settingsModal.removeAttribute("open"));
applyName.addEventListener("click",(e)=>{
  e.preventDefault();
  const v=(newName.value||"").trim(); if(!v){ newName.focus(); return; }
  displayName=v; localStorage.setItem(LS('name'),displayName);
});
applyFont.addEventListener("click",(e)=>{
  e.preventDefault();
  fontSize = fontSizeSel.value || "16px";
  document.documentElement.style.setProperty('--msg-fs', fontSize);
  localStorage.setItem(LS('fsize'), fontSize);
});
saveRoomName.addEventListener("click", async (e)=>{
  e.preventDefault(); if (!current) return;
  const oldp = (roomOldPass.value||"").trim();
  const newNameVal = (roomNameInput.value||"").trim();
  if (!newNameVal){ roomNameInput.focus(); return; }
  try{
    const d = await getDoc(doc(db,'rooms', current.id));
    if (!d.exists()){ toast('اتاق یافت نشد'); return; }
    const data=d.data(); if ((data.pass||'0000') !== oldp){ toast('پسورد فعلی اشتباه است'); return; }
    await updateDoc(doc(db,'rooms', current.id), { name:newNameVal });
    current.roomName = newNameVal;
    const el = document.getElementById('rname-'+current.id); if (el) el.textContent=newNameVal;
    toast('نام اتاق بروزرسانی شد');
  }catch(_){ toast('خطا در بروزرسانی نام اتاق'); }
});
saveRoomPass.addEventListener("click", async (e)=>{
  e.preventDefault(); if (!current) return;
  const oldp = (roomOldPass.value||"").trim();
  const newp = (roomNewPass.value||"").trim();
  if (!newp){ roomNewPass.focus(); return; }
  try{
    const d = await getDoc(doc(db,'rooms', current.id));
    if (!d.exists()){ toast('اتاق یافت نشد'); return; }
    const data=d.data(); if ((data.pass||'0000') !== oldp){ toast('پسورد فعلی اشتباه است'); return; }
    await updateDoc(doc(db,'rooms', current.id), { pass:newp });
    localStorage.setItem(LS('access:'+current.id), 'ok');
    toast('پسورد اتاق بروزرسانی شد');
  }catch(_){ toast('خطا در بروزرسانی پسورد'); }
});

let inited = false;
let current = null; // {id, msgsCol, pollTimer, rendered, userPinnedToBottom, roomName}
function startApp(){
  mainEl.classList.remove('gated');
  if (inited) return; inited = true;

  // جلوگیری از جابه‌جایی کل صفحه
  document.addEventListener('touchmove', (e)=>{
    if (!e.target.closest('#board') && !e.target.closest('.modal[open]')) e.preventDefault();
  }, {passive:false});
  board.addEventListener('wheel', ()=>{}, {passive:true});

  // رویداد انتخاب اتاق‌ها
  document.querySelectorAll(".room-btn").forEach(btn=>{
    btn.addEventListener('click', ()=> onRoomButtonClick(btn.dataset.room));
  });
  backBtn.addEventListener('click', ()=>{ leaveRoom(); showRooms(); });

  // نام/پسورد پیش‌فرض اتاق‌ها را اگر نبود بساز و نام‌ها را روی لیست بگذار
  refreshRoomNames();
  setInterval(refreshRoomNames, 10000);
  showRooms();
}

async function refreshRoomNames(){
  for (const id of ROOM_IDS){
    try{
      const ref = doc(db,'rooms', id);
      const d = await getDoc(ref);
      if (!d.exists()){
        await setDoc(ref, { name: defaultNameFor(id), pass:'0000' }, { merge:true });
        setListName(id, defaultNameFor(id));
      } else {
        const data = d.data();
        setListName(id, data.name || defaultNameFor(id));
      }
    }catch(_){ /* ignore network */ }
  }
}
function defaultNameFor(id){ const n=id.split('-')[1]; return 'صفحه چت '+n; }
function setListName(id, name){ const el = document.getElementById('rname-'+id); if (el) el.textContent = name; }

// کلیک روی اتاق
async function onRoomButtonClick(roomId){
  let data = { name: defaultNameFor(roomId), pass:'0000' };
  try{
    const ref = doc(db,'rooms', roomId);
    const d = await getDoc(ref);
    if (!d.exists()){ await setDoc(ref, data, { merge:true }); }
    else data = { name: d.data().name || data.name, pass: d.data().pass || data.pass };
  }catch(_){ /* ignore */ }

  const accessKey = LS('access:'+roomId);
  if (localStorage.getItem(accessKey)==='ok'){
    enterRoom(roomId, data.name);
    return;
  }
  // Gate per-room
  document.getElementById('gateTitle').textContent = 'ورود به اتاق: ' + (data.name);
  gateName.value = displayName || '';
  gatePass.value = '';
  gateHint.textContent = '';
  openGate();
  const enter = async ()=>{
    const nm=(gateName.value||'').trim();
    const ps=(gatePass.value||'').trim();
    if (!nm){ gateName.focus(); return; }
    if (ps !== (data.pass||'0000')){ gateHint.textContent='پسورد اشتباه است.'; gatePass.focus(); return; }
    displayName=nm; localStorage.setItem(LS('name'),displayName);
    localStorage.setItem(accessKey, 'ok');
    closeGate();
    enterRoom(roomId, data.name);
  };
  gateEnter.onclick = enter;
  gateCancel.onclick = ()=> closeGate();
  gateName.onkeydown = (e)=>{ if (e.key==='Enter') enter(); };
  gatePass.onkeydown = (e)=>{ if (e.key==='Enter') enter(); };
}

/* --------- ورود/خروج اتاق --------- */
function leaveRoom(){
  if (!current) return;
  clearInterval(current.pollTimer);
  current=null;
}
async function enterRoom(roomId, roomName){
  if (current && current.id===roomId){ showChat(); return; }
  leaveRoom();

  const msgsCol = collection(db, "rooms", roomId, "messages");

  showChat();
  board.innerHTML = '<div class="push"></div>';

  const rendered = new Set();
  let userPinnedToBottom = true;
  function isNearBottom(){ return (board.scrollHeight - board.scrollTop - board.clientHeight) < 24; }
  function scrollToBottom(){ board.scrollTop = board.scrollHeight; }
  board.addEventListener('scroll', ()=>{ userPinnedToBottom = isNearBottom(); });

  function hashHue(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%360; return h; }
  function pad(n){ return n<10 ? '0'+n : ''+n; }
  function fmt(ts){ const d=new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function getTs(m){ if(m.ts) return m.ts; if(m.t&&m.t.seconds!=null) return m.t.seconds*1000+Math.floor((m.t.nanoseconds||0)/1e6); return Date.now(); }
  function addTile({you, who, el, ts}){
    const tile=document.createElement('div'); tile.className='tile'+(you?' you':'');
    if(!you){ const hue=hashHue(who||""); tile.style.background=`hsla(${hue},70%,40%,0.22)`; tile.style.borderColor=`hsla(${hue},70%,55%,0.35)`; }
    const w=document.createElement('div'); w.className='who'; w.textContent=who||'ناشناس';
    const meta=document.createElement('div'); meta.className='meta'; meta.textContent=fmt(ts||Date.now());
    tile.appendChild(w); tile.appendChild(el); tile.appendChild(meta);
    board.appendChild(tile);
  }
  function renderText(m,force=false){ if(rendered.has(m.cid)) return; rendered.add(m.cid);
    const el=document.createElement('div'); el.className='txt'; el.textContent=m.text;
    addTile({you:m.uid===uid, who:m.name||'ناشناس', el, ts:getTs(m)}); if(force||userPinnedToBottom) scrollToBottom(); }
  function renderImage(m,force=false){ if(rendered.has(m.cid)) return; rendered.add(m.cid);
    const el=document.createElement('div'); const img=document.createElement('img'); img.src=m.dataUrl; img.className='thumb'; img.alt=m.name||'image';
    const link=document.createElement('a'); link.href=m.dataUrl; link.textContent='دانلود تصویر'; link.className='filelink'; link.download=m.name||'image.jpg';
    el.appendChild(img); el.appendChild(link); addTile({you:m.uid===uid, who:m.name||'ناشناس', el, ts:getTs(m)}); if(force||userPinnedToBottom) scrollToBottom(); }
  function renderBlob(m,force=false){ if(rendered.has(m.cid)) return; rendered.add(m.cid);
    const el=document.createElement('a'); el.href=m.dataUrl; el.textContent='📄 '+(m.name||'file'); el.className='filelink'; el.download=m.name||'file';
    addTile({you:m.uid===uid, who:m.name||'ناشناس', el, ts:getTs(m)}); if(force||userPinnedToBottom) scrollToBottom(); }

  async function poll(){
    try{
      const snap = await getDocs(query(msgsCol, orderBy('t','asc')));
      snap.forEach(d=>{
        const m=d.data(); m.cid=m.cid||d.id;
        if (m.type==='txt')  renderText(m,false);
        if (m.type==='img')  renderImage(m,false);
        if (m.type==='blob') renderBlob(m,false);
      });
      if (userPinnedToBottom) scrollToBottom();
    }catch(_){}
  }
  await poll();
  const pollTimer = setInterval(poll, POLL_MS);

  current = { id: roomId, msgsCol, pollTimer, rendered, userPinnedToBottom, roomName };

  // ارسال پیام
  form.onsubmit = async (e)=>{
    e.preventDefault();
    if (!current) return;
    const text=(input.value||'').trim(); if(!text) return;
    const cid=Date.now()+'-'+Math.random().toString(36).slice(2);
    const ts=Date.now();
    renderText({type:'txt',text,uid,name:displayName,cid,ts}, true);
    input.value='';
    try{ await addDoc(current.msgsCol, {type:'txt', text, uid, name: displayName, cid, ts, t: serverTimestamp()}); }catch(_){}
  };

  // آپلود فایل (همراه با فشرده‌سازی تصویر)
  const b64Bytes=(dataUrl)=>{ const b64=(dataUrl.split(',')[1]||'').replace(/\s+/g,''); const pad=(b64.endsWith('==')?2:(b64.endsWith('=')?1:0)); return Math.floor(b64.length*3/4)-pad; };
  const readAsDataURL=(file)=>new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(file); });
  async function drawToCanvas(img,width){ const scale=width/img.naturalWidth; const w=Math.max(1,Math.round(width)); const h=Math.max(1,Math.round(img.naturalHeight*scale)); const cv=document.createElement('canvas'); cv.width=w; cv.height=h; cv.getContext('2d').drawImage(img,0,0,w,h); return cv; }
  async function compressImageSmart(file){
    const dataUrl=await readAsDataURL(file);
    const img=new Image(); img.decoding='async'; await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=dataUrl; });
    let width=Math.min(START_MAX_W,img.naturalWidth||START_MAX_W), quality=START_QUALITY, mime='image/webp';
    try{ const t=document.createElement('canvas'); t.toDataURL('image/webp',.5);}catch{ mime='image/jpeg'; }
    let out=null;
    for(let i=0;i<40;i++){
      const cv=await drawToCanvas(img,width);
      try{ out=cv.toDataURL(mime,quality);}catch{ out=cv.toDataURL('image/jpeg',quality); mime='image/jpeg'; }
      if (b64Bytes(out)<=MAX_BYTES) return out;
      if (quality>MIN_QUALITY) quality=Math.max(MIN_QUALITY,quality*.85);
      else if (width>MIN_WIDTH) width=Math.max(MIN_WIDTH,Math.floor(width*.85));
      else { quality=Math.max(.1,quality*.8); width=Math.max(32,Math.floor(width*.9)); }
    }
    return out;
  }
  fileInput.onchange = async ()=>{
    if (!current) return;
    const file=fileInput.files?.[0]; if(!file) return;
    const cid=Date.now()+'-'+Math.random().toString(36).slice(2);
    const name=(file.name||'file').replace(/[^\w.\-]+/g,'_');
    const ts=Date.now();
    const temp=document.createElement('div'); temp.className='txt'; temp.textContent='در حال آماده‌سازی فایل — '+name;
    addTile({you:true, who:displayName||'من', el:temp, ts}); scrollToBottom();
    try{
      if (/\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name) || (file.type||'').startsWith('image/')){
        const dataUrl=await compressImageSmart(file);
        if (!dataUrl){ temp.textContent='خطا در فشرده‌سازی تصویر'; return; }
        if (b64Bytes(dataUrl)>MAX_BYTES){ temp.textContent='تصویر بسیار بزرگ است.'; return; }
        temp.parentElement.remove();
        renderImage({name,dataUrl,uid,name:displayName,cid,ts}, true);
        try{ await addDoc(current.msgsCol, {type:'img', name, dataUrl, uid, name:displayName, cid, ts, t: serverTimestamp()}); }catch(_){}
      } else {
        const raw=await readAsDataURL(file); if (b64Bytes(raw)>MAX_BYTES){ temp.textContent='حجم فایل زیاد است (~900KB).'; return; }
        temp.parentElement.remove();
        renderBlob({name,dataUrl:raw,uid,name:displayName,cid,ts}, true);
        try{ await addDoc(current.msgsCol, {type:'blob', name, dataUrl: raw, uid, name:displayName, cid, ts, t: serverTimestamp()}); }catch(_){}
      }
      fileInput.value='';
    }catch(e){ temp.textContent='خطا در پردازش فایل.'; }
  };
}

// Back/Home helpers (برای اطمینان اگر جای دیگری صدا زده شد)
function showRooms(){ chatView.classList.add("hidden"); roomsView.classList.remove("hidden"); }
function showChat(){ roomsView.classList.add("hidden"); chatView.classList.remove("hidden"); }
