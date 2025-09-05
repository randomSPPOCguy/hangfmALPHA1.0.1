# Hangfm Bot

A friendly Hang.fm room bot with commands, **Jirf Poker** (`/p`) and **Karens Club Casino** (`/s`), weather, Wikipedia lookup with AI fallback, greetings, and simple stats.

**License:** Noncommercial with attribution — see `LICENSE`, `NOTICE`, and `ATTRIBUTION.md`.  
Author: **SPPOC** (aka **randomdude** / **sumguy**).

---

## Features
- **Commands**: `/commands` shows a tidy 3‑column list (emojis + command)
- **Stats**: `/stats`, `/songstats` (clean multi‑line layout)
- **Wikipedia**: `/wiki <any term>` → summary with link (AI fallback if missing)
  - `/wiki` with no term uses the currently playing artist (if present)
- **Jirf Poker**: `/p` to open a 15s betting window, `/bet <amount>` to join
- **Slots**: `/s <amount>` (basic house‑weighted machine)
- **Greeting**: snappy welcome with cooldown, no spam
- **AI Callouts**: reply to messages that include `bot`, `hey bot`, etc.
- **/gitlink**: prints the project repo link

---

## Quick Start

### 1) Requirements
- Node.js **18.17+** (or 20+ recommended)
- A Hang.fm **Gateway** token (JWT) and **CometChat** tenant/app ID
- Optional: OpenWeather + OpenAI API keys

### 2) Install
```bash
npm i
cp .env.example .env
# edit .env with your tokens / keys
npm start
```

### 3) Environment
Edit `.env` (see `.env.example` for all variables). The minimum to run:
- `TTFM_GATEWAY_BASE_URL` — usually `https://gateway.prod.tt.fm`
- `COMETCHAT_API_KEY` *or* `COMET_BASE_URL`
- `BOT_USER_TOKEN` — JWT from your Gateway
- `HANGOUT_ID` — group GUID of your room
- `OPENAI_API_KEY` (optional but enables Q&A and AI fallbacks)
- `OPENWEATHER_API_KEY` (optional, enables `/w`)

### 4) Get API Keys
- **OpenAI**: create an account and a key at  
  https://platform.openai.com/api-keys
- **OpenWeather**: free key at  
  https://home.openweathermap.org/api_keys  
  Docs: https://openweathermap.org/api

### 5) Verify
- If you see `ERR_GROUP_NOT_JOINED`, ensure the bot is invited/co‑owner and your Comet base URL/AppID is correct.  
- Try:
  ```bash
  npm run diag:join
  ```

---

## Commands

| Emoji | Command      | Notes |
|------:|--------------|-------|
| 📊 | `/stats` | User stats (bankroll, poker, reactions, top artists) |
| 🎧 | `/songstats` | Current song: plays & first played by |
| 🌦️ | `/w <place|zip>` | Weather via OpenWeather |
| 📚 | `/wiki [term]` | Summary with link; AI fallback if missing |
| 🃏 | `/p` | **Jirf Poker**: 15s betting window, then reveal |
| 🎰 | `/s <amount>` | **Karens Club Casino** (slots) |
| 🔗 | `/gitlink` | Prints repo link |
| 🙏 | `/ty` | Thanks helpers |

Hidden/admin:
- `/.commands` (admin‑only), `/ai on|off`, `/ro`, `/roll`

---

## Troubleshooting

- **Old messages flood / greet spam on boot:** the bot primes a watermark to the newest message on startup and rate‑limits greets.
- **No weather:** check `OPENWEATHER_API_KEY` and run `node -p "require('dotenv').config(); !!process.env.OPENWEATHER_API_KEY"`
- **AI not answering:** ensure `OPENAI_API_KEY` is set and `/ai on` (admin only).

---

## Contributing
Noncommercial only. Keep attribution/link. PRs welcome.
