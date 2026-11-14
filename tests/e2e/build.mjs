// 브라우저 테스트용 빌드: 실제 앱 코드(src/)를 그대로 묶되, @supabase/supabase-js 만 가짜(fake-supabase.js)로 바꿉니다.
// 결과: tests/.build/e2e/  (public/ 파일 + index.html + assets/)
// 실행: node tests/e2e/build.mjs   (npm run test:e2e 가 먼저 자동 실행)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateVapidKeys } from '../../scripts/gen-vapid.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
export const OUT = path.join(root, 'tests/.build/e2e');

export async function buildApp() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'public'), OUT, { recursive: true });
  const { publicKey } = generateVapidKeys(); // 테스트용 임시 키 (어디에도 저장 안 함)
  await build({
    entryPoints: [path.join(root, 'src/main.jsx')],
    bundle: true, splitting: true, format: 'esm', jsx: 'automatic', loader: { '.js': 'jsx' },
    outdir: path.join(OUT, 'assets'), entryNames: 'index', chunkNames: 'chunk-[hash]',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '"https://abcdefghijklmnop.supabase.co"',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '"test-anon-key"',
      'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify(publicKey),
      'import.meta.env.PROD': 'false',
      'process.env.NODE_ENV': '"production"',
    },
    logLevel: 'warning',
    plugins: [{ name: 'fake-supabase', setup(b) {
      b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: path.join(here, 'fake-supabase.js') }));
    } }],
  });
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  html = html.replace(/<script type="module" src="\/src\/main\.jsx"><\/script>/, '<script type="module" src="/assets/index.js"></script>');
  if (fs.existsSync(path.join(OUT, 'assets/index.css'))) html = html.replace('</head>', '<link rel="stylesheet" href="/assets/index.css"></head>');
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  return OUT;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildApp();
  console.log('built', path.relative(root, OUT));
}
