// v21.1 — Settings glassy; no per-field buttons; font-size applies instantly; OK applies all changes
const ROOM_IDS = ["chat-1","chat-2","chat-3","chat-4","chat-5"];
const POLL_MS = 3000;
const MAX_BYTES = 900 * 1024;
let START_MAX_W = 2560, START_QUALITY = 0.85, MIN_QUALITY = 0.15, MIN_WIDTH = 64;
const APP_ENTRY_PASSCODE = "2025";

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
const toast = (m)=>{ errToast.textContent=m; errToast.style.display='block'; setTimeout(()=>errToast.style.display='none',4000); };
window.addEventListener('error', e=> toast('JS: '+(e.message||'خطای ناشناخته')));
window.addEventListener('unhandledrejection', e=> toast('Promise: '+(e.reason?.message||'خطای ناشناخته')));

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

// Gate per room
const gateModal = document.getElementById("gateModal");
const gateTitle = document.getElementById("gateTitle");
const gateName  = document.getElementById("gateName");
const gatePass  = document.getElementById("gatePass");
const gateEnter = document.getElementById("gateEnter");
const gateCancel= document.getElementById("gateCancel");
const gateHint  = document.getElementById("gateHint");
function openGate(){ gateModal.setAttribute("open",""); }
function closeGate(){ gateModal.removeAttribute("open"); }

// Settings (no per-field buttons)
const settingsModal = document.getElementById("settingsModal");
const newName = document.getElementById("newName");
const fontSizeSel = document.getElementById("fontSizeSel");
const settingsOK = document.getElementById("settingsOK");
const roomNameInput = document.getElementById("roomNameInput");
const roomOldPass   = document.getElementById("roomOldPass");
const roomNewPass   = document.getElementById("roomNewPass");

settingsBtn.addEventListener("click", ()=>{
  if (!current) return;
  settingsModal.setAttribute("open","");
  newName.value = displayName || "";
  fontSizeSel.value = fontSize;
  roomNameInput.value = current.roomName || current.id;
  roomOldPass.value = "";
  roomNewPass.value = "";
});
settingsOK.addEventListener("click", async ()=>{
  // save display name
  const v=(newName.value||"").trim();
  if (v && v!==displayName){ displayName=v; localStorage.setItem(LS('name'),displayName); }

  // room updates (require current password)
  if (current){
    try{
      const ref=doc(db,'rooms', current.id);
      const snap=await getDoc(ref);
      if (snap.exists()){
        const data=snap.data();
        const old=(roomOldPass.value||"").trim();
        const newRoomName=(roomNameInput.value||"").trim();
        const newPwd=(roomNewPass.value||"").trim();
        if (old){
          if ((data.pass||'0000')!==old){ toast('پسورد فعلی اتاق اشتباه است'); }
          else{
            const payload={};
            if (newRoomName && newRoomName!==(data.name||"")) payload.name=newRoomName;
            if (newPwd) payload.pass=newPwd;
            if (Object.keys(payload).length){
              await updateDoc(ref,payload);
              if (payload.name){ current.roomName=payload.name; const el=document.getElementById('rname-'+current.id); if (el) el.textContent=payload.name; }
              if (payload.pass){ localStorage.setItem(LS('access:'+current.id),'ok'); }
              toast('تنظیمات اتاق ذخیره شد');
            }
          }
        }
      }
    }catch(_){ toast('خطا در ذخیره تنظیمات اتاق'); }
  }
  settingsModal.removeAttribute("open");
});
// apply font immediately
fontSizeSel.addEventListener("change", ()=>{
  fontSize = fontSizeSel.value || "16px";
  document.documentElement.style.setProperty('--msg-fs', fontSize);
  localStorage.setItem(LS('fsize'), fontSize);
});

let inited=false, current=null;
function startApp(){
  mainEl.classList.remove('gated');
  if (inited) return; inited=true;

  // prevent page move
  document.addEventListener('touchmove',(e)=>{ if(!e.target.closest('#board') && !e.target.closest('.modal[open]')) e.preventDefault(); }, {passive:false});
  board.addEventListener('wheel',()=>{}, {passive:true});

  document.querySelectorAll(".room-btn").forEach(btn=>{
    btn.addEventListener('click', ()=> onRoomClick(btn.dataset.room));
  });
  backBtn.addEventListener('click', ()=>{ leaveRoom(); showRooms(); });

  refreshRoomNames();
  setInterval(refreshRoomNames, 10000);
  showRooms();
}

async function refreshRoomNames(){
  for(const id of ROOM_IDS){
    try{
      const ref=doc(db,'rooms', id);
      const d=await getDoc(ref);
      if (!d.exists()) await setDoc(ref,{name:defaultName(id), pass:'0000'},{merge:true});
      const nm = d.exists() ? (d.data().name||defaultName(id)) : defaultName(id);
      const el=document.getElementById('rname-'+id); if(el) el.textContent=nm;
    }catch{}
  }
}
const defaultName = (id)=> 'صفحه چت '+id.split('-')[1];

async function onRoomClick(roomId){
  let meta={name:defaultName(roomId), pass:'0000'};
  try{
    const ref=doc(db,'rooms', roomId);
    const d=await getDoc(ref);
    if(!d.exists()) await setDoc(ref, meta,{merge:true});
    else meta={name:d.data().name||meta.name, pass:d.data().pass||meta.pass};
  }catch{}
  const accessKey=LS('access:'+roomId);
  if (localStorage.getItem(accessKey)==='ok'){ enterRoom(roomId, meta.name); return; }
  // gate
  gateTitle.textContent='ورود به اتاق: '+meta.name;
  gateName.value=displayName||''; gatePass.value=''; gateHint.textContent='';
  openGate();
  const enter=()=>{
    const nm=(gateName.value||'').trim(); const ps=(gatePass.value||'').trim();
    if(!nm){gateName.focus();return;}
    if(ps!==(meta.pass||'0000')){gateHint.textContent='پسورد اشتباه است.';gatePass.focus();return;}
    displayName=nm; localStorage.setItem(LS('name'),displayName); localStorage.setItem(accessKey,'ok');
    closeGate(); enterRoom(roomId, meta.name);
  };
  gateEnter.onclick=enter; gateCancel.onclick=()=>closeGate();
  gateName.onkeydown=(e)=>{ if(e.key==='Enter') enter(); };
  gatePass.onkeydown=(e)=>{ if(e.key==='Enter') enter(); };
}

/* ===== Chat ===== */
function leaveRoom(){ if(!current) return; clearInterval(current.pollTimer); current=null; }
async function enterRoom(roomId, roomName){
  if(current && current.id===roomId){ showChat(); return; }
  leaveRoom();
  const msgsCol = collection(db,"rooms",roomId,"messages");
  showChat(); board.innerHTML='<div class="push"></div>';

  const rendered=new Set(); let userPinned=true;
  const isNearBottom=()=> (board.scrollHeight - board.scrollTop - board.clientHeight) < 24;
  const scrollBottom=()=> board.scrollTop=board.scrollHeight;
  board.addEventListener('scroll', ()=>{ userPinned=isNearBottom(); });

  const hashHue=(s)=>{let h=0;for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%360; return h;};
  const pad=(n)=> n<10 ? '0'+n : ''+n;
  const fmt=(ts)=>{const d=new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`;};
  const getTs=(m)=> m.ts || (m.t&&m.t.seconds!=null ? m.t.seconds*1000+Math.floor((m.t.nanoseconds||0)/1e6) : Date.now());
  function addTile({you,who,el,ts}){ const t=document.createElement('div'); t.className='tile'+(you?' you':'');
    if(!you){const hue=hashHue(who||""); t.style.background=`hsla(${hue},70%,40%,0.22)`; t.style.borderColor=`hsla(${hue},70%,55%,0.35)`;}
    const w=document.createElement('div'); w.className='who'; w.textContent=who||'ناشناس';
    const m=document.createElement('div'); m.className='meta'; m.textContent=fmt(ts||Date.now());
    t.appendChild(w); t.appendChild(el); t.appendChild(m); board.appendChild(t); }
  function renderText(m,force=false){ if(rendered.has(m.cid))return; rendered.add(m.cid);
    const el=document.createElement('div'); el.className='txt'; el.textContent=m.text;
    addTile({you:m.uid===uid,who:m.name||'ناشناس',el,ts:getTs(m)}); if(force||userPinned) scrollBottom(); }
  function renderImage(m,force=false){ if(rendered.has(m.cid))return; rendered.add(m.cid);
    const el=document.createElement('div'); const img=document.createElement('img'); img.src=m.dataUrl; img.className='thumb'; img.alt=m.name||'image';
    const link=document.createElement('a'); link.href=m.dataUrl; link.textContent='دانلود تصویر'; link.className='filelink'; link.download=m.name||'image.jpg';
    el.appendChild(img); el.appendChild(link); addTile({you:m.uid===uid,who:m.name||'ناشناس',el,ts:getTs(m)}); if(force||userPinned) scrollBottom(); }
  function renderBlob(m,force=false){ if(rendered.has(m.cid))return; rendered.add(m.cid);
    const el=document.createElement('a'); el.href=m.dataUrl; el.textContent='📄 '+(m.name||'file'); el.className='filelink'; el.download=m.name||'file';
    addTile({you:m.uid===uid,who:m.name||'ناشناس',el,ts:getTs(m)}); if(force||userPinned) scrollBottom(); }

  async function poll(){
    try{
      const snap=await getDocs(query(msgsCol,orderBy('t','asc')));
      snap.forEach(d=>{ const m=d.data(); m.cid=m.cid||d.id;
        if(m.type==='txt')renderText(m,false);
        if(m.type==='img')renderImage(m,false);
        if(m.type==='blob')renderBlob(m,false);
      });
      if(userPinned) scrollBottom();
    }catch{}
  }
  await poll(); const pollTimer=setInterval(poll,POLL_MS);
  current={id:roomId,msgsCol,pollTimer,rendered,userPinned,roomName};

  // send text
  form.onsubmit = async (e)=>{
    e.preventDefault(); if(!current) return;
    const text=(input.value||'').trim(); if(!text) return;
    const cid=Date.now()+'-'+Math.random().toString(36).slice(2); const ts=Date.now();
    renderText({type:'txt',text,uid,name:displayName,cid,ts},true); input.value='';
    try{ await addDoc(current.msgsCol,{type:'txt',text,uid,name:displayName,cid,ts,t:serverTimestamp()}); }catch{}
  };

  // upload
  const b64Bytes=(u)=>{const b64=(u.split(',')[1]||'').replace(/\s+/g,''); const pad=(b64.endsWith('==')?2:(b64.endsWith('=')?1:0)); return Math.floor(b64.length*3/4)-pad;};
  const readAsDataURL=(f)=>new Promise((res,rej)=>{const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(f);});
  async function drawToCanvas(img,w){const s=w/img.naturalWidth; const W=Math.max(1,Math.round(w)); const H=Math.max(1,Math.round(img.naturalHeight*s)); const cv=document.createElement('canvas'); cv.width=W; cv.height=H; cv.getContext('2d').drawImage(img,0,0,W,H); return cv;}
  async function compressImageSmart(file){
    const dataUrl=await readAsDataURL(file); const img=new Image(); img.decoding='async';
    await new Promise((res,rej)=>{img.onload=res; img.onerror=rej; img.src=dataUrl;});
    let w=Math.min(START_MAX_W,img.naturalWidth||START_MAX_W), q=START_QUALITY, mime='image/webp';
    try{document.createElement('canvas').toDataURL('image/webp',.5);}catch{mime='image/jpeg';}
    let out=null; for(let i=0;i<40;i++){ const cv=await drawToCanvas(img,w); try{out=cv.toDataURL(mime,q);}catch{out=cv.toDataURL('image/jpeg',q);mime='image/jpeg';}
      if(b64Bytes(out)<=MAX_BYTES) return out; if(q>MIN_QUALITY) q=Math.max(MIN_QUALITY,q*.85); else if(w>MIN_WIDTH) w=Math.max(MIN_WIDTH,Math.floor(w*.85)); else {q=Math.max(.1,q*.8); w=Math.max(32,Math.floor(w*.9));}}
    return out;
  }
  fileInput.onchange = async ()=>{
    if (!current) return;
    const file=fileInput.files?.[0]; if(!file) return;
    const cid=Date.now()+'-'+Math.random().toString(36).slice(2); const name=(file.name||'file').replace(/[^\w.\-]+/g,'_'); const ts=Date.now();
    const tmp=document.createElement('div'); tmp.className='txt'; tmp.textContent='در حال آماده‌سازی فایل — '+name; addTile({you:true,who:displayName||'من',el:tmp,ts}); scrollBottom();
    try{
      if (/\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name) || (file.type||'').startsWith('image/')){
        const dataUrl=await compressImageSmart(file); if(!dataUrl){tmp.textContent='خطا در فشرده‌سازی تصویر';return;}
        if (b64Bytes(dataUrl)>MAX_BYTES){ tmp.textContent='تصویر بسیار بزرگ است.'; return; }
        tmp.parentElement.remove(); renderImage({name,dataUrl,uid,name:displayName,cid,ts},true);
        try{ await addDoc(current.msgsCol,{type:'img',name,dataUrl,uid,name:displayName,cid,ts,t:serverTimestamp()}); }catch{}
      } else {
        const raw=await readAsDataURL(file); if(b64Bytes(raw)>MAX_BYTES){ tmp.textContent='حجم فایل زیاد است (~900KB).'; return; }
        tmp.parentElement.remove(); renderBlob({name,dataUrl:raw,uid,name:displayName,cid,ts},true);
        try{ await addDoc(current.msgsCol,{type:'blob',name,dataUrl:raw,uid,name:displayName,cid,ts,t:serverTimestamp()}); }catch{}
      }
      fileInput.value='';
    }catch{ tmp.textContent='خطا در پردازش فایل.'; }
  };
}
