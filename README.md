# 書誌引き

タイトル・著者・ISBNから国立国会図書館の完成書誌を探し、公式記録と引用用の書誌情報へ進む日本語サービスです。

- Production: <https://shoshi-hiki.yhay81.com>
- Source and processing: [SOURCE.md](SOURCE.md)
- Privacy: [PRIVACY.md](PRIVACY.md)

## Development

```powershell
npm install
npm run check
npm test
npm run build
```

Cloudflare Workers、Hono JSX、Vite+、D1、Durable Objectsで動作します。アカウント機能はありません。

## Release

```powershell
npx wrangler d1 migrations apply shoshi-hiki --remote
npm run deploy
npm run indexnow
npm run metrics
```
