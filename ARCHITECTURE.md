# ScanGym Architecture

Describes the system that is actually in this repository.

> The previous version of this file described a React Native / Flutter app with
> a 7-tab interface (Reels, Book, Music, Photos, AI Coach, Trainer, Profile),
> Pinecone/Weaviate vector search, Kafka, and Go microservices. None of that
> exists here. It was an aspirational design document that read like a
> description of the running system, which is worse than having no document at
> all — it sends every new engineer, and every AI agent, in the wrong direction.
> Keep this file honest: if something here is a plan rather than a fact, label it.

## 1. What it is

A gym day-pass marketplace: find a gym, buy a pass, enter with a QR code, no
membership. The distinguishing feature is that **the whole app is operable by
voice** — you say what you want and it happens, including payment.

## 2. Stack, as built

| Layer | Reality |
| --- | --- |
| Frontend | Vanilla JavaScript PWA. No framework, no bundler for app code. Served as static files from `frontend/public/`. |
| Backend | Node.js + Express, single process. `server/server.js` mounts ~50 route modules from `server/routes/`. |
| Database | PostgreSQL via `pg` pool (`server/middleware/db.js`). SQL migrations in `migrations/`, applied by `server/db/migrate.js`. |
| Payments | Stripe (+ Stripe Connect for partner payouts). |
| Voice | Groq Whisper for speech-to-text; Azure Neural TTS with Groq as fallback for speech-out. |
| LLM | `server/lib/llm.js`, used by the per-tab agents. |
| Mobile | Capacitor shell wrapping the same web app (`android/`, `capacitor.config.ts`). Not React Native, not Flutter. |
| Hosting | Railway, building `Dockerfile`. Health check `/api/v2/health`. |

## 3. The five tabs

| Tab | Route | Server agent |
| --- | --- | --- |
| Reels | `/reels` | `routes/reels.js`, `lib/reels-algorithm.js` |
| Book | `/explore` | `routes/book-agent.js` + `lib/book-tools.js` |
| ScanSquad | `/scansquad` | `routes/squad-agent.js` + `lib/squad-tools.js` |
| Partner | `/partner` | `routes/partner-agent.js` + `lib/partner-tools.js` |
| Profile | `/more/profile` | shared app core |

`/reels` and `/scansquad` also have standalone HTML shells; the rest are routes
of the single-page app in `frontend/public/index.html`.

## 4. How voice works

Cascaded, not realtime: **speech → text → existing text agent → speech**.

```
browser (voice.js, MediaRecorder)
   → POST /api/voice/stt   → Groq whisper-large-v3-turbo
   → POST /api/{book,squad,partner}/agent   (SSE, streams tokens + tool events)
   → POST /api/voice/tts   → Azure Neural (fallback: Groq Orpheus)
   → audio played back in the browser
```

This is a deliberate choice, documented at the top of `server/routes/voice.js`:
the text agents already enforce confirm-before-you-take-money and write an audit
row for every tool call. A realtime speech model would bypass both and cost
roughly twenty times more per conversation.

`voice-always.js` is the zero-click layer: the mic arms on the first interaction
of a first visit, and automatically on every visit after that.

**Money is never moved on the model's say-so.** Write tools return a pending
action that the user must confirm; only then does the tool execute. Every call
is recorded in `*_agent_actions`.

## 5. Frontend layout, and its debt

```
frontend/public/
  index.html          SPA shell
  app.ctr576.js       the application — ~20,600 lines
  one-orange.css      brand colour rule: only the voice pill may be orange
  one-cta.css         one call to action per tab
  brand-mark.css      the single orange circle logo
  voice.js            speech in / speech out
  voice-always.js     zero-click mic
  chat-agent.js       shared client engine for all tab agents
  {book,squad,partner,reels,profile}-chat.js    per-tab personalities
```

**Known debt — read before adding a feature.** On top of `app.ctr576.js` sits a
stack of roughly sixteen patch scripts (`app-patches.js`, `app-patches-v3.js`,
`round2..round5`, `batch2..batch4`, `phase2-improvements.js`, `ux-v5`, `ux-v6`,
`ui-polish.js`, `tabs-v4.js`, `continue-cta-flow.js`) totalling ~5,100 lines,
each patching the layer beneath it at runtime. Several tests
(`patch-chain`, `one-cta`, `one-orange`, `one-version`) exist specifically to
police regressions this arrangement keeps reintroducing. Prefer changing the
core over adding a seventeenth layer.

## 6. Tests and CI

```bash
cd server && npm install     # required first: suites require() routes directly
npm test                     # 257 tests
npm run brand:audit          # rendered-page brand check, needs playwright
```

`.github/workflows/ci.yml` runs the suite on every pull request and push to
`main`. The `Dockerfile` runs it again in a build stage, so a Railway deploy of
a red commit fails at build instead of reaching production.

Most tests read source files rather than running the app, which makes them fast
but blind to anything that only exists once a page is rendered. That gap is why
`tools/brand-audit.js` drives a real browser: it caught four calls to action and
five stray logos that every static test reported as clean.

## 7. Deployment

Push to `main` → Railway builds `Dockerfile` → tests run in the build → image
deploys → health check `/api/v2/health`.
