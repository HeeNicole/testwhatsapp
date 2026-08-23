/**
 * Question sweep — runs every question in questions.txt through the engine and
 * reports what the customer would get.
 *
 *   npm run sweep            console table + coverage summary
 *   npm run sweep -- --full  also writes sweep-report.md with the full replies
 *
 * The point of this tool is the FALL-THROUGHS list at the bottom: those are the
 * phrasings the knowledge base does not cover yet.
 */
const fs = require('fs');
const path = require('path');
const { answer } = require('./engine');
const { render } = require('./format');

const FILE = process.argv.find(a => a.endsWith('.txt')) ||
  path.join(__dirname, 'questions.txt');
const full = process.argv.includes('--full');

const questions = fs.readFileSync(FILE, 'utf8')
  .split(/\r?\n/)
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

if (!questions.length) {
  console.error('No questions found in ' + FILE);
  process.exit(1);
}

const results = questions.map(q => {
  const a = answer(q);
  const msgs = render(a, { footer: '_footer_' });
  return { q, a, msgs };
});

const pad = (s, n) => {
  s = String(s == null ? '' : s);
  return (s.length > n ? s.slice(0, n - 1) + '…' : s).padEnd(n);
};

console.log('');
console.log(pad('#', 4) + pad('ROUTE', 26) + pad('QUESTION', 46) + 'ANSWER');
console.log('-'.repeat(120));
results.forEach((r, i) => {
  const flag = r.a.needsHuman ? '  <-- HANDOVER' : '';
  console.log(
    pad(i + 1, 4) + pad(r.a.category, 26) + pad(r.q, 46) +
    (r.a.needsHuman ? '' : r.a.title.slice(0, 40)) + flag
  );
});

const byCat = {};
for (const r of results) byCat[r.a.category] = (byCat[r.a.category] || 0) + 1;
const handover = results.filter(r => r.a.needsHuman);
const answered = results.length - handover.length;
const pct = Math.round((answered / results.length) * 100);

console.log('');
console.log('='.repeat(120));
console.log(`COVERAGE: ${answered}/${results.length} answered (${pct}%) — ${handover.length} would go to a human`);
console.log('');
Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])
  .forEach(c => console.log('  ' + pad(c, 28) + byCat[c]));

/* An escalation is a designed handover (disputes, audits) — not a gap.
   Only "Unconfirmed" means the knowledge base did not recognise the question. */
const gaps = handover.filter(r => r.a.category === 'Unconfirmed');
const byDesign = handover.filter(r => r.a.category !== 'Unconfirmed');

if (gaps.length) {
  console.log('');
  console.log('GAPS — the engine did not recognise these. This is your to-do list:');
  gaps.forEach(r => console.log('  • ' + r.q));
}
if (byDesign.length) {
  console.log('');
  console.log('HANDED OVER BY DESIGN — correct behaviour, no action needed:');
  byDesign.forEach(r => console.log('  • ' + r.q + '   [' + r.a.category + ']'));
}

const longest = results.reduce((m, r) => Math.max(m, r.msgs.join('').length), 0);
const split = results.filter(r => r.msgs.length > 1).length;
console.log('');
console.log(`Message sizes: longest reply ${longest} chars; ${split} answer(s) split across multiple WhatsApp messages.`);

if (full) {
  const out = path.join(__dirname, 'sweep-report.md');
  let md = '# PayrollBuddy — question sweep\n\n';
  md += `${answered}/${results.length} answered (${pct}%), ${handover.length} handed over.\n\n`;
  md += 'Read these as the customer would receive them.\n\n---\n\n';
  results.forEach((r, i) => {
    md += `## ${i + 1}. ${r.q}\n\n`;
    md += `**Route:** ${r.a.category}${r.a.needsHuman ? ' — HANDOVER' : ' — ' + r.a.title}\n\n`;
    r.msgs.forEach((m, j) => {
      md += (r.msgs.length > 1 ? `*message ${j + 1} of ${r.msgs.length}*\n\n` : '');
      md += '```\n' + m + '\n```\n\n';
    });
    md += '---\n\n';
  });
  fs.writeFileSync(out, md, 'utf8');
  console.log('\nFull replies written to ' + out);
}
