// 웹 푸시용 VAPID 키 한 쌍 만들기 (한 번만 실행하면 됨)
//   node scripts/gen-vapid.mjs
// 공개키 → Vercel 환경 변수 VITE_VAPID_PUBLIC_KEY 와 Supabase 비밀 값 VAPID_PUBLIC_KEY
// 비밀키 → Supabase 비밀 값 VAPID_PRIVATE_KEY 에만 (Vercel·깃허브·채팅에 올리지 마세요)
import { createECDH, randomBytes } from 'node:crypto';

export function generateVapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const priv = ecdh.getPrivateKey();
  // 앞자리가 0이면 32바이트보다 짧게 나올 수 있어서 앞을 0으로 채움
  const priv32 = Buffer.concat([Buffer.alloc(Math.max(0, 32 - priv.length)), priv]);
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'), // 65바이트 (0x04 + x + y)
    privateKey: priv32.toString('base64url'),             // 32바이트
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { publicKey, privateKey } = generateVapidKeys();
  const secret = randomBytes(24).toString('base64url');
  console.log(`
VAPID 공개키 (VITE_VAPID_PUBLIC_KEY, VAPID_PUBLIC_KEY)
${publicKey}

VAPID 비밀키 (VAPID_PRIVATE_KEY — 절대 공개 금지)
${privateKey}

웹훅 비밀 값 예시 (WEBHOOK_SECRET — 원하면 이걸 쓰세요)
${secret}
`);
}
