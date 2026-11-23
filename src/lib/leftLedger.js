// 공유 가계부 전환 판단 (순수 함수 — 단위 테스트용으로 따로 둠)

/** 공유 가계부에서 나가거나 내보내졌을 때 이 기기에서 지울 가계부 ID (없으면 null). 내 원래 가계부는 지우지 않음 */
export function leftLedger(uid, prev, next) {
  const before = prev?.ledgerId || uid;
  const after = next?.ledgerId || uid;
  return before !== uid && before !== after ? before : null;
}
