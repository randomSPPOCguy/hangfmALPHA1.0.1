// src/commands/games.mjs
// Jirf Poker (/p, /bet) and Karens Club Casino slots (/s).
import 'dotenv/config';

const TITLE_P = (process.env.GAME_TITLE_P || 'jirf poker');
const TITLE_S = (process.env.GAME_TITLE_S || 'Karens Club Casino');

// Deck helpers
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RVAL  = Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));

function newDeck(){ const d=[]; for(const s of SUITS) for(const r of RANKS) d.push({r,s}); return d; }
function draw(deck,n=1){ const out=[]; for(let i=0;i<n;i++){ const k=Math.floor(Math.random()*deck.length); out.push(deck.splice(k,1)[0]); } return out; }
const fmt  = (cs)=> cs.map(c=>`${c.r}${c.s}`).join(' ');

// Strict 3‑card poker ranking with tie‑breakers
function eval3(cs){
  const vals = cs.map(c=>RVAL[c.r]).sort((a,b)=>b-a); // descending
  const suits= cs.map(c=>c.s);
  const uniqueVals = [...new Set(vals)];
  const flush = new Set(suits).size===1;

  const isStraight = (()=>{
    const v = [...vals].sort((a,b)=>a-b);
    // normal straight
    if (v[2]-v[1]===1 && v[1]-v[0]===1) return true;
    // A‑2‑3 low (treat as value 3 straight)
    if (v[0]===2 && v[1]===3 && v[2]===14) return true;
    return false;
  })();

  let rank, kicker=[];
  if (flush && isStraight){ rank=6; kicker=[...vals]; }              // Straight Flush
  else if (uniqueVals.length===1){ rank=5; kicker=[vals[0]]; }       // Three of a Kind
  else if (isStraight){ rank=4; kicker=[...vals]; }                  // Straight
  else if (flush){ rank=3; kicker=[...vals]; }                       // Flush
  else if (uniqueVals.length===2){                                    // Pair + kicker
    rank=2;
    const pairVal = uniqueVals.find(v=>vals.filter(x=>x===v).length===2);
    const kickerVal = uniqueVals.find(v=>v!==pairVal);
    kicker=[pairVal, kickerVal];
  } else {                                                            // High card
    rank=1; kicker=[...vals];
  }
  return { rank, kicker };
}
function compareHands(a,b){
  if (a.rank!==b.rank) return a.rank>b.rank?1:-1;
  // Compare kickers lexicographically
  for (let i=0;i<Math.max(a.kicker.length,b.kicker.length);i++){
    const av=a.kicker[i]||0, bv=b.kicker[i]||0;
    if (av!==bv) return av>bv?1:-1;
  }
  return 0;
}

// Exported entry
export async function handleCommand(fromUid, fromName, rawText, ctx){
  const { state, ensureUser, saveState, send } = ctx;
  const CMD_PREFIX = ctx.CMD_PREFIX || '/';

  if (!rawText?.startsWith(CMD_PREFIX)) return false;
  const parts = rawText.slice(CMD_PREFIX.length).trim().split(/\s+/);
  const cmd = (parts.shift() || '').toLowerCase();
  const arg = (parts.join(' ') || '').trim();

  // Hidden /ro chain
  if (cmd === 'ro'){
    state.rowGame = state.rowGame || { uids: [] };
    if (!Array.isArray(state.rowGame.uids)) state.rowGame.uids = [];
    const arr = state.rowGame.uids;
    if (!arr.includes(fromUid)) arr.push(fromUid);
    if (arr.length === 1) await send('ro');
    else if (arr.length === 2) await send('ro ro');
    else { await send('row row row 🚤'); state.rowGame.uids = []; }
    await saveState(); return true;
  }

  // Hidden /roll (kept out of /commands)
  if (cmd === 'roll'){
    const n = 1 + Math.floor(Math.random()*6);
    await send(`🎲 You rolled a ${n}`);
    return true;
  }

  // Slots: /s <amount>
  if (cmd === 's'){
    const u = ensureUser(fromUid, fromName);
    const amt = Math.max(1, Math.floor(Number(arg) || 10));
    // proceed
    const symbols = ['🍒','🍋','🔔','⭐','7️⃣'];
    const weights = [40, 30, 15, 10, 5];
    const pick = () => { let r=Math.random()*100,acc=0; for(let i=0;i<symbols.length;i++){ acc+=weights[i]; if(r<acc) return symbols[i]; } return symbols[0]; };
    const r1=pick(), r2=pick(), r3=pick();
    let mult = 0;
    if (r1===r2 && r2===r3){
      mult = (r1==='7️⃣') ? 20 : (r1==='⭐') ? 10 : (r1==='🔔') ? 6 : (r1==='🍋') ? 4 : 3;
    } else if (r1===r2 || r2===r3 || r1===r3){
      mult = 1.5;
    } else mult = 0;

    if (mult>0){
      const win = Math.floor(amt*mult);
      u.bankroll += win;
      await saveState();
      await send([
        `🎰 ${TITLE_S}`,
        `• Reels: [${r1} | ${r2} | ${r3}]`,
        `• Result: WIN +${win} (x${mult})`,
        `• Bankroll: ${u.bankroll}`
      ].join('\n'));
    } else {
      u.bankroll = Math.max(0, (u.bankroll||0) - amt);
      await saveState();
      await send([
        `🎰 ${TITLE_S}`,
        `• Reels: [${r1} | ${r2} | ${r3}]`,
        `• Result: lost ${amt}`,
        `• Bankroll: ${u.bankroll}`
      ].join('\n'));
    }
    return true;
  }

  // Jirf Poker: /p opens table; /bet joins; 5s dealer reveal
  if (cmd === 'p'){
    if (state.pokerRound && state.pokerRound.phase!=='done'){
      await send(`🃏 A ${TITLE_P} round is already running — use \`/bet <amount>\`.`);
      return true;
    }
    state.pokerRound = { phase:'betting', startedAt: Date.now(), bets:{}, order:[] };
    await saveState();
    await send(`🃏 ${TITLE_P} — 15s to place bets with \`/bet <amount>\` (≤ your bankroll).`);

    setTimeout(async ()=>{
      try{
        const round = state.pokerRound;
        if (!round || round.phase!=='betting') return;
        const ids = Object.keys(round.bets);
        if (!ids.length){ await send('⏱️ No bets placed. Round cancelled.'); state.pokerRound=null; await saveState(); return; }

        // Deal player hand
        const deck=newDeck();
        const p=draw(deck,3);
        const d=draw(deck,3);
        const pe=eval3(p);
        const de=eval3(d);

        await send([
          `🂠 Player: ${fmt(p)}`,
          `• Hand: ${['','High Card','Pair','Flush','Straight','Three of a Kind','Straight Flush'][pe.rank]}`,
          `🤫 Dealer reveals in 5s…`
        ].join('\n'));

        setTimeout(async ()=>{
          try{
            const cmp = compareHands(pe,de);
            const dealerLine = [
              `🏦 Dealer: ${fmt(d)}`,
              `• Hand: ${['','High Card','Pair','Flush','Straight','Three of a Kind','Straight Flush'][de.rank]}`
            ].join('\n');

            if (cmp===0){
              await send([dealerLine, '🟰 Push for all players.'].join('\n'));
              state.pokerRound = null; await saveState(); return;
            }

            const playerWins = cmp>0;
            const lines = [dealerLine, playerWins ? '✅ Player wins' : '❌ Dealer wins'];

            // Payouts: hand multiplier (reward better player hands)
            const multByRank = {1:1,2:2,3:2,4:3,5:4,6:6};
            for (const uid of round.order){
              const bet = Math.max(1, Math.floor(round.bets[uid]||0));
              const u = ensureUser(uid);
              if (playerWins){
                const win = Math.max(bet, Math.floor(bet * (multByRank[pe.rank]||1)));
                u.bankroll += win;
                lines.push(`• Player: +${win}`);
              } else {
                u.bankroll = Math.max(0, (u.bankroll||0) - bet);
                lines.push(`• Player: -${bet}`);
              }
            }
            state.pokerRound = null; await saveState();
            await send(lines.join('\n'));

          }catch(e){
            state.pokerRound = null; await saveState();
            await send(`⚠️ Poker error: ${e?.message||e}`);
          }
        }, 5000);

      }catch(e){
        state.pokerRound = null; await saveState();
        await send(`⚠️ Poker error: ${e?.message||e}`);
      }
    }, 15000);

    return true;
  }

  if (cmd === 'bet'){
    const round = state.pokerRound;
    if (!round || round.phase!=='betting'){ await send('⛔ No betting open. Start with `/p`.'); return true; }
    const u = ensureUser(fromUid, fromName);
    const amt = Math.max(1, Math.floor(Number(arg)));
    if (!Number.isFinite(amt) || amt<=0){ await send('Usage: `/bet <amount>`'); return true; }
    if ((u.bankroll||0) < amt){ await send(`⛔ Not enough chips. Bankroll: ${u.bankroll}`); return true; }
    round.bets[fromUid] = amt;
    if (!round.order.includes(fromUid)) round.order.push(fromUid);
    await saveState();
    await send(`💰 Bet accepted: ${amt} chips`);
    return true;
  }

  return false;
}
