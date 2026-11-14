# AGENTS.md — 가계부 프로젝트 공용 지침

AI 코딩 도우미(Claude, Gemini 등)와 사람이 함께 보는 프로젝트 설명서입니다.
**결정이 바뀌면 이 파일도 같이 고치세요.** 다음에 작업하는 도우미가 예전 정보로 일하지 않게 하기 위해서예요.
`CLAUDE.md`, `GEMINI.md`는 이 파일을 불러오기만 합니다. 공통 내용은 여기에만 쓰세요.

## 1. 한눈에 보기

- 개인·가족용 가계부 반응형 웹앱(PWA). 한국어 UI, 한국 시간(Asia/Seoul) 기준.
- 스택: React 19 + Vite 7 (자바스크립트, 타입스크립트 아님), `@supabase/supabase-js` 2.x
- 배포: 앱 = Vercel (`vercel.json`에 보안 헤더·CSP), DB·로그인·실시간·함수 = Supabase 무료 플랜
- 자체 서버 운영 가이드(Supabase 셀프호스팅 + Caddy + Tailscale)는 별도 문서로 정리돼 있음. 앱 코드는 두 환경에서 같고, 빌드할 때 넣는 주소와 키만 다름
- 사용자와는 **한국어로**, 쉬운 말로 대화. 바뀐 결과물은 프로젝트 전체 zip으로 전달해 왔음

## 2. 명령어

```bash
npm install          # 의존성
npm run dev          # 개발 서버 (서비스워커 꺼짐)
npm run build        # 배포용 빌드 → dist/
npm test             # 단위 테스트 (tests/unit, node만으로 실행)
npm run test:edge    # push-notify Edge Function (가짜 web-push·DB)
npm run test:e2e     # 브라우저 테스트 (가짜 Supabase + Playwright 크로미움, 처음 한 번 npm run test:e2e:setup)
npm run test:sql     # SQL·RLS 테스트 (로컬 Postgres 16 + psql 필요)
npm run test:all     # 위 전부
node scripts/gen-vapid.mjs   # 웹 푸시 VAPID 키 한 쌍 + 웹훅 비밀 값 예시 출력
```

환경 변수(`.env.local`, Vercel): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`(선택).
`VITE_`로 시작하는 값은 빌드 결과에 그대로 들어가므로 **공개돼도 되는 값만** 넣는다. service_role 키, VAPID 비밀키, 웹훅 비밀 값은 절대 넣지 않는다.

## 3. 폴더 구조

```
src/
  App.jsx                화면 조립, 시트(하단 패널) 열고 닫기, 각 기능 연결
  hooks/useLedger.js     데이터 핵심: 불러오기, 오프라인 보낼 목록(outbox), 전송, 실시간, DB 단계 감지
  hooks/useHousehold.js  지금 보는 가계부 ID (공유 가계부 참여 중이면 그 가계부)
  hooks/useComments.js   내역 댓글 (온라인 전용, 실시간)
  hooks/useNotifier.js   앱 안 알림 배너 / 화면 숨김 시 시스템 알림
  lib/outbox.js          값 검사(isValid*), 설정 종류 SETTINGS, 보낼 목록 합치기, 캐시
  lib/*.js               기능별 순수 함수 (recurring, shopping, cards, analysis, subscriptions, activity, household, push, device …)
  components/*.jsx       화면 조각
public/sw.js             서비스워커: 화면 network-first, 빌드 파일 cache-first(설치 때 나뉜 화면 파일까지 import를 따라가 모두 저장), push / notificationclick
src/lib/lazyScreens.js   첫 화면에 필요 없는 화면 목록(React.lazy) + 한가할 때 미리 받기
src/components/ScreenBoundary.jsx  나뉜 화면 불러오는 중 표시 / 실패 시 "새 버전·새로고침" 안내
supabase/schema.sql      새 프로젝트용 전체 스키마 (002~011 내용 포함)
supabase/00N_*.sql       기존 DB용 업데이트 (번호 순서대로, 여러 번 실행해도 안전하게 작성)
supabase/functions/push-notify/index.ts   웹 푸시 발송 Edge Function (Deno)
supabase/functions/_shared/notifyMessage.js  알림·리포트 문구 — 앱과 함수가 같은 파일을 import
```

## 4. 꼭 지켜야 할 설계 원칙

### 4.1 오프라인 우선 + 중복 없음
- 모든 저장은 먼저 기기의 "보낼 목록"(localStorage `ledger.outbox.<가계부ID>`)에 들어가고 화면에 바로 보인 뒤, 온라인이면 즉시·아니면 연결되는 순간 순서대로 전송한다.
- **ID는 클라이언트가 만든다** → 같은 작업을 여러 번 보내도 upsert라 서버에 한 줄만 남는다.
- 고정 ID 규칙: 반복 내역 `rec-<규칙ID>-<YYYY-MM>`, 장보기 결제 `shop-<구매ID>` 또는 `shop-<물품ID>`. 이 접두어는 알림·변경 기록·구독 발견에서 구분하는 데도 쓰인다.
- 같은 대상에 대한 작업은 목록에서 합쳐진다(`coalesce`). 단 카테고리 이름 변경(`renameCat`)은 순서대로 모두 실행돼야 해서 합치지 않는다.
- 카테고리 이름 변경은 내역마다 보내지 않고 `renameCat` 작업 하나 → 서버 `update ... where user_id·type·category` 한 번. 아직 못 보낸 내역 저장도 새 이름으로 고쳐 둔다.
- 실시간 변경이 한꺼번에 와도 다시 불러오기는 400ms 모아서 한 번만 한다. 탭이 여러 개면 `navigator.locks`로 한 탭만 전송한다.
- 일시적 오류(네트워크, 타임아웃 10초, 권한 오류 42501)는 3/10/30/60초 간격으로 재시도하고, 영구 오류만 목록에서 빼고 알린다.
- 기기 저장소에서 읽는 값은 손상·조작될 수 있으므로 항상 `isValid*`로 검사한다.

### 4.2 DB 업데이트 전에도 앱이 동작해야 함
- 사용자가 SQL을 늦게 실행해도 앱이 깨지지 않게 한다. `useLedger`가 칸 묶음(TX_COL_SETS, SETTINGS_COL_SETS)을 최신부터 시도하고, 없는 칸 오류(`isSchemaError`)면 한 단계 아래로 내려간다.
- 업데이트 전에 저장한 새 기능 데이터는 보낼 목록에 남아 있다가 업데이트 후 자동으로 올라간다.
- 상단 안내는 **가장 앞 번호의 빠진 업데이트**를 알려 준다(`schemaNeed`). 새 업데이트 파일을 추가하면 이 감지 로직과 테스트 스텁도 같이 고친다.

### 4.3 보안
- 데이터 보호는 RLS가 담당한다. 008부터 모든 데이터 테이블의 규칙은 `user_id = (select public.current_ledger())`.
- `user_id` 칸의 의미 = **"어느 가계부인지"**(가계부 = 만든 사람의 계정 ID). 로그인 계정 ID와 다를 수 있다.
- 참여자·초대 테이블(`ledger_members`, `ledger_invites`)은 직접 읽기·쓰기 금지. 검사 로직이 들어 있는 `security definer` 함수로만 바꾼다. 새 함수는 `anon` 실행 권한을 빼고 `authenticated`에만 준다.
- CSV 내보내기는 수식 주입 방지(`csvCell`)를 거친다.

## 5. 기능별 결정 사항

| 기능 | 결정 |
|---|---|
| 화면 구성 | 탭 4개: 가계부(요약·차트·즐겨찾기, **내역 목록 없음**) / 내역(`#list`, 목록·달력, 검색) / 장보기(`#shopping`) / 리포트(`#report`). 새 내역·댓글 알림을 누르면 내역 탭으로 |
| 메모 길이 | 내역·장보기·반복·즐겨찾기 메모 **최대 200자**(`MAX_MEMO`, 링크 저장용). DB는 011부터. 011 전 DB에 100자 넘는 메모를 보내면 버리지 않고 보관 + 011 안내(`isMemoLimitError`) |
| 함께 쓰는 사람(members) | 계정 하나를 여러 명이 쓸 때의 "누가" 목록. 공유 가계부에서도 그대로 씀. 기기마다 "나는 누구"를 저장(`getMe`), 참여할 때 고른 사람은 서버에도 저장 |
| 가계부 공유 (008) | 각자 계정으로 같은 가계부. **공유 가계부 하나만** 보임(참여 중엔 내 원래 데이터 숨김, 나가면 다시 보임). **참여자 모두 같은 권한**(초대·내보내기 가능), 만든 사람만 내보낼 수 없음. 초대 코드 10자리, 48시간, 1회용. 한 가계부 최대 10명. 보낼 목록이 남아 있으면 참여·나가기 불가 |
| 반복 내역 | 그 달에 처음 연 기기가 생성. 등록 후 규칙의 `last`를 올려 지워도 다시 안 생김. 앱을 켜 둔 채 자정이 지나면 자정+5초에 날짜를 갱신(최대 1시간 단위로 다시 맞춤 + 앱으로 돌아올 때 확인) |
| 메모 링크 | 메모 속 http/https 주소만 버튼으로(`lib/links.js`, 최대 5개), 새 탭 + `noopener noreferrer`. 목록에는 🔗 표시만 (행을 누르면 수정 화면) |
| 장보기 | 결제 확정 시 고정 ID 내역 생성 → 두 번 눌러도 한 번만 기록 |
| 신용카드 | 마감일까지 사용분은 다음 달, 이후는 다다음 달 청구. 할부 나머지는 첫 달에 |
| 즐겨찾기 (008) | 금액 있으면 한 번 누르면 오늘 날짜로 즉시 저장 + 되돌리기, 금액 0이면 입력창을 채워 열기. 최대 20개, 공유 가계부 공용 |
| 알림 방법 1 | 앱 안 알림: 실시간 INSERT 중 다른 기기에서 온 것만 배너. 내 기기 판별 = `device_id` 칸(007) + 최근 저장 ID 기록(007 전 대비) |
| 알림 방법 2 | 웹 푸시: DB 웹훅(transactions, shopping_items, tx_comments의 INSERT) → `push-notify` → 같은 가계부의 다른 기기. 함수는 `--no-verify-jwt`로 배포하고 `x-webhook-secret` 헤더로 확인. 404/410 구독은 삭제. 앱이 보이는 상태면 서비스워커가 시스템 알림을 생략 |
| 알림 설정 | 기기마다 저장 + 푸시 구독의 `prefs`. 종류별 끄기, 방해 금지 시간(푸시·시스템 알림만, 배너는 보임) |
| 주간·월간 리포트 (009) | pg_cron이 UTC 0시(= 한국 9시)에 함수 호출. 주간 = 지난주 월~일, 월간 = 지난달. 그 기간 내역 없으면 안 보냄 |
| 변경 기록 (010) | DB 트리거가 기록(앱에서 수정·삭제 불가), 90일 보관. 같은 내용 재저장은 기록 안 함. 되살리기 = 같은 ID로 upsert. 장바구니 담기·빼기는 화면에서 숨김 |
| 내역 댓글 (010) | 온라인 전용, 보낼 목록을 거치지 않음. 내 댓글만 삭제, 수정 없음. 내역을 지워도 댓글은 남아서 되살리면 다시 붙음. 푸시는 쓴 사람 계정의 모든 기기 제외 |
| 구독 자동 발견 | 3달 이상 연속, 한 달 1회, 금액 차 10% 이내, 날짜 차 6일 이내, 마지막이 이번 달·지난달. 등록하면 `last`=이번 달이라 다음 달부터 자동 기록. 무시 목록은 공유 설정(`dismissed_subs`) |

### 4.4 첫 화면 속도
- 가계부 요약 화면에 쓰이는 것만 처음에 받고, 나머지 화면(내역 목록, 장보기, 리포트, 설정 시트들, 로그인 화면)은 `lib/lazyScreens.js`의 `Lazy`로 필요할 때 불러온다. 새 화면을 추가하면 이 목록에 넣고, **App 등 첫 화면 모듈에서 직접 import하지 않는다**(직접 import하면 분할이 깨짐). 시트 안은 `Sheet`가, 페이지는 `ScreenBoundary key={page}`가 감싼다.
- 첫 화면 모듈이 상수만 필요하면 상수를 lib으로 옮긴다 (예: `lib/searchFilters.js`).
- 웹폰트는 `main.jsx`에서 첫 그리기 뒤에 불러온다(그 전엔 시스템 글꼴). `vite.config.js`에서 react·supabase를 별도 파일로 묶어 앱만 바뀌면 그 파일은 다시 받지 않게 한다.
- 서비스워커 캐시 구조를 바꾸면 `sw.js`의 `VERSION`을 올린다 (현재 v2).

## 6. DB 업데이트 파일

| 파일 | 내용 | 필요 조건 |
|---|---|---|
| 002_hardening | 값 범위 제한 | schema.sql |
| 003_members | `member_id`, `settings.members` | 002 |
| 004_features | 반복 내역, 카테고리, 카테고리 예산 | 003 |
| 005_shopping | `shopping_items` + RLS + 실시간 | 004 |
| 006_tags_cards | 태그, 카드, 할부, `settings.cards` | 005 |
| 007_notifications | `device_id`, `push_subscriptions` | 006 |
| 008_sharing_favorites | 공유(참여자·초대·RLS 변경·함수), `favorites`, 푸시 구독 `account_id` | 007 |
| 009_report_schedule | 리포트 예약 (선택, 프로젝트ID·비밀 값을 채워서 실행) | 008, 함수 배포 |
| 010_history_comments | `activity_log` 트리거, `tx_comments`, `dismissed_subs` | 008 |
| 011_memo_200 | 메모 200자, 반복·즐겨찾기 설정 크기 한도 상향 (예전 설치마다 다른 제약 이름을 정의로 찾아 교체) | 008 |

규칙: 새 파일은 **여러 번 실행해도 안전하게**(`if not exists`, `drop … if exists` 후 생성), 끝에 `notify pgrst, 'reload schema';`, 같은 내용을 `schema.sql` 끝에도 붙인다.

## 7. 테스트

자세한 내용: `tests/README.md`. 실제 Supabase·비밀 키는 쓰지 않는다. GitHub Actions(`.github/workflows/test.yml`)가 push·PR마다 실행한다.

- `tests/unit`: 순수 함수.
- `tests/edge`: Edge Function을 esbuild로 묶어 Node에서 가짜 web-push·DB로 실행.
- `tests/e2e`: `src/`를 esbuild로 묶되 `@supabase/supabase-js`만 `fake-supabase.js`로 바꾼 앱을 Playwright(크로미움)로 조작. 화면 구성, 메모·링크·자정, 오프라인·재전송·중복 방지, 카테고리 이름 변경, 011 전 DB 보관, 공유 참여, 댓글, 변경 기록·되살리기, 서비스 워커 오프라인.
- `tests/sql`: 테스트마다 빈 DB에 `supabase-shim.sql`(역할, `auth.uid()`, Vault·pg_cron·pg_net 흉내) → `schema.sql` → 테스트. 보안·공유·기록·되살리기·메모 200·011 업그레이드·리포트 예약.
- 바꿀 때 같이 고칠 것: 새 DB 칸·테이블 → `fake-supabase.js`의 `MISSING`/`tableMissing`와 SQL 테스트. 화면 문구·클래스 이름 → e2e 선택자. 새 마이그레이션 → `run.mjs`의 `SUITES`.
- **아직 실제 Supabase 클라우드 위에서의 통합 점검은 자동화하지 않았다.** 크게 바꾼 뒤에는 통합 점검 체크리스트(계정 두 개로 공유·댓글·푸시·오프라인 입력)를 직접 확인하길 권한다.

## 8. 하지 말 것

- 서버 응답을 기다린 뒤에야 화면을 바꾸는 저장 방식으로 바꾸지 않기 (오프라인 우선 깨짐)
- 서버가 ID를 만들게 바꾸지 않기 (재전송 시 중복 생김)
- 기존 업데이트 SQL 파일의 의미를 바꾸지 않기. 바꿀 일이 있으면 새 번호 파일을 추가
- RLS를 `user_id = auth.uid()`로 되돌리지 않기 (공유 가계부가 깨짐)
- 비밀 값(service_role, VAPID 비밀키, 웹훅 비밀 값)을 코드나 `VITE_` 변수에 넣지 않기

## 9. 다음 후보 (사용자와 논의된 것)

정산하기, 예산 초과 알림, 카드 결제일 알림, 장보기 리마인더, 연말정산 도우미, CSV 가져오기, 전체 백업·복원, 저축 목표, 앱 잠금(PIN), 다크 모드 직접 선택, 실제 Supabase 통합 점검, 코드 분할로 속도 개선.
