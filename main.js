// v14 → v14-rooms: پنج اتاق ثابت + منوی انتخاب، با همان رفتار پایدار قبلی
const ROOM_IDS = ["chat-1","chat-2","chat-3","chat-4","chat-5"];
const POLL_MS = 3000;
const MAX_BYTES = 900 * 1024;
let START_MAX_W = 2560, START_QUALITY = 0.85, MIN_QUALITY = 0.15, MIN_WIDTH = 64;
const ENTRY_PASSCODE = "2025";

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query,
  doc, setDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

// Identity (مثل قبل)
const UID_KEY = "local_uid_v14";
const NAME_KEY = "display_name_v14";
const PASS_OK_KEY = "entry_ok_v14";
const FSZ_KEY = "font_size_v14";
const uid = localStorage.getItem(UID_KEY) || (()=>{ const v=Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem(UID_KEY,v); return v;})();
let displayName = localStorage.getItem(NAME_KEY) || "";
let fontSize = localStorage.getItem(FSZ_KEY) || "16px";
document.documentElement.style.setProperty('--msg-fs', fontSize);

// Elements
const mainEl = document.querySelector('main');
const roomsView = document.getElementById("roomsView");
const chatView  = document.getElementById("chatView");
const roomsBtns = [...document.querySelectorAll(".room-btn")];
const backBtn   = document.getElementById("backBtn");

const board = document.getElementById("board");
const form  = document.getElementById("chatForm");
const input = document.getElementById("text");
const fileInput   = document.getElementById("fileInput");
const settingsBtn = document.getElementById("settingsBtn");

// Gate modal (مثل قبل)
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
  if (p!==ENTRY_PASSCODE){ passInput.value=""; passInput.placeholder="اشتباه است"; passInput.focus(); return; }
  displayName=n; localStorage.setItem(NAME_KEY,displayName); localStorage.setItem(PASS_OK_KEY,"1");
  closeNameModal(); startApp();
}
saveName.addEventListener("click", tryEnter);
nameInput.addEventListener("keydown",(e)=>{ if(e.key==="Enter") tryEnter(e); });
passInput.addEventListener("keydown",(e)=>{ if(e.key==="Enter") tryEnter(e); });

if (!localStorage.getItem(PASS_OK_KEY) || !displayName) openNameModal(); else startApp();

function showRooms(){ chatView.classList.add("hidden"); roomsView.classList.remove("hidden"); }
function showChat(){ roomsView.classList.add("hidden"); chatView.classList.remove("hidden"); }

let inited = false;
let current = null;        // {id, msgsCol, pollTimer, rendered, userPinnedToBottom}
function startApp(){
  mainEl.classList.remove('gated');
  if (inited) return; inited = true;

  // جلوگیری از جابه‌جایی کل صفحه
  document.addEventListener('touchmove', (e)=>{
    if (!e.target.closest('#board') && !e.target.closest('.modal[open]')) e.preventDefault();
  }, {passive:false});
  board.addEventListener('wheel', ()=>{}, {passive:true});

  // رویداد انتخاب اتاق‌ها
  roomsBtns.forEach(btn=>{
    btn.addEventListener('click', ()=> enterRoom(btn.dataset.room));
  });
  backBtn.addEventListener('click', ()=>{
    leaveRoom();
    showRooms();
  });

  // تنظیمات
  const settingsModal = document.getElementById("settingsModal");
  const newName = document.getElementById("newName");
  const applyName = document.getElementById("applyName");
  const settingsOK = document.getElementById("settingsOK");
  const fontSizeSel = document.getElementById("fontSizeSel");
  const applyFont = document.getElementById("applyFont");
  settingsBtn.addEventListener("click", ()=>{
    settingsModal.setAttribute("open","");
    newName.value = displayName || "";
    fontSizeSel.value = fontSize;
    setTimeout(()=> newName && newName.focus(), 0);
  });
  settingsOK.addEventListener("click", ()=> settingsModal.removeAttribute("open"));
  applyName.addEventListener("click",(e)=>{
    e.preventDefault();
    const v=(newName.value||"").trim(); if(!v){ newName.focus(); return; }
    displayName=v; localStorage.setItem(NAME_KEY,displayName);
  });
  applyFont.addEventListener("click",(e)=>{
    e.preventDefault();
    fontSize = fontSizeSel.value || "16px";
    document.documentElement.style.setProperty('--msg-fs', fontSize);
    localStorage.setItem(FSZ_KEY, fontSize);
  });

  showRooms();
}

/* --------- ورود/خروج اتاق --------- */
function leaveRoom(){
  if (!current) return;
  clearInterval(current.pollTimer);
  current=null;
  // پاک‌نکردن پیام‌ها؛ فقط UI می‌ماند
}
async function enterRoom(roomId){
  if (current && current.id===roomId) { showChat(); return; }
  leaveRoom();

  // ساخت سند اتاق (برای اطمینان)
  const roomDoc = doc(db, "rooms", roomId);
  await setDoc(roomDoc, { exists: true }, { merge: true });
  const msgsCol = collection(db, "rooms", roomId, "messages");

  // آماده‌سازی وضعیت UI اتاق
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

  // Polling فقط برای همان اتاق
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

  // ثبت در state جاری
  current = { id: roomId, msgsCol, pollTimer, rendered, userPinnedToBottom };

  // ارسال پیام (Enter)
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

  // آپلود فایل (همان کُد نسخهٔ قبلی)
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
