// X (旧Twitter) 共有用のヘルパー。Web Intent を使うので X API キーは不要（無料）。

const HASHTAG = '架空将棋';

export function siteUrl(): string {
  const configured = import.meta.env.VITE_SITE_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export function roomInviteUrl(roomCode: string): string {
  return `${siteUrl()}/?room=${encodeURIComponent(roomCode)}`;
}

/** X の投稿画面を新しいタブで開く */
export function openXShare(text: string, url: string = siteUrl()): void {
  const params = new URLSearchParams({ text, url, hashtags: HASHTAG });
  window.open(`https://x.com/intent/post?${params.toString()}`, '_blank', 'noopener,noreferrer');
}

/** URLの ?room=123456 を読み取る（招待リンクから来たとき用） */
export function readInviteRoomCode(): string | null {
  if (typeof window === 'undefined') return null;
  const code = new URLSearchParams(window.location.search).get('room');
  return code && /^\d{6}$/.test(code) ? code : null;
}

export function clearInviteParam(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('room')) return;
  url.searchParams.delete('room');
  window.history.replaceState(null, '', url.toString());
}
