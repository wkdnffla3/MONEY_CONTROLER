// SQL·RLS 테스트 러너: 테스트마다 빈 DB를 새로 만들어
//   Supabase 흉내(supabase-shim.sql) → schema.sql(또는 옛 스키마 + 마이그레이션) → 테스트 파일
// 순서로 psql 에 넣고, 결과 표의 PASS/FAIL 을 셉니다.
//
// 실행: npm run test:sql
// 접속 정보는 psql 표준 환경 변수를 그대로 씁니다 (기본값: localhost:5432, postgres/postgres)
//   PGHOST PGPORT PGUSER PGPASSWORD
// 실제 Supabase 프로젝트에는 절대 연결하지 마세요. 테스트가 DB를 만들고 지웁니다.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const env = { PGHOST: 'localhost', PGPORT: '5432', PGUSER: 'postgres', PGPASSWORD: 'postgres', PGOPTIONS: '-c client_min_messages=warning', ...process.env };
if (/supabase\.(co|com)/.test(env.PGHOST)) { console.error('PGHOST 가 Supabase 입니다. 로컬 Postgres 에서만 실행하세요.'); process.exit(2); }

const shim = path.join(here, 'supabase-shim.sql');
const schema = path.join(root, 'supabase/schema.sql');
const mig = (n) => path.join(root, 'supabase', n);
// pg_cron·pg_net 은 Supabase 에만 있는 확장 → "create extension" 줄을 뺀 사본을 적용 (흉내는 shim 에 있음)
const noExt = (n) => {
  const out = path.join(root, 'tests/.build/sql', n);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, fs.readFileSync(mig(n), 'utf8').replace(/^[ \t]*create extension[^;]*;/gim, '-- (테스트) $&'));
  return out;
};
const SUITES = [
  { name: 'security', files: [schema, 'security.test.sql'] },
  { name: 'sharing', files: [schema, 'sharing.test.sql'] },
  { name: 'history', files: [schema, 'history.test.sql'] },
  { name: 'restore', files: [schema, 'restore.test.sql'] },
  { name: 'memo200', files: [schema, 'memo200.test.sql'] },
  // 이미 쓰던 DB에 011 을 덧붙였을 때 (제약 이름이 설치마다 달라도 동작하는지)
  { name: 'memo200-upgrade', files: [path.join(here, 'fixtures/schema_pre011.sql'), mig('011_memo_200.sql'), 'memo200.test.sql'] },
  { name: 'report', files: [schema, noExt('009_report_schedule.sql'), 'report.test.sql'], vars: { migration: noExt('009_report_schedule.sql') } },
];

const only = process.argv.slice(2);
const psql = (args, input) => spawnSync('psql', ['-X', '-q', ...args], { env, encoding: 'utf8', input });
const admin = (sql) => {
  const r = psql(['-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  if (r.error) { console.error('psql 을 찾을 수 없어요. PostgreSQL 클라이언트를 설치하세요.'); process.exit(2); }
  if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
};

let failed = 0, passed = 0;
for (const s of SUITES) {
  if (only.length && !only.includes(s.name)) continue;
  const db = `ledger_test_${s.name.replace(/\W/g, '_')}`;
  admin(`drop database if exists ${db} with (force)`);
  admin(`create database ${db}`);
  const files = [shim, ...s.files.map((f) => (path.isAbsolute(f) ? f : path.join(here, f)))];
  const vars = Object.entries(s.vars || {}).flatMap(([k, v]) => ['-v', `${k}=${v}`]);
  const r = psql(['-d', db, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', ...vars, ...files.flatMap((f) => ['-f', f])]);
  const rows = (r.stdout || '').split('\n').filter((l) => /^\d+\|(PASS|FAIL)\|/.test(l));
  const bad = rows.filter((l) => l.split('|')[1] === 'FAIL');
  if (r.status !== 0 || !rows.length || bad.length) {
    failed++;
    console.log(`FAIL ${s.name}`);
    bad.forEach((l) => console.log('   ', l));
    if (r.status !== 0 || !rows.length) console.log((r.stderr || '').split('\n').slice(-15).join('\n'));
  } else {
    passed++;
    console.log(`ok   ${s.name} (${rows.length}/${rows.length})`);
  }
  if (!process.env.KEEP_DB) admin(`drop database if exists ${db} with (force)`);
}
console.log(`\nSQL 테스트: ${passed} 통과, ${failed} 실패`);
process.exit(failed ? 1 : 0);
