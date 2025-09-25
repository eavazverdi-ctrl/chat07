// v16: Start with rooms view; per-room gate (name + pass) once; divider; cache passes; CSP-friendly (firestore-lite)
const WIPE_PASSWORD = "delete all";
const MAX_BYTES = 900 * 1024;
let START_MAX_W = 2560, START_QUALITY = 0.85, MIN_QUALITY = 0.15, MIN_WIDTH = 64;

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query, doc, setDoc, writeBatch, getDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-lite.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

const LS = (k)=> 'v16_'+k;
const uid = localStorage.getItem(LS('uid')) || (()=>{ const v=Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem(LS('uid'), v); return v; })();
let displayName = localStorage.getItem(LS('name')) || "";
let fontSize = localStorage.getItem(LS('fsize')) || "16px";
document.documentElement.style.setProperty('--msg-fs', fontSize);

// Elements
const roomsView = document.getElementById('roomsView');
const roomsList = document.getElementById('roomsList');
const roomsDivider = document.getElementById('roomsDivider');
const addRoomBtn = document.getElementById('addRoomBtn');

const chatView = document.getElementById('chatView');
const board = document.getElementById('board');
const form = document.getElementById('chatForm');
const input = document.getElementById('text');
const fileInput = document.getElementById('fileInput');
const sendBtn = document.getElementById('sendBtn');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPop = document.getElementById('emojiPop');

// Gate modal
const roomGateModal = document.getElementById('roomGateModal');
const gateTitle = document.getElementById('gateTitle');
const gateName = document.getElementById('gateName');
const gatePass = document.getElementById('gatePass');
const gateEnter = document.getElementById('gateEnter');
const gateHint = document.getElementById('gateHint');

// Settings elements
const settingsModal = document.getElementById('settingsModal');
const newName = document.getElementById('newName');
const fontSizeSel = document.getElementById('fontSizeSel');
const wipePass = document.getElementById('wipePass');
const wipeBtn = document.getElementById('wipeBtn');
const wipeStatus = document.getElementById('wipeStatus');
const settingsOK = document.getElementById('settingsOK');

// ---------------- Rooms ----------------
const roomsCache = new Map();
async function loadRooms(){
  roomsList.innerHTML = "";
  roomsDivider.classList.add('hidden');
  try{
    const snap = await getDocs(query(collection(db,'rooms'), orderBy('createdAt','asc')));
    if (snap.empty){
      // فقط دکمه ایجاد اتاق می‌ماند
      const hint = document.createElement('div'); hint.className='hint'; hint.textContent='هنوز هیچ اتاقی ساخته نشده است.';
      roomsList.appendChild(hint);
    }else{
      roomsDivider.classList.remove('hidden');
      snap.forEach(d=>{
        const r = d.data();
        roomsCache.set(d.id, r);
        const btn = document.createElement('button');
        btn.className = 'room-btn';
        btn.innerHTML = '<span>'+ (r.name||d.id) +'</span><span class="room-meta">🔒</span>';
        btn.addEventListener('click', ()=> openRoomGate(d.id, r.name||d.id));
        roomsList.appendChild(btn);
      });
    }
  }catch(err){
    const p = document.createElement('div'); p.className='hint'; p.textContent = 'مشکل در خواندن اتاق‌ها (Rules/Network).';
    roomsList.appendChild(p);
  }
}
loadRooms();

// create room
addRoomBtn.addEventListener('click', async ()=>{
  // ساده: با prompt می‌گیریم (برای سرعت). اگر خواستی همان مودال نسخه‌های قبل را برگردانم.
  const name = prompt('نام اتاق؟');
  if (!name) return;
  const pass = prompt('پسورد اتاق؟');
  if (!pass) return;
  const slug = name.toLowerCase().replace(/[^\w]+/g,'-').replace(/(^-|-$)/g,'');
  const rand = Math.random().toString(36).slice(2,6);
  const id = (slug || 'room') + '-' + rand;
  try{
    await setDoc(doc(db,'rooms',id), { name, pass, createdAt: serverTimestamp() });
    await loadRooms();
    openRoomGate(id, name); // بلافاصله نشان بده
  }catch(e){
    alert('ساخت اتاق با خطا مواجه شد (Rules/Network).');
  }
});

// gate per room
let pendingRoomId=null, pendingRoomName=null;
function openRoomGate(id, name){
  // اگر قبلاً این کاربر وارد شده، مستقیم برو داخل
  if (localStorage.getItem(LS('access:'+id)) === 'ok'){
    startRoom(id, name);
    return;
  }
  pendingRoomId = id; pendingRoomName = name;
  gateTitle.textContent = 'ورود به اتاق: ' + name;
  gateHint.textContent = '';
  gatePass.value = '';
  if (!displayName) { gateName.value = ''; } else { gateName.value = displayName; }
  roomGateModal.setAttribute('open','');
  setTimeout(()=> (displayName? gatePass : gateName).focus(), 0);
}
gateEnter.addEventListener('click', enterRoomWithPass);
gateName.addEventListener('keydown', e=>{ if (e.key==='Enter') enterRoomWithPass(e); });
gatePass.addEventListener('keydown', e=>{ if (e.key==='Enter') enterRoomWithPass(e); });

async function enterRoomWithPass(e){
  if (e) e.preventDefault();
  const n = (gateName.value||'').trim();
  const p = (gatePass.value||'').trim();
  if (!n){ gateName.focus(); return; }
  // اگر قبلاً وارد شده بود، پ را نادیده بگیر
  const cached = roomsCache.get(pendingRoomId);
  if (cached){
    if ((cached.pass||'') !== p && localStorage.getItem(LS('access:'+pendingRoomId))!=='ok'){
      gateHint.textContent = 'پسورد اشتباه است.'; return;
    }
    displayName = n; localStorage.setItem(LS('name'), displayName);
    localStorage.setItem(LS('access:'+pendingRoomId), 'ok');
    roomGateModal.removeAttribute('open');
    startRoom(pendingRoomId, pendingRoomName);
    return;
  }
  // fallback به getDoc در صورت نبود کش
  try{
    const ref = doc(db, 'rooms', pendingRoomId);
    const snap = await getDoc(ref);
    if (!snap.exists()){ gateHint.textContent='اتاق یافت نشد.'; return; }
    const r = snap.data();
    if ((r.pass||'') !== p){ gateHint.textContent='پسورد اشتباه است.'; return; }
    displayName = n; localStorage.setItem(LS('name'), displayName);
    localStorage.setItem(LS('access:'+pendingRoomId), 'ok');
    roomGateModal.removeAttribute('open');
    startRoom(pendingRoomId, pendingRoomName);
  }catch(err){
    gateHint.textContent='خطای شبکه/دسترسی.';
  }
}

// ---------------- Chat ----------------
let pollTimer=null, rendered=new Set(), msgsCol=null;

function clearBoard(){ board.innerHTML = '<div class="push"></div>'; rendered = new Set(); }
function showChat(){ roomsView.classList.add('hidden'); chatView.classList.remove('hidden'); }
function showRooms(){ chatView.classList.add('hidden'); roomsView.classList.remove('hidden'); }

async function startRoom(roomId, name){
  clearBoard();
  showChat();
  msgsCol = collection(db, 'rooms', roomId, 'messages');
  await poll();
  setTimeout(()=> scrollToBottom(), 50);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, 3000);
}

function hashHue(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))%360; return h; }
function pad(n){ return n<10 ? '0'+n : ''+n; }
function fmt(ts){ const d=new Date(ts); return pad(d.getHours())+':'+pad(d.getMinutes()); }
function getTs(m){ if (m.ts) return m.ts; if (m.t&&m.t.seconds!=null) return m.t.seconds*1000+Math.floor((m.t.nanoseconds||0)/1e6); return Date.now(); }
function scrollToBottom(){ board.scrollTop = board.scrollHeight; }

let userPinnedToBottom = true;
function isNearBottom(){ return (board.scrollHeight - board.scrollTop - board.clientHeight) < 24; }
board.addEventListener('scroll', ()=>{ userPinnedToBottom = isNearBottom(); });

document.addEventListener('touchmove', (e)=>{
  if (!e.target.closest('#board') && !e.target.closest('.modal[open]')) e.preventDefault();
}, {passive:false});

function addTile({you, who, el, ts}){
  const tile = document.createElement('div'); tile.className = 'tile' + (you? ' you' : '');
  if (!you){
    const hue = hashHue(who||"");
    tile.style.background = 'hsla('+hue+',70%,40%,0.22)';
    tile.style.borderColor = 'hsla('+hue+',70%,55%,0.35)';
  }
  const w = document.createElement('div'); w.className='who'; w.textContent = who || 'ناشناس';
  const meta = document.createElement('div'); meta.className='meta'; meta.textContent = fmt(ts||Date.now());
  tile.appendChild(w); tile.appendChild(el); tile.appendChild(meta);
  board.appendChild(tile);
}

function renderText(m, forceScroll=false){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('div'); el.className='txt'; el.textContent = m.text;
  addTile({you: m.uid===uid, who: m.name || 'ناشناس', el, ts: getTs(m)});
  if (forceScroll || userPinnedToBottom) scrollToBottom();
}
function renderImage(m, forceScroll=false){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('div');
  const img = document.createElement('img'); img.src = m.dataUrl; img.className='thumb'; img.alt = m.name || 'image';
  const link = document.createElement('a'); link.href = m.dataUrl; link.textContent = 'دانلود تصویر'; link.className='filelink'; link.download = (m.name||'image.jpg');
  el.appendChild(img); el.appendChild(link);
  addTile({you: m.uid===uid, who: m.name || 'ناشناس', el, ts: getTs(m)});
  if (forceScroll || userPinnedToBottom) scrollToBottom();
}
function renderBlob(m, forceScroll=false){
  if (rendered.has(m.cid)) return; rendered.add(m.cid);
  const el = document.createElement('a'); el.href = m.dataUrl; el.textContent = '📄 '+(m.name||'file'); el.className='filelink'; el.download = (m.name||'file');
  addTile({you: m.uid===uid, who: m.name || 'ناشناس', el, ts: getTs(m)});
  if (forceScroll || userPinnedToBottom) scrollToBottom();
}

async function poll(){
  if (!msgsCol) return;
  try{
    const snap = await getDocs(query(msgsCol, orderBy('t','asc')));
    snap.forEach(d=>{
      const m = d.data(); m.cid = m.cid || d.id;
      if (m.type==='txt') renderText(m, false);
      if (m.type==='img') renderImage(m, false);
      if (m.type==='blob') renderBlob(m, false);
    });
    if (userPinnedToBottom) scrollToBottom();
  }catch(e){ /* ignore */ }
}

// Submit
form.addEventListener('submit', sendMessage);
sendBtn.addEventListener('click', sendMessage);
async function sendMessage(e){
  e.preventDefault();
  if (!msgsCol) { alert('ابتدا یک اتاق را انتخاب کنید.'); return; }
  const text = (input.value||'').trim();
  if (!text) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  const ts = Date.now();
  renderText({text, uid, name: displayName, cid, ts}, true);
  input.value='';
  try{
    await addDoc(msgsCol, {type:'txt', text, uid, name: displayName, cid, ts, t: serverTimestamp()});
  }catch(e){ /* ignore */ }
}

// Emoji
const EMOJIS = ['🙂','😂','😍','😎','👍','🙏','🔥','🎉','❤️','🌟','😉','🤔','😭','😅','👌','👏','💯','🍀','🫶','🙌','🤩','😴','😇','🤗','🤨','😐','🤝'];
function buildEmojiPop(){
  emojiPop.innerHTML = '';
  EMOJIS.forEach(ch=>{
    const b = document.createElement('button'); b.type='button'; b.textContent = ch;
    b.addEventListener('click', ()=> insertAtCursor(input, ch));
    emojiPop.appendChild(b);
  });
}
buildEmojiPop();
emojiBtn.addEventListener('click', ()=>{ emojiPop.classList.toggle('open'); });
document.addEventListener('click', (e)=>{ if (!e.target.closest('#emojiPop') && !e.target.closest('#emojiBtn')) emojiPop.classList.remove('open'); });
function insertAtCursor(el, text){
  el.focus();
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0,start);
  const after = el.value.slice(end);
  el.value = before + text + after;
  const pos = start + text.length;
  el.setSelectionRange(pos, pos);
}

// Files inline
function b64Bytes(dataUrl){
  const b64 = (dataUrl.split(',')[1]||'').replace(/\s+/g,'');
  const pad = (b64.endsWith('==')?2:(b64.endsWith('=')?1:0));
  return Math.floor(b64.length*3/4) - pad;
}
function readAsDataURL(file){
  return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(file); });
}
async function drawToCanvas(img, width){
  const scale = width / img.naturalWidth;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return cv;
}
async function compressImageSmart(file){
  const dataUrl = await readAsDataURL(file);
  const img = new Image(); img.decoding='async';
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=dataUrl; });
  let width = Math.min(START_MAX_W, img.naturalWidth || START_MAX_W);
  let quality = START_QUALITY;
  let mime = 'image/webp';
  try { const cv0 = document.createElement('canvas'); cv0.toDataURL('image/webp', .5); } catch { mime = 'image/jpeg'; }
  let out = null;
  for (let i=0;i<40;i++){
    const cv = await drawToCanvas(img, width);
    try { out = cv.toDataURL(mime, quality); }
    catch { out = cv.toDataURL('image/jpeg', quality); mime='image/jpeg'; }
    if (b64Bytes(out) <= MAX_BYTES) return out;
    if (quality > MIN_QUALITY) quality = Math.max(MIN_QUALITY, quality * 0.85);
    else if (width > MIN_WIDTH) width = Math.max(MIN_WIDTH, Math.floor(width * 0.85));
    else { quality = Math.max(0.1, quality * 0.8); width = Math.max(32, Math.floor(width * 0.9)); }
  }
  return out;
}

fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0];
  if (!file) return;
  if (!msgsCol) { alert('ابتدا یک اتاق را انتخاب کنید.'); return; }

  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  const safeName = (file.name || 'file').replace(/[^\w\.\-]+/g,'_');
  const ts = Date.now();

  const temp = document.createElement('div'); temp.className='txt'; temp.textContent = 'در حال آماده‌سازی فایل — ' + safeName;
  addTile({you:true, who: displayName || 'من', el: temp, ts});
  scrollToBottom();

  try{
    if ((safeName).match(/\.(png|jpe?g|gif|webp|heic|heif)$/i) || (file.type||'').startsWith('image/')) {
      const dataUrl = await compressImageSmart(file);
      if (!dataUrl) { temp.textContent = 'خطا در فشرده‌سازی تصویر'; return; }
      if (b64Bytes(dataUrl) > MAX_BYTES) { temp.textContent = 'تصویر بسیار بزرگ است؛ دوباره تلاش کنید.'; return; }
      temp.parentElement.remove();
      renderImage({name:safeName, dataUrl, uid, name: displayName, cid, ts}, true);
      await addDoc(msgsCol, {type:'img', name:safeName, dataUrl, uid, name: displayName, cid, ts, t: serverTimestamp()});
    } else {
      const raw = await readAsDataURL(file);
      if (b64Bytes(raw) > MAX_BYTES) { temp.textContent = 'حجم فایل زیاد است (~900KB).'; return; }
      temp.parentElement.remove();
      renderBlob({name:safeName, dataUrl: raw, uid, name: displayName, cid, ts}, true);
      await addDoc(msgsCol, {type:'blob', name:safeName, dataUrl: raw, uid, name: displayName, cid, ts, t: serverTimestamp()});
    }
    fileInput.value='';
  }catch(e){
    temp.textContent = 'خطا در پردازش فایل (مرورگر/حافظه).';
  }
});

// Settings
settingsOK.addEventListener('click', ()=>{
  const v = (newName.value||'').trim();
  if (v && v !== displayName){
    displayName = v;
    localStorage.setItem(LS('name'), displayName);
  }
  settingsModal.removeAttribute('open');
});
fontSizeSel.addEventListener('change', ()=>{
  fontSize = fontSizeSel.value || '16px';
  document.documentElement.style.setProperty('--msg-fs', fontSize);
  localStorage.setItem(LS('fsize'), fontSize);
});
wipeBtn.addEventListener('click', async (e)=>{
  e.preventDefault();
  const pw = (wipePass.value||'').trim();
  if (pw !== WIPE_PASSWORD){ wipeStatus.textContent='رمز حذف صحیح نیست.'; return; }
  if (!msgsCol){ wipeStatus.textContent='ابتدا وارد اتاق شوید.'; return; }
  wipeStatus.textContent='در حال حذف...';
  try{
    while (true){
      const snap = await getDocs(query(msgsCol));
      if (snap.empty) break;
      const batch = writeBatch(db);
      let count = 0;
      snap.forEach(d=>{ if (count < 450){ batch.delete(d.ref); count++; } });
      if (count === 0) break;
      await batch.commit();
    }
    clearBoard();
    wipeStatus.textContent='همه پیام‌های این اتاق حذف شد.';
  }catch(e){
    wipeStatus.textContent='خطا در حذف (Rules/Network).';
  }
});
