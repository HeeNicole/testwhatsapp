/**
 * WhatsApp Cloud API transport (Meta Graph API).
 *
 * GRAPH_VERSION is configurable because Meta ships a new Graph version every few
 * months and deprecates old ones — check the current version in Meta for
 * Developers before deploying, and set it in .env.
 */
const VERSION = process.env.GRAPH_VERSION || 'v21.0';
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

const BASE = () => `https://graph.facebook.com/${VERSION}/${PHONE_ID}`;

async function post(path, body) {
  if (!TOKEN || !PHONE_ID) {
    throw new Error('WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured');
  }
  const res = await fetch(BASE() + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`WhatsApp API ${res.status}: ${text}`);
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/** Send one plain-text message. */
function sendText(to, body) {
  return post('/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body }
  });
}

/** Send several messages in order, pausing briefly so they arrive in sequence. */
async function sendAll(to, messages) {
  const out = [];
  for (const m of messages) {
    out.push(await sendText(to, m));
    if (messages.length > 1) await new Promise(r => setTimeout(r, 350));
  }
  return out;
}

/** Blue ticks — optional, purely cosmetic. */
function markRead(messageId) {
  return post('/messages', {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  }).catch(() => {});
}

module.exports = { sendText, sendAll, markRead, VERSION };
