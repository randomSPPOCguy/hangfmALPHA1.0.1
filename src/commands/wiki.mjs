// src/commands/wiki.mjs
// Provides a single-message Wikipedia summary with AI fallback.
import 'dotenv/config';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL   = process.env.OPENAI_MODEL   || 'gpt-4o-mini';
const MAX_MSG_CHARS  = Math.max(400, Number(process.env.MAX_MSG_CHARS || 900));

const endClean = (s)=>{ const t=(s||'').trim(); return t ? (/[.!?]$/.test(t)?t:t+'.') : t; };
const oneParagraph = (s)=> String(s||'').replace(/[\r\n]+/g,' ').replace(/\s{2,}/g,' ').trim();
function clampToSentence(input, max=MAX_MSG_CHARS){
  let s = oneParagraph(String(input||''));
  if (s.length <= max) return endClean(s);
  const cut = s.slice(0, max);
  const lastPunct = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('.'));
  if (lastPunct > 40) s = s.slice(0, lastPunct+1); else s = cut;
  return endClean(s);
}

async function aiFallback(prompt){
  if (!OPENAI_API_KEY) return null;
  try{
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'content-type':'application/json', Authorization:`Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.5,
        messages: [
          { role:'system', content: 'You are a precise, factual assistant. Reply in ONE paragraph (plain text).' },
          { role:'user', content: String(prompt||'') }
        ]
      })
    });
    if (!r.ok) throw new Error(`openai ${r.status}`);
    const j = await r.json();
    return clampToSentence(j?.choices?.[0]?.message?.content || '');
  }catch{ return null; }
}

export async function runWiki(term, current){
  const subject = term?.trim() || current?.artist?.trim() || '';
  if (!subject){
    return '📚 Use `/wiki <term>` (or run it while a song is playing to use the current artist).';
  }

  // Try Wikipedia first
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(subject)}?redirect=false`;
    const r = await fetch(url, { headers: { accept:'application/json' } });
    if (r.ok){
      const data = await r.json();
      const extract = (data?.extract || '').trim();
      const title   = data?.title || subject;
      const link    = data?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
      const disambig = data?.type === 'disambiguation';

      if (!disambig && extract){
        // Slightly longer body for artist pages (still single message)
        const limit = Math.max(700, MAX_MSG_CHARS);
        const short = extract.length>limit ? extract.slice(0,limit) : extract;
        return `📚 ${title}\n${short}\n${link}`.trim();
      }
    }
  } catch {}

  // AI fallback
  const prompt = term
    ? `Write one detailed, factual paragraph about "${term}". Include the most important facts and context.`
    : `Write one detailed, factual paragraph about the current artist "${current?.artist}" and song "${current?.title}".`;
  const ai = await aiFallback(prompt);
  return ai || `I couldn’t find a reliable summary for "${subject}".`;
}
