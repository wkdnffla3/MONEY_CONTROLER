# 가계부 (React + Vite + Supabase)

개인별 로그인 가계부. 화면은 React 컴포넌트, 데이터는 Supabase(Postgres)에 저장하고 Vercel에 배포합니다.

## 폴더 구조

```
ledger-react/
├─ index.html              # 빈 껍데기 (React가 #root 에 그림)
├─ vercel.json             # 보안 헤더(CSP, HSTS 등)
├─ .env.example            # 환경변수 예시 → .env.local 로 복사
├─ supabase/schema.sql     # DB 테이블 + RLS 보안 규칙
└─ src/
   ├─ main.jsx             # 시작점
   ├─ App.jsx              # 화면 조립, 상태(선택한 달·필터·열린 시트)
   ├─ styles.css
   ├─ lib/
   │  ├─ supabase.js       # Supabase 클라이언트, 자동 로그인 저장소, URL 정리
   │  ├─ format.js         # 금액·날짜 포맷, 합계 계산
   │  ├─ categories.js     # 카테고리·아이콘·색
   │  └─ errors.js         # 오류 메시지 한국어 변환
   ├─ hooks/
   │  ├─ useAuth.js        # 로그인 상태, 비밀번호 재설정 흐름
   │  ├─ useLedger.js      # 내역·예산 불러오기/저장, 실시간 동기화
   │  └─ useToast.js       # 하단 알림
   └─ components/
      ├─ AuthScreen.jsx    # 로그인·회원가입·비밀번호 찾기·새 비밀번호
      ├─ Header.jsx  MonthBar.jsx  Summary.jsx
      ├─ BudgetCard.jsx  CategoryDonut.jsx  DailyChart.jsx
      ├─ TxList.jsx  TxForm.jsx  BudgetForm.jsx
      └─ Sheet.jsx  Toast.jsx  Icons.jsx
```

## 처음 한 번: Supabase

1. supabase.com 에서 프로젝트 생성
2. **SQL Editor** 에 `supabase/schema.sql` 붙여넣고 Run
3. **Project Settings → API** 에서 Project URL, anon public 키 복사

## 내 컴퓨터에서 실행

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                  # http://localhost:5173
```

## Vercel 배포

1. 이 폴더를 GitHub 저장소에 push (`.env.local` 은 `.gitignore` 로 제외됨)
2. vercel.com → Add New → Project → 저장소 선택 (Framework: Vite 자동 인식)
3. **Environment Variables** 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 추가 → Deploy
4. Supabase **Authentication → URL Configuration** 의 Site URL / Redirect URLs 에 Vercel 주소 등록

이후 push 할 때마다 자동 배포됩니다. 환경변수를 바꾸면 다시 배포해야 반영돼요.

## PWA (앱처럼 설치)

| 파일 | 역할 |
| --- | --- |
| `public/manifest.webmanifest` | 앱 이름, 아이콘, 색, 전체 화면(standalone) 설정, "지출 추가" 바로가기 |
| `public/icons/` | 앱 아이콘 (192·512, 마스커블 512, iPhone용 180, 파비콘) |
| `public/sw.js` | 서비스워커: 화면과 빌드 파일을 저장해 오프라인에서도 앱이 열림 |
| `src/lib/pwa.js` | 서비스워커 등록 (배포된 사이트에서만, `npm run dev` 에서는 꺼짐) |
| `src/components/InstallBanner.jsx` | 설치 안내 배너 (Android·PC는 설치 버튼, iPhone은 "공유 → 홈 화면에 추가" 안내) |

- 오프라인 입력은 아래 "오프라인 저장과 자동 업로드" 참고.
- 새로 배포하면 다음에 앱을 열 때 자동으로 새 버전이 적용돼요. 캐시 구조를 바꿀 때만 `sw.js` 의 `VERSION` 을 올리세요.
- 확인: 배포된 주소를 Chrome에서 열고 F12 → **Application** 탭 → Manifest / Service workers.
- 아이콘을 바꾸려면 `public/icons/` 의 PNG를 같은 이름·크기로 교체하세요.

## 오프라인 저장과 자동 업로드

모든 저장(추가·수정·삭제·예산)은 먼저 이 기기의 "보낼 목록"(`localStorage`)에 들어가고 화면에 바로 보입니다. 온라인이면 즉시, 오프라인이면 다시 연결되는 순간 순서대로 서버에 올라가요. 실패하면 3초 → 10초 → 30초 → 60초 간격으로 다시 시도합니다.

| 파일 | 역할 |
| --- | --- |
| `src/lib/outbox.js` | 보낼 목록 저장·정리, 오류 종류 판별(다시 시도할지 버릴지) |
| `src/hooks/useLedger.js` | 기기 저장 → 서버 전송 흐름, 재시도, 탭 간 잠금, 마지막으로 받은 내역 캐시 |
| `src/hooks/useOnline.js` | 온라인/오프라인 감지 |

**같은 내역이 두 번 저장되지 않는 이유**

1. 내역 ID를 저장 버튼을 누를 때 기기에서 한 번 만들고(`crypto.randomUUID`), 다시 보낼 때도 같은 ID를 씁니다. 서버에는 `upsert`(있으면 덮어쓰기)로 보내서, 응답이 끊겨 재전송돼도 한 줄만 남아요.
2. 같은 내역에 대한 작업은 목록에서 하나로 합칩니다(마지막 수정만, 추가 후 삭제면 삭제만).
3. 탭이 여러 개면 `navigator.locks` 로 한 탭만 전송합니다.
4. 저장 버튼 연타는 폼에서 막습니다.

**알아둘 점**

- 두 기기에서 같은 내역을 각각 오프라인으로 고치면, 나중에 올라간 쪽이 남습니다.
- 서버 응답이 10초 넘게 없으면 실패로 보고 나중에 같은 ID로 다시 보냅니다(중복 없음).
- 권한 오류(대부분 로그인 만료)는 내역을 버리지 않고 보관했다가, 다시 로그인되면 올립니다. 로그인 상태가 아니면 아예 보내지 않아요.
- 다시 보내도 실패할 오류(값 범위 위반 등)만 목록에서 빼고 알림을 띄운 뒤 서버 상태로 되돌립니다.
- 기기 저장소에서 읽은 값은 매번 형식을 검사해서, 손상되거나 조작된 항목은 무시합니다.
- 기기 저장 공간이 꽉 차면 다시 받을 수 있는 캐시를 먼저 지워 공간을 만들고, 그래도 부족하면 메모리에 보관하면서 안내를 띄웁니다.
- 로그아웃하면 이 기기의 내역 캐시와 보낼 목록을 지웁니다. 못 올린 내역이 있으면 먼저 확인창이 떠요. 자동 로그인을 끈 경우 캐시는 탭을 닫으면 지워지는 저장소(sessionStorage)에 둡니다.

## 함께 쓰는 사람 (한 계정을 여러 명이 사용)

**처음 한 번:** 이미 DB를 만든 프로젝트는 Supabase SQL Editor에서 `supabase/003_members.sql` 을 실행하세요. 새로 만드는 프로젝트는 `schema.sql` 에 이미 들어 있어요.

| 기능 | 설명 |
| --- | --- |
| 사람 등록 | "사람별 합계" 카드 → 사람 관리. 최대 10명, 이름 12자, 색 선택(색 칸을 누르면 바뀜) |
| 이 기기의 사람("나") | 기기마다 따로 기억. 새 내역을 입력할 때 자동 선택 |
| 내역의 "누가" | 사람 또는 공동. 수정할 때 바꿀 수 있음 |
| 사람별 합계 | 그 달 각자의 지출·수입·비율·건수와 총합. 비율은 합이 정확히 100%가 되게 반올림 |
| 보기 필터 | 전체 / 사람 / 공동. 요약·카테고리·일별 차트·내역이 그 기준으로 바뀜. 예산은 항상 모두의 합계 기준 |

- 사람을 삭제해도 그 사람의 내역은 지워지지 않고 "공동"으로 합산돼요.
- `003_members.sql` 을 실행하기 전에 새 버전을 배포해도 안전해요. 앱은 정상 동작하고, 사람이 없는 내역은 바로 저장돼요. 사람이 지정된 내역과 사람 목록은 기기에 보관됐다가 업데이트되면 자동으로 올라가요.
- 같은 계정이라 모두가 서로의 내역을 볼 수 있어요. 각자 내역을 숨기고 싶다면 계정을 따로 쓰는 "공동 가계부(초대)" 방식이 필요해요.

| 파일 | 역할 |
| --- | --- |
| `src/lib/members.js` | 사람별 합계, 필터, 비율 계산, 이 기기의 사람 기억 |
| `src/components/MembersForm.jsx` | 사람 관리 화면 |
| `src/components/MemberSummary.jsx` | 사람별 합계 카드 |
| `src/components/WhoFilter.jsx` | 보기 필터 |
| `supabase/003_members.sql` | DB 업데이트 (`member_id`, `members` 칸) |

## 반복 내역 · 카테고리 · 예산 · 추이 · CSV

**처음 한 번:** 이미 DB를 만든 프로젝트는 SQL Editor에서 `supabase/004_features.sql` 을 실행하세요(003 다음). 실행 전에 배포해도 설정은 기기에 보관됐다가 업데이트되면 올라가요. 모든 기능은 오른쪽 위 ☰ 메뉴에서 열 수 있어요.

| 기능 | 설명 |
| --- | --- |
| 반복 내역 | 매달 N일(말일 포함)·시작/끝 월·누가. 그날이 되면 자동 기록되고 🔁 표시. 일시정지·수정·삭제해도 이미 기록된 내역은 남음 |
| 카테고리 편집 | 추가·이름 변경·아이콘·순서·삭제·기본값으로. 이름을 바꾸면 기존 내역·반복 내역·카테고리별 예산도 함께 바뀜. 삭제해도 기존 내역은 📦로 남음 |
| 카테고리별 예산 | 카테고리마다 한도. 80% 이상 주의(노랑), 넘으면 초과(빨강). 모두의 지출 기준 |
| 월별 추이 | 최근 6/12개월 수입·지출 막대, 평균 지출선, 기간 저축액. 막대를 누르면 그 달로 이동. 보기 필터(사람)를 따름 |
| CSV 내보내기 | 이번 달·올해·전체·기간 지정, 사람별. 엑셀에서 한글이 안 깨지도록 BOM 포함 |

**반복 내역이 두 번 기록되지 않는 이유**
- 자동 기록 내역의 ID가 `rec-<규칙ID>-<YYYY-MM>` 으로 고정이라, 두 기기가 같은 달을 동시에 기록해도 서버에는 한 줄만 남아요.
- 기록 후 규칙에 "마지막으로 기록한 달"을 저장해서, 자동 기록된 내역을 지워도 다시 생기지 않아요.
- 이번 접속에서 서버 데이터를 받은 뒤에만 기록해요(오래된 캐시 기준으로 지운 내역을 되살리지 않게).
- 오래 앱을 안 열었다면 밀린 달을 최대 24개월까지 채워요.

**CSV 보안:** 메모가 `= + - @` 로 시작하면 앞에 `'` 를 붙여 저장해서, 엑셀이 수식(예: 악성 링크)으로 실행하지 않게 해요.

| 파일 | 역할 |
| --- | --- |
| `src/lib/recurring.js` | 반복 내역 날짜 계산·등록 계획 |
| `src/lib/csv.js` | CSV 만들기(이스케이프·수식 주입 방지)·내려받기 |
| `src/lib/categories.js` | 기본/사용자 카테고리, 아이콘·색 |
| `src/components/RecurringManager.jsx` · `CategoryEditor.jsx` · `CategoryBudget.jsx` · `MonthlyTrend.jsx` · `ExportForm.jsx` · `SettingsMenu.jsx` | 각 화면 |
| `tests/features.test.mjs` | 반복 내역·CSV·검증 단위 테스트 (`npm test`) |

## DB 값 제한

`schema.sql` 에 금액(1 ~ 99억 9999만), 예산, 메모(100자), 카테고리(20자), ID(64자) 범위 제한이 들어 있습니다. 앱을 거치지 않고 API를 직접 호출해도 서버가 거부해요. **이미 `schema.sql`을 실행한 프로젝트**는 `supabase/002_hardening.sql` 을 SQL Editor에서 한 번 실행하세요.

## 보안 메모

- anon 키는 공개돼도 되는 키입니다. 데이터 보호는 `schema.sql` 의 RLS 정책이 담당해요.
- `service_role` 키는 절대 `VITE_` 환경변수나 코드에 넣지 마세요. `VITE_` 로 시작하는 값은 빌드 결과에 그대로 포함됩니다.
- 라이브러리는 npm + `package-lock.json` 으로 버전이 고정되고, 내 도메인에서 함께 서빙돼서 CDN·SRI 걱정이 없어요.
- `vercel.json` 의 CSP는 내 사이트 스크립트와 Supabase 연결만 허용합니다. 외부 서비스(예: CAPTCHA)를 추가하면 CSP에도 그 주소를 더해야 해요.
