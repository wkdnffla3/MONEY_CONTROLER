-- 015 반복 내역 최대 100개 (러너가 :migration 으로 015 파일 경로를 넘김)
\set A '00000000-0000-0000-0000-00000000000a'
create temp table out(n serial, name text, ok bool, detail text);
grant all on out to authenticated, anon; grant usage on sequence out_n_seq to authenticated, anon;
create or replace function pg_temp.chk(name text, ok bool, detail text default '') returns void language sql as $$ insert into out(name,ok,detail) values (name, coalesce(ok,false), detail) $$;
create or replace function pg_temp.rules(n int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id','r'||g,'type','expense','amount',55000,'category','주거·통신','memo','통신비 매달 자동 납부','memberId',null,'day',25,'start','2026-01','end',null,'last','2026-11','active',true)), '[]'::jsonb)
  from generate_series(1,n) g $$;

insert into settings(user_id) values (:'A') on conflict (user_id) do nothing;
select set_config('request.jwt.claim.sub', :'A', false); set role authenticated;
do $$ begin
  begin update settings set recurring = pg_temp.rules(100) where user_id = '00000000-0000-0000-0000-00000000000a';
    perform pg_temp.chk('1. 반복 내역 100개 저장', (select jsonb_array_length(recurring) from settings where user_id = '00000000-0000-0000-0000-00000000000a') = 100);
  exception when others then perform pg_temp.chk('1. 반복 내역 100개 저장', false, sqlerrm); end;
  begin update settings set recurring = pg_temp.rules(101) where user_id = '00000000-0000-0000-0000-00000000000a';
    perform pg_temp.chk('2. 101개는 거절', false);
  exception when check_violation then perform pg_temp.chk('2. 101개는 거절', true); end;
end $$;
reset role;
-- 다시 실행해도 안전 (100개 들어 있는 상태에서 015, 011 다시 실행)
\i :migration
\i :mig011
select pg_temp.chk('3. 015·011 을 다시 실행해도 100개 그대로, 제약 1개',
  (select jsonb_array_length(recurring) from settings where user_id = :'A') = 100
  and (select count(*) from pg_constraint where conrelid = 'public.settings'::regclass and pg_get_constraintdef(oid) like '%jsonb_array_length(recurring)%') = 1);

select n, case when ok then 'PASS' else 'FAIL' end, name, left(detail,120) from out order by n;
