/**
 * Daily usage report.
 *
 *   node report.js              today
 *   node report.js 2026-08-22   a specific date
 *   node report.js --csv        also write payrollbuddy-report-<date>.csv
 *
 * Run it from Task Scheduler / cron once a day.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const store = require('./store');

const args = process.argv.slice(2);
const wantCsv = args.includes('--csv');
const date = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || store.dstr(new Date());

(async () => {
  await store.init();
  const rows = await store.dailyRows(date);

  if (!rows.length) {
    console.log('No questions logged for ' + date + '.');
    await store.close();
    return;
  }

  const companies = new Set(), domCount = {};
  const escalated = [], needHuman = [], uncertain = [];
  for (const r of rows) {
    if (r.company) companies.add(r.company);
    if (r.domains && r.domains !== '-') {
      for (const d of String(r.domains).split(', ')) domCount[d] = (domCount[d] || 0) + 1;
    }
    if (Number(r.escalated)) escalated.push(r);
    if (Number(r.needs_human)) needHuman.push(r);
    if (Number(r.uncertain)) uncertain.push(r);
  }
  const top = Object.keys(domCount).sort((a, b) => domCount[b] - domCount[a])[0] || '—';

  const line = '='.repeat(78);
  console.log(line);
  console.log('PayrollBuddy — daily usage report for ' + date);
  console.log(line);
  console.log(
    rows.length + ' question' + (rows.length === 1 ? '' : 's') +
    ' from ' + companies.size + ' compan' + (companies.size === 1 ? 'y' : 'ies') +
    '; most-asked domain: ' + top +
    '; ' + needHuman.length + ' needing follow-up.'
  );
  console.log('');
  const pad = (s, n) => String(s == null ? '' : s).slice(0, n).padEnd(n);
  console.log(pad('Time', 6) + pad('Company', 26) + pad('Question', 40) + pad('Domain(s)', 16) + 'Source');
  console.log('-'.repeat(78));
  for (const r of rows) {
    console.log(
      pad(r.log_time, 6) + pad(r.company || '(not captured)', 26) +
      pad(r.question, 40) + pad(r.domains, 16) + String(r.source_cited || '-').slice(0, 30)
    );
  }

  if (needHuman.length) {
    console.log('\nNEEDS FOLLOW-UP');
    for (const r of needHuman) {
      console.log('  ' + r.log_time + '  +' + r.phone + '  ' + (r.company || '(not captured)') +
                  '\n      ' + r.question + '\n      [' + r.category + ']');
    }
  }
  if (uncertain.length) {
    console.log('\nANSWERED WITH A "CONFIRM WITH THE AGENCY" CAVEAT');
    for (const r of uncertain) console.log('  ' + r.log_time + '  ' + (r.company || '-') + ' — ' + r.question);
  }

  if (wantCsv) {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['date', 'time', 'phone', 'company_name', 'requester_name', 'question',
                  'category', 'domains_covered', 'source_cited', 'escalated', 'needs_human'];
    const csv = head.join(',') + '\n' + rows.map(r => [
      r.log_date, r.log_time, r.phone, r.company, r.requester, r.question,
      r.category, r.domains, r.source_cited,
      Number(r.escalated) ? 'Yes' : 'No', Number(r.needs_human) ? 'Yes' : 'No'
    ].map(q).join(',')).join('\n');
    const out = path.join(__dirname, 'payrollbuddy-report-' + date + '.csv');
    fs.writeFileSync(out, csv, 'utf8');
    console.log('\nCSV written: ' + out);
  }

  await store.close();
})().catch(err => { console.error(err); process.exit(1); });
