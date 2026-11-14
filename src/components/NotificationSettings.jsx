import { useEffect, useState } from 'react';
import { setPrefs } from '../lib/notify';
import { disablePush, enablePush, getPushState, syncPushPrefs } from '../lib/push';
import { koError } from '../lib/errors';
import { isSchemaError } from '../lib/outbox';

// 직접 만든 한국어 안내는 그대로, DB 업데이트 전이면 안내, 나머지는 공통 오류 문구
const msgOf = (e) => (isSchemaError(e) ? 'DB 업데이트(supabase/007_notifications.sql)가 필요해요'
  : /[가-힣]/.test(e?.message || '') ? e.message : koError(e));

const PUSH_TEXT = {
  checking: ['확인 중…', ''],
  on: ['켜짐', '앱을 닫아 둬도 다른 사람이 추가하면 이 기기로 알림이 와요.'],
  off: ['꺼짐', '켜면 앱을 닫아 둬도 이 기기로 알림이 와요. 브라우저가 알림 권한을 물어보면 "허용"을 눌러 주세요.'],
  denied: ['차단됨', '브라우저 설정에서 이 사이트의 알림을 "허용"으로 바꾼 뒤 다시 열어 주세요.'],
  'no-key': ['설정 필요', '관리자 설정(VAPID 키, Edge Function)이 아직 안 됐어요. README의 "웹 푸시 설정"을 따라 해 주세요. 그 전에도 앱 안 알림은 동작해요.'],
  'no-sw': ['사용 불가', '배포된 사이트에서만 켤 수 있어요 (개발 서버에서는 서비스워커가 꺼져 있어요).'],
  'ios-install': ['홈 화면 앱에서 가능', '아이폰·아이패드는 Safari 공유 버튼 → "홈 화면에 추가" 후, 홈 화면 아이콘으로 열어서 켜 주세요 (iOS 16.4 이상).'],
  unsupported: ['지원 안 됨', '이 브라우저는 웹 푸시를 지원하지 않아요. 앱 안 알림은 동작해요.'],
};

const KINDS = [
  ['tx', '가계부 내역 추가'],
  ['shop', '장보기 물품 추가'],
  ['purchase', '장보기 결제 확정'],
  ['comment', '내역 댓글'],
  ['weekly', '주간 리포트', '월요일 오전 9시 · 지난주 지출 요약 (푸시)'],
  ['monthly', '월간 리포트', '매월 1일 오전 9시 · 지난달 요약 (푸시)'],
];

/** 알림 설정: 앱 안 알림 · 이 기기 웹 푸시 · 받을 내용 · 방해 금지 시간 */
export default function NotificationSettings({ uid, ledgerId, prefs, onPrefs, onPushChange, onToast }) {
  const [push, setPush] = useState('checking');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getPushState().then((s) => { if (alive) setPush(s); }, () => { if (alive) setPush('unsupported'); });
    return () => { alive = false; };
  }, []);

  const update = (patch) => {
    const next = setPrefs(uid, { ...prefs, ...patch });
    onPrefs(next);
    if (push === 'on') syncPushPrefs(next).catch(() => {});
  };

  const togglePush = async () => {
    setBusy(true);
    try {
      const s = push === 'on' ? await disablePush() : await enablePush(prefs, ledgerId);
      setPush(s);
      onPushChange?.();
      onToast(s === 'on' ? '이 기기에서 푸시 알림을 켰어요' : '이 기기의 푸시 알림을 껐어요');
    } catch (e) {
      setPush(await getPushState().catch(() => 'off'));
      onToast(`푸시 알림을 바꾸지 못했어요 · ${msgOf(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const testPush = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.showNotification('가계부 알림 테스트', { body: '이렇게 알림이 와요 🔔', tag: 'test', icon: '/icons/icon-192.png', data: { url: '/' } });
    } catch (e) {
      onToast(`테스트 알림을 띄우지 못했어요 · ${msgOf(e)}`);
    }
  };

  const [label, desc] = PUSH_TEXT[push] || PUSH_TEXT.unsupported;
  const canToggle = push === 'on' || push === 'off';

  return (
    <div className="form notify-settings">
      <section className="ns-sec">
        <h4>앱 안 알림</h4>
        <label className="check">
          <input type="checkbox" checked={prefs.inapp} onChange={(e) => update({ inapp: e.target.checked })} />
          다른 사람이 추가하면 화면 위에 알려주기
        </label>
        <p className="hint">앱을 열어 둔 동안 동작하고, 설정은 필요 없어요. 내가 이 기기에서 입력한 건 알리지 않아요.</p>
      </section>

      <section className="ns-sec">
        <h4>이 기기 푸시 알림 <span className={`ns-badge ns-${push}`}>{label}</span></h4>
        <p className="hint">{desc}</p>
        {canToggle && (
          <div className="form-actions">
            <button type="button" className={`btn ${push === 'on' ? '' : 'primary'}`} disabled={busy} onClick={togglePush}>
              {busy ? '처리 중…' : push === 'on' ? '푸시 끄기' : '푸시 켜기'}
            </button>
            {push === 'on' && <button type="button" className="btn" onClick={testPush}>테스트 알림</button>}
          </div>
        )}
        <p className="hint">기기마다 따로 켜야 해요. 로그아웃하면 이 기기는 자동으로 꺼져요.</p>
      </section>

      <section className="ns-sec">
        <h4>알림 받을 내용</h4>
        <div className="ns-kinds">
          {KINDS.map(([k, t, sub]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={prefs[k]} onChange={(e) => update({ [k]: e.target.checked })} />
              <span>{t}{sub && <small className="ns-sub">{sub}</small>}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="ns-sec">
        <h4>방해 금지 시간</h4>
        <label className="check">
          <input type="checkbox" checked={prefs.quiet} onChange={(e) => update({ quiet: e.target.checked })} />
          이 시간에는 푸시·시스템 알림 보내지 않기
        </label>
        <div className={`ns-quiet ${prefs.quiet ? '' : 'off'}`}>
          <input type="time" aria-label="방해 금지 시작" value={prefs.quietStart} disabled={!prefs.quiet}
            onChange={(e) => e.target.value && update({ quietStart: e.target.value })} />
          <span>~</span>
          <input type="time" aria-label="방해 금지 끝" value={prefs.quietEnd} disabled={!prefs.quiet}
            onChange={(e) => e.target.value && update({ quietEnd: e.target.value })} />
        </div>
        <p className="hint">앱을 보고 있을 때의 화면 위 알림은 이 시간에도 보여요.</p>
      </section>
    </div>
  );
}
