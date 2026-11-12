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
import { PlusIcon } from './components/Icons';
import { AuthScreen, NewPasswordScreen } from './components/AuthScreen';

const thisMonth = () => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; };

export default function App() {
  const auth = useAuth();
  const ledger = useLedger(auth.user?.id);
  const { toast, show, hide } = useToast();

  const [ym, setYm] = useState(thisMonth);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState(null); // { kind: 'add' } | { kind: 'edit', id } | { kind: 'budget' }
  const closeSheet = useCallback(() => setSheet(null), []);

  // ---- 파생 데이터 ----
  const allTx = useMemo(() => Object.entries(ledger.tx).map(([id, t]) => ({ id, ...t })), [ledger.tx]);
  const monthTx = useMemo(() => {
    const k = ymKey(ym.y, ym.m);
    return allTx.filter((t) => typeof t.date === 'string' && t.date.startsWith(k));
  }, [allTx, ym]);
  const totals = useMemo(() => sumByType(monthTx), [monthTx]);
  const prevExp = useMemo(() => {
    const p = prevMonth(ym);
    const k = ymKey(p.y, p.m);
    return sumByType(allTx.filter((t) => t.date?.startsWith(k))).exp;
  }, [allTx, ym]);
  const expenses = useMemo(() => monthTx.filter((t) => t.type !== 'income'), [monthTx]);
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
  const saveTx = async (id, data, isEdit) => {
    try {
      await ledger.saveTx(id, data);
      show(isEdit ? '수정했어요' : `${data.type === 'income' ? '수입' : '지출'} ${won(data.amount)} 저장`);
      const [y, m] = data.date.split('-').map(Number);
      if (y !== ym.y || m !== ym.m) setYm({ y, m });
      closeSheet();
    } catch (e) {
      show(`저장하지 못했어요 · ${koError(e)}`);
      throw e;
    }
  };

  const deleteTx = async (id) => {
    closeSheet();
    try {
      const prev = await ledger.deleteTx(id);
      show('삭제했어요', prev ? () => ledger.saveTx(id, prev).catch((e) => show(koError(e))) : undefined);
    } catch (e) {
      show(`삭제하지 못했어요 · ${koError(e)}`);
    }
  };

  const saveBudget = async (value) => {
    closeSheet();
    try {
      await ledger.saveBudget(value);
      show(value ? '예산을 저장했어요' : '예산을 없앴어요');
    } catch (e) {
      show(`저장하지 못했어요 · ${koError(e)}`);
    }
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
        <Header status={ledger.status} email={auth.user.email} onSignOut={auth.signOut} />

        {ledger.status === 'error' && (
          <div className="notice show">내역을 불러오지 못했어요: {koError(ledger.error)}</div>
        )}

        <div className="layout">
          <main className="grid">
            <MonthBar
              ym={ym}
              onPrev={() => setYm(prevMonth)}
              onNext={() => setYm(nextMonth)}
              onToday={() => setYm(thisMonth())}
            />
            <Summary inc={totals.inc} exp={totals.exp} prevExp={prevExp} />
            <section className="grid insights">
              <BudgetCard budget={ledger.budget} exp={totals.exp} ym={ym} onEdit={() => setSheet({ kind: 'budget' })} />
              <CategoryDonut expenses={expenses} total={totals.exp} />
              <DailyChart list={monthTx} ym={ym} />
            </section>
            <TxList
              items={monthTx}
              filter={filter}
              onFilter={setFilter}
              query={query}
              onQuery={setQuery}
              onOpen={(id) => setSheet({ kind: 'edit', id })}
            />
          </main>

          <aside className="side-form card" aria-label="내역 추가">
            <h2 style={{ color: 'var(--ink)', fontSize: 16 }}>새 내역</h2>
            <TxForm key={ymKey(ym.y, ym.m)} defaultDate={defaultDate} onSubmit={(d) => saveTx(newId(), d, false)} />
          </aside>
        </div>
      </div>

      <button type="button" className="fab" onClick={() => setSheet({ kind: 'add' })} aria-label="내역 추가">
        <PlusIcon />
      </button>

      {sheet?.kind === 'add' && (
        <Sheet title="내역 추가" onClose={closeSheet}>
          <TxForm autoFocus defaultDate={defaultDate} onSubmit={(d) => saveTx(newId(), d, false)} />
        </Sheet>
      )}
      {sheet?.kind === 'edit' && editing && (
        <Sheet title="내역 수정" onClose={closeSheet}>
          <TxForm
            key={editing.id}
            initial={editing}
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

      <Toast toast={toast} onHide={hide} />
    </>
  );
}
