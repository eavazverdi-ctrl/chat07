// v20: robust rooms sync (rooms + _meta), list polling, fixed button types, send/upload handlers, error toast.
import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, collection, collectionGroup, addDoc, setDoc, serverTimestamp, getDocs, orderBy, query, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-lite.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

const LS = (k)=> 'v20_'+k;
const uid = localStorage.getItem(LS('uid')) || (()=>{ const v=Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem(LS('uid'), v); return v; })();
let displayName = localStorage.getItem(LS('name')) || "";
let fontSize = localStorage.getItem(LS('fsize')) || "16px";
document.documentElement.style.setProperty('--msg-fs', fontSize);

const errToast = document.getElementById('errToast');
function toast(msg){ errToast.textContent = msg; errToast.style.display='block'; setTimeout(()=> errToast.style.display='none', 4000); }
window.addEventListener('error', e=> toast('JS: '+(e.message||'خطای ناشناخته')));
window.addEventListener('unhandledrejection', e=> toast('Promise: '+(e.reason && e.reason.message ? e.reason.message : 'خطای ناشناخته')));

// Elements
const roomsListEl = document.getElementById('roomsList');
const roomsDivider = document.getElementById('roomsDivider');
const addRoomBtn = document.getElementById('addRoomBtn');
const createRoomModal = document.getElementById('createRoomModal');
const roomNameInput = document.getElementById('roomNameInput');
const roomPassInput = document.getElementById('roomPassInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const createRoomCancel = document.getElementById('createRoomCancel');
const createHint = document.getElementById('createHint');

const chatView = document.getElementById('chatView');
const roomsView = document.getElementById('roomsView');
const backBtn = document.getElementById('backBtn');
const board = document.getElementById('board');
const form = document.getElementById('chatForm');
const input = document.getElementById('text');
const fileInput = document.getElementById('fileInput');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPop = document.getElementById('emojiPop');
const settingsBtn = document.getElementById('settingsBtn');

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
let rooms = loadRoomsLocal(); // {id,name,pass?}
let roomsById = new Map(rooms.map(r=>[r.id,r]));
let pendingRoom = null;
let msgsCol = null, pollTimer = null, rendered = new Set();
let currentRoomId = null;

// ---------- Rooms UI ----------
function renderRooms(list){
  roomsListEl.innerHTML='';
  if (list.length>0) roomsDivider.classList.remove('hidden'); else roomsDivider.classList.add('hidden');
  list.forEach(r=>{
    const btn = document.createElement('button');
    btn.className='room-btn';
    btn.type='button';
    btn.innerHTML=`<span>${r.name}</span><span class="room-meta">🔒</span>`;
    btn.addEventListener('click', ()=> openGate(r));
    roomsListEl.appendChild(btn);
  });
}
renderRooms(rooms);

function saveRoomsLocal(arr){ localStorage.setItem(LS('rooms'), JSON.stringify(arr)); }
function loadRoomsLocal(){ try{ return JSON.parse(localStorage.getItem(LS('rooms'))||'[]'); }catch{ return []; } }

async function refreshRoomsFromServer(){
  let updated = false;
  // try rooms collection
  try{
    const snap = await getDocs(query(collection(db,'rooms'), orderBy('createdAt','asc')));
    const serverRooms = [];
    snap.forEach(d=>{ const r=d.data(); serverRooms.push({id:d.id,name:r.name||d.id,pass:r.pass||''}); });
    if (serverRooms.length){ updated = true; }
    mergeRooms(serverRooms);
  }catch(e){ /* ignore */ }
  // try collectionGroup on messages meta
  try{
    const cg = await getDocs(query(collectionGroup(db,'messages'), orderBy('t','asc')));
    const meta = [];
    cg.forEach(d=>{ const m=d.data(); if (m && m.type==='meta'){ const roomId = d.ref.parent.parent.id; meta.push({id:roomId,name:m.name||roomId,pass:m.pass||''}); } });
    if (meta.length){ updated = true; }
    mergeRooms(meta);
  }catch(e){ /* ignore */ }
  if (updated){ renderRooms(rooms); saveRoomsLocal(rooms); }
}
function mergeRooms(list){
  const byId = new Map(rooms.map(r=>[r.id,r]));
  list.forEach(r=> byId.set(r.id, r));
  rooms = Array.from(byId.values());
  roomsById = new Map(rooms.map(r=>[r.id,r]));
}

// poll room list every 7s
setInterval(refreshRoomsFromServer, 7000);
refreshRoomsFromServer();

// Create room flow
addRoomBtn.addEventListener('click', ()=>{
  createRoomModal.setAttribute('open','');
  roomNameInput.value=''; roomPassInput.value=''; createHint.textContent='';
  setTimeout(()=> roomNameInput.focus(), 0);
});
createRoomCancel.addEventListener('click', ()=> createRoomModal.removeAttribute('open'));
createRoomBtn.addEventListener('click', async ()=>{
  const name = (roomNameInput.value||'').trim();
  const pass = (roomPassInput.value||'').trim();
  if (!name || !pass){ createHint.textContent='نام و پسورد را وارد کنید.'; return; }
  const id = (name.toLowerCase().replace(/[^\w]+/g,'-').replace(/(^-|-$)/g,'')||'room') + '-' + Math.random().toString(36).slice(2,6);
  const r = { id, name, pass };
  // optimistic local
  rooms.push(r); roomsById.set(id, r); saveRoomsLocal(rooms); renderRooms(rooms);
  createRoomModal.removeAttribute('open');
  // server writes (best-effort)
  try{ await setDoc(doc(db,'rooms',id), { name, pass, createdAt: serverTimestamp() }); }catch(e){ toast('اتاق محلی ساخته شد (سرور در دسترس نیست)'); }
  try{ await setDoc(doc(db,'rooms',id,'messages','_meta'), { type:'meta', name, pass, t: serverTimestamp() }); }catch(e){}
  refreshRoomsFromServer();
});

// Gate modal
function openGate(room){
  if (localStorage.getItem(LS('access:'+room.id))==='ok'){
    startRoom(room);
    return;
  }
  pendingRoom = room;
  gateTitle.textContent = 'ورود به اتاق: ' + (room?.name || '');
  gateHint.textContent='';
  gateName.value = displayName || '';
  gatePass.value = '';
  roomGateModal.setAttribute('open','');
  setTimeout(()=> (displayName? gatePass : gateName).focus(), 0);
}
gateCancel.addEventListener('click', ()=> roomGateModal.removeAttribute('open'));
gateEnter.addEventListener('click', enterRoom);
gateName.addEventListener('keydown', e=>{ if (e.key==='Enter') enterRoom(e); });
gatePass.addEventListener('keydown', e=>{ if (e.key==='Enter') enterRoom(e); });

async function ensureRoomPass(room){
  if (room.pass) return room.pass;
  try{
    const s = await getDoc(doc(db,'rooms', room.id));
    if (s.exists()){ const data=s.data(); room.pass=data.pass||''; roomsById.set(room.id, room); saveRoomsLocal(rooms); return room.pass; }
  }catch(e){}
  try{
    const s = await getDoc(doc(db,'rooms', room.id, 'messages', '_meta'));
    if (s.exists()){ const data=s.data(); room.pass=data.pass||''; roomsById.set(room.id, room); saveRoomsLocal(rooms); return room.pass; }
  }catch(e){}
  return '';
}
async function enterRoom(e){
  if (e) e.preventDefault();
  const n = (gateName.value||'').trim();
  const p = (gatePass.value||'').trim();
  if (!n){ gateName.focus(); return; }
  const pass = await ensureRoomPass(pendingRoom);
  if (!pass){ gateHint.textContent='پسورد اتاق در دسترس نیست.'; return; }
  if (p !== pass){ gateHint.textContent='پسورد اشتباه است.'; return; }
  displayName = n; localStorage.setItem(LS('name'), displayName);
  localStorage.setItem(LS('access:'+pendingRoom.id), 'ok');
  roomGateModal.removeAttribute('open');
  startRoom(pendingRoom);
}

// ---------- Chat ----------
const settingsModal = document.getElementById('settingsModal');
const newName = document.getElementById('newName');
const fontSizeSel = document.getElementById('fontSizeSel');
const settingsOK = document.getElementById('settingsOK');

settingsBtn.addEventListener('click', ()=>{
  newName.value = displayName || '';
  fontSizeSel.value = fontSize;
  settingsModal.setAttribute('open','');
});
settingsOK.addEventListener('click', ()=>{
  const v = (newName.value||'').trim();
  if (v && v !== displayName){ displayName = v; localStorage.setItem(LS('name'), v); }
  fontSize = fontSizeSel.value || '16px';
  document.documentElement.style.setProperty('--msg-fs', fontSize);
  localStorage.setItem(LS('fsize'), fontSize);
  settingsModal.removeAttribute('open');
});

function showChat(){ roomsView.classList.add('hidden'); chatView.classList.remove('hidden'); }
function showRooms(){ chatView.classList.add('hidden'); roomsView.classList.remove('hidden'); }
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

// Local store per room
function keyLocal(roomId){ return LS('local:'+roomId); }
function keyUnsent(roomId){ return LS('unsent:'+roomId); }
function loadLocalMsgs(roomId){ try{ return JSON.parse(localStorage.getItem(keyLocal(roomId))||'[]'); }catch{ return []; } }
function saveLocalMsgs(roomId, list){ localStorage.setItem(keyLocal(roomId), JSON.stringify(list)); }
function loadUnsent(roomId){ try{ return JSON.parse(localStorage.getItem(keyUnsent(roomId))||'[]'); }catch{ return []; } }
function saveUnsent(roomId, list){ localStorage.setItem(keyUnsent(roomId), JSON.stringify(list)); }

// Start room
async function startRoom(room){
  currentRoomId = room.id;
  showChat();
  clearBoard();
  // render local first
  const local = loadLocalMsgs(room.id);
  local.forEach(m=>{ if (m.type==='txt') renderText(m); if (m.type==='img') renderImage(m); if (m.type==='blob') renderBlob(m); });
  setTimeout(scrollToBottom, 10);
  msgsCol = collection(db, 'rooms', room.id, 'messages');
  await poll(); // server overlay
  setTimeout(scrollToBottom, 50);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async ()=>{ await poll(); await flushUnsent(); }, 3000);
}

// Merge server snapshot
async function poll(){
  if (!msgsCol) return;
  try{
    const snap = await getDocs(query(msgsCol, orderBy('t','asc')));
    const srv = [];
    snap.forEach(d=>{
      const m = d.data(); m.cid = m.cid || d.id; srv.push(m);
      if (m.type==='txt') renderText(m);
      if (m.type==='img') renderImage(m);
      if (m.type==='blob') renderBlob(m);
    });
    const trimmed = srv.slice(-500);
    saveLocalMsgs(currentRoomId, trimmed);
    if (userPinnedToBottom) scrollToBottom();
  }catch(e){ /* ignore */ }
}

// Submit (Enter only)
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  e.stopPropagation();
  const text = (input.value||'').trim();
  if (!text || !currentRoomId) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  const ts = Date.now();
  const m = {type:'txt', text, uid, name: displayName, cid, ts, t: serverTimestamp()};
  renderText(m, true);
  const loc = loadLocalMsgs(currentRoomId); loc.push(m); saveLocalMsgs(currentRoomId, loc.slice(-500));
  input.value='';
  try{ await setDoc(doc(db,'rooms',currentRoomId,'messages',cid), m); }
  catch(e){ const q = loadUnsent(currentRoomId); q.push(m); saveUnsent(currentRoomId, q.slice(-200)); toast('ارسال در صف آفلاین قرار گرفت'); }
});

// Unsent flush
async function flushUnsent(){
  const q = loadUnsent(currentRoomId); if (!q.length) return;
  const rest = [];
  for (const m of q){
    try{ await setDoc(doc(db,'rooms',currentRoomId,'messages',m.cid), m); }
    catch(e){ rest.push(m); }
  }
  saveUnsent(currentRoomId, rest);
}

// Emoji
const EMOJIS = ['🙂','😂','😍','😎','👍','🙏','🔥','🎉','❤️','🌟','😉','🤔','😭','😅','👌','👏','💯','🍀','🫶','🙌','🤩','😴','😇','🤗','🤨','😐','🤝'];
function buildEmojiPop(){
  emojiPop.innerHTML='';
  EMOJIS.forEach(ch=>{
    const b=document.createElement('button'); b.type='button'; b.textContent=ch;
    b.addEventListener('click', ()=> insertAtCursor(input, ch));
    emojiPop.appendChild(b);
  });
}
buildEmojiPop();
emojiBtn.addEventListener('click', ()=> emojiPop.classList.toggle('open'));
document.addEventListener('click', (e)=>{ if (!e.target.closest('#emojiPop') && !e.target.closest('#emojiBtn')) emojiPop.classList.remove('open'); });
function insertAtCursor(el, text){
  el.focus(); const s=el.selectionStart??el.value.length; const e=el.selectionEnd??el.value.length;
  el.value = el.value.slice(0,s) + text + el.value.slice(e);
  const p=s+text.length; el.setSelectionRange(p,p);
}

// Files inline with compression
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
  const file=fileInput.files?.[0]; if (!file || !currentRoomId) return;
  const cid=Date.now()+'-'+Math.random().toString(36).slice(2);
  const name=(file.name||'file').replace(/[^\w\.\-]+/g,'_'); const ts=Date.now();
  const temp=document.createElement('div'); temp.className='txt'; temp.textContent='در حال آماده‌سازی فایل — '+name; addTile({you:true, who:displayName||'من', el:temp, ts}); scrollToBottom();
  try{
    if ((name).match(/\.(png|jpe?g|gif|webp|heic|heif)$/i) || (file.type||'').startsWith('image/')){
      const dataUrl=await compressImageSmart(file); if (!dataUrl){ temp.textContent='خطا در فشرده‌سازی تصویر'; return; }
      if (b64Bytes(dataUrl)>MAX_BYTES){ temp.textContent='تصویر بسیار بزرگ است.'; return; }
      temp.parentElement.remove(); const m={type:'img', name, dataUrl, uid, name: displayName, cid, ts, t: serverTimestamp()};
      renderImage(m, true);
      const loc=loadLocalMsgs(currentRoomId); loc.push(m); saveLocalMsgs(currentRoomId, loc.slice(-500));
      try{ await setDoc(doc(db,'rooms',currentRoomId,'messages',cid), m); }
      catch(e){ const q=loadUnsent(currentRoomId); q.push(m); saveUnsent(currentRoomId, q.slice(-200)); toast('ارسال فایل در صف آفلاین قرار گرفت'); }
    } else {
      const raw=await readAsDataURL(file); if (b64Bytes(raw)>MAX_BYTES){ temp.textContent='حجم فایل زیاد است (~1.2MB).'; return; }
      temp.parentElement.remove(); const m={type:'blob', name, dataUrl: raw, uid, name: displayName, cid, ts, t: serverTimestamp()};
      renderBlob(m, true);
      const loc=loadLocalMsgs(currentRoomId); loc.push(m); saveLocalMsgs(currentRoomId, loc.slice(-500));
      try{ await setDoc(doc(db,'rooms',currentRoomId,'messages',cid), m); }
      catch(e){ const q=loadUnsent(currentRoomId); q.push(m); saveUnsent(currentRoomId, q.slice(-200)); toast('ارسال فایل در صف آفلاین قرار گرفت'); }
    }
    fileInput.value='';
  }catch(e){ temp.textContent='خطا در پردازش فایل.'; }
});
