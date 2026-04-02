import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getDatabase, ref, get, set, update, onValue, remove, off } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const tapStart = document.getElementById('tapStart');
const bgmVolume = document.getElementById('bgmVolume');
const sfxVolume = document.getElementById('sfxVolume');
const bgmOut = document.getElementById('bgmOut');
const sfxOut = document.getElementById('sfxOut');
const STORAGE = { bgm:'gy_bgm_volume', sfx:'gy_sfx_volume', unlocked:'gy_audio_unlocked' };
const menuBgm = new Audio('./bgm/menu.mp3');
menuBgm.loop = true;
menuBgm.preload = 'auto';
function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function getStoredVolume(key, fallback){ const raw = localStorage.getItem(key); const n = raw===null?fallback:Number(raw); return Number.isFinite(n)?clamp01(n):fallback; }
function setStoredVolume(key, value){ localStorage.setItem(key, String(clamp01(value))); }
function applyAudioPrefs(){
  const bgm = getStoredVolume(STORAGE.bgm, 0.65);
  const sfx = getStoredVolume(STORAGE.sfx, 0.75);
  if(bgmVolume){ bgmVolume.value = String(Math.round(bgm*100)); if(bgmOut) bgmOut.textContent = `${Math.round(bgm*100)}%`; }
  if(sfxVolume){ sfxVolume.value = String(Math.round(sfx*100)); if(sfxOut) sfxOut.textContent = `${Math.round(sfx*100)}%`; }
  menuBgm.volume = bgm;
}
function tryPlayMenuBgm(){ menuBgm.volume = getStoredVolume(STORAGE.bgm, 0.65); menuBgm.play().then(()=>localStorage.setItem(STORAGE.unlocked,'1')).catch(()=>{}); }
function unlockAndEnter(){
  localStorage.setItem(STORAGE.unlocked,'1');
  if(tapStart) tapStart.classList.add('hide');
  tryPlayMenuBgm();
}
applyAudioPrefs();
if(bgmVolume){ bgmVolume.addEventListener('input', ()=>{ const v = Number(bgmVolume.value)/100; setStoredVolume(STORAGE.bgm,v); menuBgm.volume=v; if(bgmOut) bgmOut.textContent=`${bgmVolume.value}%`; }); }
if(sfxVolume){ sfxVolume.addEventListener('input', ()=>{ const v = Number(sfxVolume.value)/100; setStoredVolume(STORAGE.sfx,v); if(sfxOut) sfxOut.textContent=`${sfxVolume.value}%`; }); }
if(tapStart){ tapStart.addEventListener('click', unlockAndEnter); }
window.addEventListener('beforeunload', ()=>{ menuBgm.pause(); menuBgm.currentTime = 0; });

const roleSelect = document.getElementById('roleSelect');
const createBtn = document.getElementById('createBtn');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const copyBtn = document.getElementById('copyBtn');
const roomCodeEl = document.getElementById('roomCode');
const myRoleText = document.getElementById('myRoleText');
const statusO = document.getElementById('statusO');
const statusX = document.getElementById('statusX');
const readyBtn = document.getElementById('readyBtn');
const leaveBtn = document.getElementById('leaveBtn');
const statusText = document.getElementById('statusText');
const countdownText = document.getElementById('countdownText');

let roomCode = null;
let myRole = null;
let unsub = null;
let roomCache = null;
let navTimer = null;
let countdownInterval = null;

function codeGen(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }
function roomRef(code){ return ref(db, `rooms/${code}`); }
function statusLine(p){ if(!p?.joined) return '<span class="bad">未加入</span>'; if(p.ready) return '<span class="ok">已準備</span>'; return '<span class="warn">未準備</span>'; }
function setStatus(msg){ statusText.textContent = msg; }
function initBattleState(host){
  return {
    turn: host || 'O',
    grid: Array(9).fill(null),
    queues: { O: [], X: [] },
    data: {
      O:{hp:100, sp:0, skillUsed:0, stunned:false, defending:false},
      X:{hp:100, sp:0, skillUsed:0, stunned:false, defending:false}
    },
    timeLeft: 30,
    turnEndsAt: Date.now() + 30000
  };
}
function render(room){
  roomCache = room;
  const players = room?.players || { O:{joined:false,ready:false}, X:{joined:false,ready:false} };
  roomCodeEl.textContent = roomCode || '未建立';
  myRoleText.textContent = myRole ? (myRole==='O' ? '你是 光 / O' : '你是 影 / X') : '未加入';
  statusO.innerHTML = statusLine(players.O);
  statusX.innerHTML = statusLine(players.X);
  readyBtn.disabled = !(roomCode && myRole && room && room.phase === 'lobby' && players[myRole]?.joined);
  leaveBtn.disabled = !roomCode;
  readyBtn.textContent = players[myRole]?.ready ? '取消準備' : '準備';

  if(!roomCode){ setStatus('尚未加入房間'); countdownText.style.display='none'; return; }
  if(room.phase === 'lobby'){
    countdownText.style.display='none';
    if(!(players.O.joined && players.X.joined)) setStatus('等待另一位玩家加入');
    else if(!(players.O.ready && players.X.ready)) setStatus('雙方都要按準備才會開始');
  }
  if(room.phase === 'countdown'){
    startCountdown(room.startAt);
    setStatus('雙方已準備，倒數進入戰鬥');
  } else {
    stopCountdown();
  }
  if(room.phase === 'playing'){
    setStatus('正在進入戰鬥…');
    countdownText.style.display='none';
    if(navTimer) clearTimeout(navTimer);
    navTimer = setTimeout(()=>{
      location.href = `battle.html?room=${encodeURIComponent(roomCode)}&role=${encodeURIComponent(myRole)}`;
    }, 250);
  }
}
function stopCountdown(){ if(countdownInterval){ clearInterval(countdownInterval); countdownInterval=null; } }
function startCountdown(startAt){
  stopCountdown();
  countdownText.style.display='block';
  const tick = ()=>{
    const diff = (startAt || Date.now()) - Date.now();
    let remain = Math.max(0, Math.ceil(diff/1000));
    countdownText.textContent = diff <= -200 ? '開始！' : String(Math.max(1, remain));
  };
  tick();
  countdownInterval = setInterval(tick, 100);
}
async function maybeAdvance(room){
  if(!roomCode || !myRole || !room) return;
  const players = room.players || {};
  const bothJoined = players.O?.joined && players.X?.joined;
  const bothReady = players.O?.ready && players.X?.ready;
  if(myRole === room.host && room.phase === 'lobby' && bothJoined && bothReady){
    const startAt = Date.now() + 3000;
    await update(roomRef(roomCode), { phase:'countdown', startAt, state:initBattleState(room.host) });
  } else if(myRole === room.host && room.phase === 'countdown' && room.startAt && Date.now() >= room.startAt){
    await update(roomRef(roomCode), { phase:'playing' });
  }
}
function subscribe(code){
  if(unsub) off(roomRef(code), 'value', unsub);
  unsub = onValue(roomRef(code), async snap => {
    const room = snap.val();
    if(!room){ setStatus('房間不存在或已被刪除'); return; }
    render(room);
    await maybeAdvance(room);
  });
}
async function createRoom(){
  myRole = roleSelect.value;
  roomCode = codeGen();
  const other = myRole === 'O' ? 'X' : 'O';
  const room = {
    phase:'lobby',
    host: myRole,
    startAt: null,
    players: {
      O:{joined: myRole==='O', ready:false},
      X:{joined: myRole==='X', ready:false}
    }
  };
  await set(roomRef(roomCode), room);
  subscribe(roomCode);
  render(room);
}
async function joinRoom(){
  const code = roomInput.value.trim().toUpperCase();
  if(!code){ setStatus('先輸入房號'); return; }
  const snap = await get(roomRef(code));
  if(!snap.exists()){ setStatus('找不到這個房間'); return; }
  const room = snap.val();
  myRole = roleSelect.value;
  if(room.phase !== 'lobby'){ setStatus('這個房間已經開始戰鬥'); return; }
  if(room.players?.[myRole]?.joined){ setStatus('這個角色已被佔用，請換另一邊'); return; }
  roomCode = code;
  await update(roomRef(roomCode), { [`players/${myRole}/joined`]: true, [`players/${myRole}/ready`]: false });
  subscribe(roomCode);
  render({ ...room, players:{ ...room.players, [myRole]: { joined:true, ready:false } } });
}
async function toggleReady(){
  if(!roomCode || !myRole || !roomCache) return;
  const current = !!roomCache.players?.[myRole]?.ready;
  await update(roomRef(roomCode), { [`players/${myRole}/ready`]: !current });
}
async function leaveRoom(){
  if(!roomCode || !myRole) return;
  const code = roomCode;
  const role = myRole;
  const host = roomCache?.host;
  if(unsub) off(roomRef(code), 'value', unsub);
  unsub = null;
  if(role === host){
    await remove(roomRef(code));
  } else {
    await update(roomRef(code), { [`players/${role}`]: { joined:false, ready:false } });
  }
  roomCode = null; myRole = null; roomCache = null;
  roomCodeEl.textContent='未建立'; myRoleText.textContent='未加入'; statusO.innerHTML='未加入'; statusX.innerHTML='未加入'; readyBtn.disabled=true; leaveBtn.disabled=true; countdownText.style.display='none'; setStatus('已離開房間');
}
createBtn.addEventListener('click', createRoom);
joinBtn.addEventListener('click', joinRoom);
readyBtn.addEventListener('click', toggleReady);
leaveBtn.addEventListener('click', leaveRoom);
copyBtn.addEventListener('click', async ()=>{ if(roomCode){ await navigator.clipboard.writeText(roomCode); setStatus('房號已複製'); }});
setInterval(async ()=>{ if(roomCache) await maybeAdvance(roomCache); }, 500);
