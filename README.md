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

## 보안 메모

- anon 키는 공개돼도 되는 키입니다. 데이터 보호는 `schema.sql` 의 RLS 정책이 담당해요.
- `service_role` 키는 절대 `VITE_` 환경변수나 코드에 넣지 마세요. `VITE_` 로 시작하는 값은 빌드 결과에 그대로 포함됩니다.
- 라이브러리는 npm + `package-lock.json` 으로 버전이 고정되고, 내 도메인에서 함께 서빙돼서 CDN·SRI 걱정이 없어요.
- `vercel.json` 의 CSP는 내 사이트 스크립트와 Supabase 연결만 허용합니다. 외부 서비스(예: CAPTCHA)를 추가하면 CSP에도 그 주소를 더해야 해요.
