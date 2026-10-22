// 緊急スイッチ（Vercel の環境変数で切り替え。変更後に再デプロイすると反映される）
//   FEATURE_AI_GENERATION=off   … AI生成を止める（キャッシュ・近い単語・簡易生成で動き続ける）
//   FEATURE_ONLINE_MATCH=off    … オンライン対戦の新規開始を止める（CPU戦・対面戦は遊べる）
//   SITE_NOTICE=...             … トップ画面に出すお知らせ（混雑・メンテナンスなど）
export interface FeatureFlags {
  aiGeneration: boolean;
  onlineMatch: boolean;
  notice: string;
}

const isOff = (v: string | undefined) => ['off', 'false', '0'].includes((v || '').trim().toLowerCase());

export function featureFlags(): FeatureFlags {
  return {
    aiGeneration: !isOff(process.env.FEATURE_AI_GENERATION),
    onlineMatch: !isOff(process.env.FEATURE_ONLINE_MATCH),
    notice: (process.env.SITE_NOTICE || '').slice(0, 200),
  };
}
