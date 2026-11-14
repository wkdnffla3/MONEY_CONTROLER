import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { fromItemRow, fromRow, newId, useLedger } from './hooks/useLedger';
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
import TxForm from './components/TxForm';
import Sheet from './components/Sheet';
import Toast from './components/Toast';
import MemberSummary from './components/MemberSummary';
import WhoFilter from './components/WhoFilter';
import { SHARED, filterByOwner, findMember, getMe, setMe } from './lib/members';
import InstallBanner from './components/InstallBanner';
import { PlusIcon } from './components/Icons';
import { CategoryBudgetCard, CategoryBudgetForm } from './components/CategoryBudget';
import MonthlyTrend from './components/MonthlyTrend';
import SettingsMenu from './components/SettingsMenu';
import { CategoriesContext, CategoryActionsContext, checkNewCategory, resolveCategories } from './lib/categories';
import NavTabs from './components/NavTabs';
import { summarize as summarizeShopping } from './lib/shopping';
import { FormDataContext } from './lib/formData';
import { allTags, compareMonths, lastPrices as computeLastPrices } from './lib/analysis';
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
import { detectSubscriptions, ruleFromSuggestion } from './lib/subscriptions';
import { isValidItem, isValidTx } from './lib/outbox';
import { EMPTY_FILTERS } from './lib/searchFilters';
import { Lazy, prefetchScreens } from './lib/lazyScreens';
import ScreenBoundary from './components/ScreenBoundary';

// 첫 화면에 필요 없는 화면들: 필요할 때 불러옴 (lib/lazyScreens.js)
const {
  TxList, ReportPage, ShoppingPage, ShopItemForm, PurchaseConfirm, RecurringManager, CategoryEditor, ExportForm, CardManager,
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
  const ledger = useLedger(ledgerId, { onRemote: (n) => notifyRef.current?.(n), accountId: auth.user?.id, onForbidden: household.refresh });
  const notifier = useNotifier(auth.user?.id, ledger.members);
  // 내역 댓글 (다른 사람이 쓴 새 댓글은 알림으로)
  const comments = useComments(ledgerId, auth.user?.id, { onRemote: (n) => notifyRef.current?.(n) });
  notifyRef.current = notifier.notify;
  const { toast, show, hide } = useToast();

  const [ym, setYm] = useState(thisMonth);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [who, setWho] = useState('all'); // 보기 기준: 'all' | 'shared' | 사람 id
  const [meId, setMeId] = useState(null); // 이 기기를 쓰는 사람
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
  const saveTx = (id, data, isEdit) => {
    closeSheet();
    const [y, m] = data.date.split('-').map(Number);
    if (y !== ym.y || m !== ym.m) setYm({ y, m });
    const label = isEdit ? '수정했어요' : `${data.type === 'income' ? '수입' : '지출'} ${won(data.amount)} 저장`;
    ledger.saveTx(id, data)
      .then(({ synced }) => show(label + savedSuffix(synced, navigator.onLine !== false)))
      .catch((e) => show(`저장하지 못했어요 · ${koError(e)}`));
  };

  // ---- 장보기 ----
  const shopItems = ledger.items;
  const shopSummary = useMemo(() => summarizeShopping(Object.values(shopItems)), [shopItems]);
  const changePage = (p) => {
    setPage(p);
    setSheet(null);
    if (p !== 'ledger') window.history.pushState(null, '', `${window.location.pathname}#${p}`);
    else window.history.pushState(null, '', window.location.pathname);
    window.scrollTo(0, 0);
  };
  const shop = {
    add: (data) => notifySaved(ledger.saveItem(newId(), data), `${data.name} 추가했어요`),
    open: (id) => setSheet({ kind: 'item', id }),
    openNew: (prefill) => setSheet({ kind: 'item', prefill }),
    toggle: (id) => {
      const it = shopItems[id];
      if (it) ledger.saveItem(id, { ...it, checked: !it.checked }).catch((e) => show(`저장하지 못했어요 · ${koError(e)}`));
    },
    remove: (id) => {
      const it = shopItems[id];
      closeSheet();
      ledger.deleteItems([id])
        .then(() => show(`${it?.name || '물품'} 삭제했어요`, it ? () => ledger.saveItem(id, it).catch(() => {}) : undefined))
        .catch((e) => show(`삭제하지 못했어요 · ${koError(e)}`));
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
      .catch((e) => show(`기록하지 못했어요 · ${koError(e)}`));
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

  // ---- 즐겨찾기 ----
  // 금액이 정해진 즐겨찾기 → 오늘 날짜로 바로 저장(되돌리기 가능), 금액 매번 입력 → 입력창 열기
  const applyFavorite = (f) => {
    if (!f.amount) { setSheet({ kind: 'add', prefill: f }); return; }
    const id = newId();
    const data = {
      type: f.type, amount: f.amount, category: f.category, memo: f.memo || '', date: todayStr(),
      memberId: f.memberId && members.some((m) => m.id === f.memberId) ? f.memberId : (formDefaultMember ?? null),
      tags: f.tags || [], cardId: f.cardId && ledger.cards.some((c) => c.id === f.cardId) ? f.cardId : null, inst: 1, createdAt: Date.now(),
    };
    if (!isCurrentMonth(ym)) setYm(thisMonth());
    ledger.saveTx(id, data)
      .then(({ synced }) => show(`⭐ ${f.label} ${won(f.amount)} 저장${savedSuffix(synced, navigator.onLine !== false)}`,
        () => ledger.deleteTx(id).then(() => show('되돌렸어요')).catch(() => {})))
      .catch((e) => show(`저장하지 못했어요 · ${koError(e)}`));
  };
  const saveFavorites = (list, msg) => notifySaved(ledger.saveSetting('favorites', list), msg);
  const favoriteFromTx = (t) => {
    if (ledger.favorites.length >= 20) { show('즐겨찾기는 20개까지 만들 수 있어요'); return; }
    const label = (t.memo || t.category).trim().slice(0, 16) || t.category.slice(0, 16);
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
    if (ledger.recurring.length >= 50) { show('반복 내역은 50개까지 만들 수 있어요'); return; }
    const rule = ruleFromSuggestion(sg, newId().slice(0, 40));
    notifySaved(ledger.saveSetting('recurring', [...ledger.recurring, rule]), `"${sg.label}" 반복 내역으로 등록했어요 · 다음 달 ${rule.day}일부터 자동 기록`);
  };
  const dismissSubscription = (sg) => notifySaved(
    ledger.saveSetting('dismissedSubs', [...ledger.dismissedSubs.filter((k) => k !== sg.key), sg.key].slice(-100)),
    `"${sg.label}"은(는) 다시 제안하지 않을게요`,
  );

  // ---- 댓글 ----
  const myName = (members.find((m) => m.id === meId)?.name || (auth.user?.email || '나').split('@')[0]).slice(0, 20);
  const addComment = (txId, body) => comments.add(txId, body, myName)
    .catch((e) => { show(`댓글을 보내지 못했어요 · ${koError(e)}`); throw e; });
  const deleteComment = (id) => comments.remove(id).then(() => show('댓글을 지웠어요')).catch((e) => show(`지우지 못했어요 · ${koError(e)}`));

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
        members={members} defaultMemberId={formDefaultMember} onSubmit={(d) => saveTx(newId(), d, false)} />
    </aside>
  );

  // 공통: 설정 저장 후 결과 알림
  const notifySaved = (p, msg) => p
    .then(({ synced }) => show(msg + savedSuffix(synced, navigator.onLine !== false)))
    .catch((e) => show(`저장하지 못했어요 · ${koError(e)}`));

  // 반복 내역은 시트를 닫지 않고 바로바로 저장
  const saveCards = (list, msg) => notifySaved(ledger.saveSetting('cards', list), msg);
  const saveRecurring = (rules, msg) => notifySaved(ledger.saveSetting('recurring', rules), msg);
  const saveCatBudgets = (value) => { closeSheet(); notifySaved(ledger.saveSetting('catBudgets', value), '카테고리별 예산을 저장했어요'); };
  const saveCategories = (cats, renames) => {
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
    // 이 기기의 웹 푸시 해제 (다음 사람이 이 기기를 써도 알림이 오지 않게). 오래 걸리면 기다리지 않음
    await Promise.race([disablePush().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    ledger.clearLocalData();
    // 공유 가계부를 보던 중이었다면 내 원래 가계부 캐시와 공유 상태 기억도 지움
    if (uid) { clearUserData(uid); writeHousehold(uid, null); }
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
    return <ScreenBoundary><NewPasswordScreen onDone={() => { auth.endRecovery(); show('비밀번호를 바꿨어요'); }} /></ScreenBoundary>;
  }
  if (!auth.user) return <ScreenBoundary><AuthScreen /></ScreenBoundary>;

  const editing = sheet?.kind === 'edit' ? allTx.find((t) => t.id === sheet.id) : null;

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
              who={whoValid} whoLabel={whoLabel} onPickMonth={(m) => { setYm(m); changePage('ledger'); }} />
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
            <Summary inc={totals.inc} exp={totals.exp} cmp={monthCmp} who={whoLabel} />
            <FavoritesBar favorites={ledger.favorites} onUse={applyFavorite} onManage={() => setSheet({ kind: 'favorites' })} />
            <section className="grid insights">
              <SubscriptionFinder suggestions={subSuggestions} onRegister={registerSubscription} onDismiss={dismissSubscription} />
              <BudgetCard budget={ledger.budget} exp={householdExp} ym={ym} onEdit={() => setSheet({ kind: 'budget' })}
                note={whoLabel ? '예산은 모두의 지출 합계 기준이에요.' : ''} />
              <CategoryDonut expenses={expenses} total={totals.exp} />
              <CategoryBudgetCard catBudgets={ledger.catBudgets} monthTx={monthTx} onEdit={() => setSheet({ kind: 'catBudgets' })} />
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
        <Sheet title={sheet.id ? '물품 수정' : '물품 추가'} onClose={closeSheet}>
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
          <Sheet title={`결제 확정 · ${cartItems.length}개`} onClose={closeSheet}>
            <PurchaseConfirm items={cartItems} members={members} defaultMemberId={meId}
              onConfirm={(opts) => confirmPurchase(cartItems.map((i) => i.id), opts)} />
          </Sheet>
        );
      })()}

      {sheet?.kind === 'add' && (
        <Sheet title="내역 추가" onClose={closeSheet}>
          <TxForm key={sheet.prefill?.id || 'new'} autoFocus defaultDate={sheet.prefill ? todayStr() : defaultDate} members={members}
            defaultMemberId={formDefaultMember} prefill={sheet.prefill} onSubmit={(d) => saveTx(newId(), d, false)} />
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
          <button type="button" className="btn fav-add-btn" onClick={() => favoriteFromTx(editing)}>⭐ 즐겨찾기에 추가</button>
          <CommentThread comments={comments.byTx[editing.id] || []} uid={uid} supported={comments.supported} online={online}
            onAdd={(body) => addComment(editing.id, body)} onDelete={deleteComment} />
        </Sheet>
      )}
      {sheet?.kind === 'budget' && (
        <Sheet title="월 예산" onClose={closeSheet}>
          <BudgetForm budget={ledger.budget} onSave={saveBudget} />
        </Sheet>
      )}

      {sheet?.kind === 'menu' && (
        <Sheet title="설정" onClose={closeSheet}>
          <SettingsMenu onOpen={(kind) => setSheet({ kind })}
            shared={household.joined || household.people.length > 1}
            counts={{ favorites: ledger.favorites.length, recurring: ledger.recurring.filter((r) => r.active).length, members: members.length, cards: ledger.cards.length, catBudgets: Object.keys(ledger.catBudgets).length }} />
        </Sheet>
      )}
      {sheet?.kind === 'recurring' && (
        <Sheet title="반복 내역" onClose={closeSheet}>
          <RecurringManager rules={ledger.recurring} members={members} onSave={saveRecurring} />
        </Sheet>
      )}
      {sheet?.kind === 'categories' && (
        <Sheet title="카테고리 편집" onClose={closeSheet}>
          <CategoryEditor counts={categoryCounts} onSave={saveCategories} />
        </Sheet>
      )}
      {sheet?.kind === 'catBudgets' && (
        <Sheet title="카테고리별 예산" onClose={closeSheet}>
          <CategoryBudgetForm catBudgets={ledger.catBudgets} monthTx={monthTx} onSave={saveCatBudgets} />
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
          <FavoritesManager favorites={ledger.favorites} members={members} onSave={saveFavorites} />
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

      <NotifyBanner banners={notifier.banners} onDismiss={notifier.dismiss} onOpen={openNotified} />
      <Toast toast={toast} onHide={hide} />
    </FormDataContext.Provider>
    </CategoryActionsContext.Provider>
    </CategoriesContext.Provider>
  );
}
