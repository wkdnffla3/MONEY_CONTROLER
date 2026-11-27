import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { fromItemRow, fromRow, newId, useLedger } from './hooks/useLedger';
import { useToast } from './hooks/useToast';
import { useAppUpdate } from './hooks/useAppUpdate';
import { configError } from './lib/supabase';
import { koError } from './lib/errors';
import {
  clipText, isCurrentMonth, nextMonth, pad, prevMonth, sumByType, todayStr, won, ymKey,
} from './lib/format';

import Header from './components/Header';
import MonthBar from './components/MonthBar';
import Summary from './components/Summary';
import BudgetCard from './components/BudgetCard';
import CategoryDonut from './components/CategoryDonut';
import DailyChart from './components/DailyChart';
import TxForm from './components/TxForm';
import Sheet, { sheetGuard } from './components/Sheet';
import Toast from './components/Toast';
import MemberSummary from './components/MemberSummary';
import WhoFilter from './components/WhoFilter';
import { SHARED, filterByOwner, findMember, getMe, setMe } from './lib/members';
import InstallBanner from './components/InstallBanner';
import { PlusIcon } from './components/Icons';
import { CategoryBudgetCard, CategoryBudgetForm } from './components/CategoryBudget';
import MonthlyTrend from './components/MonthlyTrend';
import SettingsMenu from './components/SettingsMenu';
import { backupDue } from './lib/backup';
import { PRIVACY_HASH } from './lib/privacy';
import { MAX_RECURRING, recurringTxId, repeatMarker, ruleFromTx, ruleOfTx, upcomingThisMonth } from './lib/recurring';
import { CategoriesContext, CategoryActionsContext, checkNewCategory, resolveCategories } from './lib/categories';
import NavTabs from './components/NavTabs';
import { MAX_QTY, summarize as summarizeShopping } from './lib/shopping';
import { FormDataContext } from './lib/formData';
import { allTags, compareMonths, lastPrices as computeLastPrices, normalizeName } from './lib/analysis';
import CardBills from './components/CardBills';
import MonthCompare from './components/MonthCompare';
import NotifyBanner from './components/NotifyBanner';
import { useNotifier } from './hooks/useNotifier';
import { disablePush } from './lib/push';
import { useHousehold } from './hooks/useHousehold';
import { normalizeCode, writeHousehold } from './lib/household';
import { clearUserData } from './lib/outbox';
import FavoritesBar from './components/FavoritesBar';
import { useComments } from './hooks/useComments';
import CommentThread from './components/CommentThread';
import SubscriptionFinder from './components/SubscriptionFinder';
import { detectSubscriptions, ruleFromSuggestion, suggestionStartText } from './lib/subscriptions';
import { isValidItem, isValidTx } from './lib/outbox';
import { EMPTY_FILTERS } from './lib/searchFilters';
import { Lazy, prefetchScreens } from './lib/lazyScreens';
import ScreenBoundary from './components/ScreenBoundary';

// 첫 화면에 필요 없는 화면들: 필요할 때 불러옴 (lib/lazyScreens.js)
const {
  TxList, ReportPage, ShoppingPage, ShopItemForm, PurchaseConfirm, RecurringManager, CategoryEditor, ExportForm, BackupPanel, AccountPanel, PrivacyPolicy, CardManager,
  AdvancedSearch, NotificationSettings, SharePanel, FavoritesManager, ActivityLog, MembersForm, BudgetForm, AuthScreen, NewPasswordScreen,
} = Lazy;

// 페이지: 주소 끝이 #list 면 내역, #shopping 이면 장보기 (홈 화면 바로가기·뒤로 가기와 맞물림)
const PAGES = ['list', 'shopping', 'report'];
const pageFromHash = () => { const h = window.location.hash.slice(1); return PAGES.includes(h) ? h : 'ledger'; };

const thisMonth = () => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; };

// 홈 화면 아이콘 길게 누르기 → "지출 추가" 바로가기로 열렸는지
const openedFromAddShortcut = () => new URLSearchParams(window.location.search).get('action') === 'add';

// 저장 결과 문구: 서버까지 올라갔는지, 기기에 대기 중인지
const savedSuffix = (synced, online) =>
  synced ? '' : online ? ' · 서버에 올리는 중' : ' · 연결되면 자동으로 올라가요';

export default function App() {
  const auth = useAuth();
  // 다른 기기에서 추가한 내역 → 알림 (notifier는 사람 목록이 필요해서 ledger 다음에 만들고 ref로 연결)
  const notifyRef = useRef(null);
  // 지금 보는 가계부: 공유 가계부에 참여 중이면 그 가계부, 아니면 내 가계부
  const household = useHousehold(auth.user?.id);
  const ledgerId = household.ledgerId;
  const conflictRef = useRef(null);
  const ledger = useLedger(ledgerId, { onRemote: (n) => notifyRef.current?.(n), accountId: auth.user?.id, onForbidden: household.refresh, onConflict: (c) => conflictRef.current?.(c) });
  const notifier = useNotifier(auth.user?.id, ledger.members);
  // 내역 댓글 (다른 사람이 쓴 새 댓글은 알림으로)
  // 실시간 댓글 알림 배너도 쓴 사람 이름을 계정 기준으로 (commentAuthorRef: 아래 commentAuthor)
  const commentAuthorRef = useRef(null);
  const comments = useComments(ledgerId, auth.user?.id, {
    onRemote: (n) => notifyRef.current?.(n?.record && commentAuthorRef.current
      ? { ...n, record: { ...n.record, author_name: commentAuthorRef.current(n.record) } } : n),
  });
  notifyRef.current = notifier.notify;
  const { toast, show, hide } = useToast();
  const appUpdate = useAppUpdate();
  // 저장 실패 알림. 다른 기기가 먼저 바꾼 충돌은 아래 알림(내 것으로 저장 버튼)이 따로 뜨므로 건너뜀
  const fail = (prefix) => (e) => { if (e?.code !== 'conflict') show(`${prefix} · ${koError(e)}`); };
  // 017 버전 확인: 다른 기기·사람이 먼저 고친 것을 덮어쓰지 않고 알림. 버튼으로 내 내용을 최신 기준으로 다시 저장
  conflictRef.current = (list) => {
    const c = list[0];
    const { op, reason } = c;
    const what = op.kind === 'item' || op.kind === 'itemDel' ? '장보기 물품' : op.kind === 'upsert' || op.kind === 'delete' ? '내역' : null;
    const SET_LABEL = { budget: '예산', members: '사람 목록', recurring: '반복 내역', categories: '카테고리', catBudgets: '카테고리별 예산', cards: '카드', favorites: '즐겨찾기', dismissedSubs: '구독 제안' };
    let msg, label;
    if (!what) {
      const w = SET_LABEL[op.kind] || '설정';
      const last = w.charCodeAt(w.length - 1);
      const obj = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 ? '을' : '를'; // 받침 있으면 을
      msg = `다른 기기에서 먼저 ${w}${obj} 바꿔서 내 변경은 저장하지 않았어요`; label = '내 것으로 저장'; }
    else if (op.kind === 'delete' || op.kind === 'itemDel') { msg = `다른 기기에서 고친 ${what}이라 지우지 않았어요`; label = '그래도 지우기'; }
    else if (reason === 'deleted') { msg = `다른 기기에서 지운 ${what}이라 저장하지 않았어요`; label = '다시 살리기'; }
    else { msg = `다른 기기에서 먼저 고친 ${what}이라 내 수정은 저장하지 않았어요`; label = '내 것으로 저장'; }
    if (list.length > 1) msg += ` (외 ${list.length - 1}건)`;
    show(`${msg} · 최신 내용을 불러왔어요`, () => {
      Promise.all(list.map((x) => ledger.retryConflict(x)))
        .then(() => show('내 내용으로 저장했어요'))
        .catch(fail('저장하지 못했어요'));
    }, { label, ms: 9000 });
  };

  const [ym, setYm] = useState(thisMonth);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [who, setWho] = useState('all'); // 보기 기준: 'all' | 'shared' | 사람 id
  const [meId, setMeId] = useState(null); // 이 기기를 쓰는 사람
  // 개인정보 처리방침 (#privacy, 로그인 없이도)
  const [showPrivacy, setShowPrivacy] = useState(() => window.location.hash === PRIVACY_HASH);
  useEffect(() => {
    const onHash = () => setShowPrivacy(window.location.hash === PRIVACY_HASH);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onHash); };
  }, []);
  const closePrivacy = () => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setShowPrivacy(false);
  };
  const [page, setPage] = useState(pageFromHash);
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('popstate', onHash);
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('popstate', onHash); window.removeEventListener('hashchange', onHash); };
  }, []);
  const [sheet, setSheet] = useState(() => (openedFromAddShortcut() ? { kind: 'add' } : null)); // { kind: 'add' } | { kind: 'edit', id } | { kind: 'budget' }
  const closeSheet = useCallback(() => setSheet((s) => (s?.back ? { kind: s.back } : null)), []);
  // 수정 창을 연 순간의 버전(017). 창을 열어 둔 사이 다른 기기가 고친 걸 덮어쓰지 않게 저장·삭제할 때 같이 보냄
  const editBase = useRef({ id: null, base: undefined });
  if (sheet?.kind === 'edit' && editBase.current.id !== sheet.id) editBase.current = { id: sheet.id, base: ledger.verOf('upsert', sheet.id) };
  else if (sheet?.kind !== 'edit' && editBase.current.id) editBase.current = { id: null, base: undefined };
  const editBaseOf = (id) => (editBase.current.id === id ? editBase.current.base : undefined);
  // 휴대폰 뒤로 가기: 열린 시트(입력창 등)를 닫음 (예전엔 앱을 나가거나 탭이 바뀌어 입력하던 내용이 사라졌음)
  // 시트가 열리면 같은 주소로 기록을 하나 쌓고, 뒤로 가기가 오면 그 기록을 쓰며 시트만 닫음.
  // 버튼으로 닫으면 쌓아 둔 기록을 되돌려 놓아, 뒤로 가기를 한 번 더 눌러야 하는 일이 없게 함
  const sheetEntry = useRef(false);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const skipPops = useRef(0);
  const sheetOpen = !!sheet;
  useEffect(() => {
    if (sheetOpen && !sheetEntry.current) {
      sheetEntry.current = true;
      window.history.pushState({ sheet: true }, '', window.location.href);
    } else if (!sheetOpen && sheetEntry.current) {
      sheetEntry.current = false;
      if (window.history.state?.sheet) { skipPops.current += 1; window.history.back(); }
    }
  }, [sheetOpen]);
  useEffect(() => {
    const onPop = () => {
      if (skipPops.current > 0) { skipPops.current -= 1; return; }
      if (!sheetEntry.current) return;
      // 입력하다 만 내용이 있으면 닫지 않고 물어봄 (기록 자리는 다시 쌓아 둠)
      if (sheetGuard.blocked?.()) { window.history.pushState({ sheet: true }, '', window.location.href); return; }
      sheetEntry.current = false;
      // 다른 시트에서 넘어온 시트(예: 검색 → 내역 수정)면 그 시트로, 아니면 닫기 (돌아간 시트는 위 효과가 기록을 다시 쌓음)
      const s = sheetRef.current;
      if (s?.back) { sheetEntry.current = true; window.history.pushState({ sheet: true }, '', window.location.href); setSheet({ kind: s.back }); }
      else setSheet(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [listView, setListView] = useState('list'); // 내역: 목록 | 달력
  const [calDay, setCalDay] = useState(null);         // 달력에서 고른 날짜
  const [searchFilters, setSearchFilters] = useState(EMPTY_FILTERS);
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
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
  // 지난달 대비: 진행 중인 달이면 같은 날짜까지끼리 비교 (요약 카드와 "지난달 대비" 카드가 같은 기준)
  const monthCmp = useMemo(() => compareMonths(filterByOwner(allTx, members, whoValid), ym), [allTx, ym, members, whoValid]);
  const expenses = useMemo(() => viewTx.filter((t) => t.type !== 'income'), [viewTx]);
  const whoTx = useMemo(() => filterByOwner(allTx, members, whoValid), [allTx, members, whoValid]);
  const cats = useMemo(() => resolveCategories(ledger.categories), [ledger.categories]);
  const tagList = useMemo(() => allTags(allTx), [allTx]);
  const formData = useMemo(() => ({ cards: ledger.cards, tags: tagList }), [ledger.cards, tagList]);
  const cardUsage = useMemo(() => {
    const u = {};
    for (const t of allTx) if (t.cardId) u[t.cardId] = (u[t.cardId] || 0) + 1;
    return u;
  }, [allTx]);
  const shopLastPrices = useMemo(() => computeLastPrices(Object.values(ledger.items)), [ledger.items]);
  const categoryCounts = useMemo(() => {
    const c = {};
    for (const t of allTx) { const k = `${t.type}:${t.category}`; c[k] = (c[k] || 0) + 1; }
    return c;
  }, [allTx]);
  const whoLabel = whoValid === 'all' ? '' : whoValid === SHARED ? '공동' : findMember(members, whoValid)?.name || '';

  // 이 기기를 쓰는 사람 (기기마다·가계부마다 저장). 로그인 사용자나 보는 가계부가 바뀌면 다시 읽음.
  // 공유 가계부에 참여할 때 고른 사람은 서버에도 있어서 새 기기에서도 자동으로 채워짐
  const uid = auth.user?.id;
  const meKey = uid && ledgerId && ledgerId !== uid ? `${uid}@${ledgerId}` : uid;
  const serverPerson = household.personId;
  useEffect(() => { setMeId(meKey ? getMe(meKey) || serverPerson || null : null); setWho('all'); }, [meKey, serverPerson]);

  // 댓글 알림으로 앱이 새로 열렸을 때(?tx=내역ID) → 그 내역 열기
  useEffect(() => {
    if (!uid) return;
    const txId = new URLSearchParams(window.location.search).get('tx');
    if (!txId || txId.length > 64) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    setSheet({ kind: 'edit', id: txId });
  }, [uid]);

  // 첫 화면이 뜬 뒤 한가할 때 나머지 화면을 미리 받아 둠 (오프라인 대비, 탭 이동이 즉시)
  useEffect(() => { if (uid) prefetchScreens(); }, [uid]);

  // 초대 링크(?join=코드)로 열면 로그인 후 공유 화면을 코드와 함께 열기
  useEffect(() => {
    if (!uid) return;
    const code = normalizeCode(window.location.search);
    if (!code) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    setSheet({ kind: 'share', code });
  }, [uid]);
  // 새 내역의 기본 "누가": 특정 사람 보기 중이면 그 사람, 아니면 이 기기의 사람
  const formDefaultMember = whoValid !== 'all' && whoValid !== SHARED ? whoValid : meId;
  const defaultDate = isCurrentMonth(ym) ? todayStr() : `${ym.y}-${pad(ym.m)}-01`;
  // 앱을 켜 둔 채 달이 바뀌면(자정): 이번 달을 보고 있었다면 새 달로 넘어감 (지난달을 일부러 보던 중이면 그대로)
  const curMonthKey = todayStr().slice(0, 7);
  const lastMonthKey = useRef(curMonthKey);
  useEffect(() => {
    if (lastMonthKey.current === curMonthKey) return;
    const was = lastMonthKey.current;
    lastMonthKey.current = curMonthKey;
    if (ymKey(ym.y, ym.m) === was) setYm(thisMonth());
  }, [curMonthKey, ym]);

  // 알림을 누르면 해당 페이지로 (앱 안 배너, 또는 서비스워커가 보낸 메시지)
  const openNotified = (url) => {
    const u = String(url || '');
    const txId = new URLSearchParams(u.split('?')[1]?.split('#')[0] || '').get('tx');
    // 장보기 알림 → 장보기, 월간 리포트 → 리포트, 새 내역·댓글 → 내역
    changePage(u.includes('#shopping') ? 'shopping' : u.includes('#report') ? 'report' : 'list');
    if (txId) setSheet({ kind: 'edit', id: txId }); // 댓글 알림 → 그 내역 열기
  };
  const openNotifiedRef = useRef(openNotified);
  openNotifiedRef.current = openNotified;
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return undefined;
    const onMsg = (e) => { if (e.data?.type === 'navigate') openNotifiedRef.current(e.data.url); };
    sw.addEventListener('message', onMsg);
    return () => sw.removeEventListener('message', onMsg);
  }, []);

  // ---- 키보드 ←/→ 로 달 이동 ----
  useEffect(() => {
    const onKey = (e) => {
      if (sheet || !['ledger', 'list'].includes(pageRef.current) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      if (e.key === 'ArrowLeft') setYm(prevMonth);
      if (e.key === 'ArrowRight') setYm(nextMonth);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);

  // ---- 동작 ----
  // 저장은 기기에 먼저 기록되고 화면에 바로 보이므로, 서버 응답을 기다리지 않고 시트를 닫음
  const saveTx = (id, data, isEdit, opts) => {
    closeSheet();
    const [y, m] = data.date.split('-').map(Number);
    if (y !== ym.y || m !== ym.m) setYm({ y, m });
    const label = isEdit ? '수정했어요' : `${data.type === 'income' ? '수입' : '지출'} ${won(data.amount)} 저장`;
    ledger.saveTx(id, data, opts)
      .then(({ synced }) => show(label + savedSuffix(synced, navigator.onLine !== false)))
      .catch(fail('저장하지 못했어요'));
  };

  // 새 내역 저장. "🔁 매달 반복"을 켰으면 반복 규칙도 함께 (이번 내역 = 그 달 몫이라 ID를 반복 내역 형식으로)
  const addTx = (data, { repeat } = {}) => {
    if (!repeat || ledger.recurring.length >= MAX_RECURRING) { saveTx(newId(), data, false); return; }
    closeSheet();
    const [y, m] = data.date.split('-').map(Number);
    if (y !== ym.y || m !== ym.m) setYm({ y, m });
    const rule = ruleFromTx(data, newId());
    Promise.all([
      ledger.saveTx(recurringTxId(rule.id, data.date.slice(0, 7)), data),
      ledger.saveSetting('recurring', [...ledger.recurring, rule]),
    ])
      .then(([a, b]) => show(`${data.type === 'income' ? '수입' : '지출'} ${won(data.amount)} 저장 · 🔁 매달 ${rule.day}일 반복 등록`
        + savedSuffix(a.synced && b.synced, navigator.onLine !== false)))
      .catch(fail('저장하지 못했어요'));
  };

  // 내역 수정. "🔁 매달 반복"을 새로 켜면 이 내역을 첫 달로 하는 규칙을 만들고, 끄면 연결된 규칙을 지움
  // (이미 기록된 내역은 그대로, 다음 달부터 기록 안 됨)
  const editTx = (id, data, { repeat } = {}) => {
    const rule = ruleOfTx(ledger.recurring, id);
    const opts = { base: editBaseOf(id) }; // 수정 창을 열 때 본 버전 → 그사이 다른 기기가 고쳤으면 알림 (017)
    if (!!rule === !!repeat) { saveTx(id, data, true, opts); return; }
    if (!rule && ledger.recurring.length >= MAX_RECURRING) { saveTx(id, data, true, opts); return; }
    closeSheet();
    const [y, m] = data.date.split('-').map(Number);
    if (y !== ym.y || m !== ym.m) setYm({ y, m });
    const next = rule ? ledger.recurring.filter((r) => r.id !== rule.id) : [...ledger.recurring, ruleFromTx(data, newId(), id)];
    const msg = rule ? '수정했어요 · 🔁 반복 해제 (기록된 내역은 그대로)' : `수정했어요 · 🔁 매달 ${Number(data.date.slice(8, 10))}일 반복 등록`;
    Promise.all([ledger.saveTx(id, data, opts), ledger.saveSetting('recurring', next)])
      .then(([a, b]) => show(msg + savedSuffix(a.synced && b.synced, navigator.onLine !== false)))
      .catch(fail('저장하지 못했어요'));
  };
  const isRepeatTx = useMemo(() => repeatMarker(ledger.recurring), [ledger.recurring]);

  // ---- 장보기 ----
  const shopItems = ledger.items;
  const shopSummary = useMemo(() => summarizeShopping(Object.values(shopItems)), [shopItems]);
  const changePage = (p) => {
    setPage(p);
    setSheet(null);
    // 시트가 열려 있었으면 그 기록 자리를 새 탭 주소로 바꿈 (닫을 때 되돌리다 탭 이동이 취소되지 않게)
    const how = sheetEntry.current ? 'replaceState' : 'pushState';
    sheetEntry.current = false;
    if (p !== 'ledger') window.history[how](null, '', `${window.location.pathname}#${p}`);
    else window.history[how](null, '', window.location.pathname);
    window.scrollTo(0, 0);
  };
  const shop = {
    // 빠른 추가: 살 것 목록에 같은 이름(띄어쓰기·대소문자 무시)이 이미 있으면 새로 만들지 않고 수량 +1
    add: (data) => {
      const key = normalizeName(data.name);
      const dup = Object.entries(shopItems).find(([, i]) => i.status === 'todo' && normalizeName(i.name) === key);
      if (dup && dup[1].qty < MAX_QTY) {
        const [id, it] = dup;
        const qty = Math.min(MAX_QTY, it.qty + (data.qty || 1));
        return notifySaved(ledger.saveItem(id, { ...it, qty }), `${it.name} 수량을 ${qty}개로 늘렸어요`);
      }
      return notifySaved(ledger.saveItem(newId(), data), `${data.name} 추가했어요`);
    },
    open: (id) => setSheet({ kind: 'item', id }),
    openNew: (prefill) => setSheet({ kind: 'item', prefill }),
    toggle: (id) => {
      const it = shopItems[id];
      if (it) ledger.saveItem(id, { ...it, checked: !it.checked }).catch(fail('저장하지 못했어요'));
    },
    remove: (id) => {
      const it = shopItems[id];
      closeSheet();
      ledger.deleteItems([id])
        .then(() => show(`${it?.name || '물품'} 삭제했어요`, it ? () => ledger.saveItem(id, it).catch(() => {}) : undefined))
        .catch(fail('삭제하지 못했어요'));
    },
    confirm: () => setSheet({ kind: 'purchase' }),
    rebuy: (list) => notifySaved(ledger.updateItems(list.map((i, k) => ({
      id: newId(),
      data: { name: i.name, qty: i.qty, price: i.price, category: i.category, memberId: i.memberId ?? null, memo: i.memo || '',
        checked: false, status: 'todo', paid: null, txId: null, boughtAt: null, createdAt: Date.now() + k },
    }))), `${list.length}개를 살 것에 다시 넣었어요`),
    removeHistory: (ids) => notifySaved(ledger.deleteItems(ids), '구매 기록을 지웠어요'),
  };
  const saveShopItem = (id, data) => { closeSheet(); notifySaved(ledger.saveItem(id, data), id in shopItems ? '수정했어요' : `${data.name} 추가했어요`); };
  const confirmPurchase = (cartIds, opts) => {
    closeSheet();
    ledger.confirmPurchase(cartIds, opts)
      .then(({ synced, count }) => show(`가계부에 ${count}건 기록했어요` + savedSuffix(synced, navigator.onLine !== false)))
      .catch(fail('기록하지 못했어요'));
  };

  const deleteTx = (id) => {
    const base = editBaseOf(id);
    closeSheet();
    ledger.deleteTx(id, { base })
      .then(({ prev, synced }) => {
        // 되돌리기 = 같은 ID로 다시 저장 → 서버에 두 줄이 생기지 않음.
        // 그사이 연 다른 입력 창을 닫거나 보던 달을 바꾸지 않게 saveTx(창 닫기·달 이동 포함) 대신 바로 저장
        const undo = prev ? () => ledger.saveTx(id, prev)
          .then(({ synced: s }) => show('되돌렸어요' + savedSuffix(s, navigator.onLine !== false)))
          .catch(fail('되돌리지 못했어요')) : undefined;
        show('삭제했어요' + savedSuffix(synced, navigator.onLine !== false), undo);
      })
      .catch(fail('삭제하지 못했어요'));
  };

  // ---- 즐겨찾기 ----
  // 금액이 정해진 즐겨찾기 → 오늘 날짜로 바로 저장(되돌리기 가능), 금액 매번 입력 → 입력창 열기
  const applyFavorite = (f) => {
    if (!f.amount) { setSheet({ kind: 'add', prefill: f }); return; }
    const id = newId();
    const data = {
      type: f.type, amount: f.amount, category: f.category, memo: f.memo || '', date: todayStr(),
      // 사람이 정해진 즐겨찾기 → 그 사람, '공동' 묶음(사람 없음·지운 사람) → 공동 (화면의 묶음과 같게)
      memberId: f.memberId && members.some((m) => m.id === f.memberId) ? f.memberId : null,
      // 수입에는 카드 없음 (TxForm 과 같은 규칙)
      tags: f.tags || [], cardId: f.type === 'expense' && f.cardId && ledger.cards.some((c) => c.id === f.cardId) ? f.cardId : null, inst: 1, createdAt: Date.now(),
    };
    if (!isCurrentMonth(ym)) setYm(thisMonth());
    ledger.saveTx(id, data)
      .then(({ synced }) => show(`⭐ ${f.label} ${won(f.amount)} 저장${savedSuffix(synced, navigator.onLine !== false)}`,
        () => ledger.deleteTx(id).then(() => show('되돌렸어요')).catch(() => {})))
      .catch(fail('저장하지 못했어요'));
  };
  const saveFavorites = (...a) => withUndo('favorites')(...a); // withUndo 는 아래에 정의
  const favoriteFromTx = (t) => {
    if (ledger.favorites.length >= 20) { show('즐겨찾기는 20개까지 만들 수 있어요'); return; }
    // 긴 메모(링크·이모지 포함)를 16자로 자를 때 이모지를 반으로 자르지 않게 (반쪽 이모지는 서버가 거절)
    const label = clipText((t.memo || t.category).trim(), 16).trim() || clipText(t.category, 16);
    const fav = { id: newId().slice(0, 40), label, type: t.type, amount: t.amount, category: t.category, memo: t.memo || '',
      memberId: t.memberId ?? null, cardId: t.cardId ?? null, tags: t.tags || [] };
    saveFavorites([...ledger.favorites, fav], `"${label}" 즐겨찾기를 만들었어요`);
  };

  // ---- 구독 자동 발견 ----
  const subSuggestions = useMemo(
    () => detectSubscriptions(allTx, ledger.recurring, ledger.dismissedSubs),
    [allTx, ledger.recurring, ledger.dismissedSubs],
  );
  const registerSubscription = (sg) => {
    if (ledger.recurring.length >= MAX_RECURRING) { show(`반복 내역은 ${MAX_RECURRING}개까지 만들 수 있어요`); return; }
    const rule = ruleFromSuggestion(sg, newId().slice(0, 40));
    notifySaved(ledger.saveSetting('recurring', [...ledger.recurring, rule]), `"${sg.label}" 반복 내역으로 등록했어요 · ${suggestionStartText(rule)}`);
  };
  const dismissSubscription = (sg) => notifySaved(
    ledger.saveSetting('dismissedSubs', [...ledger.dismissedSubs.filter((k) => k !== sg.key), sg.key].slice(-100)),
    `"${sg.label}"은(는) 다시 제안하지 않을게요`,
  );

  // ---- 댓글 ----
  const myName = (members.find((m) => m.id === meId)?.name || (auth.user?.email || '나').split('@')[0]).slice(0, 20);
  const addComment = (txId, body) => comments.add(txId, body, myName)
    .catch((e) => { show(`댓글을 보내지 못했어요 · ${koError(e)}`); throw e; });
  const deleteComment = (id) => comments.remove(id).then(() => show('댓글을 지웠어요')).catch(fail('지우지 못했어요'));

  // 댓글 쓴 사람 이름: 보낸 이름(author_name)은 바꿔 보낼 수 있으므로 공유 참여자는 계정에 연결된 사람 이름(없으면 이메일 앞부분).
  // 가계부 주인·나·알 수 없는 계정은 보낸 이름 그대로
  const commentAuthor = (c) => {
    if (c.author === uid) return c.author_name;
    const p = household.people.find((x) => x.userId === c.author);
    if (!p || p.owner) return c.author_name;
    const person = p.personId && members.find((m) => m.id === p.personId)?.name;
    return person || (p.email ? p.email.split('@')[0] : c.author_name);
  };
  commentAuthorRef.current = commentAuthor;

  // ---- 변경 기록에서 되살리기 / 되돌리기 ----
  const restoreFromLog = async (e, kind) => {
    try {
      if (e.table_name === 'transactions') {
        const data = fromRow(e.before);
        if (!isValidTx(data)) { show('이 기록은 되돌릴 수 없어요'); return false; }
        const { synced } = await ledger.saveTx(e.row_id, data);
        show((kind === 'restore' ? '내역을 되살렸어요' : '수정 전으로 되돌렸어요') + savedSuffix(synced, navigator.onLine !== false));
      } else {
        const data = fromItemRow(e.before);
        if (!isValidItem(data)) { show('이 기록은 되돌릴 수 없어요'); return false; }
        const { synced } = await ledger.saveItem(e.row_id, data);
        show((kind === 'restore' ? '물품을 되살렸어요' : '수정 전으로 되돌렸어요') + savedSuffix(synced, navigator.onLine !== false));
      }
      return true;
    } catch (err) {
      show(`되돌리지 못했어요 · ${koError(err)}`);
      return false;
    }
  };

  // PC 오른쪽 '새 내역' 입력칸 (가계부·내역 페이지 공통)
  const sideForm = (
    <aside className="side-form card" aria-label="내역 추가">
      <h2 style={{ color: 'var(--ink)', fontSize: 16 }}>새 내역</h2>
      <TxForm key={`${ymKey(ym.y, ym.m)}-${meId}-${members.map((m) => m.id).join()}`} defaultDate={defaultDate}
        members={members} defaultMemberId={formDefaultMember} canRepeat={ledger.recurring.length < MAX_RECURRING} onSubmit={addTx} />
    </aside>
  );

  // 공통: 설정 저장 후 결과 알림
  const notifySaved = (p, msg, undo) => p
    .then(({ synced }) => show(msg + savedSuffix(synced, navigator.onLine !== false), undo))
    .catch(fail('저장하지 못했어요'));
  // 목록 설정에서 하나 지운 뒤 "되돌리기": 그사이 바뀐 최신 목록에 원래 자리로 다시 넣음
  const latestRef = useRef(ledger);
  latestRef.current = ledger;
  const undoRemove = (kind, item, index) => () => {
    const cur = latestRef.current[kind] || [];
    if (cur.some((x) => x.id === item.id)) return;
    const next = [...cur.slice(0, index), item, ...cur.slice(index)];
    notifySaved(ledger.saveSetting(kind, next), '되돌렸어요');
  };
  // onSave(list, msg, removed?) — removed: 지운 항목 하나 { item, index } → 되돌리기 버튼
  const withUndo = (kind) => (list, msg, removed) => notifySaved(ledger.saveSetting(kind, list), msg,
    removed ? undoRemove(kind, removed.item, removed.index) : undefined);

  // 반복 내역은 시트를 닫지 않고 바로바로 저장
  const saveCards = (list, msg) => notifySaved(ledger.saveSetting('cards', list), msg);
  const saveRecurring = withUndo('recurring');
  const saveCatBudgets = (value) => { closeSheet(); notifySaved(ledger.saveSetting('catBudgets', value), '카테고리별 예산을 저장했어요'); };
  const saveCategories = (cats, renames) => {
    // 상세 검색에서 고른 카테고리도 새 이름으로 (맞바꾸기도 한 번에)
    if (renames.length) {
      setSearchFilters((f) => {
        if (!f.categories.length) return f;
        const next = f.categories.flatMap((name) => {
          const rs = renames.filter((r) => r.from === name && (f.type === 'all' || r.type === f.type));
          if (!rs.length) return [name];
          return [...rs.map((r) => r.to), ...(f.type === 'all' && rs.length === 1 ? [name] : [])];
        });
        return { ...f, categories: [...new Set(next)] };
      });
    }
    closeSheet();
    notifySaved(ledger.saveCategories(cats, renames), renames.length ? '카테고리를 저장하고 기존 내역도 바꿨어요' : '카테고리를 저장했어요');
  };

  // 입력 폼에서 바로 카테고리 추가: 지금 목록 끝에 붙여 저장 (검사 실패 시 오류 문구를 돌려줌)
  const addCategory = (type, name, icon) => {
    const err = checkNewCategory(cats, type, name);
    if (err) return err;
    const next = { expense: [...cats.expense], income: [...cats.income] };
    next[type] = [...next[type], { name, icon: icon || '🏷️' }];
    // 받침 있으면 "을", 없으면(또는 한글이 아니면) "를"
    const code = name.charCodeAt(name.length - 1) - 0xac00;
    const josa = code >= 0 && code <= 11171 && code % 28 !== 0 ? '을' : '를';
    notifySaved(ledger.saveCategories(next, []), `카테고리 "${name}"${josa} 추가했어요`);
    return null;
  };

  const saveMembers = (list, me) => {
    closeSheet();
    if (meKey) setMe(meKey, me);
    setMeId(me);
    ledger.saveMembers(list)
      .then(({ synced }) => show('함께 쓰는 사람을 저장했어요' + savedSuffix(synced, navigator.onLine !== false)))
      .catch(fail('저장하지 못했어요'));
  };

  const saveBudget = (value) => {
    closeSheet();
    ledger.saveBudget(value)
      .then(({ synced }) => show((value ? '예산을 저장했어요' : '예산을 없앴어요') + savedSuffix(synced, navigator.onLine !== false)))
      .catch(fail('저장하지 못했어요'));
  };

  // 로그아웃: 공용 기기에 가계부가 남지 않도록 이 기기의 내역 캐시와 보낼 목록을 지움.
  // 아직 못 올린 내역이 있으면 먼저 확인.
  const doSignOut = async () => {
    closeSheet();
    // 이 기기의 웹 푸시 해제 (다음 사람이 이 기기를 써도 알림이 오지 않게). 오래 걸리면 기다리지 않음
    await Promise.race([disablePush().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    ledger.clearLocalData();
    // 공유 가계부를 보던 중이었다면 내 원래 가계부 캐시와 공유 상태 기억도 지움
    if (uid) { clearUserData(uid); writeHousehold(uid, null); }
    await auth.signOut();
  };
  // 회원 탈퇴가 끝난 뒤: 서버 데이터는 이미 지워졌으니 이 기기의 사본·알림·로그인도 정리
  const afterAccountDeleted = async () => {
    closeSheet();
    await Promise.race([disablePush().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    ledger.clearLocalData();
    if (uid) { clearUserData(uid); writeHousehold(uid, null); }
    try { localStorage.removeItem(`ledger.lastBackup.${ledgerId}`); } catch { /* 무시 */ }
    await Promise.resolve(auth.signOut()).catch(() => {});
  };
  const handleSignOut = () => {
    if (ledger.pendingCount > 0) setSheet({ kind: 'logout' });
    else doSignOut();
  };

  // ---- 화면 분기 ----
  const editing = sheet?.kind === 'edit' ? allTx.find((t) => t.id === sheet.id) : null;
  // 수정 중인 내역이 다른 기기에서 지워지면: 빈 시트가 열린 채로 남지 않게 닫고 알려줌
  const editGone = sheet?.kind === 'edit' && !editing && ledger.serverLoaded; // 서버에서 받은 뒤에만 (옛 캐시엔 없을 수 있음)
  useEffect(() => {
    if (!editGone) return;
    closeSheet();
    show('다른 기기에서 지워진 내역이에요');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editGone]);
  if (showPrivacy) return <ScreenBoundary><PrivacyPolicy onClose={closePrivacy} /></ScreenBoundary>;
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
    return <ScreenBoundary><NewPasswordScreen onDone={() => { auth.endRecovery(); show('비밀번호를 바꿨어요'); }} /></ScreenBoundary>;
  }
  if (!auth.user) return <ScreenBoundary><AuthScreen /></ScreenBoundary>;


  return (
    <CategoriesContext.Provider value={cats}>
    <CategoryActionsContext.Provider value={addCategory}>
    <FormDataContext.Provider value={formData}>
      <div className="app">
        <Header
          status={ledger.status}
          online={online}
          syncing={ledger.syncing}
          pending={ledger.pendingCount}
          email={auth.user.email}
          onSignOut={handleSignOut}
          onSync={ledger.syncNow}
          onMenu={() => setSheet({ kind: 'menu' })}
        />
        {appUpdate.available && (
          <div className="update-bar" role="status">
            <span>새 버전이 있어요{ledger.pendingCount ? ' · 못 보낸 내역은 이 기기에 그대로 남아요' : ''}</span>
            <button type="button" className="btn primary sm" onClick={() => window.location.reload()}>새로고침</button>
            <button type="button" className="linkbtn" aria-label="나중에" onClick={appUpdate.dismiss}>나중에</button>
          </div>
        )}

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
            <b>DB 업데이트가 필요해요.</b> Supabase SQL Editor에서 <code>supabase/{ledger.schemaNeed || '003'}_*.sql</code>부터
            아직 실행하지 않은 업데이트 파일을 번호 순서대로 실행해 주세요.
            그 전까지 새 기능에서 저장한 내용은 이 기기에 보관됐다가, 업데이트되면 자동으로 올라가요.
          </div>
        )}
        {ledger.storageFull && (
          <div className="notice show">
            기기 저장 공간이 부족해요. 지금 입력은 계속 할 수 있지만, 서버에 올라가기 전에 이 탭을 닫으면 사라질 수 있어요.
          </div>
        )}

        <NavTabs page={page} onChange={changePage} todoCount={shopSummary.todo - shopSummary.cart} cartCount={shopSummary.cart} />

        <ScreenBoundary key={page}>
        {page === 'shopping' ? (
          <ShoppingPage items={shopItems} members={members} defaultMemberId={meId} actions={shop} />
        ) : page === 'report' ? (
          <>
            <WhoFilter members={members} who={whoValid} onChange={setWho} />
            <ReportPage allTx={whoTx} year={reportYear} onYear={setReportYear} members={members} cards={ledger.cards}
              who={whoValid} whoLabel={whoLabel} onPickMonth={(m) => { setYm(m); changePage('ledger'); }} onOpenTx={(id) => setSheet({ kind: 'edit', id })} />
          </>
        ) : page === 'list' ? (
        <div className="layout">
          <main className="grid">
            <MonthBar
              ym={ym}
              onPrev={() => setYm(prevMonth)}
              onNext={() => setYm(nextMonth)}
              onToday={() => setYm(thisMonth())}
            />
            <WhoFilter members={members} who={whoValid} onChange={setWho} />
            <TxList
              isRepeat={isRepeatTx}
              members={members}
              items={viewTx}
              filter={filter}
              onFilter={setFilter}
              query={query}
              onQuery={setQuery}
              onOpen={(id) => setSheet({ kind: 'edit', id })}
              view={listView}
              onView={(v) => { setListView(v); setCalDay(null); }}
              ym={ym}
              day={calDay && calDay.startsWith(ymKey(ym.y, ym.m)) ? calDay : null}
              onDay={setCalDay}
              onSearch={() => setSheet({ kind: 'search' })}
              commentCounts={comments.counts}
            />
          </main>
          {sideForm}
        </div>
        ) : (
        <div className="layout">
          <main className="grid">
            <MonthBar
              ym={ym}
              onPrev={() => setYm(prevMonth)}
              onNext={() => setYm(nextMonth)}
              onToday={() => setYm(thisMonth())}
            />
            <WhoFilter members={members} who={whoValid} onChange={setWho} />
            <Summary inc={totals.inc} exp={totals.exp} cmp={monthCmp} who={whoLabel}
              monthLabel={isCurrentMonth(ym) ? '이번 달' : `${ym.y !== new Date().getFullYear() ? `${ym.y}년 ` : ''}${ym.m}월`} />
            <FavoritesBar favorites={ledger.favorites} members={members} meId={meId} onUse={applyFavorite} onManage={() => setSheet({ kind: 'favorites' })} />
            <section className="grid insights">
              <SubscriptionFinder suggestions={subSuggestions} onRegister={registerSubscription} onDismiss={dismissSubscription} />
              <BudgetCard budget={ledger.budget} exp={householdExp} ym={ym} onEdit={() => setSheet({ kind: 'budget' })}
                planned={isCurrentMonth(ym) ? upcomingThisMonth(ledger.recurring, new Date()).reduce((a, x) => a + x.rule.amount, 0) : 0}
                note={whoLabel ? '예산은 모두의 지출 합계 기준이에요.' : ''} />
              <CategoryDonut expenses={expenses} total={totals.exp} />
              <CategoryBudgetCard catBudgets={ledger.catBudgets} monthTx={monthTx} onEdit={() => setSheet({ kind: 'catBudgets' })}
                planned={isCurrentMonth(ym) ? upcomingThisMonth(ledger.recurring, new Date()).reduce((a, x) => ({ ...a, [x.rule.category]: (a[x.rule.category] || 0) + x.rule.amount }), {}) : {}} />
              <DailyChart list={viewTx} ym={ym} half />
              <MonthCompare allTx={whoTx} ym={ym} label={whoLabel} cmp={monthCmp} />
              <CardBills allTx={allTx} cards={ledger.cards} thisMonth={ledger.thisMonth} onManage={() => setSheet({ kind: 'cards' })} />
              <MonthlyTrend allTx={whoTx} ym={ym} onPick={setYm} label={whoLabel} />
              <MemberSummary list={monthTx} members={members} who={whoValid} onSelect={setWho}
                onManage={() => setSheet({ kind: 'members' })} />
            </section>
          </main>

          {sideForm}
        </div>
        )}
        </ScreenBoundary>
      </div>

      <button type="button" className={`fab ${page === 'shopping' ? 'fab-shop' : ''}`}
        onClick={() => setSheet({ kind: page === 'shopping' ? 'item' : 'add' })} aria-label={page === 'shopping' ? '물품 추가' : '내역 추가'}>
        <PlusIcon />
      </button>

      {sheet?.kind === 'item' && (
        <Sheet title={sheet.id ? '물품 수정' : '물품 추가'} onClose={closeSheet} guard>
          <ShopItemForm
            key={sheet.id || 'new'}
            initial={sheet.id ? shopItems[sheet.id] : null}
            lastPrices={shopLastPrices}
            prefill={sheet.prefill}
            members={members}
            defaultMemberId={meId}
            onSubmit={(d) => saveShopItem(sheet.id || newId(), d)}
            onDelete={sheet.id ? () => shop.remove(sheet.id) : undefined}
          />
        </Sheet>
      )}
      {sheet?.kind === 'purchase' && (() => {
        const cartItems = Object.entries(shopItems).filter(([, i]) => i.status === 'todo' && i.checked)
          .map(([id, i]) => ({ id, ...i })).sort((a, b) => a.createdAt - b.createdAt);
        return cartItems.length > 0 && (
          <Sheet title={`결제 확정 · ${cartItems.length}개`} onClose={closeSheet} guard>
            <PurchaseConfirm items={cartItems} members={members} defaultMemberId={meId}
              onConfirm={(opts) => confirmPurchase(cartItems.map((i) => i.id), opts)} />
          </Sheet>
        );
      })()}

      {sheet?.kind === 'add' && (
        <Sheet title="내역 추가" onClose={closeSheet} guard>
          <TxForm key={sheet.prefill?.id || 'new'} autoFocus defaultDate={sheet.prefill ? todayStr() : defaultDate} members={members}
            defaultMemberId={formDefaultMember} prefill={sheet.prefill} canRepeat={ledger.recurring.length < MAX_RECURRING} onSubmit={addTx} />
        </Sheet>
      )}
      {sheet?.kind === 'edit' && editing && (
        <Sheet title="내역 수정" onClose={closeSheet} guard>
          <TxForm
            key={editing.id}
            initial={editing}
            members={members}
            defaultDate={defaultDate}
            repeatRule={ruleOfTx(ledger.recurring, editing.id)}
            canRepeat={ledger.recurring.length < MAX_RECURRING}
            onSubmit={(d, o) => editTx(editing.id, d, o)}
            onDelete={() => deleteTx(editing.id)}
          />
          <button type="button" className="btn fav-add-btn" onClick={() => favoriteFromTx(editing)}>⭐ 즐겨찾기에 추가</button>
          <CommentThread comments={comments.byTx[editing.id] || []} uid={uid} supported={comments.supported} online={online} nameOf={commentAuthor}
            onAdd={(body) => addComment(editing.id, body)} onDelete={deleteComment} />
        </Sheet>
      )}
      {sheet?.kind === 'budget' && (
        <Sheet title="월 예산" onClose={closeSheet} guard>
          <BudgetForm budget={ledger.budget} onSave={saveBudget} />
        </Sheet>
      )}

      {sheet?.kind === 'menu' && (
        <Sheet title="설정" onClose={closeSheet}>
          <SettingsMenu onOpen={(kind) => setSheet({ kind })} backupDue={backupDue(ledgerId, allTx.length)}
            shared={household.joined || household.people.length > 1}
            counts={{ favorites: ledger.favorites.length, recurring: ledger.recurring.filter((r) => r.active).length, members: members.length, cards: ledger.cards.length, catBudgets: Object.keys(ledger.catBudgets).length }} />
        </Sheet>
      )}
      {sheet?.kind === 'recurring' && (
        <Sheet title="반복 내역" onClose={closeSheet} guard>
          <RecurringManager rules={ledger.recurring} members={members} meId={meId} onSave={saveRecurring} />
        </Sheet>
      )}
      {sheet?.kind === 'categories' && (
        <Sheet title="카테고리 편집" onClose={closeSheet} guard>
          <CategoryEditor counts={categoryCounts} onSave={saveCategories} />
        </Sheet>
      )}
      {sheet?.kind === 'catBudgets' && (
        <Sheet title="카테고리별 예산" onClose={closeSheet} guard>
          <CategoryBudgetForm catBudgets={ledger.catBudgets} monthTx={monthTx} onSave={saveCatBudgets} />
        </Sheet>
      )}
      {sheet?.kind === 'account' && (
        <Sheet title="계정·개인정보" onClose={closeSheet}>
          <AccountPanel email={auth.user.email} online={online}
            ownerWithOthers={household.isOwner && household.people.length > 1} joined={household.joined}
            onBackup={() => setSheet({ kind: 'backup' })} onShare={() => setSheet({ kind: 'share' })} onDeleted={afterAccountDeleted} />
        </Sheet>
      )}
      {sheet?.kind === 'backup' && (
        <Sheet title="백업·복원" onClose={closeSheet}>
          <BackupPanel ledger={ledger} ledgerId={ledgerId} online={online} onToast={show} />
        </Sheet>
      )}
      {sheet?.kind === 'export' && (
        <Sheet title="CSV 내보내기" onClose={closeSheet}>
          <ExportForm allTx={allTx} members={members} cards={ledger.cards} ym={ym} onDone={(n) => { closeSheet(); show(`${n}건을 CSV로 내려받았어요`); }} />
        </Sheet>
      )}

      {sheet?.kind === 'search' && (
        <Sheet title="상세 검색" onClose={closeSheet}>
          <AdvancedSearch allTx={allTx} members={members} cards={ledger.cards} tags={tagList}
            filters={searchFilters} onFilters={setSearchFilters} onOpen={(id) => setSheet({ kind: 'edit', id, back: 'search' })} />
        </Sheet>
      )}
      {sheet?.kind === 'share' && (
        <Sheet title="가계부 공유" onClose={closeSheet}>
          <SharePanel uid={uid} email={auth.user.email} household={household} members={members} pendingCount={ledger.pendingCount}
            initialCode={sheet.code} onToast={show}
            onChanged={async ({ personId }) => {
              const h = await household.refresh();
              if (h && personId) setMe(h.ledgerId !== uid ? `${uid}@${h.ledgerId}` : uid, personId);
              notifier.refreshPush();
            }} />
        </Sheet>
      )}
      {sheet?.kind === 'history' && (
        <Sheet title="변경 기록" onClose={closeSheet}>
          <ActivityLog ledgerId={ledgerId} uid={uid} people={household.people} members={members} cards={ledger.cards}
            tx={ledger.tx} items={ledger.items} online={online} onRestore={restoreFromLog} />
        </Sheet>
      )}
      {sheet?.kind === 'favorites' && (
        <Sheet title="즐겨찾기" onClose={closeSheet}>
          <FavoritesManager favorites={ledger.favorites} members={members} meId={meId} onSave={saveFavorites} />
        </Sheet>
      )}
      {sheet?.kind === 'notify' && notifier.prefs && (
        <Sheet title="알림" onClose={closeSheet}>
          <NotificationSettings uid={uid} ledgerId={ledgerId} prefs={notifier.prefs} onPrefs={notifier.setPrefs}
            onPushChange={notifier.refreshPush} onToast={show} />
        </Sheet>
      )}
      {sheet?.kind === 'cards' && (
        <Sheet title="신용카드" onClose={closeSheet}>
          <CardManager cards={ledger.cards} usage={cardUsage} onSave={saveCards} />
        </Sheet>
      )}

      {sheet?.kind === 'members' && (
        <Sheet title="함께 쓰는 사람" onClose={closeSheet} guard>
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

      <NotifyBanner banners={notifier.banners} onDismiss={notifier.dismiss} onOpen={openNotified} />
      <Toast toast={toast} onHide={hide} />
    </FormDataContext.Provider>
    </CategoryActionsContext.Provider>
    </CategoriesContext.Provider>
  );
}
