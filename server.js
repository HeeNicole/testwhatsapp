/**
 * WhatsApp webhook for PayrollBuddy.
 *
 * GET  /webhook   Meta verification handshake
 * POST /webhook   incoming messages
 * POST /simulate  local testing without WhatsApp (enable with SIMULATE=1)
 * GET  /health    liveness
 */
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');

const store = require('./store');
const { answer } = require('./engine');
const { render } = require('./format');
const wa = require('./whatsapp');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const HANDOVER_TO = process.env.HANDOVER_NOTIFY_NUMBER || '';

const FOOTER = process.env.REPLY_FOOTER ||
  '_Automated reply — statutory reference only, not formal advice. Reply AGENT to speak to a colleague._';

const GREETING =
  '*Hello, this is PayrollBuddy* 👋\n\n' +
  'I answer Malaysian statutory payroll questions — EPF, SOCSO/EIS/SKBBK, PCB, HRDF and the Employment Act — ' +
  'with the official government source for every answer.\n\n' +
  'Before we start, may I know *which company* you are with?';

const HANDOVER_MSG =
  '*Passing you to a colleague* 🙋\n\n' +
  'Someone from our team will pick this up and reply here shortly. ' +
  'Thank you for your patience.';

/* Messages can be redelivered by Meta; answer each id once. */
const seen = new Map();
const SEEN_TTL = 10 * 60 * 1000;
function alreadyHandled(id) {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > SEEN_TTL) seen.delete(k);
  if (seen.has(id)) return true;
  seen.set(id, now);
  return false;
}

/* --------------------------- webhook verification -------------------------- */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === VERIFY_TOKEN) {
    console.log('[webhook] verified by Meta');
    return res.status(200).send(challenge);
  }
  console.warn('[webhook] verification failed');
  return res.sendStatus(403);
});

/** Meta signs every payload; reject anything we cannot verify. */
function signatureOk(req) {
  if (!APP_SECRET) {
    console.warn('[webhook] WHATSAPP_APP_SECRET not set — signature check skipped');
    return true;
  }
  const header = req.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET)
    .update(req.body).digest('hex');
  const a = Buffer.from(header), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------ conversation ------------------------------ */
const GREET_RE = /^(hi|hai|hello|helo|halo|hey|salam|assalamualaikum|salam sejahtera|selamat (pagi|petang|tengahari|tengah hari|malam)|good (morning|afternoon|evening)|test|testing)\b/i;
const COMPANY_SUFFIX = /\b(sdn\.? ?bhd|berhad|bhd|enterprise|trading|holdings?|resources|industries|services|solutions|technolog|group|plt|llp|corporation|corp|company|co\.?|manufacturing|plantations?|logistics)\b/i;

const isGreeting = t => GREET_RE.test(String(t).trim());

/** Distinguish a company name from a customer who typed their question instead. */
function looksLikeCompany(text) {
  const t = String(text).trim();
  if (!t || t.length > 120) return false;
  if (COMPANY_SUFFIX.test(t)) return true;   // strongest signal — accept outright
  if (isGreeting(t)) return false;
  if (/\?/.test(t)) return false;
  if (/\b(is|are|do|does|can|what|when|how|why|which|berapa|apa|bila|macam|boleh|kena|adakah|nak)\b/i.test(t)) return false;
  // If the payroll engine recognises it, it is a question, not a company.
  return answer(t).category === 'Unconfirmed';
}

/**
 * @returns {string[]} replies to send back
 */
async function handle(phone, body, profileName) {
  const text = String(body || '').trim();
  if (!text) return [];

  const cmd = text.toUpperCase();
  let session = await store.getSession(phone);

  if (cmd === 'RESET' || cmd === 'TUKAR SYARIKAT') {
    await store.clearSession(phone);
    return ['Session cleared. ' + GREETING];
  }

  if (cmd === 'AGENT' || cmd === 'HUMAN' || cmd === 'HELP' || cmd === 'BANTUAN') {
    await store.log({
      phone, company: session && session.company, requester: profileName,
      question: text, category: 'Handover requested', domains: [], cite: '-',
      escalated: false, needsHuman: true, uncertain: false
    });
    await notifyTeam(phone, session, text, 'customer asked for a person');
    return [HANDOVER_MSG];
  }

  // Identity is captured once per number, then never asked again.
  if (!session || !session.company) {
    if (!session) {
      // "Hi" is not a payroll question — do not hold it as one, or the customer
      // gets a handover reply for saying hello.
      await store.setSession(phone, {
        requester: profileName || null,
        pending_q: isGreeting(text) ? null : text
      });
      return [GREETING];
    }
    // We are expecting a company name. Customers often send their real question
    // here instead — bank it rather than filing it as the company.
    if (!looksLikeCompany(text)) {
      await store.setSession(phone, { pending_q: session.pending_q || (isGreeting(text) ? null : text) });
      return ['That looks like a question rather than a company name — I will come back to it. ' +
              'First, may I know *which company* you are with?'];
    }
    const company = text.replace(/\s+/g, ' ').slice(0, 200);
    const pending = session.pending_q;
    await store.setSession(phone, { company, requester: profileName || session.requester, pending_q: null });
    const ack = 'Thank you — noted, *' + company + '*.';
    if (!pending) return [ack + '\n\nWhat would you like to check today?'];
    const replies = await respond(phone, company, profileName, pending);
    return [ack + '\n\nBack to your question:'].concat(replies);
  }

  return respond(phone, session.company, profileName || session.requester, text);
}

async function respond(phone, company, requester, question) {
  const a = answer(question);
  await store.log({
    phone, company, requester, question,
    category: a.category, domains: a.domains, cite: a.cite,
    escalated: a.escalated, needsHuman: a.needsHuman, uncertain: a.uncertain
  });
  if (a.needsHuman) await notifyTeam(phone, { company }, question, a.category);
  return render(a, { footer: FOOTER });
}

/** Ping the internal number so an unanswered question is never lost. */
async function notifyTeam(phone, session, question, why) {
  if (!HANDOVER_TO) return;
  const msg = '*PayrollBuddy — needs a human*\n\n' +
    'From: +' + phone + '\n' +
    'Company: ' + ((session && session.company) || 'not captured') + '\n' +
    'Reason: ' + why + '\n\n' +
    'Question:\n' + question;
  try { await wa.sendText(HANDOVER_TO, msg); }
  catch (err) { console.error('[handover] notify failed:', err.message); }
}

/* -------------------------------- incoming -------------------------------- */
app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  if (!signatureOk(req)) {
    console.warn('[webhook] bad signature — rejected');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // acknowledge fast; Meta retries on delay

  let payload;
  try { payload = JSON.parse(req.body.toString('utf8')); }
  catch { return console.error('[webhook] payload was not JSON'); }

  for (const entry of payload.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const contacts = v.contacts || [];
      for (const m of v.messages || []) {
        if (alreadyHandled(m.id)) continue;
        if (m.type !== 'text') {
          await wa.sendAll(m.from, [
            'I can only read text messages at the moment. Please type your payroll question, ' +
            'or reply AGENT to speak to a colleague.'
          ]).catch(e => console.error('[send]', e.message));
          continue;
        }
        const profileName = (contacts[0] && contacts[0].profile && contacts[0].profile.name) || null;
        try {
          wa.markRead(m.id);
          const replies = await handle(m.from, m.text.body, profileName);
          if (replies.length) await wa.sendAll(m.from, replies);
        } catch (err) {
          console.error('[handle]', err);
          await wa.sendText(m.from,
            'Sorry — something went wrong on our side. Our team has been alerted and will follow up.'
          ).catch(() => {});
          await notifyTeam(m.from, null, m.text.body, 'bot error: ' + err.message);
        }
      }
    }
  }
});

/* ---------------------------------------------------------------------------
 * Test console.
 * Enabled explicitly with SIMULATE=1. Also enabled automatically when no
 * WhatsApp credentials are configured — without a token the service cannot be
 * talking to real customers, so exposing the console costs nothing. As soon as
 * a real token is set it switches off again unless SIMULATE=1 is explicit,
 * and SIMULATE=0 always forces it off.
 * ------------------------------------------------------------------------- */
const HAS_WHATSAPP = !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
const SIMULATE_ON = process.env.SIMULATE === '1' ||
                    (!HAS_WHATSAPP && process.env.SIMULATE !== '0');

if (SIMULATE_ON) {
  // Browser test console at / — same engine, no phone number needed.
  app.use(express.static(require('path').join(__dirname, 'public')));

  app.post('/simulate', express.json(), async (req, res) => {
    const from = String(req.body.from || '60000000000');
    try {
      const replies = await handle(from, req.body.text, req.body.name || 'Test User');
      res.json({ from, replies });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  console.log('[sim] test console enabled at / — ' +
    (process.env.SIMULATE === '1' ? 'SIMULATE=1' : 'no WhatsApp credentials configured'));
}

app.get('/health', (_req, res) => res.json({ ok: true, store: store.useDb ? 'mysql' : 'file' }));

store.init()
  .then(() => {
    // Bind 0.0.0.0 explicitly — container platforms route to the external
    // interface, and PORT must come from the platform, not from our default.
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[server] listening on 0.0.0.0:${PORT}`);
      console.log(`[server] PORT from environment: ${process.env.PORT || '(not set — using 3000)'}`);
      console.log('[server] test console: ' + (SIMULATE_ON ? 'ENABLED at /'
        : process.env.SIMULATE === '0' ? 'DISABLED (SIMULATE=0)'
        : 'DISABLED (WhatsApp credentials present; set SIMULATE=1 to force on)'));
    });
  })
  .catch(err => { console.error('[startup]', err); process.exit(1); });
