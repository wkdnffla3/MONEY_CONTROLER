export const pad = (n) => String(n).padStart(2, '0');
export const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
export const signedWon = (n) => (n < 0 ? '-' : '') + won(Math.abs(n));
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const ymKey = (y, m) => `${y}-${pad(m)}`;
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
export const isCurrentMonth = ({ y, m }) => {
  const d = new Date();
  return y === d.getFullYear() && m === d.getMonth() + 1;
};
export const prevMonth = ({ y, m }) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 });
export const nextMonth = ({ y, m }) => (m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 });

// "12,345" ↔ 12345
export const parseAmount = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;
export const formatAmountInput = (n) => (n ? n.toLocaleString('ko-KR') : '');

export function sumByType(list) {
  let inc = 0, exp = 0;
  for (const t of list) {
    const a = Number(t.amount) || 0;
    if (t.type === 'income') inc += a; else exp += a;
  }
  return { inc, exp };
}
