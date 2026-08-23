# PayrollBuddy — WhatsApp bot

Answers customers' Malaysian statutory payroll questions on WhatsApp, using the
same knowledge base as the browser prototype, and logs every interaction for the
daily usage report.

## How the pieces fit

```
payroll-compliance-chatbot.html   <-- the knowledge base lives here (source of truth)
        |  npm run sync
        v
   kb-data.js  ->  engine.js  ->  format.js  ->  whatsapp.js
                       |                              ^
                    store.js  (MySQL)                 |
                       |                         Meta Cloud API
                    report.js                         |
                                                  customer
```

**Edit statutory content in the HTML file only**, then run `npm run sync`. The
browser demo and the bot can then never disagree on an answer. Nothing statutory
is typed into the Node code.

## Setup

```bash
npm install
cp .env.example .env
npm run sync
npm test
```

Check coverage against a list of real customer questions:

```bash
npm run sweep
```

Edit `questions.txt` (English/Manglish) or `questions-bm.txt` (formal Malay) and
re-run. The GAPS list at the bottom is the knowledge base to-do list.

### Try it without WhatsApp

Set `SIMULATE=1` in `.env`, then:

```bash
npm start
```

```bash
curl -X POST http://localhost:3000/simulate -H "Content-Type: application/json" -d "{\"from\":\"60123456789\",\"text\":\"elaun kereta kena EPF ke?\"}"
```

The first message from a new number asks for the company name; the second answers
the original question. That mirrors the real conversation exactly.

## Connecting the WhatsApp number

This bot runs on the **WhatsApp Business Platform (Cloud API)**, which is not the
same thing as the WhatsApp Business *app*. A number can be on one or the other,
never both — so use a **new number** for the bot and leave your existing business
number in the app for manual chats.

1. Create a Meta Business account and complete business verification.
2. Meta for Developers → create an app → add the **WhatsApp** product.
3. Register the new phone number under WhatsApp → API Setup, and copy the
   **Phone number ID** and an access token into `.env`.
   The test token expires in 24 hours — generate a permanent System User token
   for production.
4. Copy the **App Secret** (App Settings → Basic) into `WHATSAPP_APP_SECRET`.
5. Expose this server over HTTPS on a public URL. For a first test, `ngrok http 3000`
   works; for production put it behind IIS/ARR alongside the other API services.
6. In WhatsApp → Configuration → Webhook, set:
   - Callback URL: `https://your-host/webhook`
   - Verify token: the same string you put in `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to the **messages** field.
7. Message the bot number from your own phone.

## Test run without a WhatsApp number

Set `SIMULATE=1` in `.env`, start the server, and open <http://localhost:3000/> —
a browser chat console that talks to the **same engine** the WhatsApp bot uses.
It reproduces the real conversation: the company-name gate, Malay questions,
handover, message splitting and all.

```bash
npm start
```

"New customer" gives you a fresh pretend phone number so you can replay the
first-contact flow.

### Fastest way to run it online: GitHub Codespaces

No cloud account needed beyond GitHub, and nothing to install locally.

1. On the repo page: **Code -> Codespaces -> Create codespace on main**.
2. Wait for it to build. The devcontainer installs dependencies and creates a
   working .env for you, with SIMULATE=1 already set.
3. In the codespace terminal, run: npm start
4. A notification offers to open the forwarded port 3000 — that is the test
   console. Or use the **Ports** tab and click the globe icon on port 3000.

By default a forwarded port is **private to your GitHub account**. To let a
classmate or trainer try it, open the Ports tab, right-click port 3000 and set
**Port Visibility -> Public**. Set it back to private when you are done.

A codespace stops after a period of inactivity, and the JSON-file log resets
with it. That is fine for a class; it is not somewhere to keep real data.

### Deploying to Railway

1. Go to railway.com and **sign in with GitHub**.
2. **New Project -> Deploy from GitHub repo**, authorise Railway, pick this repo.
3. It detects Node from package.json and deploys using railway.json
   (start command: node server.js, health check: /health).
4. **Variables** tab -> add:

   | Variable   | Value |
   |------------|-------|
   | `SIMULATE` | `1`   |

   Without this the test console at `/` returns 404. Railway sets `PORT` itself,
   so do not add one.
5. **Settings -> Networking -> Generate Domain** to get a public URL.
6. Open the URL. The test console loads at `/`.

**To keep the log between restarts**, add a database: **New -> Database -> MySQL**
in the same project. Railway injects `MYSQLHOST`, `MYSQLUSER` and friends, which
`store.js` reads automatically — no configuration needed, and the tables are
created on first boot. Without it the log lives in a JSON file that resets every
time the container restarts.

Railway runs on trial credit rather than a permanent free tier, so check the
current plan limits before relying on it for anything long-lived.

### Putting it online for others to test

`render.yaml` is included, so a free Render deployment needs no configuration:
push to GitHub, then Render → New → Blueprint → pick the repo. The test console
is at `/` and `/health` is the health check.

Two warnings for a public test URL:

- **Anyone with the link can use it**, and it answers with your curated knowledge
  base. Keep the URL private, or put the service behind Render's access control.
- **Turn `SIMULATE` off** once a real WhatsApp number is connected. Leaving the
  open `/simulate` endpoint enabled in production lets anyone write to your log.

## Knowledge base workflow

The statutory content lives in `payroll-compliance-chatbot.html`, which sits
**outside this repo** (one directory up). `kb-data.js` is generated from it and
**is committed**, because the deployed service has no access to the HTML file.

After editing the knowledge base:

```bash
npm run sync && npm test && git add kb-data.js && git commit -m "kb: update"
```

If `npm run sync` cannot find the HTML, point it at the file:
`KB_HTML=/path/to/payroll-compliance-chatbot.html npm run sync`

## Daily report

```bash
npm run report              # today, printed to the console
node report.js 2026-08-22   # a specific date
node report.js --csv        # also writes a CSV
```

Schedule it once a day (Task Scheduler on Windows). It summarises total questions,
distinct companies, the most-asked domain, and — most importantly — everything
that needs a human follow-up.

## What the bot does with a question it cannot answer

It does **not** guess. Unmatched questions, and anything mentioning a dispute,
audit or enforcement action, get:

1. a reply telling the customer a colleague will follow up,
2. a WhatsApp ping to `HANDOVER_NOTIFY_NUMBER`, and
3. a `needs_human` flag in the log so it appears in the daily report.

Customers can also type `AGENT` (or `HUMAN`, `BANTUAN`) at any time to reach a
person, or `RESET` to change the company on record.

## Known limits

- **Matching is keyword-based**, not an LLM. It handles common English and Malay
  phrasing (see the `EXPAND` table in `engine.js`), but an unusual wording lands in
  handover rather than being answered. Watch the daily report's follow-up list —
  it is the list of phrasings worth adding to the knowledge base.
- **Text messages only.** Voice notes, images and PDFs get a polite "please type it".
- **The 24-hour window applies.** The bot can reply freely only within 24 hours of
  the customer's message. It never initiates conversations, so no paid message
  templates are needed.
- **PDPA 2010.** The log holds phone numbers, names and company names. Decide the
  retention period and who may read the table before going live.
