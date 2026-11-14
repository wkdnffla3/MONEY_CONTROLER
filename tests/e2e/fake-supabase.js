// 브라우저 테스트용 가짜 Supabase. 실제 서버 없이 sessionStorage 에 DB 를 흉내 냅니다 (RLS·공유·기록·스키마 버전 포함).
// 가짜 Supabase (DB는 localStorage '__fakedb'에 → 탭·새로고침 사이 공유)
// window.__net: 'up' | 'lost'(저장 후 응답 유실,1회) | 'hang'(응답 없음) | 'rls'(권한 오류,1회) | 'anon'(로그인 없이 요청)
const KEY='__fakedb';
const load=()=>{ const d=JSON.parse(sessionStorage.getItem(KEY)||'{"transactions":[],"settings":[],"writes":0}'); d.shopping_items=d.shopping_items||[]; d.push_subscriptions=d.push_subscriptions||[]; d.ledger_members=d.ledger_members||[]; d.ledger_invites=d.ledger_invites||[]; d.activity_log=d.activity_log||[]; d.tx_comments=d.tx_comments||[]; d.logSeq=d.logSeq||0; return d; };
const save=db=>sessionStorage.setItem(KEY,JSON.stringify(db));
const netErr={message:'TypeError: Failed to fetch',code:''};
const rlsErr={message:'new row violates row-level security policy for table "transactions"',code:'42501'};
const delay=()=>new Promise(r=>setTimeout(r,40));
async function exec(fn, isWrite){
  await delay();
  if(!navigator.onLine || sessionStorage.getItem('__down')) return {data:null,error:netErr};
  if(isWrite && window.__net==='hang') return new Promise(()=>{});
  if(isWrite && window.__net==='rls'){ window.__net='up'; return {data:null,error:rlsErr}; }
  if(isWrite && window.__net==='anon') return {data:null,error:rlsErr};
  const db=load(); const out=fn(db); save(db);
  if(isWrite && window.__net==='lost'){ window.__net='up'; return {data:null,error:netErr}; }
  return out; }
// sessionStorage '__legacy'=1 → DB 업데이트(003) 전 상태: member_id / members 칸이 없음
const LV=()=>Number(sessionStorage.getItem('__legacy')||0); // 0=최신, 1=003 전, 2=004 전, 3=005 전
const tableMissing=(t)=>(t==='shopping_items' && LV()>0 && LV()<4) || (t==='push_subscriptions' && LV()>0 && LV()<7) || ((t==='activity_log'||t==='tx_comments') && LV()>0); // 4 = 006 전(005까지 적용)
const noTable=(t)=>({data:null,error:{code:'PGRST205',message:`Could not find the table 'public.${t}' in the schema cache`}});
const NEW6={tx:['tags','card_id','inst_months'], st:['cards']};
// 5 = 007 전(006까지 적용): device_id 칸, push_subscriptions 테이블 없음 / 6 = 008 전: favorites 칸·공유 함수 없음
const MISSING=()=>{ const lv=LV(); const D=lv>0&&lv<6?['device_id']:[]; const F=lv>0?(lv===7?['dismissed_subs']:['favorites','dismissed_subs']):[];
  if(lv===1) return {transactions:['member_id',...NEW6.tx,...D], settings:['members','recurring','categories','cat_budgets',...NEW6.st,...F], shopping_items:D};
  if(lv===2) return {transactions:[...NEW6.tx,...D], settings:['recurring','categories','cat_budgets',...NEW6.st,...F], shopping_items:D};
  if(lv===3||lv===4) return {transactions:[...NEW6.tx,...D], settings:[...NEW6.st,...F], shopping_items:D};
  return {transactions:D, settings:F, shopping_items:D, push_subscriptions:[]}; };
// ---- 계정·공유 (008) 흉내 ----
const UID=()=>sessionStorage.getItem('__uid')||'u1';
const EMAILS={u1:'me@example.com',u2:'bob@example.com',u3:'carol@example.com'};
const ledgerOf=(db,u)=>{ const m=db.ledger_members.find(x=>x.user_id===u); return m?m.ledger_id:u; };
const OWNED=['transactions','settings','shopping_items','tx_comments','activity_log'];
const LOGGED=['transactions','shopping_items'];
const strip=(r)=>{ if(!r) return null; const o={...r}; delete o.device_id; delete o.user_id; return o; };
const logIt=(db,table,action,before,after,id)=>{ if(LV()!==0||!LOGGED.includes(table)) return; if(action==='update'&&JSON.stringify(strip(before))===JSON.stringify(strip(after))) return;
  db.activity_log.push({id:++db.logSeq,user_id:rowLedger(after||before),actor:UID(),table_name:table,row_id:id,action,before:strip(before),after:strip(after),created_at:new Date().toISOString()}); };
const rowLedger=(r)=>r.user_id ?? 'u1'; // 예전 테스트 시드는 user_id 없이 넣음 → u1
const visible=(db,table,r)=> table==='push_subscriptions' ? (r.account_id ?? r.user_id ?? 'u1')===UID() : !OWNED.includes(table) || rowLedger(r)===ledgerOf(db,UID());
const rlsDenied=(table)=>({data:null,error:{code:'42501',message:`new row violates row-level security policy for table "${table}"`}});
const missingIn=(table, cols)=>(MISSING()[table]||[]).find(c=>cols.includes(c));
const legacy=()=>LV()>0;
function q(table){ const st={f:[],cols:'*'}; const b={
  select(c){ st.cols=c||'*'; return b }, eq(k,v){st.f.push([k,v]);return b},
  maybeSingle(){ const mc=missingIn(table, st.cols); if(mc) return exec(()=>({data:null,error:{code:'42703',message:`column ${table}.${mc} does not exist`}}));
    return exec(db=>({data:db[table].filter(r=>visible(db,table,r))[0]||null,error:null})); },
  upsert(row){ if(tableMissing(table)) return exec(()=>noTable(table), true); const mc=missingIn(table, Object.keys(row).join(',')); if(mc) return exec(()=>({error:{code:'PGRST204',message:`Could not find the '${mc}' column of '${table}' in the schema cache`}}), true);
    return exec(db=>{
    if(LV()===0 && OWNED.includes(table) && row.user_id && row.user_id!==ledgerOf(db,UID())) return rlsDenied(table);
    if(sessionStorage.getItem('__memo100') && (table==='transactions'||table==='shopping_items') && String(row.memo||'').length>100) return {data:null,error:{code:'23514',message:`new row for relation "${table}" violates check constraint "${table}_memo_check"`}};
    if(table==='push_subscriptions'){ row={account_id:UID(), user_id:ledgerOf(db,UID()), ...row}; if(row.user_id!==ledgerOf(db,UID())) return rlsDenied(table); }
    db.writes++;
    if(table==='settings' && row.budget>Number.MAX_SAFE_INTEGER) { return {error:{message:'value out of range for type bigint',code:'22003'}}; }
    const key=table==='settings'?'user_id':table==='push_subscriptions'?'endpoint':'id'; const i=db[table].findIndex(r=>r[key]===row[key]);
    if(i>=0){ const before=db[table][i]; db[table][i]={...db[table][i],...row}; logIt(db,table,'update',before,db[table][i],row.id); return {error:null}; }
    const _ins=(table==='settings'?{budget:0,members:[],recurring:[],categories:null,cat_budgets:{},cards:[],...row}:table==='transactions'?{member_id:null,tags:[],card_id:null,inst_months:1,...row}:row); db[table].push(_ins); logIt(db,table,'insert',null,_ins,row.id); return {error:null}; }, true); },
  insert(row){ if(tableMissing(table)) return exec(()=>noTable(table), true);
    return exec(db=>{ if(table==='tx_comments'){ row={author:UID(),created_at:new Date().toISOString(),...row}; if(row.author!==UID()||row.user_id!==ledgerOf(db,UID())) return rlsDenied(table); if(!String(row.body||'').trim()) return {error:{code:'23514',message:'check constraint'}}; }
      if(db[table].some(r=>r.id===row.id)) return {error:{code:'23505',message:'duplicate key'}}; db.writes++; db[table].push(row); return {error:null}; }, true); },
  order(k,o){ st.order=[k,o&&o.ascending===false?-1:1]; return b; }, limit(n){ st.limit=n; return b; }, lt(k,v){ st.lt=[k,v]; return b; },
  delete(){ st.del=true; return b; },
  update(row){ st.upd=row; return b; },
  then(res,rej){ if(tableMissing(table)) return exec(()=>noTable(table), !!st.del).then(res,rej); const mc=!st.del && missingIn(table, st.cols); if(mc) return exec(()=>({data:null,error:{code:'42703',message:`column ${table}.${mc} does not exist`}})).then(res,rej);
    if(st.upd) return exec(db=>{ db.writes++; db.updateCalls=(db.updateCalls||0)+1; db[table]=db[table].map(r=>visible(db,table,r)&&st.f.every(([k,v])=>(k==='user_id'?rowLedger(r):r[k])===v)?{...r,...st.upd}:r); return {error:null}; }, true).then(res,rej);
    const p = st.del ? exec(db=>{ db.writes++; const keep=[], gone=[]; for(const r of db[table]) ((visible(db,table,r)&&st.f.every(([k,v])=>r[k]===v)&&(table!=='tx_comments'||r.author===UID()))?gone:keep).push(r); db[table]=keep; gone.forEach(r=>logIt(db,table,'delete',r,null,r.id)); return {error:null}; }, true)
                     : exec(db=>({data:db[table].filter(r=>visible(db,table,r)&&st.f.every(([k,v])=>r[k]===v)&&(!st.lt||r[st.lt[0]]<st.lt[1])).sort((a,c)=>st.order?(a[st.order[0]]>c[st.order[0]]?1:-1)*st.order[1]:0).slice(0,st.limit||1e9).map(r=>{ const o={...r}; for(const c of (MISSING()[table]||[])) delete o[c]; return o; }),error:null})); return p.then(res,rej); } }; return b; }
let session={user:{id:UID(),email:EMAILS[UID()],identities:[{}]}}; const subs=new Set();
const fnErr=(m)=>({data:null,error:{code:'P0001',message:m}});
const noFn=(fn)=>({data:null,error:{code:'PGRST202',message:`Could not find the function public.${fn} in the schema cache`}});
const RPC={
  my_ledger(db){ const me=UID(), lid=ledgerOf(db,me); const m=db.ledger_members.find(x=>x.user_id===me);
    return {data:{ledger_id:lid, is_owner:lid===me, person_id:m?m.person_id:null,
      people:[{user_id:lid,email:EMAILS[lid],owner:true,person_id:null}, ...db.ledger_members.filter(x=>x.ledger_id===lid).map(x=>({user_id:x.user_id,email:EMAILS[x.user_id],owner:false,person_id:x.person_id}))]},error:null}; },
  create_invite(db){ const lid=ledgerOf(db,UID()); const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c=''; for(let i=0;i<10;i++) c+=A[Math.floor(Math.random()*32)];
    const exp=new Date(Date.now()+48*3600e3).toISOString(); db.ledger_invites.push({code:c,ledger_id:lid,used_by:null,expires_at:exp}); return {data:{code:c,expires_at:exp},error:null}; },
  peek_invite(db,{p_code}){ const inv=db.ledger_invites.find(x=>x.code===String(p_code).toUpperCase()); if(!inv) return fnErr('invalid_code'); if(inv.used_by) return fnErr('used');
    if(inv.ledger_id===UID()) return fnErr('own_ledger'); const st=db.settings.find(x=>rowLedger(x)===inv.ledger_id);
    return {data:{owner:EMAILS[inv.ledger_id].replace(/^(.{1,2})[^@]*/,'$1***'), members:st?st.members||[]:[], count:1+db.ledger_members.filter(x=>x.ledger_id===inv.ledger_id).length},error:null}; },
  join_ledger(db,{p_code,p_person,p_name}){ const me=UID(); const inv=db.ledger_invites.find(x=>x.code===p_code); if(!inv) return fnErr('invalid_code'); if(inv.used_by) return fnErr('used');
    if(inv.ledger_id===me) return fnErr('own_ledger'); if(db.ledger_members.some(x=>x.user_id===me)) return fnErr('already_joined'); if(db.ledger_members.some(x=>x.ledger_id===me)) return fnErr('has_members');
    let st=db.settings.find(x=>rowLedger(x)===inv.ledger_id); if(!st){ st={user_id:inv.ledger_id,budget:0,members:[],recurring:[],categories:null,cat_budgets:{},cards:[],favorites:[]}; db.settings.push(st); }
    let pid=null; const mem=st.members||[]; if(p_person && mem.some(m=>m.id===p_person)) pid=p_person; else if(p_name && mem.length<10){ pid='acct-'+me; st.members=[...mem,{id:pid,name:p_name,color:mem.length%10}]; }
    db.ledger_members.push({user_id:me,ledger_id:inv.ledger_id,person_id:pid}); inv.used_by=me;
    db.push_subscriptions.forEach(s=>{ if((s.account_id??s.user_id)===me) s.user_id=inv.ledger_id; }); return {data:{ledger_id:inv.ledger_id,person_id:pid},error:null}; },
  remove_member(db,{p_user}){ const lid=ledgerOf(db,UID()); if(!db.ledger_members.some(x=>x.user_id===p_user&&x.ledger_id===lid)) return fnErr('not_member');
    db.ledger_members=db.ledger_members.filter(x=>x.user_id!==p_user); db.push_subscriptions.forEach(s=>{ if((s.account_id??s.user_id)===p_user) s.user_id=p_user; }); return {data:null,error:null}; },
  leave_ledger(db){ return RPC.remove_member(db,{p_user:UID()}); },
};
export function createClient(){ return {
  auth:{ getSession:async()=>({data:{session}}), onAuthStateChange:(cb)=>{subs.add(cb);return {data:{subscription:{unsubscribe(){subs.delete(cb)}}}}},
    signOut:async()=>{ session=null; subs.forEach(cb=>cb('SIGNED_OUT',null)); } },
  rpc:(fn,args={})=>exec(db=>{ if(LV()!==0) return noFn(fn); const f=RPC[fn]; return f?f(db,args):noFn(fn); }, fn!=='my_ledger'&&fn!=='peek_invite'),
  from:q, channel(){const c={on(ev,f,h){ (window.__rtH=window.__rtH||[]).push([f.table,h]); return c},subscribe(){return c}};return c}, removeChannel(){ window.__rtH=[]; } }; }
// 테스트에서 실시간 이벤트 흉내: window.__rt('transactions', {eventType:'INSERT', new:{...}})
window.__rt=(table,payload)=>{ for(const [t,h] of (window.__rtH||[])) if(t===table) h(payload); };
