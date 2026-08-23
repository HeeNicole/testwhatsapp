/**
 * Renders an engine answer into WhatsApp message text.
 *
 * WhatsApp supports *bold*, _italic_ and ```monospace``` only — no headings,
 * tables or links markup. Messages are capped at 4096 characters, so long
 * answers are split on paragraph boundaries.
 */
const LIMIT = 3900; // leave headroom under WhatsApp's 4096 limit

const ENT = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘',
  '&rarr;': '→', '&nbsp;': ' ', '&hellip;': '…',
  '&divide;': '÷', '&times;': '×', '&minus;': '−', '&plusmn;': '±',
  '&deg;': '°', '&frac12;': '½', '&sect;': '§', '&para;': '¶'
};

/** Convert the knowledge base's light HTML into WhatsApp text. */
function html2wa(html) {
  let s = String(html);
  s = s.replace(/<li>/g, '\n• ').replace(/<\/li>/g, '');
  s = s.replace(/<\/?ul>/g, '\n');
  s = s.replace(/<\/?(b|strong)>/g, '*');
  s = s.replace(/<\/?(i|em)>/g, '_');
  s = s.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&[a-z#0-9]+;/gi, m => (ENT[m] !== undefined ? ENT[m] : m));
  // An empty *…* or _…_ pair renders as literal punctuation in WhatsApp.
  s = s.replace(/\*\s*\*/g, '').replace(/_\s*_/g, '');
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderSources(sources) {
  if (!sources || !sources.length) return '';
  const body = sources.map(s =>
    '• ' + s.a + ' — ' + s.t + '\n' + s.u + '\n_' + s.p + '_'
  ).join('\n\n');
  return '*Source' + (sources.length > 1 ? 's' : '') + ':*\n' + body;
}

/**
 * @returns {string[]} one or more messages to send in order
 */
function render(a, opts) {
  opts = opts || {};
  const parts = [];

  parts.push('*' + html2wa(a.title) + '*');

  /* Asked in Malay: lead with the verdict in Malay, then the English detail. */
  if (a.ms) {
    parts.push('*' + a.ms.label + ':* ' + html2wa(a.ms.text) +
      '\n_Butiran penuh dan sumber rasmi di bawah dalam bahasa Inggeris._');
  }

  if (a.rows && a.rows.length) {
    parts.push(a.rows.map(r =>
      '*' + r.label + ':* ' + r.verdict + '\n' + html2wa(r.reason)
    ).join('\n\n'));
  }

  (a.html || []).forEach(h => { const t = html2wa(h); if (t) parts.push(t); });

  const src = renderSources(a.sources);
  if (src) parts.push(src);

  (a.notes || []).forEach(n => {
    parts.push('_' + n.label + ':_ ' + html2wa(n.text));
  });

  if (opts.footer) parts.push(opts.footer);

  return split(parts.join('\n\n'));
}

/** Split a long message on paragraph, then line, then hard boundaries. */
function split(text) {
  if (text.length <= LIMIT) return [text];
  const out = [];
  let buf = '';
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };

  for (const para of text.split('\n\n')) {
    if ((buf + '\n\n' + para).length <= LIMIT) {
      buf = buf ? buf + '\n\n' + para : para;
      continue;
    }
    flush();
    if (para.length <= LIMIT) { buf = para; continue; }
    let line = '';
    for (const l of para.split('\n')) {
      if ((line + '\n' + l).length <= LIMIT) { line = line ? line + '\n' + l : l; continue; }
      if (line) out.push(line);
      line = l.length <= LIMIT ? l : '';
      if (!line) for (let i = 0; i < l.length; i += LIMIT) out.push(l.slice(i, i + LIMIT));
    }
    buf = line;
  }
  flush();
  return out.length ? out : [text.slice(0, LIMIT)];
}

module.exports = { render, html2wa, split, LIMIT };
