export const CATEGORIES = {
  expense: [
    ['식비', '🍚'], ['카페·간식', '☕'], ['교통', '🚌'], ['주거·통신', '🏠'], ['생활용품', '🧴'], ['쇼핑', '🛍️'],
    ['의료·건강', '💊'], ['문화·여가', '🎬'], ['교육', '📚'], ['경조사', '🎁'], ['기타', '📦'],
  ],
  income: [['월급', '💼'], ['부수입', '💡'], ['용돈', '💌'], ['금융수입', '📈'], ['기타', '📦']],
};

const COLOR_VARS = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8', '--c9', '--c10', '--c11'];

export const iconOf = (type, category) =>
  (CATEGORIES[type].find((c) => c[0] === category) || ['', '📦'])[1];

export const colorOf = (category) => {
  if (category === '그 외') return 'var(--c11)';
  const i = CATEGORIES.expense.findIndex((c) => c[0] === category);
  return `var(${COLOR_VARS[i < 0 ? 10 : i]})`;
};
