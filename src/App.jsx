import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { newId, useLedger } from './hooks/useLedger';
import { useToast } from './hooks/useToast';
import { configError } from './lib/supabase';
import { koError } from './lib/errors';
import {
  isCurrentMonth, nextMonth, pad, prevMonth, sumByType, todayStr, won, ymKey,
} from './lib/format';

import Header from './components/Header';
import MonthBar from './components/MonthBar';
import Summary from './components/Summary';
import BudgetCard from './components/BudgetCard';
import CategoryDonut from './components/CategoryDonut';
import DailyChart from './components/DailyChart';
import TxList from './components/TxList';
import TxForm from './components/TxForm';
import BudgetForm from './components/BudgetForm';
import Sheet from './components/Sheet';
import Toast from './components/Toast';
import MemberSummary from './components/MemberSummary';
import MembersForm from './components/MembersForm';
import WhoFilter from './components/WhoFilter';
import { SHARED, filterByOwner, findMember, getMe, setMe } from './lib/members';
import InstallBanner from './components/InstallBanner';
import { PlusIcon } from './components/Icons';
import { AuthScreen, NewPasswordScreen } from './components/AuthScreen';

const thisMonth = () => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; };

// 홈 화면 아이콘 길게 누르기 → "지출 추가" 바로가기로 열렸는지
const openedFromAddShortcut = () => new URLSearchParams(window.location.search).get('action') === 'add';

// 저장 결과 문구: 서버까지 올라갔는지, 기기에 대기 중인지
const savedSuffix = (synced, online) =>
  synced ? '' : online ? ' · 서버에 올리는 중' : ' · 연결되면 자동으로 올라가요';

export default function App() {
  const auth = useAuth();
  const ledger = useLedger(auth.user?.id);
  const { toast, show, hide } = useToast();

  const [ym, setYm] = useState(thisMonth);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [who, setWho] = useState('all'); // 보기 기준: 'all' | 'shared' | 사람 id
  const [meId, setMeId] = useState(null); // 이 기기를 쓰는 사람
  const [sheet, setSheet] = useState(() => (openedFromAddShortcut() ? { kind: 'add' } : null)); // { kind: 'add' } | { kind: 'edit', id } | { kind: 'budget' }
  const closeSheet = useCallback(() => setSheet(null), []);
  const { online } = ledger;

  // 바로가기 주소(?action=add)는 한 번 쓰고 지움 → 새로고침해도 다시 열리지 않게
  useEffect(() => {
    if (openedFromAddShortcut()) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // ---- 파생 데이터 ----
  const allTx = useMemo(() => Object.entries(ledger.tx).map(([id, t]) => ({ id, ...t })), [ledger.tx]);
  const monthTx = useMemo(() => {
    const k = ymKey(ym.y, ym.m);
    return allTx.filter((t) => typeof t.date === 'string' && t.date.startsWith(k));
  }, [allTx, ym]);
  const { members } = ledger;
  // 보던 사람이 삭제되면 전체 보기로
  const whoValid = who === 'all' || who === SHARED || members.some((m) => m.id === who) ? who : 'all';
  const viewTx = useMemo(() => filterByOwner(monthTx, members, whoValid), [monthTx, members, whoValid]);
  const totals = useMemo(() => sumByType(viewTx), [viewTx]);
  const householdExp = useMemo(() => sumByType(monthTx).exp, [monthTx]);
  const prevExp = useMemo(() => {
    const p = prevMonth(ym);
    const k = ymKey(p.y, p.m);
    return sumByType(filterByOwner(allTx.filter((t) => t.date?.startsWith(k)), members, whoValid)).exp;
  }, [allTx, ym, members, whoValid]);
  const expenses = useMemo(() => viewTx.filter((t) => t.type !== 'income'), [viewTx]);
  const whoLabel = whoValid === 'all' ? '' : whoValid === SHARED ? '공동' : findMember(members, whoValid)?.name || '';

  // 이 기기를 쓰는 사람 (기기마다 저장). 로그인 사용자가 바뀌면 다시 읽음
  const uid = auth.user?.id;
  useEffect(() => { setMeId(uid ? getMe(uid) : null); setWho('all'); }, [uid]);
  // 새 내역의 기본 "누가": 특정 사람 보기 중이면 그 사람, 아니면 이 기기의 사람
  const formDefaultMember = whoValid !== 'all' && whoValid !== SHARED ? whoValid : meId;
  const defaultDate = isCurrentMonth(ym) ? todayStr() : `${ym.y}-${pad(ym.m)}-01`;

  // ---- 키보드 ←/→ 로 달 이동 ----
  useEffect(() => {
    const onKey = (e) => {
      if (sheet || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      if (e.key === 'ArrowLeft') setYm(prevMonth);
      if (e.key === 'ArrowRight') setYm(nextMonth);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);

  // ---- 동작 ----
  // 저장은 기기에 먼저 기록되고 화면에 바로 보이므로, 서버 응답을 기다리지 않고 시트를 닫음
  const saveTx = (id, data, isEdit) => {
    closeSheet();
    const [y, m] = data.date.split('-').map(Number);
    if (y !== ym.y || m !== ym.m) setYm({ y, m });
    const label = isEdit ? '수정했어요' : `${data.type === 'income' ? '수입' : '지출'} ${won(data.amount)} 저장`;
    ledger.saveTx(id, data)
      .then(({ synced }) => show(label + savedSuffix(synced, navigator.onLine !== false)))
      .catch((e) => show(`저장하지 못했어요 · ${koError(e)}`));
  };

  const deleteTx = (id) => {
    closeSheet();
    ledger.deleteTx(id)
      .then(({ prev, synced }) => {
        // 되돌리기 = 같은 ID로 다시 저장 → 서버에 두 줄이 생기지 않음
        const undo = prev ? () => saveTx(id, prev, true) : undefined;
        show('삭제했어요' + savedSuffix(synced, navigator.onLine !== false), undo);
      })
      .catch((e) => show(`삭제하지 못했어요 · ${koError(e)}`));
  };

  const saveMembers = (list, me) => {
    closeSheet();
    if (uid) setMe(uid, me);
    setMeId(me);
    ledger.saveMembers(list)
      .then(({ synced }) => show('함께 쓰는 사람을 저장했어요' + savedSuffix(synced, navigator.onLine !== false)))
      .catch((e) => show(`저장하지 못했어요 · ${koError(e)}`));
  };

  const saveBudget = (value) => {
    closeSheet();
    ledger.saveBudget(value)
      .then(({ synced }) => show((value ? '예산을 저장했어요' : '예산을 없앴어요') + savedSuffix(synced, navigator.onLine !== false)))
      .catch((e) => show(`저장하지 못했어요 · ${koError(e)}`));
  };

  // 로그아웃: 공용 기기에 가계부가 남지 않도록 이 기기의 내역 캐시와 보낼 목록을 지움.
  // 아직 못 올린 내역이 있으면 먼저 확인.
  const doSignOut = async () => {
    closeSheet();
    ledger.clearLocalData();
    await auth.signOut();
  };
  const handleSignOut = () => {
    if (ledger.pendingCount > 0) setSheet({ kind: 'logout' });
    else doSignOut();
  };

  // ---- 화면 분기 ----
  if (configError) {
    return (
      <div className="app">
        <div className="notice show">
          <b>설정이 필요해요.</b> {configError}<br />
          로컬에서는 <code>.env.local</code>, Vercel에서는 Project Settings → Environment Variables 에 값을 넣고 다시 배포해 주세요.
        </div>
      </div>
    );
  }
  if (auth.loading) return null;
  if (auth.recovering) {
    return <NewPasswordScreen onDone={() => { auth.endRecovery(); show('비밀번호를 바꿨어요'); }} />;
  }
  if (!auth.user) return <AuthScreen />;

  const editing = sheet?.kind === 'edit' ? allTx.find((t) => t.id === sheet.id) : null;

  return (
    <>
      <div className="app">
        <Header
          status={ledger.status}
          online={online}
          syncing={ledger.syncing}
          pending={ledger.pendingCount}
          email={auth.user.email}
          onSignOut={handleSignOut}
          onSync={ledger.syncNow}
        />

        <InstallBanner />

        {!online ? (
          <div className="notice show">
            오프라인이에요. 지금 입력하는 내역은 이 기기에 저장되고, 인터넷에 다시 연결되면 자동으로 올라가요.
            {ledger.pendingCount > 0 && <> (대기 {ledger.pendingCount}건)</>}
          </div>
        ) : ledger.status === 'error' && (
          <div className="notice show">내역을 불러오지 못했어요: {koError(ledger.error)}</div>
        )}
        {ledger.schemaOutdated && (
          <div className="notice show">
            <b>DB 업데이트가 필요해요.</b> Supabase SQL Editor에서 <code>supabase/003_members.sql</code>을 실행해 주세요.
            그 전까지 사람이 지정된 내역과 사람 목록은 이 기기에 보관됐다가, 업데이트되면 자동으로 올라가요.
          </div>
        )}
        {ledger.storageFull && (
          <div className="notice show">
            기기 저장 공간이 부족해요. 지금 입력은 계속 할 수 있지만, 서버에 올라가기 전에 이 탭을 닫으면 사라질 수 있어요.
          </div>
        )}

        <div className="layout">
          <main className="grid">
            <MonthBar
              ym={ym}
              onPrev={() => setYm(prevMonth)}
              onNext={() => setYm(nextMonth)}
              onToday={() => setYm(thisMonth())}
            />
            <WhoFilter members={members} who={whoValid} onChange={setWho} />
            <Summary inc={totals.inc} exp={totals.exp} prevExp={prevExp} who={whoLabel} />
            <section className="grid insights">
              <BudgetCard budget={ledger.budget} exp={householdExp} ym={ym} onEdit={() => setSheet({ kind: 'budget' })}
                note={whoLabel ? '예산은 모두의 지출 합계 기준이에요.' : ''} />
              <CategoryDonut expenses={expenses} total={totals.exp} />
              <MemberSummary list={monthTx} members={members} who={whoValid} onSelect={setWho}
                onManage={() => setSheet({ kind: 'members' })} />
              <DailyChart list={viewTx} ym={ym} />
            </section>
            <TxList
              members={members}
              items={viewTx}
              filter={filter}
              onFilter={setFilter}
              query={query}
              onQuery={setQuery}
              onOpen={(id) => setSheet({ kind: 'edit', id })}
            />
          </main>

          <aside className="side-form card" aria-label="내역 추가">
            <h2 style={{ color: 'var(--ink)', fontSize: 16 }}>새 내역</h2>
            <TxForm key={`${ymKey(ym.y, ym.m)}-${meId}-${members.map((m) => m.id).join()}`} defaultDate={defaultDate}
              members={members} defaultMemberId={formDefaultMember} onSubmit={(d) => saveTx(newId(), d, false)} />
          </aside>
        </div>
      </div>

      <button type="button" className="fab" onClick={() => setSheet({ kind: 'add' })} aria-label="내역 추가">
        <PlusIcon />
      </button>

      {sheet?.kind === 'add' && (
        <Sheet title="내역 추가" onClose={closeSheet}>
          <TxForm autoFocus defaultDate={defaultDate} members={members} defaultMemberId={formDefaultMember}
            onSubmit={(d) => saveTx(newId(), d, false)} />
        </Sheet>
      )}
      {sheet?.kind === 'edit' && editing && (
        <Sheet title="내역 수정" onClose={closeSheet}>
          <TxForm
            key={editing.id}
            initial={editing}
            members={members}
            defaultDate={defaultDate}
            onSubmit={(d) => saveTx(editing.id, d, true)}
            onDelete={() => deleteTx(editing.id)}
          />
        </Sheet>
      )}
      {sheet?.kind === 'budget' && (
        <Sheet title="월 예산" onClose={closeSheet}>
          <BudgetForm budget={ledger.budget} onSave={saveBudget} />
        </Sheet>
      )}

      {sheet?.kind === 'members' && (
        <Sheet title="함께 쓰는 사람" onClose={closeSheet}>
          <MembersForm members={members} meId={meId} onSave={saveMembers} />
        </Sheet>
      )}

      {sheet?.kind === 'logout' && (
        <Sheet title="로그아웃" onClose={closeSheet}>
          <div className="form">
            <p style={{ fontSize: 14.5 }}>
              아직 서버에 올리지 못한 내역이 <b>{ledger.pendingCount}건</b> 있어요.
              지금 로그아웃하면 이 기기에서 지워져요.
            </p>
            <div className="form-actions">
              <button type="button" className="btn danger" onClick={doSignOut}>지우고 로그아웃</button>
              <button type="button" className="btn primary" onClick={() => { closeSheet(); ledger.syncNow(); }}>
                {online ? '지금 올리기' : '연결 후 하기'}
              </button>
            </div>
          </div>
        </Sheet>
      )}

      <Toast toast={toast} onHide={hide} />
    </>
  );
}
