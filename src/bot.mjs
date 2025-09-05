// src/bot.mjs — release bundle
// - Modular: uses ./commands/wiki.mjs and ./commands/games.mjs
// - Clean outputs, 3-column /commands, one-paragraph wiki/AI
// - Greets with cooldown + boot suppression
// - AI callouts answer generic questions when message includes "bot"

import 'dotenv/config';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

import * as Wiki from './commands/wiki.mjs';
import * as Games from './commands/games.mjs';

// --- Startup attribution print (from ATTRIBUTION.md) ---
(async ()=>{
  try{
    const a = await fs.readFile('./ATTRIBUTION.md','utf8');
    console.log(a.split('\n').slice(0,3).join('\n'));
  }catch{
    console.warn('[warn ] ATTRIBUTION.md missing — keep attribution per LICENSE/NOTICE.');
  }
})();

// --- Env / Config ---
const GATEWAY_BASE = (process.env.TTFM_GATEWAY_BASE_URL || 'https://gateway.prod.tt.fm').replace(/\/+$/,'');
const COMET_BASE   = (process.env.COMET_BASE_URL || (process.env.COMETCHAT_API_KEY
  ? `https://${process.env.COMETCHAT_API_KEY}.apiclient-us.cometchat.io`
  : '')).replace(/\/+$/,'');
const BOT_USER_TOKEN = process.env.BOT_USER_TOKEN || '';
const HANGOUT_ID     = process.env.HANGOUT_ID     || '';

if (!BOT_USER_TOKEN) throw new Error('BOT_USER_TOKEN missing');
if (!HANGOUT_ID)     throw new Error('HANGOUT_ID missing');
if (!COMET_BASE)     throw new Error('COMET_BASE_URL or COMETCHAT_API_KEY missing');

const LOG_LEVEL  = (process.env.LOG_LEVEL || 'info').toLowerCase();
const POLL_MS    = Math.max(300, Number(process.env.POLL_MS || 600));
const MSG_LIMIT  = Math.max(1,   Number(process.env.MSG_LIMIT || 100));
const MAX_MSG_CHARS = Math.max(400, Number(process.env.MAX_MSG_CHARS || 900));

const CMD_PREFIX = process.env.CMD_PREFIX || '/';
const ADMIN_UIDS = String(process.env.ADMIN_UIDS || '').split(',').map(s=>s.trim()).filter(Boolean);
const isAdmin = (uid)=> ADMIN_UIDS.includes(uid);

const GREET_ENABLED   = String(process.env.GREET_ENABLED ?? 'true').toLowerCase() === 'true';
const GREET_MESSAGE   = process.env.GREET_MESSAGE || '👋 Welcome, {name}! Type /commands to see what I can do.';
const BOOT_GREET_SUPPRESS_MS = Math.max(0, Number(process.env.BOOT_GREET_SUPPRESS_MS || 3000));

const OPENAI_API_KEY  = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL    = process.env.OPENAI_MODEL   || 'gpt-4o-mini';

// --- Logging ---
const levels={debug:10,info:20,warn:30,error:40};
const lvl=levels[LOG_LEVEL]??20;
const log={ debug:(...a)=>{if(lvl<=10)console.log('[debug]',...a)},info:(...a)=>{if(lvl<=20)console.log('[info ]',...a)},warn:(...a)=>{if(lvl<=30)console.log('[warn ]',...a)},error:(...a)=>{if(lvl<=40)console.log('[error]',...a)} };
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const cleanName=(n)=>String(n||'').replace(/\*/g,'').trim()||'Unknown';

// --- State ---
const STATE_FILE = process.env.STATE_FILE || './bot-state.json';
const defaultUser=(name='Unknown')=>({name,bankroll:1000,wins:0,losses:0,up:0,down:0,star:0,artistCounts:{}});
const defaultState=()=>({users:{},songs:{},lastTrack:null,ai:{enabled:true,lastSentAt:0},rowGame:{uids:[]},greeter:{lastGreet:{},present:{}},watermark:{sentAt:0,id:0},pokerRound:null});
let state = defaultState();

function ensureUser(uid,name='Unknown'){const nm=cleanName(name);const ex=state.users[uid];
  if(!ex){state.users[uid]=defaultUser(nm)}else{const u={...defaultUser(nm),...ex};u.name=nm;['bankroll','wins','losses','up','down','star'].forEach(k=>{const v=u[k];u[k]=Number.isFinite(v)?Math.max(0,Math.floor(v)):(k==='bankroll'?1000:0)});u.artistCounts=u.artistCounts&&typeof u.artistCounts==='object'?u.artistCounts:{};state.users[uid]=u}return state.users[uid]}
async function loadState(){try{state=JSON.parse(await fs.readFile(STATE_FILE,'utf8'))}catch{state=defaultState();await saveState()}state.users||={};state.songs||={};state.ai||={enabled:true,lastSentAt:0};state.rowGame||={uids:[]};state.greeter||={lastGreet:{},present:{}};state.watermark||={sentAt:0,id:0};state.pokerRound||=null;for(const[uid,u]of Object.entries(state.users))ensureUser(uid,u.name);log.info('📦 state ready:',STATE_FILE)}
async function saveState(){try{await fs.writeFile(STATE_FILE,JSON.stringify(state,null,2))}catch(e){log.warn('state save failed:',e.message||e)}}

// --- HTTP (Comet) ---
let cometAuthToken=null; let selfUid=null;
async function fetchCometAuthToken(){const r=await fetch(`${GATEWAY_BASE}/api/user-service/comet-chat/user-token`,{headers:{Authorization:`Bearer ${BOT_USER_TOKEN}`}});if(!r.ok)throw new Error(`Gateway ${r.status} ${await r.text()}`);const j=await r.json().catch(()=>({}));cometAuthToken=j?.cometAuthToken;if(!cometAuthToken)throw new Error('no cometAuthToken');}
function H(extra={}){return{accept:'application/json',authToken:cometAuthToken,Authorization:`Bearer ${cometAuthToken}`,...extra}}
async function comet(path,opts={},retry=true){if(!cometAuthToken)await fetchCometAuthToken();const r=await fetch(`${COMET_BASE}${path}`,{...opts,headers:H(opts.headers||{})});if(r.status===401&&retry){await fetchCometAuthToken();return await fetch(`${COMET_BASE}${path}`,{...opts,headers:H(opts.headers||{})})}return r}
async function me(){const r=await comet('/v3.0/me');const t=await r.text();if(!r.ok)throw new Error(`me ${r.status} ${t}`);const j=JSON.parse(t);selfUid=j?.data?.uid||j?.data?.user?.uid||null;return selfUid}
async function ensureJoin(){try{const uid=selfUid||await me();const r=await comet(`/v3.0/groups/${encodeURIComponent(HANGOUT_ID)}/members`,{method:'POST',headers:H({'content-type':'application/json'}),body:JSON.stringify({participants:[{uid,scope:'participant'}]})});const txt=await r.text().catch(()=> '');if(r.ok)return true;if(r.status===409||/already|exists/i.test(txt))return true;const r2=await comet(`/v3.0/groups/${encodeURIComponent(HANGOUT_ID)}/join`,{method:'POST',headers:H({'content-type':'application/json'}),body:JSON.stringify({})});return r2.ok}catch(e){log.warn('join error:',e.message||e);return false}}
async function listGroupMessages(groupId,{limit=MSG_LIMIT}={}){const r=await comet(`/v3.0/groups/${encodeURIComponent(groupId)}/messages?limit=${limit}`);const t=await r.text();if(!r.ok)throw new Error(`list ${r.status} ${t}`);const j=JSON.parse(t);return Array.isArray(j?.data)?j.data:Array.isArray(j?.data?.data)?j.data.data:Array.isArray(j)?j:[]}
function payload(text){return{avatarId:'dj-femalezombie-1',color:'#9E4ADF',badges:['BOT'],id:-1,message:text,type:'user',userName:'BOT',userUuid:selfUid||'unknown',uuid:crypto.randomUUID()}}
async function send(text){const msg=clamp(String(text||''),MAX_MSG_CHARS);try{await comet('/v3.0/messages',{method:'POST',headers:H({'content-type':'application/json'}),body:JSON.stringify({receiverType:'group',receiver:HANGOUT_ID,category:'custom',type:'ChatMessage',data:{customData:payload(msg),metadata:{incrementUnreadCount:true}}})})}catch{await comet('/v3.0/messages',{method:'POST',headers:H({'content-type':'application/json'}),body:JSON.stringify({receiverType:'group',receiver:HANGOUT_ID,category:'message',type:'text',data:{text:msg}})})}}

// --- Helpers ---
const endClean=(s)=>{const t=(s||'').trim();return t?(/[.!?]$/.test(t)?t:t+'.'):t}
const oneLine=(s)=>String(s||'').replace(/[\r\n]+/g,' ').replace(/\s{2,}/g,' ').trim()
function clamp(input,max){let s=oneLine(String(input||''));if(s.length<=max)return endClean(s);const cut=s.slice(0,max);const last=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf('! '),cut.lastIndexOf('? '),cut.lastIndexOf('.'));if(last>40)s=s.slice(0,last+1);else s=cut;return endClean(s)}
function pad(str,n){const s=String(str||'');return s.length>=n?s:s+' '.repeat(n-s.length)}
function make3Cols(cells){const W=16;const rows=[];for(let i=0;i<cells.length;i+=3){const r=[cells[i],cells[i+1],cells[i+2]].filter(Boolean).map(c=>pad(c,W)).join('');rows.push(r.trimEnd())}return rows.join('\n')}

// --- Parsing & now playing ---
function pretty(m){const fromUid=m?.data?.entities?.sender?.entity?.uid??m?.sender??null;const fromName=m?.data?.entities?.sender?.entity?.name??(fromUid==='app_system'?'System':fromUid)??'unknown';const text=m?.data?.text??m?.text??m?.data?.message?.customData?.message??m?.data?.customData?.message??'';return{id:String(m?.id||''),sentAt:m?.sentAt||0,fromUid,from:cleanName(fromName),text:String(text||'')}}
function advanceWatermark(m){const sAt=m?.sentAt??0, mid=Number(m?.id)||0;const curS=state.watermark.sentAt||0,curI=state.watermark.id||0;if(sAt>curS||(sAt===curS&&mid>curI))state.watermark={sentAt:sAt,id:mid}}
function parseSong(m){const song=m?.data?.metadata?.chatMessage?.songs?.[0]?.song;if(!song)return null;const artist=song?.artistName||'Unknown Artist';const title=song?.trackName||'Unknown Title';const songKey=String(song?.songId||song?.crateSongUuid||`${artist} — ${title}`);return{artist,title,songKey}}
function recordNowPlaying(song,m){const mentionUid=Object.keys(m?.data?.mentions||{})[0]||null;const mdUserUid=m?.data?.metadata?.user?.uid||m?.data?.user?.uid||null;const djUid=mentionUid||mdUserUid||null;const djName=djUid?cleanName(m?.data?.mentions?.[mentionUid]?.name||m?.data?.metadata?.user?.name||m?.data?.user?.name||djUid):'Unknown DJ';state.lastTrack={songKey:song.songKey,artist:song.artist,title:song.title,djUid,djName};if(!state.songs[song.songKey]){state.songs[song.songKey]={artist:song.artist,title:song.title,firstDjUid:djUid,firstDjName:djName,plays:1}}else{state.songs[song.songKey].plays++}}

// --- Greeter ---
function looksJoin(m){const cat=(m?.category||m?.data?.category||'').toLowerCase();const typ=(m?.type||m?.data?.type||'').toLowerCase();if(cat==='action'&&/member|join|added|enter/.test(typ))return true;const blob=JSON.stringify(m?.data||m||{}).toLowerCase();return /(joined|has joined|entered|member added|joined the room|joined hangout)/.test(blob)}
function joinedFrom(m){const mentionUid=Object.keys(m?.data?.mentions||{})[0]||null;const mdUserUid=m?.data?.metadata?.user?.uid||m?.data?.user?.uid||null;const uid=mentionUid||mdUserUid;const name=cleanName(m?.data?.mentions?.[mentionUid]?.name||m?.data?.metadata?.user?.name||m?.data?.user?.name||uid||'friend');return uid?{uid,name}:null}
let bootStartedAt=Date.now();
function handleSystem(m){if(GREET_ENABLED&&(Date.now()-bootStartedAt)>BOOT_GREET_SUPPRESS_MS&&looksJoin(m)){const j=joinedFrom(m);if(j&&j.uid&&j.uid!==selfUid){const last=state.greeter.lastGreet[j.uid]||0;const now=Date.now();if(now-last>10*60*1000){state.greeter.lastGreet[j.uid]=now;send(GREET_MESSAGE.replace('{name}',j.name))}}}const s=parseSong(m);if(s){recordNowPlaying(s,m);saveState()}}

// --- Commands ---
const VISIBLE=[
  {cmd:'/stats',emoji:'📊'},
  {cmd:'/songstats',emoji:'🎧'},
  {cmd:'/w',emoji:'🌦️'},
  {cmd:'/wiki',emoji:'📚'},
  {cmd:'/p',emoji:'🃏'},
  {cmd:'/s',emoji:'🎰'},
  {cmd:'/gitlink',emoji:'🔗'},
  {cmd:'/ty',emoji:'🙏'}
];
const HIDDEN=['/.commands','/ai on|off','/ro','/roll'];

function formatCommands(){return make3Cols(VISIBLE.map(x=>`${x.emoji} ${x.cmd}`))}

function topArtistsFor(uid,n=3){const u=state.users[uid];if(!u||!u.artistCounts)return[];return Object.entries(u.artistCounts).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([name])=>name)}

async function doStats(uid,label){const u=ensureUser(uid,label);const total=(u.wins||0)+(u.losses||0);const pct=total?Math.round((u.wins/total)*100):0;const top3=topArtistsFor(uid,3);await send([`👤 ${u.name}`,`• 💼 Bankroll: ${u.bankroll} chips`,`• 🃏 Poker: ${u.wins}W / ${u.losses}L (${pct}%)`,`• ⭐ Reactions: 👍 ${u.up||0}  👎 ${u.down||0}  ⭐ ${u.star||0}`,`• 🎧 Top artists: ${top3.length?top3.join(', '):'—'}`].join('\n'))}
async function doSongStats(){const lt=state.lastTrack;if(!lt){await send('🎧 No track info yet.');return;}const s=state.songs[lt.songKey];if(!s){await send([`🎵 ${lt.artist} — ${lt.title}`,`• 🔢 Plays: 1`,`• 👤 First played by: ${lt.djName||'Unknown'}`].join('\n'));return;}await send([`🎵 ${s.artist} — ${s.title}`,`• 🔢 Plays: ${s.plays}`,`• 👤 First played by: ${s.firstDjName||s.firstDjUid||'Unknown'}`].join('\n'))}

async function weatherText(arg){const key=process.env.OPENWEATHER_API_KEY||'';if(!key)return'⚠️ Weather not configured. Add OPENWEATHER_API_KEY to .env';const q=(arg||'').trim();if(!q)return'🌦️ Usage: /w 14207 or /w Buffalo';try{const enc=encodeURIComponent(q);let place,lat,lon;let geo=await (await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${enc}&limit=1&appid=${key}`)).json();if(!Array.isArray(geo)||!geo.length){if(/^\d{5}$/.test(q)){const z=await (await fetch(`https://api.openweathermap.org/geo/1.0/zip?zip=${q},US&appid=${key}`)).json();if(z&&z.lat!=null&&z.lon!=null){lat=z.lat;lon=z.lon;place=`${z.name||'USA'} ${q}`}}}else{const g=geo[0];lat=g.lat;lon=g.lon;place=[g.name,g.state,g.country].filter(Boolean).join(', ')}if(lat==null||lon==null)throw new Error('geo');const cur=await (await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${key}`)).json();const cNow=Math.round(cur.main.temp-273.15);const fNow=Math.round((cNow*9)/5+32);const desc=(cur.weather?.[0]?.description||'').replace(/\b\w/g,s=>s.toUpperCase());return[`🌦️ ${place}`,`• Now: ${fNow}°F / ${cNow}°C — ${desc}`].join('\n')}catch{return`⚠️ Weather lookup failed for \`${q}\``}}

const BOT_ALIASES=['bot','@bot','hey bot','hi bot','ok bot','yo bot']
function hasBotCallout(t){t=String(t||'').toLowerCase();return BOT_ALIASES.some(a=>t.includes(a))}
async function aiReply(prompt){if(!OPENAI_API_KEY)return null;const now=Date.now();if(now-(state.ai.lastSentAt||0)<1200)return null;try{const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${OPENAI_API_KEY}`},body:JSON.stringify({model:OPENAI_MODEL,temperature:0.5,messages:[{role:'system',content:'You are a concise, helpful chat assistant. Reply in ONE paragraph, plain text.'},{role:'user',content:String(prompt||'')}]})});if(!r.ok)throw new Error(`openai ${r.status}`);const j=await r.json();const out=j?.choices?.[0]?.message?.content?.trim()||null;state.ai.lastSentAt=Date.now();return clamp(out||'',MAX_MSG_CHARS)}catch{return null}}

// --- Router ---
async function handleCommand(fromUid,from,text){
  if(!text?.trim().startsWith(CMD_PREFIX))return false;
  const parts=text.slice(CMD_PREFIX.length).split(/\s+/);const cmd=(parts.shift()||'').toLowerCase();const arg=parts.join(' ').trim();

  // Delegate to games first
  const gamesHandled = await Games.handleCommand(fromUid,from,text,{state,ensureUser,saveState,send,CMD_PREFIX});
  if (gamesHandled) return true;

  if(cmd==='commands'){await send(make3Cols(VISIBLE.map(x=>`${x.emoji} ${x.cmd}`)));return true}
  if(cmd==='.commands'){if(!isAdmin(fromUid))return true;await send(HIDDEN.join('\n'));return true}
  if(cmd==='ai'||cmd==='.ai'){if(!isAdmin(fromUid))return true;const on=arg.toLowerCase()==='on';const off=arg.toLowerCase()==='off';if(on||off){state.ai.enabled=on;await saveState();await send(on?'🧠 AI: ON':'🧠 AI: OFF')}else{await send(`🧠 AI is ${state.ai.enabled?'ON':'OFF'}. Use "/ai on" or "/ai off".`) }return true}
  if(cmd==='w'){await send(await weatherText(arg));return true}
  if(cmd==='stats'){let targetUid=fromUid;let label=state.users[fromUid]?.name||from;if(arg==='dj'&&state.lastTrack?.djUid){targetUid=state.lastTrack.djUid;label=state.lastTrack.djName||label}else if(arg){const needle=arg.toLowerCase();const found=Object.entries(state.users).find(([_,u])=>(u.name||'').toLowerCase()===needle);if(found){targetUid=found[0];label=state.users[targetUid]?.name||label}}await doStats(targetUid,label);return true}
  if(cmd==='songstats'){await doSongStats();return true}
  if(cmd==='wiki'){await send(await Wiki.runWiki(arg,state.lastTrack));return true}
  if(cmd==='gitlink'){await send(['🔗 GitHub','• https://github.com/randomSPPOCguy/HangfmBotAlpha1.0.0'].join('\n'));return true}
  if(cmd==='ty'){await send('🙏 Thank you Jodrell, Kai the Husky, and butter');return true}
  return false
}

// --- System handling ---
function isSystem(m){const uid=m?.data?.entities?.sender?.entity?.uid??m?.sender??null;return uid==='app_system'}

// --- Main loop ---
async function main(){
  console.log('[info ] 🚀 bot starting…');await loadState();
  try{await fetchCometAuthToken()}catch(e){log.warn('token error:',e.message||e)}
  try{await me();log.info('👤 self uid:',selfUid)}catch(e){log.warn('me error:',e.message||e)}
  await ensureJoin();

  // Prime watermark to newest
  try{const recent=await listGroupMessages(HANGOUT_ID,{limit:50});if(Array.isArray(recent)&&recent.length){const newest=recent.reduce((a,b)=>{const as=a?.sentAt||0,bs=b?.sentAt||0;if(bs>as)return b;if(bs<as)return a;const ai=Number(a?.id)||0,bi=Number(b?.id)||0;return(bi>ai)?b:a});advanceWatermark(newest);await saveState()}}catch{}
  bootStartedAt=Date.now();
  console.log('✅ ready.');console.log('[step] entering poll loop…');

  while(true){
    try{
      let items;
      try{items=await listGroupMessages(HANGOUT_ID,{limit:MSG_LIMIT})}
      catch(err){const txt=String(err?.message||'');if(txt.includes('ERR_GROUP_NOT_JOINED')||/not a member of the group/i.test(txt)){log.warn('not joined; attempting ensureJoin…');await ensureJoin();await sleep(800);continue}throw err}
      if(Array.isArray(items)){
        items.sort((a,b)=>{const as=a?.sentAt||0,bs=b?.sentAt||0;if(as!==bs)return as-bs;const ai=Number(a?.id)||0,bi=Number(b?.id)||0;return ai-bi});
        for(const m of items){
          const sAt=m?.sentAt||0,mid=Number(m?.id)||0;const ws=state.watermark.sentAt||0,wi=state.watermark.id||0;if(sAt<ws||(sAt===ws&&mid<=wi))continue;
          advanceWatermark(m);await saveState();
          if(isSystem(m)){handleSystem(m);continue}
          const pm=pretty(m); if(selfUid && pm.fromUid===selfUid) continue;

          // AI callouts (generic Q&A only)
          if(!pm.text.startsWith(CMD_PREFIX) && state.ai.enabled && hasBotCallout(pm.text)){
            const reply = await aiReply(`User says: ${pm.text}`);
            if (reply) await send(reply);
            continue;
          }

          // Slash commands
          const handled = await handleCommand(pm.fromUid, pm.from, pm.text);
          if (!handled){ /* ignore */ }
        }
      }
    }catch(e){log.warn('poll loop error:',e?.message||e);await sleep(1000)}
    await sleep(POLL_MS)
  }
}

main().catch(err=>{console.error('[fatal]',err);process.exit(1)});
