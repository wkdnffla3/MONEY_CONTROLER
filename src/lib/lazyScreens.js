// 첫 화면(가계부 요약)에 필요 없는 화면은 필요할 때 불러옴 → 첫 로딩 파일이 작아져 빨리 뜸.
// 앱이 한가해지면 미리 받아 두어서(서비스워커가 저장) 오프라인에서도 열림.
import { lazy } from 'react';

const loaders = {
  TxList: () => import('../components/TxList'),
  ReportPage: () => import('../components/ReportPage'),
  ShoppingPage: () => import('../components/ShoppingPage'),
  ShopItemForm: () => import('../components/ShopItemForm'),
  PurchaseConfirm: () => import('../components/PurchaseConfirm'),
  RecurringManager: () => import('../components/RecurringManager'),
  CategoryEditor: () => import('../components/CategoryEditor'),
  ExportForm: () => import('../components/ExportForm'),
  CardManager: () => import('../components/CardManager'),
  AdvancedSearch: () => import('../components/AdvancedSearch'),
  NotificationSettings: () => import('../components/NotificationSettings'),
  SharePanel: () => import('../components/SharePanel'),
  FavoritesManager: () => import('../components/FavoritesManager'),
  ActivityLog: () => import('../components/ActivityLog'),
  MembersForm: () => import('../components/MembersForm'),
  BudgetForm: () => import('../components/BudgetForm'),
  AuthScreen: () => import('../components/AuthScreen').then((m) => ({ default: m.AuthScreen })),
  NewPasswordScreen: () => import('../components/AuthScreen').then((m) => ({ default: m.NewPasswordScreen })),
};

export const Lazy = Object.fromEntries(Object.entries(loaders).map(([name, load]) => [name, lazy(load)]));

let prefetched = false;
/** 나머지 화면 미리 받기 (한가할 때, 한 번만) */
export function prefetchScreens() {
  if (prefetched) return;
  prefetched = true;
  const run = () => { for (const load of Object.values(loaders)) load().catch(() => {}); };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2000);
}

/** 새 버전 배포 뒤 예전 화면 파일을 못 찾는 오류인지 */
export const isChunkError = (e) => /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i
  .test(String(e?.message || e || ''));
