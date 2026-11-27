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
  lib/backup.js          전체 백업 파일 만들기·검사(parseBackup)·복원 계획(planRestore·planSettings)
  lib/*.js               기능별 순수 함수 (recurring, shopping, cards, analysis, subscriptions, activity, household, push, device …)
  components/*.jsx       화면 조각
public/sw.js             서비스워커: 화면 network-first, 빌드 파일 cache-first(설치 때 나뉜 화면 파일까지 import를 따라가 모두 저장), push / notificationclick
src/lib/lazyScreens.js   첫 화면에 필요 없는 화면 목록(React.lazy) + 한가할 때 미리 받기
src/components/ScreenBoundary.jsx  나뉜 화면 불러오는 중 표시 / 실패 시 "새 버전·새로고침" 안내
supabase/schema.sql      새 프로젝트용 전체 스키마 (002~017 내용 포함)
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
- 카테고리 이름 변경은 내역마다 보내지 않고 `renameCat` 작업 하나 → 013 이후 DB 함수 `rename_category`(변경 기록에 내역마다 남기지 않음), 013 전이면 `update ... where user_id·type·category` 한 번 + 013 안내. 아직 못 보낸 내역 저장도 새 이름으로 고쳐 둔다.
- 맞바꾸기·이어 바꾸기(식비↔교통, 교통→버스+식비→교통)는 순서대로 실행하면 합쳐지므로 `renameOps`(outbox.js)가 임시 이름(`~임시N-…`)을 거쳐 두 단계로 만든다.
- 새 이름이 지운 카테고리의 옛 내역(📦) 이름과 같으면 합쳐져 나눌 수 없으므로 `CategoryEditor`가 "합쳐서 저장" 확인을 받는다.
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
| 즐겨찾기 보기 | `lib/favorites.js` `groupFavorites`: "누가"(memberId) 기준 묶음, 이 기기 사람(meId) 먼저 → 사람 목록 순 → 공동(없음·지워진 사람). 묶음이 2개 이상일 때만 탭·묶음 이름. 펼치기·탭은 기기별 localStorage `ledger.favView`. 순서 바꾸기는 `moveInGroup`(같은 묶음 안에서만) |
| 구독 제안 → 규칙 | `ruleFromSuggestion`: `last`·`start` = 제안의 `lastYm`(마지막 결제 달). 지난달이면 이번 달 결제일에 기록됨 |
| 반복 다시 시작 | `resumeRule`(lib/recurring): 일시정지 → 다시 시작 때 `last`를 "이번 달 그날이 지났으면 이번 달, 아니면 지난달"로 올려서 멈춘 달을 채우지 않음 |
| 새 내역 → 매달 반복 | `TxForm`의 "🔁 매달 반복"(새 내역만) → `App.addTx`가 `ruleFromTx`(lib/recurring)로 규칙을 만들고 `last`=그 달, 입력한 내역의 ID는 `recurringTxId(규칙ID, 그 달)` → 같은 달 중복 없음. 지난달 날짜면 자동 등록 효과가 빠진 달을 채움. 할부(inst>1)·규칙 100개(`MAX_RECURRING`)면 꺼짐. 규칙엔 카드·태그 없음 |
| 리포트 펼쳐 보기 | `yearReport`의 묶음(categories·byMember·byTag·byCard)마다 `items`(큰 금액 순 지출 내역), 전체 지출 `expenses`(큰 순). `ReportPage`의 `ShareList` 줄을 누르면 `ItemList`(10개씩 더 보기), 내역 → `onOpenTx`(수정 화면) |
| 댓글 쓴 사람 이름 | `author_name`은 클라이언트가 보낸 값이라 믿지 않는다. 화면(`App.commentAuthor`)·앱 안 배너·푸시(push-notify가 `ledger_members.person_id`로 조회) 모두 공유 참여자는 계정에 연결된 사람 이름(없으면 이메일 앞부분/"참여자"), 가계부 주인만 보낸 이름 |
| 서비스 워커 정리 | `syncAssets`: 새 index.html을 받으면 필요한 빌드 파일을 모두 확보한 뒤에만 나머지 `/assets/` 캐시를 지움(sw.js가 안 바뀌어 재설치되지 않으므로 여기서 정리) |
| 보관 목록 안전장치 | `enqueueMany`는 `isValidOp`로 검사해 틀리면 `invalid_op` 오류(조용히 버리지 않음). 가계부 전환 시 `activeLedger` ref로 이전 가계부의 늦은 `updateServer`·`load` 결과를 무시, 반복 자동 등록은 `loadedFor === userId`일 때만 |
| 화면 테마 | `lib/theme.js`: 기기별 localStorage `ledger.theme`(system·light·dark, 서버에 안 보냄, 잘못된 값은 system). `main.jsx`가 첫 그리기 전에 `<html data-theme>` 적용 + 다른 탭 변경 따라감. CSS는 어두운 색 변수를 `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`와 `:root[data-theme="dark"]` 두 곳에 같은 값으로 둠(바꿀 때 둘 다). 강조색 위 글자는 `--on-accent`. 설정 메뉴 맨 위 `.theme-row` |
| 구독 자동 발견 | 3달 이상 연속, 한 달 1회, 금액 차 10% 이내, 날짜 차 6일 이내, 마지막이 이번 달·지난달. 등록하면 `last`=이번 달이라 다음 달부터 자동 기록. 무시 목록은 공유 설정(`dismissed_subs`) |

### 4.4 전체 백업·복원
- 백업 파일(JSON, `format: 'ledger-backup'`, `version: 1`)은 이 기기 화면 기준(보관 목록 반영) 내역·장보기·설정 전체. 계정 ID는 넣지 않고 가계부 ID만. 댓글·변경 기록은 제외. 형식을 바꾸면 `version`을 올리고 `parseBackup`이 예전 버전도 읽게 한다.
- 복원 파일은 신뢰하지 않는다: `parseBackup`이 줄마다 `isValidTx`/`isValidItem`/`SETTINGS[k].valid`로 검사하고 알려진 칸만 남긴다.
- 내역·장보기는 보관 목록을 거치지 않고 `restoreBackup`이 `restore_backup` RPC로 300건씩 보낸다(온라인 전용, 다시 눌러도 같은 결과). 설정은 보관 목록으로.
- "빠진 것만"(기본)은 없는 ID만 추가, 설정은 빠진 항목만 더함(예산은 0일 때만). "덮어쓰기"는 내용이 다른 줄·설정을 백업 값으로.
- 다른 가계부의 백업이면 `rb-` + 해시로 새 ID를 만든다(같은 파일을 두 번 넣어도 같은 ID → 중복 없음). 장보기의 `txId`도 같이 바꾼다.
- 내역 20건 이상인데 이 기기에서 30일 넘게 백업을 안 받았으면 메뉴에 "백업 권장"(`backupDue`, localStorage `ledger.lastBackup.<가계부ID>`).

### 4.5 첫 화면 속도
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
| 017_versions | 동시에 고칠 때 덮어쓰기 방지. `transactions`·`shopping_items.version`(트리거 `bump_version`: 내용이 바뀔 때만 +1, 앱이 못 바꿈, `rename_category` 안의 카테고리만 변경은 그대로), `settings.ver` 칸별 버전(트리거 `bump_settings_ver`), `save_setting(col, value, base)`(security invoker, 다르면 `LV409 version_conflict`). `log_activity`는 `version` 제외. 앱: 작업에 `base`(본 버전, `withBase`) → 내역·물품은 `insert`(base null)/`update…eq(version)`/`delete…eq(version)`, 설정은 `save_setting`. 0줄·23505·LV409면 서버 줄을 다시 읽어 내용이 같으면 성공(응답 유실), 다르면 충돌 → 작업을 빼고 다시 불러온 뒤 `onConflict`(App 알림 "내 것으로 저장"·"다시 살리기"·"그래도 지우기" → `retryConflict`). 자동 작업(반복 내역 기록)은 `soft`로 조용히 뺌. 설정 칸 충돌은 `op.prev`(바꾸기 전 본 값)로 3방향 자동 합치기(`lib/merge.js`: id 목록은 항목·칸별, 문자열 목록은 집합, 객체는 키별) 후 성공하면 합친 값을 다시 `save_setting`. 버전 표는 서버 상태 `_ver`(캐시에도 보관). 017 전이면 예전처럼 upsert | 016 |
| 016_delete_account | `delete_account()` 회원 탈퇴(security definer, `auth.users`에서 본인 삭제 → cascade). 내 가계부에 다른 참여자가 있으면 `ledger_has_members`로 거절. `tx_comments.author`는 cascade, `activity_log.actor`는 set null | 008 |
| 015_recurring_100 | 반복 내역 최대 100개(가계부 하나당). 반복 내역 검사 제약을 정의로 찾아 교체. 015 전 DB에 51개 이상을 보내면 앱이 `recurring` 작업을 보관하고 015 안내(`recurBlockedRef`). 011도 100으로 맞춰 다시 실행해도 안전 | 011 |
| 014_restore_backup | `restore_backup(p_tx, p_items, p_overwrite)` 백업 복원(security invoker, 1000건 한도, 앱은 300건씩). 가계부 ID는 항상 `current_ledger()`. 새로 넣는 줄은 `ledger.skip_log='restore'`로 기록 생략, 덮어쓰기(UPDATE)는 기록. 넣는 줄의 `device_id`는 비어 있어 푸시 함수가 알리지 않음 | 013 |
| 013_rename_category | `rename_category(type, from, to)` 이름 일괄 변경(security invoker, 바뀐 건수 반환). 그 안에서만 `ledger.skip_log`를 켜서 `log_activity`가 카테고리만 바뀐 줄을 기록하지 않음 | 010 |
| 012_push_endpoint_hosts | 푸시 주소를 실제 푸시 서비스(FCM·모질라·WNS·애플)로만 제한 `is_push_endpoint`. 앱(`push.js`)·Edge Function도 같은 규칙(`isPushEndpoint`, `_shared/notifyMessage.js`). 앱은 012 없이도 동작 | 007 |

규칙: 새 파일은 **여러 번 실행해도 안전하게**(`if not exists`, `drop … if exists` 후 생성), 끝에 `notify pgrst, 'reload schema';`, 같은 내용을 `schema.sql` 끝에도 붙인다.

## 7. 테스트

자세한 내용: `tests/README.md`. 패키지 업데이트는 Dependabot(`.github/dependabot.yml`)이 매주 minor·patch 를 PR 하나로 올린다. 메이저는 자동 PR을 막아 두었으니, 올릴 때는 함께 쓰는 패키지(예: vite ↔ @vitejs/plugin-react)를 같이 올리고 전체 테스트를 돌린다. 실제 Supabase·비밀 키는 쓰지 않는다. GitHub Actions(`.github/workflows/test.yml`)가 push·PR마다 실행한다.

- `tests/unit`: 순수 함수.
- `tests/edge`: Edge Function을 esbuild로 묶어 Node에서 가짜 web-push·DB로 실행.
- `tests/e2e`: `src/`를 esbuild로 묶되 `@supabase/supabase-js`만 `fake-supabase.js`로 바꾼 앱을 Playwright(크로미움)로 조작. 화면 구성, 메모·링크·자정, 오프라인·재전송·중복 방지, 카테고리 이름 변경, 011 전 DB 보관, 공유 참여, 댓글, 변경 기록·되살리기, 서비스 워커 오프라인.
- `tests/sql`: 테스트마다 빈 DB에 `supabase-shim.sql`(역할, `auth.uid()`, Vault·pg_cron·pg_net 흉내) → `schema.sql` → 테스트. 보안·공유·기록·되살리기·메모 200·011 업그레이드·푸시 주소 제한(012)·이름 일괄 변경(013)·백업 복원(014)·반복 100개(015)·회원 탈퇴(016)·버전 확인(017)·리포트 예약.
- 바꿀 때 같이 고칠 것: 새 DB 칸·테이블 → `fake-supabase.js`의 `MISSING`/`tableMissing`와 SQL 테스트. 화면 문구·클래스 이름 → e2e 선택자. 새 마이그레이션 → `run.mjs`의 `SUITES`.
- **아직 실제 Supabase 클라우드 위에서의 통합 점검은 자동화하지 않았다.** 크게 바꾼 뒤에는 통합 점검 체크리스트(계정 두 개로 공유·댓글·푸시·오프라인 입력)를 직접 확인하길 권한다.

## 서버에서 여러 줄 읽기 (필수)

Supabase(PostgREST)는 한 번에 최대 1,000줄만 돌려주고 오류를 내지 않는다. 개수가 정해지지 않은 목록(내역·장보기·댓글 등)은 반드시 `lib/fetchAll.js`의 `fetchAll(() => supabase.from(...).select(...).eq(...))`로 읽는다(ID 순 1,000줄씩). 변경 기록처럼 화면에서 쪽 단위로 보는 것은 `limit` + 커서로.

## 카테고리 이름을 저장하는 곳 (이름 변경 시 함께 바꿔야 함)

내역(`renameCat` → 서버 일괄), 반복 내역, 카테고리별 예산, 즐겨찾기, 장보기 물품, 아직 못 보낸 내역(새 이름으로 고쳐 이름 변경 작업 **뒤로** 옮김 — 앞에 두면 맞바꾸기 때 다시 바뀜). 카테고리 이름을 저장하는 새 기능을 만들면 `useLedger.saveCategories`에 추가한다.

## 개인정보 처리방침 (필수)

새로 수집·저장하는 개인정보(새 칸·새 테이블·기기에 저장하는 값)나 새 외부 서비스(API·글꼴·분석 도구 등)를 추가하면 `src/components/PrivacyPolicy.jsx`의 해당 표를 고치고 `src/lib/privacy.js`의 `PRIVACY_EFFECTIVE`(시행일)를 바꾼다. 운영자 연락처·이름·데이터 지역은 환경 변수(`VITE_PRIVACY_CONTACT`, `VITE_OPERATOR_NAME`, `VITE_DATA_REGION`)로만 넣고 코드에 적지 않는다. 회원가입에 필수 동의 체크박스는 두지 않는다(계약 이행에 필요한 정보만 처리).

## 변경 내역 기록 (필수)

코드·DB·설정을 바꾸면 **README.md 맨 아래 "## 변경 내역"의 맨 위에** 그날 날짜(`### YYYY-MM-DD`, 한국 시간) 항목을 추가하거나, 같은 날짜가 있으면 그 아래에 이어 쓴다.
- 한 줄에 하나씩, 사용자가 알아듣는 말로: `**추가**` / `**변경**` / `**수정**`(버그) / `**보안**` / `**개선**` / `**문서**` 중 하나로 시작.
- 사용자가 따로 해야 할 일이 있으면 마지막 줄에 `**할 일**`: 실행할 SQL 파일 번호, 함수 재배포, 환경 변수·웹훅 설정 등. 없으면 생략(push만 하면 됨).
- 내부 리팩터링·테스트만 바뀐 것은 적지 않아도 되지만, 동작이 바뀌면 적는다.

## 8. 하지 말 것

- 서버 응답을 기다린 뒤에야 화면을 바꾸는 저장 방식으로 바꾸지 않기 (오프라인 우선 깨짐)
- 서버가 ID를 만들게 바꾸지 않기 (재전송 시 중복 생김)
- 기존 업데이트 SQL 파일의 의미를 바꾸지 않기. 바꿀 일이 있으면 새 번호 파일을 추가
- RLS를 `user_id = auth.uid()`로 되돌리지 않기 (공유 가계부가 깨짐)
- 비밀 값(service_role, VAPID 비밀키, 웹훅 비밀 값)을 코드나 `VITE_` 변수에 넣지 않기

## 9. 다음 후보 (사용자와 논의된 것)

정산하기, 예산 초과 알림, 카드 결제일 알림, 장보기 리마인더, 연말정산 도우미, CSV 가져오기, 저축 목표, 앱 잠금(PIN), 실제 Supabase 통합 점검.

## 2026-11-24 추가
- `hooks/useAppUpdate.js`: 서버 `/`(index.html)를 `x-update-check` 헤더로 받아 메인 빌드 파일(`/assets/...`) 이름을 지금 문서와 비교 → 다르면 `.update-bar`. 화면 복귀(5분 간격 제한)·30분마다·시작 1분 뒤. 개발 서버(빌드 파일 없음)에선 꺼짐
- 장보기 결제: `PurchaseConfirm` 결제 카드 칩 → `planPurchase(opts.cardId)` → 내역 `cardId`, `inst: 1`. 마지막 카드 `localStorage['ledger.shopCard']`
- 반복 규칙 선택 칸 `cardId`(지출만, 일시불)·`tags` (`isValidRecurring`). `planRecurring`이 내역에 넣음, `ruleFromTx`·`ruleFromSuggestion`이 이어감. DB 변경 없음(설정 jsonb)
- 시트 입력 보호: `<Sheet guard>`(입력 양식 시트). 입력이 생긴 `form`을 기억 → 바깥·Esc·✕·뒤로 가기(`sheetGuard.blocked`, App popstate)면 `.leave-ask` 확인. submit하면 그 양식은 빠지고, 취소로 양식이 사라지면(isConnected) 입력 중 아님
- 목록 설정 삭제 되돌리기: `onSave(list, msg, { item, index })` → App `withUndo(kind)`가 알림에 되돌리기(최신 목록의 원래 자리에 다시 넣음). 반복 내역·즐겨찾기
- 예산 카드 `planned`: `upcomingThisMonth(rules, today)`(이번 달 남은 날의 활성 반복 지출) 합계를 미리 뺌. 카테고리별 예산은 카테고리별 합계
- '공동' 묶음 즐겨찾기(사람 없음·지운 사람)는 공동(null)으로 기록. 장보기 빠른 추가는 같은 이름(normalizeName)의 살 것이 있으면 수량 +1
- 실시간: Supabase 삭제(DELETE) 이벤트는 기본 키만 실려 `user_id=eq` 필터 구독에 오지 않음 → transactions·shopping_items·tx_comments는 DELETE만 필터 없이 따로 구독하고, 내 가계부에 있는 id일 때만 반영 (가짜 서버 `__rt`도 같은 규칙)
- `.github/workflows/keepalive.yml`: Supabase 무료 일시정지 방지. 3일마다 anon 키로 `/rest/v1/transactions?select=id&limit=1` 조회(RLS로 빈 결과, 200이면 성공). Secrets `SUPABASE_URL`·`SUPABASE_ANON_KEY`. service_role 키 금지
