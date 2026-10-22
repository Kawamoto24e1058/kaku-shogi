import React from 'react';

interface State {
  error: Error | null;
}

/**
 * 想定外のエラーで画面全体が真っ白になるのを防ぐ。
 * AIが作った駒のデータは毎回違うため、どこかで例外が起きても「やり直す」手段を必ず残す。
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[app] crashed:', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private resetAndReload = () => {
    try {
      // 対局の再開情報だけ消す（作った駒のキャッシュは残す）
      sessionStorage.removeItem('kaku_online_resume');
    } catch {
      // 保存領域が使えない環境では何もしない
    }
    window.location.href = window.location.pathname;
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#f6f1e7' }}>
        <div style={{ maxWidth: '420px', width: '100%', background: '#fffdf9', border: '1px solid rgba(139, 92, 26, 0.25)', borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '8px' }}>問題が発生しました</h1>
          <p style={{ fontSize: '13px', lineHeight: 1.7, color: '#4b4136', marginBottom: '16px' }}>
            申し訳ありません。予期しないエラーで画面を表示できなくなりました。<br />
            もう一度読み込むと、続きから遊べることがあります。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button type="button" onClick={this.reload} style={{ padding: '12px', borderRadius: '10px', border: 'none', background: '#78350f', color: '#fff', fontWeight: 700 }}>
              もう一度読み込む
            </button>
            <button type="button" onClick={this.resetAndReload} style={{ padding: '12px', borderRadius: '10px', border: '1px solid rgba(139, 92, 26, 0.3)', background: '#fff', color: '#78350f', fontWeight: 700 }}>
              最初の画面に戻る
            </button>
          </div>
        </div>
      </div>
    );
  }
}
