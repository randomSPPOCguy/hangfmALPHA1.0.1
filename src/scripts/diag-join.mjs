import 'dotenv/config';

const GATEWAY_BASE = (process.env.TTFM_GATEWAY_BASE_URL || 'https://gateway.prod.tt.fm').replace(/\/+$/,'');
const COMET_BASE   = (process.env.COMET_BASE_URL || (process.env.COMETCHAT_API_KEY
  ? `https://${process.env.COMETCHAT_API_KEY}.apiclient-us.cometchat.io`
  : '')).replace(/\/+$/,'');
const BOT_USER_TOKEN = process.env.BOT_USER_TOKEN || '';
const HANGOUT_ID     = process.env.HANGOUT_ID     || '';

if (!BOT_USER_TOKEN || !HANGOUT_ID || !COMET_BASE) {
  console.error('Missing envs. Need BOT_USER_TOKEN, HANGOUT_ID, and COMET_BASE_URL or COMETCHAT_API_KEY.');
  process.exit(1);
}

let cometAuthToken = null;
async function fetchCometAuthToken(){
  const r = await fetch(`${GATEWAY_BASE}/api/user-service/comet-chat/user-token`, {
    headers: { Authorization: `Bearer ${BOT_USER_TOKEN}` }
  });
  if (!r.ok) throw new Error(`Gateway ${r.status} ${await r.text()}`);
  const data = await r.json().catch(()=> ({}));
  cometAuthToken = data?.cometAuthToken;
  if (!cometAuthToken) throw new Error('no cometAuthToken');
}
function h(extra={}){ return { accept:'application/json', authToken:cometAuthToken, Authorization:`Bearer ${cometAuthToken}`, ...extra }; }

async function ensureJoin(){
  const me = await (await fetch(`${COMET_BASE}/v3.0/me`, { headers:h() })).json();
  const uid = me?.data?.uid || me?.data?.user?.uid;
  const r = await fetch(`${COMET_BASE}/v3.0/groups/${encodeURIComponent(HANGOUT_ID)}/members`, {
    method:'POST',
    headers: h({'content-type':'application/json'}),
    body: JSON.stringify({ participants: [{ uid, scope:'participant' }] })
  });
  if (r.ok) return 'JOINED';
  const t = await r.text();
  if (r.status===409 || /already|exists/i.test(t)) return 'ALREADY';
  return `ERR ${r.status} ${t}`;
}

(async ()=>{
  console.log('[1] fetching comet token…');
  await fetchCometAuthToken();
  console.log('[2] ensure join', HANGOUT_ID, '…', await ensureJoin());
})().catch(e=>{ console.error(e); process.exit(1); });
