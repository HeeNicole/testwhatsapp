/**
 * Routing regression test — run with `npm test` after any knowledge base change.
 *
 * Each case asserts the category the question should land in, and (optionally)
 * a fragment that must appear in the answer title. It does not check statutory
 * wording; it checks that a question reaches the right entry.
 */
const { answer } = require('./engine');
const { render } = require('./format');

const CASES = [
  // English component classification
  ['Is transport allowance subject to KWSP, SOCSO, income tax or HRDF?', 'Component classification', 'transport'],
  ['Is overtime subject to EPF?', 'Component classification', 'Overtime'],
  ['Is annual bonus subject to SOCSO?', 'Component classification', 'bonus'],
  ['Is meal allowance subject to SKBBK?', 'Component classification', 'Meal'],
  ['Is maternity allowance subject to EPF?', 'Component classification', 'Maternity leave pay'],
  ['Is a resignation-in-lieu payment subject to PCB?', 'Component classification', 'lieu of notice'],

  // Malay / colloquial
  ['elaun kereta kena EPF ke?', 'Component classification', 'transport'],
  ['elaun makan kena socso?', 'Component classification', 'Meal'],
  ['OT kena EPF tak?', 'Component classification', 'Overtime'],
  ['my staff resign notice pay macam mana?', 'Component classification', 'lieu of notice'],

  // Entitlements
  ['How many days annual leave?', 'Statutory entitlement', 'Annual leave'],
  ['paternity limit how many kids?', 'Statutory entitlement', 'Paternity'],
  ['berapa hari cuti tahunan?', 'Statutory entitlement', 'Annual leave'],
  ['How many hours per week can an employee work in Sarawak?', 'Statutory entitlement', 'working hours'],
  ['Which act applies to employees in Sabah?', 'Statutory entitlement', 'labour statute'],

  // Topics
  ['What is SKBBK?', 'Component classification', 'SKBBK'],
  ['Do we deduct SOCSO for a foreign worker earning above RM5,000?', 'Component classification', 'Foreign'],

  // Rates — must never be answered from memory
  ['What is the current EPF contribution rate for employees above 60?', 'Rate/ceiling lookup', null],
  ['berapa kadar caruman EPF?', 'Rate/ceiling lookup', null],
  ['gaji minimum sekarang berapa?', 'Rate/ceiling lookup', null],

  // Procedural
  ['How do I register a new employee with SOCSO?', 'Procedural', 'SOCSO'],
  ['macam mana nak daftar pekerja baru dengan SOCSO?', 'Procedural', 'SOCSO'],
  ['When must we submit Form E and CP8D?', 'Procedural', 'Form E'],
  ['What is CP22 and when is it due?', 'Procedural', 'CP22'],

  // Escalation, scope, fallback
  ['LHDN issued a garnishee order on our director', 'Escalated', null],
  ['How do I apply for a work permit?', 'Out of scope', null],
  ['durian subsidy kena epf?', 'Unconfirmed', null]
];

let pass = 0;
const fails = [];

for (const [q, wantCat, wantTitle] of CASES) {
  const a = answer(q);
  const okCat = a.category === wantCat;
  const okTitle = !wantTitle || a.title.toLowerCase().includes(wantTitle.toLowerCase());
  if (okCat && okTitle) { pass++; continue; }
  fails.push(`  ✗ ${q}\n      expected [${wantCat}]${wantTitle ? ' ~ "' + wantTitle + '"' : ''}\n      got      [${a.category}] ${a.title}`);
}

// Every answer must render to at least one non-empty WhatsApp message.
for (const [q] of CASES) {
  const msgs = render(answer(q), { footer: '_footer_' });
  if (!msgs.length || !msgs[0].trim()) fails.push(`  ✗ ${q}\n      rendered to an empty message`);
  for (const m of msgs) {
    if (m.length > 4096) fails.push(`  ✗ ${q}\n      message exceeds WhatsApp's 4096 limit (${m.length})`);
    if (/<[a-z/]/i.test(m)) fails.push(`  ✗ ${q}\n      HTML leaked into WhatsApp text: ${m.match(/<[^>]{0,40}/)[0]}`);
    const ent = m.match(/&[a-z]+;|&#\d+;/i);
    if (ent) fails.push(`  ✗ ${q}\n      undecoded HTML entity in WhatsApp text: ${ent[0]}`);
  }
}

console.log(`routing: ${pass}/${CASES.length} passed`);
if (fails.length) {
  console.log('\nFAILURES:\n' + fails.join('\n'));
  process.exit(1);
}
console.log('render: all answers produce valid WhatsApp messages');
console.log('OK');
