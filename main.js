// v17.1: Modal room creation; stable chat layout; back button; gate label tweaks + cancel; remove send button.
import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-lite.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

const LS = (k)=> 'v17_1_'+k;
const uid = localStorage.getItem(LS('uid')) || (()=>{ const v=Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem(LS('uid'), v); return v; })();
let displayName = localStorage.getItem(LS('name')) || "";

const roomsListEl = document.getElementById('roomsList');
const roomsDivider = document.getElementById('roomsDivider');
const addRoomBtn = document.getElementById('addRoomBtn');
const rooms = loadRooms(); // local only

// Create-room modal
const createRoomModal = document.getElementById('createRoomModal');
const roomNameInput = document.getElementById('roomNameInput');
const roomPassInput = document.getElementById('roomPassInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const createRoomCancel = document.getElementById('createRoomCancel');

function loadRooms(){ try{ return JSON.parse(localStorage.getItem(LS('rooms'))||'[]'); }catch{ return []; } }
function saveRooms(){ localStorage.setItem(LS('rooms'), JSON.stringify(rooms)); }

function refreshRoomsUI(){
  roomsListEl.innerHTML='';
  if (rooms.length>0) roomsDivider.classList.remove('hidden'); else roomsDivider.classList.add('hidden');
  rooms.forEach(r=>{
    const btn = document.createElement('button');
    btn.className='room-btn';
    btn.innerHTML=`<span>${r.name}</span><span class="room-meta">🔒</span>`;
    btn.addEventListener('click', ()=> openGate(r));
    roomsListEl.appendChild(btn);
  });
}
refreshRoomsUI();

addRoomBtn.addEventListener('click', ()=>{
  createRoomModal.setAttribute('open','');
  roomNameInput.value=''; roomPassInput.value='';
  setTimeout(()=> roomNameInput.focus(), 0);
});
createRoomCancel.addEventListener('click', ()=> createRoomModal.removeAttribute('open'));
createRoomBtn.addEventListener('click', ()=>{
  const name = (roomNameInput.value||'').trim();
  const pass = (roomPassInput.value||'').trim();
  if (!name || !pass) return;
  const id = (name.toLowerCase().replace(/[^\w]+/g,'-').replace(/(^-|-$)/g,'')||'room') + '-' + Math.random().toString(36).slice(2,6);
  rooms.push({id, name, pass}); saveRooms(); refreshRoomsUI();
  createRoomModal.removeAttribute('open');
});

// Gate modal
const roomGateModal = document.getElementById('roomGateModal');
const gateTitle = document.getElementById('gateTitle');
const gateName = document.getElementById('gateName');
const gatePass = document.getElementById('gatePass');
const gateEnter = document.getElementById('gateEnter');
const gateCancel = document.getElementById('gateCancel');
const gateHint = document.getElementById('gateHint');
let pendingRoom=null;

function openGate(room){
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

function enterRoom(e){
  if (e) e.preventDefault();
  const n = (gateName.value||'').trim();
  const p = (gatePass.value||'').trim();
  if (!n){ gateName.focus(); return; }
  if (pendingRoom && p !== pendingRoom.pass){
    gateHint.textContent='پسورد اشتباه است.'; return;
  }
  displayName = n; localStorage.setItem(LS('name'), displayName);
  roomGateModal.removeAttribute('open');
  startRoom(pendingRoom);
}

// Chat
const chatView = document.getElementById('chatView');
const roomsView = document.getElementById('roomsView');
const backBtn = document.getElementById('backBtn');
const board = document.getElementById('board');
const form = document.getElementById('chatForm');
const input = document.getElementById('text');
const fileInput = document.getElementById('fileInput');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPop = document.getElementById('emojiPop');

let msgsCol=null, pollTimer=null, rendered=new Set();
function showChat(){ roomsView.classList.add('hidden'); chatView.classList.remove('hidden'); }
function showRooms(){ chatView.classList.add('hidden'); roomsView.classList.remove('hidden'); }
backBtn.addEventListener('click', ()=>{ showRooms(); if (pollTimer) clearInterval(pollTimer); });
function clearBoard(){ board.innerHTML = '<div class=\"push\"></div>'; rendered = new Set(); }

async function startRoom(room){
  showChat();
  clearBoard();
  msgsCol = collection(db, 'rooms', room.id, 'messages');
  await poll();
  setTimeout(scrollToBottom, 50);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, 3000);
}

function pad(n){ return n<10 ? '0'+n : ''+n; }
function fmt(ts){ const d=new Date(ts); return pad(d.getHours())+':'+pad(d.getMinutes()); }
function getTs(m){ if (m.ts) return m.ts; if (m.t&&m.t.seconds!=null) return m.t.seconds*1000+Math.floor((m.t.nanoseconds||0)/1e6); return Date.now(); }
function hashHue(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%360; return h; }
function addTile({you, who, el, ts}){
  const tile = document.createElement('div'); tile.className='tile'+(you?' you':'');
  if (!you){ const hue = hashHue(who||''); tile.style.background = `hsla(${hue},70%,40%,0.22)`; tile.style.borderColor = `hsla(${hue},70%,55%,0.35)`; }
  const w = document.createElement('div'); w.className='who'; w.textContent = who||'ناشناس';
  const meta = document.createElement('div'); meta.className='meta'; meta.textContent = fmt(ts||Date.now());
  tile.appendChild(w); tile.appendChild(el); tile.appendChild(meta);
  board.appendChild(tile);
}
function scrollToBottom(){ board.scrollTop = board.scrollHeight; }
let userPinnedToBottom = true;
function isNearBottom(){ return (board.scrollHeight - board.scrollTop - board.clientHeight) < 24; }
board.addEventListener('scroll', ()=>{ userPinnedToBottom = isNearBottom(); });
document.addEventListener('touchmove', (e)=>{ if (!e.target.closest('#board') && !e.target.closest('.modal[open]')) e.preventDefault(); }, {passive:false});

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

async function poll(){
  if (!msgsCol) return;
  try{
    const snap = await getDocs(query(msgsCol, orderBy('t','asc')));
    snap.forEach(d=>{
      const m = d.data(); m.cid = m.cid || d.id;
      if (m.type==='txt') renderText(m);
      if (m.type==='img') renderImage(m);
      if (m.type==='blob') renderBlob(m);
    });
    if (userPinnedToBottom) scrollToBottom();
  }catch(e){ /* ignore in offline/rules */ }
}

// Submit on Enter (no visible send button)
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const text = (input.value||'').trim();
  if (!text || !msgsCol) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  const ts = Date.now();
  renderText({text, uid, name: displayName, cid, ts}, true);
  input.value='';
  try{ await addDoc(msgsCol, {type:'txt', text, uid, name: displayName, cid, ts, t: serverTimestamp()}); }catch(_){}
});

// Emoji (use already-declared elements)
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

// Files inline (<=900KB after compression)
function b64Bytes(dataUrl){ const b64=(dataUrl.split(',')[1]||'').replace(/\s+/g,''); const pad=(b64.endsWith('==')?2:(b64.endsWith('=')?1:0)); return Math.floor(b64.length*3/4)-pad; }
function readAsDataURL(file){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(file); }); }
async function drawToCanvas(img, width){ const scale=width/img.naturalWidth; const w=Math.max(1,Math.round(width)); const h=Math.max(1,Math.round(img.naturalHeight*scale)); const cv=document.createElement('canvas'); cv.width=w; cv.height=h; const ctx=cv.getContext('2d'); ctx.drawImage(img,0,0,w,h); return cv; }
let START_MAX_W=2560, START_QUALITY=.85, MIN_QUALITY=.15, MIN_WIDTH=64, MAX_BYTES=900*1024;
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
  const file=fileInput.files?.[0]; if (!file || !msgsCol) return;
  const cid=Date.now()+'-'+Math.random().toString(36).slice(2); const name=(file.name||'file').replace(/[^\w\.\-]+/g,'_'); const ts=Date.now();
  const temp=document.createElement('div'); temp.className='txt'; temp.textContent='در حال آماده‌سازی فایل — '+name; addTile({you:true, who:displayName||'من', el:temp, ts}); scrollToBottom();
  try{
    if ((name).match(/\.(png|jpe?g|gif|webp|heic|heif)$/i) || (file.type||'').startsWith('image/')){
      const dataUrl=await compressImageSmart(file); if (!dataUrl){ temp.textContent='خطا در فشرده‌سازی تصویر'; return; }
      if (b64Bytes(dataUrl)>MAX_BYTES){ temp.textContent='تصویر بسیار بزرگ است.'; return; }
      temp.parentElement.remove(); renderImage({name, dataUrl, uid, name: displayName, cid, ts}, true);
      try{ await addDoc(msgsCol, {type:'img', name, dataUrl, uid, name: displayName, cid, ts, t: serverTimestamp()}); }catch(_){}
    } else {
      const raw=await readAsDataURL(file); if (b64Bytes(raw)>MAX_BYTES){ temp.textContent='حجم فایل زیاد است (~900KB).'; return; }
      temp.parentElement.remove(); renderBlob({name, dataUrl: raw, uid, name: displayName, cid, ts}, true);
      try{ await addDoc(msgsCol, {type:'blob', name, dataUrl: raw, uid, name: displayName, cid, ts, t: serverTimestamp()}); }catch(_){}
    }
    fileInput.value='';
  }catch(e){ temp.textContent='خطا در پردازش فایل.'; }
});
