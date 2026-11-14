import { createContext, useContext } from 'react';

/**
 * 입력 폼들이 함께 쓰는 보조 데이터: 등록한 카드, 지금까지 쓴 태그(추천용)
 * { cards: [...], tags: ['여행', ...] }
 */
export const FormDataContext = createContext({ cards: [], tags: [] });
export const useFormData = () => useContext(FormDataContext);
