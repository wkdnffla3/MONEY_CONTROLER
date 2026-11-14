# 테스트

실제 Supabase·비밀 키 없이 돌아가요. 브라우저 테스트는 **가짜 Supabase**, SQL 테스트는 **로컬 Postgres**를 씁니다.

| 명령 | 내용 | 필요한 것 |
| --- | --- | --- |
| `npm test` | 순수 함수 단위 테스트 (`tests/unit`) | Node 22 |
| `npm run test:edge` | push-notify Edge Function (가짜 web-push·DB) | Node 22 |
| `npm run test:e2e` | 앱을 빌드해 크로미움에서 실제로 눌러 보는 브라우저 테스트 (`tests/e2e`) | 처음 한 번 `npm run test:e2e:setup` |
| `npm run test:sql` | schema.sql·마이그레이션의 RLS·공유·기록·리포트 예약 (`tests/sql`) | Postgres 16 + `psql` |
| `npm run test:all` | 위 네 개 전부 | 위 전부 |

GitHub에 올리면 `.github/workflows/test.yml` 이 push·PR마다 세 작업(단위·Edge / 브라우저 / SQL)을 자동으로 돌려요. Actions 탭에서 결과를 볼 수 있어요.

## 처음 한 번

```bash
npm install
npm run test:e2e:setup      # 테스트용 크로미움 설치 (약 150MB, 앱 배포에는 포함 안 됨)
```

SQL 테스트용 Postgres는 Docker로 띄우는 게 가장 간단해요.

```bash
docker run -d --name ledger-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
npm run test:sql
```

접속 정보는 `PGHOST PGPORT PGUSER PGPASSWORD` 환경 변수로 바꿀 수 있어요 (기본 `localhost:5432`, `postgres/postgres`).
테스트가 DB를 만들고 지우므로 **실제 Supabase 주소는 넣지 마세요** (러너가 막아 둠).

## 폴더

```
tests/
  unit/      *.test.mjs            순수 함수 (outbox·반복·카드·분석·알림 문구·링크)
  edge/      push-notify.test.mjs  Edge Function + 가짜 web-push·Supabase
  e2e/       build.mjs             src/ 를 그대로 묶고 supabase-js 만 fake-supabase.js 로 교체
             fake-supabase.js      sessionStorage 에 DB 흉내 (RLS·공유·기록·스키마 단계·네트워크 장애)
             helpers.mjs           정적 서버·크로미움·시드 데이터
             *.e2e.test.mjs        화면 구성 / 메모·링크·자정 / 동기화 / 공유·댓글·기록 / 오프라인 앱
  sql/       run.mjs               테스트마다 빈 DB → supabase-shim.sql → schema.sql → 테스트
             supabase-shim.sql     역할(anon·authenticated·service_role)·auth.uid()·Vault·pg_cron·pg_net 흉내
             *.test.sql            보안 / 공유 / 기록 / 되살리기 / 메모 200 / 리포트 예약
             fixtures/             011 전 스키마 (예전 DB에 011 을 덧붙이는 경우)
  .build/    (자동 생성, git 에 안 올림)
```

## 테스트 고치기·추가하기

- **브라우저**: `*.e2e.test.mjs` 를 하나 복사해서 시작하세요. `open(env, { seed, path })` 로 새 창을 열고, `db(page)` 로 가짜 서버 내용, `pending(page)` 로 아직 못 보낸 목록을 확인해요.
  - 실시간 이벤트 흉내: `page.evaluate(() => window.__rt('transactions', { eventType: 'INSERT', new: {...} }))`
  - 다른 계정: `sessionStorage.setItem('__uid', 'u2')` 후 새로고침
  - 예전 DB 단계: `sessionStorage.setItem('__legacy', '6')` (값의 뜻은 fake-supabase.js 위쪽 주석)
  - 네트워크 장애: `window.__net = 'lost' | 'hang' | 'rls'`
- **SQL**: `pg_temp.chk('이름', 조건)` 으로 결과를 쌓고 마지막에 표로 출력하는 방식이에요. 새 파일은 `run.mjs` 의 `SUITES` 에 추가하세요.
- **DB에 새 칸·테이블을 추가하면** 앱 코드와 함께 `fake-supabase.js`(MISSING·tableMissing)와 SQL 테스트도 같이 고쳐야 해요.
- 화면 문구나 CSS 클래스 이름을 바꾸면 브라우저 테스트의 선택자도 같이 바꿔야 해요.
