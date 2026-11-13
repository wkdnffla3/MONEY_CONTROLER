import { SHARED, SHARED_LABEL, memberColor } from '../lib/members';

/** 보기 필터: 전체 / 사람별 / 공동 — 요약·차트·내역이 이 기준으로 바뀜 */
export default function WhoFilter({ members, who, onChange }) {
  if (!members.length) return null;
  const options = [
    { key: 'all', name: '전체', color: null },
    ...members.map((m) => ({ key: m.id, name: m.name, color: memberColor(m) })),
    { key: SHARED, name: SHARED_LABEL, color: memberColor(null) },
  ];
  return (
    <div className="who-filter" role="group" aria-label="누구 기준으로 볼까요">
      {options.map((o) => (
        <button key={o.key} type="button" className="chip" aria-pressed={who === o.key} onClick={() => onChange(o.key)}>
          {o.color && <span className="dot" style={{ background: o.color }} />}{o.name}
        </button>
      ))}
    </div>
  );
}
