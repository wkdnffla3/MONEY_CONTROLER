import { createContext, useContext } from 'react';

// 기본 카테고리 (사용자가 편집하기 전)
export const DEFAULT_CATEGORIES = {
  expense: [
    ['식비', '🍚'], ['카페·간식', '☕'], ['교통', '🚌'], ['주거·통신', '🏠'], ['생활용품', '🧴'], ['쇼핑', '🛍️'],
    ['의료·건강', '💊'], ['문화·여가', '🎬'], ['교육', '📚'], ['경조사', '🎁'], ['기타', '📦'],
  ].map(([name, icon]) => ({ name, icon })),
  income: [['월급', '💼'], ['부수입', '💡'], ['용돈', '💌'], ['금융수입', '📈'], ['기타', '📦']].map(([name, icon]) => ({ name, icon })),
};

export const MAX_CATEGORIES = 30;
export const MAX_CATEGORY_NAME = 20;

/** 저장된 사용자 카테고리(없으면 null) → 실제로 쓸 목록 */
export const resolveCategories = (custom) => custom || DEFAULT_CATEGORIES;

const COLOR_VARS = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8', '--c9', '--c10'];

export const CategoriesContext = createContext(DEFAULT_CATEGORIES);
export const useCategories = () => useContext(CategoriesContext);

/** 아이콘: 목록에 없는 이름(삭제된 카테고리)은 📦 */
export const iconOf = (cats, type, name) => (cats[type].find((c) => c.name === name) || { icon: '📦' }).icon;

/** 지출 카테고리 색: 목록 순서대로. 목록에 없거나 "그 외"는 회색 */
export const colorOf = (cats, name) => {
  const i = cats.expense.findIndex((c) => c.name === name);
  return i < 0 ? 'var(--c11)' : `var(${COLOR_VARS[i % COLOR_VARS.length]})`;
};
