// ゲームの外向きの設定値。ここだけが本番と手元で変わる。
//
// 静的サイトなのでビルド時の環境変数は無い。代わりにこのファイルを «環境変数» として扱う。
// 空のままでも遊べる。ランキングは「準備中」と画面に出し、支援リンクは出さない。
// ダミーの URL を入れないのは、投げ銭が他人に飛んだり、存在しない API を叩き続けたりするから。
//
// RANKING_API_URL を入れたら、_headers の connect-src も同じオリジンにすること。
// 片方だけ変えると npm run check が落ちる（わざとそうしてある）。

// 例: 'https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com'（末尾スラッシュ無し）
export const RANKING_API_URL = 'https://5u0vzxhs2f.execute-api.ap-northeast-1.amazonaws.com';

// 例: 'https://buymeacoffee.com/<ユーザー名>'
export const SUPPORT_URL = '';
