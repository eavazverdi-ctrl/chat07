// v20.1: 5 fixed rooms with first-claim setup, cross-device via Firestore.
import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, getDocs, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-lite.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

const LS = (k)=> 'v20_1_'+k;
const uid = localStorage.getItem(LS('uid')) || (()=>{ const v=Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem(LS('uid'), v); return v; })();
let displayName = localStorage.getItem(LS('name')) || "";
let fontSize = localStorage.getItem(LS('fsize')) || "16px";
document.documentElement.style.setProperty('--msg-fs', fontSize);

const errToast = document.getElementById('errToast');
function toast(msg){ errToast.textContent=msg; errToast.style.display='block'; setTimeout(()=> errToast.style.display='none', 4000); }
window.addEventListener('error', e=> toast('JS: '+(e.message||'خطای ناشناخته')));
window.addEventListener('unhandledrejection', e=> toast('Promise: '+(e.reason && e.reason.message ? e.reason.message : 'خطای ناشناخته')));

const PRESET = [
  {id:'chat-1', defaultName:'صفحه چت 1'},
  {id:'chat-2', defaultName:'صفحه چت 2'},
  {id:'chat-3', defaultName:'صفحه چت 3'},
  {id:'chat-4', defaultName:'صفحه چت 4'},
  {id:'chat-5', defaultName:'صفحه چت 5'},
];
const DEFAULT_PASS = '0000';

// Elements
const roomsListEl = document.getElementById('roomsList');
const roomsView = document.getElementById('roomsView');
const chatView = document.getElementById('chatView');
const backBtn = document.getElementById('backBtn');
const board = document.getElementById('board');
const form = document.getElementById('chatForm');
const input = document.getElementById('text');
const fileInput = document.getElementById('fileInput');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPop = document.getElementById('emojiPop');
const settingsBtn = document.getElementById('settingsBtn');

// Modals
const claimModal = document.getElementById('claimModal');
const claimName = document.getElementById('claimName');
const claimPass = document.getElementById('claimPass');
const claimOK = document.getElementById('claimOK');
const claimCancel = document.getElementById('claimCancel');
const claimHint = document.getElementById('claimHint');

const roomGateModal = document.getElementById('roomGateModal');
const gateTitle = document.getElementById('gateTitle');
const gateName = document.getElementById('gateName');
const gatePass = document.getElementById('gatePass');
const gateEnter = document.getElementById('gateEnter');
const gateCancel = document.getElementById('gateCancel');
const gateHint = document.getElementById('gateHint');

const settingsModal = document.getElementById('settingsModal');
const newName = document.getElementById('newName');
const fontSizeSel = document.getElementById('fontSizeSel');
const settingsOK = document.getElementById('settingsOK');

// State
let rooms = PRESET.map(x=> ({...x, name:x.defaultName, initialized:false}));
let currentRoom = null, msgsCol=null, pollTimer=null, rendered=new Set();
let currentRoomId = null;

// UI helpers
function showRooms(){ chatView.classList.add('hidden'); roomsView.classList.remove('hidden'); }
function showChat(){ roomsView.classList.add('hidden'); chatView.classList.remove('hidden'); }
function renderRooms(){
  roomsListEl.innerHTML='';
  rooms.forEach(r=>{
    const btn = document.createElement('button');
    btn.className='room-btn'; btn.type='button';
    btn.innerHTML = `<span>${r.name}</span><span class="room-meta">${r.initialized?'🔒':'🆕'}</span>`;
    btn.addEventListener('click', ()=> onRoomClick(r));
    roomsListEl.appendChild(btn);
  });
}
renderRooms();

// fetch room states from server
async function fetchRoomStates(){
  for (const r of rooms){
    try{
      const d = await getDoc(doc(db,'rooms', r.id));
      if (d.exists()){
        const data = d.data();
        r.name = data.name || r.defaultName;
        r.initialized = !!data.initialized || !!data.pass;
      } else {
        r.name = r.defaultName;
        r.initialized = false;
      }
    }catch(e){ /* ignore network/rules */ }
  }
  renderRooms();
}
fetchRoomStates();
setInterval(fetchRoomStates, 8000);

// Click room
let pendingRoom=null;
function onRoomClick(r){
  pendingRoom = r;
  if (r.initialized){
    // already set -> gate (unless locally unlocked)
    if (localStorage.getItem(LS('access:'+r.id))==='ok'){ startRoom(r); return; }
    gateTitle.textContent='ورود به اتاق: '+(r.name||r.defaultName);
    gateHint.textContent='';
    gateName.value = displayName || '';
    gatePass.value = '';
    roomGateModal.setAttribute('open','');
    setTimeout(()=> (displayName? gatePass : gateName).focus(), 0);
  } else {
    // first claim
    claimName.value = r.name || r.defaultName;
    claimPass.value = DEFAULT_PASS;
    claimHint.textContent='';
    claimModal.setAttribute('open','');
    setTimeout(()=> claimName.focus(), 0);
  }
}
claimCancel.addEventListener('click', ()=> claimModal.removeAttribute('open'));
claimOK.addEventListener('click', async ()=>{
  const nm = (claimName.value||'').trim();
  const ps = (claimPass.value||'').trim();
  if (!nm || !ps){ claimHint.textContent='نام و پسورد را کامل کنید.'; return; }
  try{
    await setDoc(doc(db,'rooms', pendingRoom.id), { name:nm, pass:ps, initialized:true, createdAt: serverTimestamp() });
    await setDoc(doc(db,'rooms', pendingRoom.id, 'messages', '_meta'), { type:'meta', name:nm, t: serverTimestamp() });
    pendingRoom.name = nm; pendingRoom.initialized = true;
    localStorage.setItem(LS('access:'+pendingRoom.id), 'ok');
    claimModal.removeAttribute('open');
    startRoom(pendingRoom);
    renderRooms();
  }catch(e){ claimHint.textContent='خطا در ثبت — قوانین Firestore را بررسی کنید.'; }
});

// Gate flow
gateCancel.addEventListener('click', ()=> roomGateModal.removeAttribute('open'));
gateEnter.addEventListener('click', enterRoom);
gateName.addEventListener('keydown', e=>{ if (e.key==='Enter') enterRoom(e); });
gatePass.addEventListener('keydown', e=>{ if (e.key==='Enter') enterRoom(e); });
async function enterRoom(e){
  if (e) e.preventDefault();
  const n = (gateName.value||'').trim();
  const p = (gatePass.value||'').trim();
  if (!n){ gateName.focus(); return; }
  try{
    const d = await getDoc(doc(db,'rooms', pendingRoom.id));
    if (!d.exists()){ gateHint.textContent='این اتاق هنوز ساخته نشده.'; return; }
    const data = d.data(); const pass = data.pass || DEFAULT_PASS;
    if (p !== pass){ gateHint.textContent='پسورد اشتباه است.'; return; }
    displayName = n; localStorage.setItem(LS('name'), displayName);
    localStorage.setItem(LS('access:'+pendingRoom.id), 'ok');
    roomGateModal.removeAttribute('open');
    startRoom(pendingRoom);
  }catch(e){ gateHint.textContent='عدم دسترسی/شبکه — Rules را بررسی کنید.'; }
}

// Settings
settingsBtn.addEventListener('click', ()=>{
  newName.value = displayName || '';
  fontSizeSel.value = getComputedStyle(document.documentElement).getPropertyValue('--msg-fs').trim() || fontSize;
  settingsModal.setAttribute('open','');
});
settingsOK.addEventListener('click', ()=>{
  const v = (newName.value||'').trim();
  if (v){ displayName = v; localStorage.setItem(LS('name'), v); }
  fontSize = fontSizeSel.value || '16px';
  document.documentElement.style.setProperty('--msg-fs', fontSize);
  localStorage.setItem(LS('fsize'), fontSize);
  settingsModal.removeAttribute('open');
});

// Chat core
backBtn.addEventListener('click', (e)=>{ e.preventDefault(); showRooms(); if (pollTimer) clearInterval(pollTimer); currentRoomId=null; });

function clearBoard(){ board.innerHTML = '<div class=\"push\"></div>'; rendered = new Set(); }
function scrollToBottom(){ board.scrollTop = board.scrollHeight; }
let userPinnedToBottom = true;
function isNearBottom(){ return (board.scrollHeight - board.scrollTop - board.clientHeight) < 24; }
board.addEventListener('scroll', ()=>{ userPinnedToBottom = isNearBottom(); });
document.addEventListener('touchmove', (e)=>{ if (!e.target.closest('#board') && !e.target.closest('.modal[open]')) e.preventDefault(); }, {passive:false});

function pad(n){ return n<10 ? '0'+n : ''+n; }
function fmt(ts){ const d=new Date(ts); return pad(d.getHours())+':'+pad(d.getMinutes()); }
function getTs(m){ if (m.ts) return m.ts; if (m.t&&m.t.seconds!=null) return m.t.seconds*1000+Math.floor((m.t.nanoseconds||0)/1e6); return Date.now(); }
function hashHue(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%360; return h; }
function addTile({you, who, el, ts}){
  const tile = document.createElement('div'); tile.className='tile'+(you?' you':''); if (!you){ const hue=hashHue(who||''); tile.style.background=`hsla(${hue},70%,40%,0.22)`; tile.style.borderColor=`hsla(${hue},70%,55%,0.35)`; }
  const w = document.createElement('div'); w.className='who'; w.textContent = who||'ناشناس';
  const meta = document.createElement('div'); meta.className='meta'; meta.textContent = fmt(ts||Date.now());
  tile.appendChild(w); tile.appendChild(el); tile.appendChild(meta);
  board.appendChild(tile);
}

function renderText(m, force=false){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('div'); el.className='txt'; el.textContent = m.text;
  addTile({you:m.uid===uid, who:m.name||'ناشناس', el, ts:getTs(m)});
  if (force || userPinnedToBottom) scrollToBottom();
}
function renderImage(m, force=false){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('div');
  const img = document.createElement('img'); img.src = m.dataUrl; img.className='thumb'; img.alt = m.name || 'image';
  const link = document.createElement('a'); link.href = m.dataUrl; link.textContent='دانلود تصویر'; link.className='filelink'; link.download=(m.name||'image.jpg');
  el.appendChild(img); el.appendChild(link);
  addTile({you:m.uid===uid, who:m.name||'ناشناس', el, ts:getTs(m)});
  if (force || userPinnedToBottom) scrollToBottom();
}
function renderBlob(m, force=false){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('a'); el.href=m.dataUrl; el.textContent='📄 '+(m.name||'file'); el.className='filelink'; el.download=(m.name||'file');
  addTile({you:m.uid===uid, who:m.name||'ناشناس', el, ts:getTs(m)});
  if (force || userPinnedToBottom) scrollToBottom();
}

function keyLocal(roomId){ return LS('local:'+roomId); }
function loadLocalMsgs(roomId){ try{ return JSON.parse(localStorage.getItem(keyLocal(roomId))||'[]'); }catch{ return []; } }
function saveLocalMsgs(roomId, list){ localStorage.setItem(keyLocal(roomId), JSON.stringify(list)); }

async function startRoom(room){
  currentRoom = room; currentRoomId = room.id;
  showChat();
  clearBoard();
  // local first
  loadLocalMsgs(room.id).forEach(m=>{ if (m.type==='txt') renderText(m); if (m.type==='img') renderImage(m); if (m.type==='blob') renderBlob(m); });
  setTimeout(scrollToBottom, 20);
  await poll();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, 3000);
}

async function poll(){
  if (!currentRoom) return;
  try{
    const snap = await getDocs(query(collection(db,'rooms', currentRoom.id, 'messages'), orderBy('t','asc')));
    const list = [];
    snap.forEach(d=>{ const m=d.data(); m.cid=m.cid||d.id; list.push(m);
      if (m.type==='txt') renderText(m);
      if (m.type==='img') renderImage(m);
      if (m.type==='blob') renderBlob(m);
    });
    saveLocalMsgs(currentRoom.id, list.slice(-500));
    if (userPinnedToBottom) scrollToBottom();
  }catch(e){}
}

// Submit text
form.addEventListener('submit', async (e)=>{
  e.preventDefault(); e.stopPropagation();
  if (!currentRoom) return;
  const text = (input.value||'').trim(); if (!text) return;
  const cid = Date.now()+'-'+Math.random().toString(36).slice(2); const ts=Date.now();
  const m = {type:'txt', text, uid, name: displayName, cid, ts, t: serverTimestamp()};
  renderText(m, true); input.value='';
  try{ await setDoc(doc(db,'rooms', currentRoom.id, 'messages', cid), m); }catch(e){ toast('ارسال ناموفق — قواعد دسترسی؟'); }
});

// Emoji
const EMOJIS=['🙂','😂','😍','😎','👍','🙏','🔥','🎉','❤️','🌟','😉','🤔','😭','😅','👌','👏','💯','🍀','🫶','🙌','🤩','😴','😇','🤗','🤨','😐','🤝'];
function buildEmojiPop(){ emojiPop.innerHTML=''; EMOJIS.forEach(ch=>{ const b=document.createElement('button'); b.type='button'; b.textContent=ch; b.addEventListener('click', ()=> insertAtCursor(input, ch)); emojiPop.appendChild(b); }); }
buildEmojiPop();
emojiBtn.addEventListener('click', ()=> emojiPop.classList.toggle('open'));
document.addEventListener('click', (e)=>{ if (!e.target.closest('#emojiPop') && !e.target.closest('#emojiBtn')) emojiPop.classList.remove('open'); });
function insertAtCursor(el, text){ el.focus(); const s=el.selectionStart??el.value.length; const e=el.selectionEnd??el.value.length; el.value=el.value.slice(0,s)+text+el.value.slice(e); const p=s+text.length; el.setSelectionRange(p,p); }

// Files
function b64Bytes(dataUrl){ const b64=(dataUrl.split(',')[1]||'').replace(/\s+/g,''); const pad=(b64.endsWith('==')?2:(b64.endsWith('=')?1:0)); return Math.floor(b64.length*3/4)-pad; }
function readAsDataURL(file){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(file); }); }
async function drawToCanvas(img, width){ const scale=width/img.naturalWidth; const w=Math.max(1,Math.round(width)); const h=Math.max(1,Math.round(img.naturalHeight*scale)); const cv=document.createElement('canvas'); cv.width=w; cv.height=h; const ctx=cv.getContext('2d'); ctx.drawImage(img,0,0,w,h); return cv; }
let START_MAX_W=2560, START_QUALITY=.85, MIN_QUALITY=.15, MIN_WIDTH=64, MAX_BYTES=1200*1024;
async function compressImageSmart(file){
  const dataUrl = await readAsDataURL(file);
  const img = new Image(); img.decoding='async'; await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=dataUrl; });
  let width=Math.min(START_MAX_W,img.naturalWidth||START_MAX_W), quality=START_QUALITY, mime='image/webp';
  try{ const t=document.createElement('canvas'); t.toDataURL('image/webp',.5);}catch{ mime='image/jpeg'; }
  let out=null;
  for (let i=0;i<40;i++){
    const cv=await drawToCanvas(img,width); try{ out=cv.toDataURL(mime,quality);}catch{ out=cv.toDataURL('image/jpeg',quality); mime='image/jpeg'; }
    if (b64Bytes(out)<=MAX_BYTES) return out;
    if (quality>MIN_QUALITY) quality=Math.max(MIN_QUALITY,quality*.85);
    else if (width>MIN_WIDTH) width=Math.max(MIN_WIDTH,Math.floor(width*.85));
    else { quality=Math.max(.1,quality*.8); width=Math.max(32,Math.floor(width*.9)); }
  }
  return out;
}
fileInput.addEventListener('change', async ()=>{
  if (!currentRoom) return;
  const file=fileInput.files?.[0]; if (!file) return;
  const cid=Date.now()+'-'+Math.random().toString(36).slice(2); const ts=Date.now();
  const name=(file.name||'file').replace(/[^\w\.\-]+/g,'_');
  const temp=document.createElement('div'); temp.className='txt'; temp.textContent='در حال آماده‌سازی فایل — '+name; addTile({you:true, who:displayName||'من', el:temp, ts}); scrollToBottom();
  try{
    if ((name).match(/\.(png|jpe?g|gif|webp|heic|heif)$/i) || (file.type||'').startsWith('image/')){
      const dataUrl=await compressImageSmart(file); if (!dataUrl){ temp.textContent='خطا در فشرده‌سازی تصویر'; return; }
      if (b64Bytes(dataUrl)>MAX_BYTES){ temp.textContent='تصویر بسیار بزرگ است.'; return; }
      temp.parentElement.remove(); const m={type:'img', name, dataUrl, uid, name: displayName, cid, ts, t: serverTimestamp()};
      renderImage(m, true);
      try{ await setDoc(doc(db,'rooms', currentRoom.id, 'messages', cid), m); }catch(e){ toast('ارسال فایل ناموفق — Rules؟'); }
    } else {
      const raw=await readAsDataURL(file); if (b64Bytes(raw)>MAX_BYTES){ temp.textContent='حجم فایل زیاد است (~1.2MB).'; return; }
      temp.parentElement.remove(); const m={type:'blob', name, dataUrl: raw, uid, name: displayName, cid, ts, t: serverTimestamp()};
      renderBlob(m, true);
      try{ await setDoc(doc(db,'rooms', currentRoom.id, 'messages', cid), m); }catch(e){ toast('ارسال فایل ناموفق — Rules؟'); }
    }
    fileInput.value='';
  }catch(e){ temp.textContent='خطا در پردازش فایل.'; }
});
