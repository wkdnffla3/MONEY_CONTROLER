import { Component, Suspense } from 'react';
import { isChunkError } from '../lib/lazyScreens';

/** 화면을 불러오는 동안 / 못 불러왔을 때 (새 버전이 배포돼 예전 파일이 없어진 경우 등) */
class Catch extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    return (
      <div className="screen-error card" role="alert">
        <p>{chunk ? '새 버전이 나왔어요. 새로고침하면 바로 쓸 수 있어요.'
          : navigator.onLine === false ? '오프라인이라 이 화면을 불러오지 못했어요. 연결되면 다시 시도해 주세요.'
            : '화면을 불러오지 못했어요.'}</p>
        <button type="button" className="btn primary" onClick={() => (chunk ? window.location.reload() : this.setState({ error: null }))}>
          {chunk ? '새로고침' : '다시 시도'}
        </button>
      </div>
    );
  }
}

export function ScreenLoading() {
  return <div className="screen-loading" aria-busy="true" aria-label="불러오는 중"><span /><span /><span /></div>;
}

export default function ScreenBoundary({ children }) {
  return <Catch><Suspense fallback={<ScreenLoading />}>{children}</Suspense></Catch>;
}
