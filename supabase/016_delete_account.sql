-- 016: 회원 탈퇴 (앱 ☰ → 계정·개인정보 → 회원 탈퇴)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run (여러 번 실행해도 안전, 008 이후)
-- 실행 전에는 탈퇴 버튼을 누르면 "DB 업데이트(016)가 필요해요" 안내가 떠요.

-- 회원 탈퇴: 로그인한 본인 계정과 그 계정의 데이터를 지움.
--  - 내 가계부(계정 ID = 가계부 ID)의 내역·설정·장보기·변경 기록·댓글·초대 코드·푸시 구독은 외래 키(on delete cascade)로 함께 지워짐
--  - 다른 사람이 내 가계부에 참여 중이면 거절 (그 사람들의 공유 내역까지 지워지므로). 공유에서 먼저 내보내야 함
--  - 내가 남의 가계부에 참여 중이면: 참여 정보·내 기기 알림·내가 쓴 댓글은 지워지고, 내가 입력한 내역은 그 가계부에 남음
--    (변경 기록의 "누가"는 비워짐)
create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if exists (select 1 from public.ledger_members where ledger_id = me and user_id <> me) then
    raise exception 'ledger_has_members' using errcode = 'P0001',
      hint = '다른 사람이 참여 중인 가계부예요. 가계부 공유에서 참여자를 먼저 내보내 주세요.';
  end if;
  delete from auth.users where id = me;
end $$;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

notify pgrst, 'reload schema';
