// Supabase 오류 메시지를 사용자가 이해할 수 있는 한국어로 바꿈
const RULES = [
  [/invalid login credentials/i, '이메일 또는 비밀번호가 맞지 않아요.'],
  [/email not confirmed/i, '이메일 인증을 먼저 완료해 주세요. 가입할 때 받은 메일의 링크를 눌러 주세요.'],
  [/already registered|already been registered|user already exists/i, '이미 가입된 이메일이에요. 로그인해 주세요.'],
  [/password should be at least|password.*(short|length)/i, '비밀번호가 너무 짧아요.'],
  [/weak password|pwned/i, '너무 흔한 비밀번호예요. 다른 비밀번호를 써 주세요.'],
  [/signups not allowed|signup.*disabled/i, '지금은 새로 가입할 수 없어요.'],
  [/rate limit|too many|security purposes/i, '요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.'],
  [/unable to validate email|invalid email|email address .* invalid/i, '이메일 주소 형식을 확인해 주세요.'],
  [/same.*password|different from the old/i, '이전과 다른 비밀번호를 입력해 주세요.'],
  [/invalid path specified|requested path is invalid/i, 'Supabase 주소가 잘못됐어요. VITE_SUPABASE_URL을 확인해 주세요.'],
  [/invalid api key|no api key/i, 'Supabase 키가 잘못됐어요. VITE_SUPABASE_ANON_KEY를 확인해 주세요.'],
  [/failed to fetch|networkerror|network request failed/i, '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'],
];

export function koError(e) {
  const msg = (e && e.message) || String(e || '');
  const hit = RULES.find(([re]) => re.test(msg));
  return hit ? hit[1] : `문제가 생겼어요: ${msg}`;
}
