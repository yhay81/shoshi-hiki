import { Hono } from "hono";
import type { Context } from "hono";
import { requestId } from "hono/request-id";

import {
  buildApiUrl,
  normalizeSearch,
  transformOpenSearchXml,
  validateSearch,
  type PublicBook,
} from "./domain/books";

export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  NDL_GATE: DurableObjectNamespace;
};
type Variables = { requestId: string };
type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
type SearchResult = { total: number; results: PublicBook[] };

class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 413 | 415 | 502 | 503,
  ) {
    super(code);
  }
}

const canonicalOrigin = "https://shoshi-hiki.yhay81.com";
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const telemetryNames = new Set([
  "visited",
  "searched",
  "no_result",
  "official_opened",
  "citation_copied",
  "saved",
  "returned",
]);
const nowSeconds = () => Math.floor(Date.now() / 1000);

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const enforceSameOrigin = (c: AppContext) => {
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") throw new ApiError("cross_site_request", 403);
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) throw new ApiError("cross_site_request", 403);
};

const parseJson = async (c: AppContext, maximumBytes = 1024) => {
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new ApiError("unsupported_media_type", 415);
  }
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes)
    throw new ApiError("payload_too_large", 413);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError("invalid_json", 400);
  }
};

const objectPayload = (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new ApiError("invalid_request", 400);
  return payload as Record<string, unknown>;
};

const recordEvent = async (c: AppContext, name: string) => {
  const session = (c.req.header("x-shoshi-session") ?? "").toLowerCase();
  if (!sessionPattern.test(session)) return;
  await c.env.DB.prepare(
    "INSERT INTO product_events (session_hash,event_name,is_qa,created_at) VALUES (?,?,?,?)",
  )
    .bind(await sha256(session), name, c.req.header("x-shoshi-qa") === "1" ? 1 : 0, nowSeconds())
    .run();
};

const Layout = ({
  canonical,
  children,
  description,
  noindex = false,
  title,
}: {
  canonical: string;
  children: unknown;
  description: string;
  noindex?: boolean;
  title: string;
}) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta content="width=device-width,initial-scale=1" name="viewport" />
      <title>{title}</title>
      <meta content={description} name="description" />
      {noindex ? <meta content="noindex,nofollow" name="robots" /> : null}
      <link href={canonical} rel="canonical" />
      <meta content="website" property="og:type" />
      <meta content="書誌引き" property="og:site_name" />
      <meta content={title} property="og:title" />
      <meta content={description} property="og:description" />
      <meta content={canonical} property="og:url" />
      <meta content={`${canonicalOrigin}/og.svg`} property="og:image" />
      <meta content="summary_large_image" name="twitter:card" />
      <meta content="#24394a" name="theme-color" />
      <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
      <link href="/manifest.webmanifest" rel="manifest" />
      <link href="/styles.css" rel="stylesheet" />
      <script defer src="/app.js" />
    </head>
    <body>
      <a class="skip-link" href="#main">
        本文へ
      </a>
      <header class="site-header">
        <a aria-label="書誌引き ホーム" class="wordmark" href="/">
          <span aria-hidden="true" class="mini-catalogue">
            <i />
            <i />
            <i />
          </span>
          <span>書誌引き</span>
        </a>
        <nav aria-label="案内">
          <a href="/guide">使い方</a>
          <a href="/source">出典</a>
          <a href="/privacy">保存</a>
        </nav>
      </header>
      {children}
      <footer class="site-footer">
        <span>国立国会図書館作成書誌 / NDLサーチAPI</span>
        <span>
          <a
            href="https://creativecommons.org/licenses/by/4.0/deed.ja"
            rel="license noopener noreferrer"
          >
            CC BY 4.0
          </a>
          <a href="https://ndlsearch.ndl.go.jp/" rel="noopener noreferrer">
            NDLサーチ
          </a>
        </span>
      </footer>
    </body>
  </html>
);

const CatalogueScene = () => (
  <div aria-hidden="true" class="catalogue-scene">
    <div class="book-stack">
      <i class="spine spine-a">913.6</i>
      <i class="spine spine-b">007</i>
      <i class="spine spine-c">289</i>
    </div>
    <div class="card-cabinet">
      <span class="drawer drawer-a">
        <i />
      </span>
      <span class="drawer drawer-b">
        <i />
      </span>
      <span class="drawer drawer-c">
        <i />
      </span>
      <span class="drawer drawer-d">
        <i />
      </span>
    </div>
    <div class="catalogue-card">
      <span class="card-rule" />
      <span class="card-title" />
      <span class="card-line line-a" />
      <span class="card-line line-b" />
      <span class="card-line line-c" />
      <span class="barcode">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  </div>
);

const SearchForm = () => (
  <form class="search-form" id="search-form" novalidate>
    <fieldset class="mode-tabs">
      <legend>探す項目</legend>
      <label>
        <input checked name="mode" type="radio" value="title" />
        <span>タイトル</span>
      </label>
      <label>
        <input name="mode" type="radio" value="creator" />
        <span>著者</span>
      </label>
      <label>
        <input name="mode" type="radio" value="isbn" />
        <span>ISBN</span>
      </label>
    </fieldset>
    <div class="query-line">
      <label for="query">探したい本</label>
      <div class="query-slot">
        <span aria-hidden="true" class="search-mark">
          書
        </span>
        <input
          autocomplete="off"
          id="query"
          maxlength={80}
          name="q"
          placeholder="こころ"
          required
          type="search"
        />
        <button type="submit">書誌を引く</button>
      </div>
    </div>
    <div class="refine-line" id="creator-refine">
      <label for="creator">
        著者で絞る <span>任意</span>
      </label>
      <input autocomplete="off" id="creator" maxlength={80} name="creator" placeholder="夏目漱石" />
    </div>
    <div class="examples" aria-label="検索例">
      <span>例</span>
      <button data-creator="夏目漱石" data-example="こころ" data-mode="title" type="button">
        こころ × 夏目漱石
      </button>
      <button data-example="夏目漱石" data-mode="creator" type="button">
        夏目漱石
      </button>
      <button data-example="9784101010014" data-mode="isbn" type="button">
        9784101010014
      </button>
    </div>
    <p class="search-status" id="search-status" role="status">
      タイトルに著者を添えると、目的の版を見つけやすくなります
    </p>
  </form>
);

const SavedDrawer = () => (
  <aside class="saved-drawer" aria-labelledby="saved-heading">
    <div class="drawer-handle">
      <i />
    </div>
    <header>
      <div>
        <p>この端末だけ</p>
        <h2 id="saved-heading">書誌カード箱</h2>
      </div>
      <strong id="saved-count">0</strong>
    </header>
    <div class="saved-stack" id="saved-stack">
      <p class="empty-saved">残した本が、ここにカードで並びます。</p>
    </div>
    <button class="clear-button" hidden id="clear-saved" type="button">
      カード箱を空にする
    </button>
  </aside>
);

const HomePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/`}
    description="タイトル・著者・ISBNから国立国会図書館の完成書誌を探し、公式記録と引用用の書誌情報を確認できます。登録不要。"
    title="書誌引き | 本の書誌情報を引く"
  >
    <main class="home" id="main">
      <section class="search-library" aria-labelledby="product-title">
        <div class="product-heading">
          <p class="eyebrow">日本全国書誌</p>
          <h1 id="product-title">本を、確かな一枚へ。</h1>
          <p>タイトル、著者、ISBNから、出版情報のカードを引き出せます。</p>
        </div>
        <CatalogueScene />
        <SearchForm />
      </section>
      <div class="source-ribbon">
        <span>国立国会図書館作成書誌</span>
        <span>図書に限定</span>
        <span>登録なし</span>
        <a href="/source">収録と出典</a>
      </div>
      <div class="work-area">
        <section class="results" aria-labelledby="results-heading">
          <div class="section-heading">
            <div>
              <p>検索結果</p>
              <h2 id="results-heading">書誌カード</h2>
            </div>
            <span id="result-count">未検索</span>
          </div>
          <div class="result-list" id="results">
            <div class="empty-result">
              <span class="empty-seal">書</span>
              <div>
                <h3>検索すると、書誌カードが並びます</h3>
                <p>著者、出版者、刊行年、ISBNを確認して公式記録へ進めます。</p>
              </div>
            </div>
          </div>
        </section>
        <SavedDrawer />
      </div>
    </main>
  </Layout>
);

const GuidePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/guide`}
    description="書誌引きで本の書誌情報を探し、コピー・保存する方法。"
    title="使い方 | 書誌引き"
  >
    <main class="content-page" id="main">
      <header class="content-heading">
        <span class="page-index">引</span>
        <div>
          <p>使い方</p>
          <h1>一枚のカードから公式記録へ</h1>
        </div>
      </header>
      <div class="instruction-grid">
        <section>
          <b>一</b>
          <h2>手がかりを選ぶ</h2>
          <p>タイトル、著者、ISBNのいずれかを選び、手元の情報を入れます。</p>
        </section>
        <section>
          <b>二</b>
          <h2>版を見分ける</h2>
          <p>出版者、刊行年、版表示、シリーズ、ISBNから目的の一冊を選びます。</p>
        </section>
        <section>
          <b>三</b>
          <h2>使う形にする</h2>
          <p>書誌情報をコピーするか、カード箱へ残し、必要なら公式記録で詳細を確かめます。</p>
        </section>
      </div>
      <a class="page-cta" href="/">
        書誌を引く
      </a>
    </main>
  </Layout>
);

const SourcePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/source`}
    description="書誌引きが利用する国立国会図書館サーチAPI、収録範囲、出典と加工の説明。"
    title="出典と収録 | 書誌引き"
  >
    <main class="content-page" id="main">
      <header class="content-heading">
        <span class="page-index">典</span>
        <div>
          <p>出典と収録</p>
          <h1>完成書誌を読みやすいカードに</h1>
        </div>
      </header>
      <div class="source-grid">
        <section class="source-ledger">
          <h2>出典</h2>
          <p>
            本サービスで提供するメタデータは、
            <a href="https://ndlsearch.ndl.go.jp/" rel="noopener noreferrer">
              国立国会図書館サーチ
            </a>
            のAPIから取得した国立国会図書館作成書誌に由来します。
          </p>
          <p>日本全国書誌のうち、作成が完了した図書の書誌を検索対象にします。</p>
        </section>
        <section class="source-ledger">
          <h2>利用条件</h2>
          <p>
            メタデータは
            <a
              href="https://creativecommons.org/licenses/by/4.0/deed.ja"
              rel="license noopener noreferrer"
            >
              クリエイティブ・コモンズ 表示 4.0 国際
            </a>
            に基づき利用します。
          </p>
          <p>国立国会図書館が作成した画面ではありません。</p>
        </section>
        <section class="source-ledger">
          <h2>表示の加工</h2>
          <p>
            タイトル、責任表示、出版者、刊行年、版、シリーズ、ページ数、識別子、分類を選択・整形し、最大20件のカードとして表示します。
          </p>
          <p>同条件は実行中メモリで15分再利用し、検索条件や応答は永続保存しません。</p>
        </section>
      </div>
    </main>
  </Layout>
);

const PrivacyPage = () => (
  <Layout
    canonical={`${canonicalOrigin}/privacy`}
    description="書誌引きの検索条件、書誌カード、匿名利用計測の保存範囲。"
    title="保存とプライバシー | 書誌引き"
  >
    <main class="content-page" id="main">
      <header class="content-heading">
        <span class="page-index">守</span>
        <div>
          <p>保存</p>
          <h1>探したことばは残さない</h1>
        </div>
      </header>
      <div class="privacy-grid">
        <section>
          <h2>検索</h2>
          <p>
            タイトル、著者、ISBNはURL、D1、利用計測へ保存しません。検索のため国立国会図書館サーチAPIへ送られます。
          </p>
        </section>
        <section>
          <h2>カード箱</h2>
          <p>
            残した書誌カードは、このブラウザのlocalStorageだけに最大80件保存します。アカウントやCookieは使いません。
          </p>
        </section>
        <section>
          <h2>利用計測</h2>
          <p>
            ランダム端末IDのハッシュ、許可済み操作名、QA判定、時刻だけを35日保持します。検索語、書誌ID、保存内容の列はありません。
          </p>
        </section>
      </div>
    </main>
  </Layout>
);

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
app.use("*", requestId());
app.use("*", async (c, next) => {
  await next();
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  );
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-Request-Id", c.get("requestId"));
});

app.get("/", (c) => {
  c.header("Cache-Control", "public,max-age=60,s-maxage=300");
  return c.html(<HomePage />);
});
app.get("/guide", (c) => c.html(<GuidePage />));
app.get("/source", (c) => c.html(<SourcePage />));
app.get("/privacy", (c) => c.html(<PrivacyPage />));

app.post("/api/search", async (c) => {
  enforceSameOrigin(c);
  const search = normalizeSearch(objectPayload(await parseJson(c)));
  const validationError = validateSearch(search);
  if (validationError) throw new ApiError(validationError, 400);
  const id = c.env.NDL_GATE.idFromName("official-api");
  const response = await c.env.NDL_GATE.get(id).fetch("https://gate.internal/search", {
    body: JSON.stringify(search),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok)
    throw new ApiError("official_api_unavailable", response.status === 503 ? 503 : 502);
  const result = await response.json<SearchResult>();
  await recordEvent(c, result.results.length ? "searched" : "no_result");
  c.header("Cache-Control", "no-store");
  return c.json(result);
});

app.post("/api/telemetry", async (c) => {
  enforceSameOrigin(c);
  const payload = objectPayload(await parseJson(c, 256));
  const name = typeof payload.name === "string" ? payload.name : "";
  if (!telemetryNames.has(name)) throw new ApiError("invalid_event", 400);
  await recordEvent(c, name);
  return c.body(null, 202);
});

app.get("/health", async (c) => {
  const database = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({
    api: "https://ndlsearch.ndl.go.jp/api/opensearch",
    ok: database?.ok === 1,
    service: "shoshi-hiki",
  });
});

app.get("/sitemap.xml", (c) => {
  const paths = ["/", "/guide", "/source", "/privacy"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${canonicalOrigin}${path}</loc></url>`).join("")}</urlset>`;
  c.header("Cache-Control", "public,max-age=3600,s-maxage=86400");
  c.header("Content-Type", "application/xml; charset=utf-8");
  return c.body(xml);
});

app.notFound((c) => {
  c.status(404);
  return c.html(
    <Layout
      canonical={`${canonicalOrigin}/404`}
      description="指定されたページは見つかりません。"
      noindex
      title="ページが見つかりません | 書誌引き"
    >
      <main class="not-found" id="main">
        <span>404</span>
        <h1>カードのないページです</h1>
        <p>検索机へ戻って、タイトル・著者・ISBNから探してください。</p>
        <a href="/">書誌を引く</a>
      </main>
    </Layout>,
  );
});

app.onError((error, c) => {
  if (error instanceof ApiError)
    return c.json({ error: error.code, requestId: c.get("requestId") }, error.status);
  console.error(
    "request_failed",
    c.get("requestId"),
    error instanceof Error ? error.message : "unknown",
  );
  return c.json({ error: "internal_error", requestId: c.get("requestId") }, 500);
});

export const scheduled = async (_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) => {
  await env.DB.prepare("DELETE FROM product_events WHERE created_at < ?")
    .bind(nowSeconds() - 35 * 86400)
    .run();
};

type MemoryEntry = { expiresAt: number; result: SearchResult };

export class NdlGate {
  private readonly cache = new Map<string, MemoryEntry>();
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request) {
    if (request.method !== "POST") return new Response("method_not_allowed", { status: 405 });
    return this.state.blockConcurrencyWhile(async () => {
      const search = normalizeSearch((await request.json()) as Record<string, unknown>);
      if (validateSearch(search))
        return Response.json({ error: "invalid_search" }, { status: 400 });
      const key = await sha256(JSON.stringify(search));
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return Response.json(cached.result);
      if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value ?? "");

      const lastFinishedAt =
        (await this.state.storage.get<number>("last_upstream_finished_at")) ?? 0;
      const waitMilliseconds = Math.max(0, 2000 - (Date.now() - lastFinishedAt));
      if (waitMilliseconds) await new Promise((resolve) => setTimeout(resolve, waitMilliseconds));

      let xml = "";
      try {
        const upstream = await fetch(buildApiUrl(search), {
          headers: {
            Accept: "application/rss+xml, application/xml;q=0.9",
            "User-Agent": "ShoshiHiki/1.0 (+https://github.com/yhay81/shoshi-hiki)",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(12_000),
        });
        if (!upstream.ok || !/xml|rss/iu.test(upstream.headers.get("content-type") ?? "")) {
          console.error("ndl_upstream_rejected", upstream.status);
          return Response.json({ error: "upstream_failed" }, { status: 503 });
        }
        xml = await upstream.text();
      } catch (error) {
        console.error("ndl_upstream_failed", error instanceof Error ? error.message : "unknown");
        return Response.json({ error: "upstream_failed" }, { status: 503 });
      } finally {
        await this.state.storage.put("last_upstream_finished_at", Date.now());
      }

      try {
        const result = transformOpenSearchXml(search, xml);
        this.cache.set(key, { expiresAt: Date.now() + 15 * 60 * 1000, result });
        return Response.json(result);
      } catch {
        return Response.json({ error: "invalid_upstream_response" }, { status: 503 });
      }
    });
  }
}

export { app };
export default { fetch: app.fetch, scheduled };
