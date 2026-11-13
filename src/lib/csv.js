/**
 * CSV 만들기·내려받기
 * - 맨 앞에 BOM(﻿)을 붙여 엑셀에서 한글이 깨지지 않게 함
 * - 수식 주입 방지: = + - @ 탭 으로 시작하는 글자 칸은 앞에 ' 를 붙여, 엑셀이 수식으로 실행하지 않게 함
 *   (예: 메모에 =HYPERLINK(...) 를 넣어 두면 파일을 연 사람 PC에서 실행될 수 있음)
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value == null) return '';
  let s = String(value);
  if (typeof value === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header, rows) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** 브라우저에서 파일로 내려받기. 실패하면 false */
export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch {
    return false;
  }
}
