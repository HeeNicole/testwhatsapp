/**
 * Answer engine — the same classification logic as the browser prototype, but it
 * returns structured data instead of HTML so it can be rendered for WhatsApp.
 *
 * Everything it knows comes from kb-data.js, which is generated from the HTML
 * file by sync-kb.js. Do not add statutory content here.
 */
const {
  SRC, YES, NO, CHK, KB, TOPICS, RATE_KEYS, PROCS, OUT_OF_SCOPE, ESCALATE
} = require('./kb-data');

const DOMLABEL = {
  epf: 'EPF (KWSP)', socso: 'SOCSO / EIS / SKBBK',
  lhdn: 'Income Tax (PCB)', hrdf: 'HRDF Levy', ea: 'Employment Act'
};
const DOMSHORT = { epf: 'EPF', socso: 'SOCSO', lhdn: 'PCB', hrdf: 'HRDF', ea: 'Employment Act' };

/* ---------------------------------------------------------------------------
 * Malay and colloquial phrasing.
 * Customers type "elaun kereta kena EPF ke?" rather than "Is a fixed transport
 * allowance subject to EPF?". Rather than duplicate every knowledge-base key in
 * Malay, we append the English equivalents to the text being matched. The user's
 * original wording is never altered — only the string used for keyword scoring.
 * ------------------------------------------------------------------------- */
const EXPAND = [
  [/\belaun\b/, 'allowance'],
  [/\bkena\b|\btertakluk\b|\bdikenakan\b/, 'subject'],
  [/\bcaruman\b/, 'contribution'],
  [/\bpotongan\b|\bpotong\b/, 'deduction'],
  [/\bgaji\b/, 'salary wages'],
  [/\bkereta\b|\bminyak\b|\bpetrol\b|\bperjalanan\b|\bpengangkutan\b/, 'transport allowance travelling allowance'],
  [/\bmakan\b|\bmakanan\b/, 'meal allowance'],
  [/\brumah\b|\bperumahan\b|\bsewa\b/, 'housing allowance'],
  [/\btelefon\b|\bfon\b/, 'phone allowance'],
  [/\blebih masa\b|\bot\b|\bkerja lebih\b/, 'overtime'],
  [/\bkomisen\b/, 'commission'],
  [/\bbonus tahunan\b/, 'annual bonus'],
  [/\bbercuti\b|\bcuti\b/, 'leave'],
  [/\bsakit\b/, 'sick leave'],
  [/\bbersalin\b|\bmengandung\b/, 'maternity'],
  [/\bbapa\b|\bpaterniti\b/, 'paternity'],
  [/\btahunan\b/, 'annual'],
  [/\bhospital\b|\bwad\b/, 'hospitalisation'],
  [/\bberhenti kerja\b|\bpemberhentian\b|\bbuang kerja\b/, 'termination'],
  [/\bnotis\b/, 'notice'],
  [/\bpampasan\b/, 'retrenchment'],
  [/\bganjaran\b/, 'gratuity'],
  [/\bperubatan\b/, 'medical'],
  [/\bpekerja asing\b|\bwarga asing\b|\bbangla\b|\bforeigner\b/, 'foreign worker'],
  [/\bpengarah\b/, 'director fee'],
  [/\bberapa\b/, 'how many'],
  [/\bmacam mana\b|\bcamne\b|\bmcm mana\b|\bbagaimana\b/, 'how do'],
  [/\bbila\b/, 'when'],
  [/\bdaftar\b|\bpendaftaran\b/, 'register'],
  [/\bjam kerja\b|\bjam bekerja\b|\bwaktu kerja\b/, 'working hours'],
  [/\bperatus\b|\bperatusan\b/, 'percentage rate'],
  [/\bumur\b|\bberumur\b/, 'age'],
  [/\bsimpan\b|\bmenyimpan\b/, 'keep record'],
  [/\bborang\b/, 'form'],
  [/\bletak kereta\b|\bparkir\b/, 'parking'],
  [/\bhantar\b|\bmenghantar\b/, 'submit'],
  [/\bsiling\b/, 'ceiling'],
  [/\bkadar\b/, 'rate'],
  [/\bpekerja baharu\b|\bpekerja baru\b/, 'new employee'],
  [/\bmajikan\b/, 'employer']
];

/* Malay attaches affixes to roots — memotong/potong, mengira/kira,
   dikenakan/kena, berumur/umur. Strip the common ones and append the root so a
   root keyword still matches. Stems are ADDED, never substituted, so this can
   only widen matching, never break an existing one. */
const PREFIX = /^(meng|meny|mem|men|peng|peny|pem|pen|ber|ter|per|di|ke|se|me|pe)/;
const SUFFIX = /(kannya|annya|nya|kan|an|i)$/;
/* meN- assimilates and swallows the root's first consonant:
   mem+otong = potong, meng+ira = kira, meny+impan = simpan, men+ulis = tulis.
   Restore the dropped consonant as an extra candidate. */
const NASAL = { mem: 'p', meng: 'k', meny: 's', men: 't', pem: 'p', peng: 'k', peny: 's', pen: 't' };

function stems(w) {
  const out = [];
  const push = v => {
    if (v && v.length >= 3 && v !== w && out.indexOf(v) === -1) out.push(v);
  };
  const m = w.match(PREFIX);
  const base = m ? w.slice(m[0].length) : w;
  push(base);
  if (m && NASAL[m[0]] && /^[aeiou]/.test(base)) push(NASAL[m[0]] + base);
  for (const v of out.slice()) push(v.replace(SUFFIX, ''));
  push(w.replace(SUFFIX, ''));
  return out;
}

function normalise(raw) {
  let t = ' ' + String(raw).toLowerCase()
    .replace(/[^a-z0-9%,\s]/g, ' ')
    .replace(/\s+/g, ' ') + ' ';

  const roots = [];
  for (const w of t.trim().split(' ')) {
    if (w.length < 5) continue;
    for (const st of stems(w)) {
      if (t.indexOf(' ' + st + ' ') === -1 && roots.indexOf(st) === -1) roots.push(st);
    }
  }
  if (roots.length) t += roots.join(' ') + ' ';

  const extra = [];
  for (const [re, add] of EXPAND) if (re.test(t)) extra.push(add);
  if (extra.length) t += extra.join(' ') + ' ';
  return t;
}

/* ---------------------------------------------------------------------------
 * Language detection + the Malay summary line.
 * Customers may ask in Malay; the knowledge base detail stays in English, so we
 * lead with a one-line verdict in Malay when the question was asked in Malay.
 * ------------------------------------------------------------------------- */
const MS_STRONG = /\b(adakah|apakah|bilakah|berapakah|bolehkah|bagaimanakah|tertakluk|elaun|caruman|majikan|pekerja|cuti|gaji|potongan|syarikat|kelayakan|dikenakan|perlukah)\b/;
const MS_WEAK = /\b(kena|tak|boleh|perlu|hari|berapa|nak|macam|mana|wajib|sila|saya|kami|kalau|sebab|dengan|untuk|yang|tidak|ke)\b/;

function isMalay(raw) {
  const t = ' ' + String(raw).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  if (MS_STRONG.test(t)) return true;
  const weak = t.match(new RegExp(MS_WEAK.source, 'g'));
  return !!weak && new Set(weak).size >= 2;
}

const MS_VERDICT = { 'Subject': 'tertakluk', 'Not subject': 'tidak tertakluk', 'Depends': 'bergantung' };
const MS_DOMAIN = {
  'EPF (KWSP)': 'KWSP', 'SOCSO / EIS / SKBBK': 'PERKESO/SIP/SKBBK',
  'Income Tax (PCB)': 'Cukai (PCB)', 'HRDF Levy': 'Levi HRDF', 'Employment Act': 'Akta Kerja'
};
const MS_FALLBACK = {
  'Rate/ceiling lookup': 'Kadar dan siling berubah dari semasa ke semasa — sila rujuk jadual rasmi di bawah. Saya tidak menyatakan angka daripada ingatan.',
  'Escalated': 'Perkara ini melibatkan pertikaian, audit atau penguatkuasaan. Pasukan kami akan menghubungi anda.',
  'Out of scope': 'Soalan ini di luar skop statutori yang saya liputi.',
  'Unconfirmed': 'Saya tidak dapat mengesahkan jawapan ini daripada sumber rasmi. Pasukan kami akan menghubungi anda.'
};

/** Build the leading Malay line, or null when the question was asked in English. */
function malayLine(raw, result, entry) {
  if (!isMalay(raw)) return null;
  let text = null;
  if (result.rows && result.rows.length && entry && entry.ms) {
    text = entry.ms + ' — ' + result.rows
      .map(r => (MS_DOMAIN[r.label] || r.label) + ': ' + (MS_VERDICT[r.verdict] || r.verdict))
      .join(' · ');
  } else if (entry && entry.ms) {
    text = entry.ms;
  } else if (MS_FALLBACK[result.category]) {
    text = MS_FALLBACK[result.category];
  }
  return text ? { label: 'Ringkasan (BM)', text } : null;
}

/* ------------------------------- matching ------------------------------- */
function scoreEntry(text, keys) {
  let s = 0;
  for (const k of keys) {
    if (k.indexOf('+') !== -1) {
      const parts = k.split('+');
      let all = true, len = 0;
      for (const p of parts) {
        if (text.indexOf(p) === -1) { all = false; break; }
        len += p.length;
      }
      if (all) s += parts.length * 3 + len / 10;
    } else if (text.indexOf(k) !== -1) {
      s += k.split(' ').length * 2 + k.length / 10;
    }
  }
  return s;
}
function bestScored(text, arr) {
  let best = null, bs = 0;
  for (const e of arr) {
    const s = scoreEntry(text, e.keys || e.k);
    if (s > bs) { bs = s; best = e; }
  }
  return { it: bs > 0 ? best : null, s: bs };
}
function hit(text, list) {
  for (const l of list) if (text.indexOf(l) !== -1) return l;
  return null;
}
function namedDomains(text) {
  const d = [];
  if (/\b(epf|kwsp|provident)\b/.test(text)) d.push('epf');
  if (/\b(socso|perkeso|sosco)\b/.test(text)) d.push('socso');
  if (/\b(eis|sip|skbbk|lindung)\b/.test(text) && d.indexOf('socso') === -1) d.push('socso');
  if (/\b(pcb|lhdn|income tax|tax|cukai|mtd)\b/.test(text)) d.push('lhdn');
  if (/\b(hrdf|hrd corp|hrdcorp|levy|levi)\b/.test(text)) d.push('hrdf');
  return d;
}
const srcOf = ids => {
  const seen = new Set(), out = [];
  for (const i of ids) if (!seen.has(i) && SRC[i]) { seen.add(i); out.push(SRC[i]); }
  return out;
};
const citeOf = ids => srcOf(ids).map(s => s.u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')).join('; ');

/* -------------------------------- answer -------------------------------- */
function classify(raw) {
  const text = normalise(raw);

  // 1. escalation — a dispute is never a lookup
  const e = hit(text, ESCALATE);
  if (e) {
    return {
      category: 'Escalated', domains: [], cite: '-', escalated: true, needsHuman: true,
      title: 'This needs a person, not an automated lookup',
      html: [
        'Your question mentions <b>' + e + '</b>, which puts it into enforcement, dispute or audit territory. ' +
        'That turns on documents I cannot see, and a wrong answer there has real consequences.',
        'I have passed this to our team and someone will follow up with you directly. ' +
        'If there is a specific payroll component involved, ask me about that part separately and I can give you the statutory treatment straight away.'
      ],
      notes: [], sources: []
    };
  }

  const topicHit = bestScored(text, TOPICS);
  const compHit = bestScored(text, KB);
  let chosenTopic = null;
  if (/(how many|berapa|entitle|minimum days|how long|days of|hours per week|maximum hours|limit|how much leave)/.test(text)) {
    const ent = bestScored(text, TOPICS.filter(x => x.entitlement));
    if (ent.it) { topicHit.it = ent.it; topicHit.s = ent.s + 10; }
  }
  if (topicHit.it && topicHit.s > compHit.s) chosenTopic = topicHit.it;

  // 2. special topics (SKBBK, foreign workers, leave, hours, employer duties…)
  if (chosenTopic) {
    const t = chosenTopic;
    let title = t.title, html = t.body ? t.body.slice() : [];
    if (t.items) {
      let picked = t.items.filter(i => i.k.some(kk => text.indexOf(kk) !== -1));
      if (!picked.length) picked = t.items;
      if (picked.length === 1) title = picked[0].title;
      html = [];
      if (t.intro) html.push(t.intro);
      html.push('<ul>' + picked.map(i => '<li>' + i.html + '</li>').join('') + '</ul>');
      if (picked.length < t.items.length) {
        html.push('Ask me about any of the others and I will pull them up: ' +
          t.items.filter(i => picked.indexOf(i) === -1)
                 .map(i => i.title.split('—')[0].trim()).join(', ') + '.');
      }
      if (t.outro) html.push(t.outro);
    }
    const notes = [];
    if (t.caveat) notes.push({ label: 'Check before you rely on this', text: t.caveat });
    const st = /\bsabah\b/.test(text) ? 'sabah' : (/\bsarawak\b/.test(text) ? 'swk' : null);
    if (t.entitlement && st) {
      notes.push({
        label: 'A different statute applies here',
        text: 'You mentioned <b>' + (st === 'sabah' ? 'Sabah' : 'Sarawak') + '</b>. The figures above are the Peninsular position. ' +
          (st === 'sabah'
            ? 'Sabah is governed by the Sabah Labour Ordinance (Amendment) 2024 — confirm with Jabatan Tenaga Kerja Sabah.'
            : 'Sarawak is governed by the Sarawak Labour (Amendment) Ordinance 2024, which reduced the working week from 48 to 45 hours — confirm with Jabatan Tenaga Kerja Sarawak.')
      });
    } else if (t.clarify) {
      notes.push({ label: 'Tell me this and I can be exact', text: t.clarify });
    }
    return {
      category: t.cat || 'Component classification', domains: t.domains || [],
      cite: t.cite || citeOf(t.src), escalated: false, uncertain: !!t.uncertain,
      needsHuman: false, title, html, notes, sources: srcOf(t.src), entry: t
    };
  }

  // 3. component classification
  if (compHit.it) {
    const k = compHit.it;
    const want = namedDomains(text);
    const order = ['epf', 'socso', 'lhdn', 'hrdf'];
    const show = want.length ? order.filter(d => want.indexOf(d) !== -1) : order;
    const rows = show.map(d => ({
      label: DOMLABEL[d],
      verdict: k[d].v === CHK ? 'Depends' : k[d].v,
      reason: k[d].r
    }));
    const srcIds = show.slice();
    (k.extra || []).forEach(x => { if (srcIds.indexOf(x) === -1) srcIds.push(x); });
    if (show.indexOf('socso') !== -1 && /\b(skbbk|lindung)\b/.test(text)) srcIds.push('skbbk');

    const notes = [];
    if (show.indexOf('socso') !== -1) {
      notes.push({
        label: 'Applies to EIS and SKBBK as well',
        text: 'EIS (SIP) and SKBBK / LINDUNG 24 JAM use the same wage definition as SOCSO (Akta 4, s.2(24)). ' +
              'Whatever is subject to SOCSO is subject to those two; only the rates and who bears them differ.'
      });
    }
    (k.notes || []).forEach(n => notes.push({ label: 'Note', text: n }));
    if (k.clarify) notes.push({ label: 'Clarify before you process this', text: k.clarify });

    return {
      category: 'Component classification',
      domains: show.map(d => DOMSHORT[d]),
      cite: citeOf(srcIds), escalated: false,
      uncertain: show.some(d => k[d].v === CHK), needsHuman: false,
      title: k.label, rows, html: [], notes, sources: srcOf(srcIds), entry: k
    };
  }

  // 4. rate / ceiling lookup — never quoted from memory
  const r = bestScored(text, RATE_KEYS).it;
  if (r) {
    return {
      category: 'Rate/ceiling lookup', domains: r.d, cite: citeOf(r.s),
      escalated: false, uncertain: true, needsHuman: false,
      title: 'Current rate or threshold',
      html: [
        'You are asking about <b>' + r.what + '</b>. Figures like this get revised by ministerial order or budget announcement, ' +
        'and quoting a remembered number into a payroll run is how under-deduction happens.',
        'I will not state it from memory. The official table below carries the current value — it is the same page an auditor checks against.'
      ],
      notes: [{
        label: 'Note',
        text: 'Record the effective date alongside whatever figure you take, so you can show which version you applied.'
      }],
      sources: srcOf(r.s)
    };
  }

  // 5. procedural
  const p = bestScored(text, PROCS).it;
  if (p) {
    return {
      category: 'Procedural', domains: p.d, cite: citeOf(p.s),
      escalated: false, uncertain: false, needsHuman: false,
      title: p.title,
      html: ['<ul>' + p.steps.map(s => '<li>' + s + '</li>').join('') + '</ul>'],
      notes: [{ label: 'Note', text: 'Forms, portals and deadlines change. Confirm the current form number and due date on the portal above before you submit.' }],
      sources: srcOf(p.s), entry: p
    };
  }

  // 6. out of scope
  const o = hit(text, OUT_OF_SCOPE);
  if (o) {
    return {
      category: 'Out of scope', domains: [], cite: '-', escalated: false,
      uncertain: false, needsHuman: false,
      title: 'Outside what I cover',
      html: [
        'That question is about <b>' + o + '</b>, which sits outside the statutory areas I handle — ' +
        'Employment Act, EPF, SOCSO/EIS/SKBBK, income tax (PCB) and the HRD Corp levy.',
        'If there is a payroll component inside that situation — an allowance, a deduction, a termination payment — ask me about that and I will give you the statutory treatment.'
      ],
      notes: [], sources: []
    };
  }

  // 7. no confident match — hand to a person rather than guess
  return {
    category: 'Unconfirmed', domains: [], cite: '-', escalated: false,
    uncertain: true, needsHuman: true,
    title: 'Let me pass this to a colleague',
    html: [
      'I could not match that to something I can answer from an official source, and I would rather not guess on a statutory question.',
      'Our team has been notified and will come back to you. If it helps, you can also rephrase using the payroll item as it appears on the payslip — ' +
      'for example "fixed transport allowance" rather than "travel money" — and tell me whether it is a fixed monthly amount or claimed against receipts.'
    ],
    notes: [], sources: []
  };
}

/** Public entry point: classify, then attach the Malay summary line. */
function answer(raw) {
  const r = classify(raw);
  r.ms = malayLine(raw, r, r.entry);
  delete r.entry;
  return r;
}

module.exports = { answer, classify, normalise, isMalay, DOMLABEL, DOMSHORT };
