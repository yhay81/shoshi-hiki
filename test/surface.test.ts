import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("product surface", () => {
  const worker = read("src/worker.tsx");
  const domain = read("src/domain/books.ts");
  const client = read("public/app.js");
  const css = read("public/styles.css");
  const migration = read("migrations/0001_telemetry.sql");
  const source = read("SOURCE.md");

  it("communicates through a card-catalogue visual system without oversized type", () => {
    expect(worker).toContain('class="catalogue-scene"');
    expect(worker).toContain('class="card-cabinet"');
    expect(worker).toContain('class="catalogue-card"');
    expect(worker).toContain('class="saved-drawer"');
    expect(client).toContain('card.className = "book-card"');
    expect(css.toLowerCase()).not.toContain("gradient");
    expect(css).not.toMatch(/h1\s*\{[^}]*font-size:\s*(?:[4-9]\d|[1-9]\d{2})px/su);
  });

  it("keeps search conditions and bibliographic identifiers out of telemetry and product URLs", () => {
    expect(worker).toContain('app.post("/api/search"');
    expect(worker).toContain('c.header("Cache-Control", "no-store")');
    expect(migration).not.toMatch(/query|isbn|bib|email|phone|advertising/iu);
    expect(migration).toContain("CHECK(event_name IN");
    expect(client).not.toMatch(/history\.(?:pushState|replaceState)|location\.search\s*=/u);
  });

  it("serializes official API calls and waits from response completion", () => {
    expect(worker).toContain("blockConcurrencyWhile");
    expect(worker).toContain('storage.get<number>("last_upstream_finished_at")');
    expect(worker).toContain('storage.put("last_upstream_finished_at", Date.now())');
    expect(worker).toContain("2000 - (Date.now() - lastFinishedAt)");
    expect(worker).not.toContain("last_upstream_at");
  });

  it("bounds official retrieval, XML processing, and destinations", () => {
    expect(domain).toContain('url.searchParams.set("cnt", "20")');
    expect(domain).toContain('url.searchParams.set("dpid", "iss-ndl-opac-national")');
    expect(domain).toContain('url.searchParams.set("mediatype", "books")');
    expect(domain).toContain("2_000_000");
    expect(domain).toContain("<!DOCTYPE|<!ENTITY");
    expect(domain).toContain('url.origin === "https://ndlsearch.ndl.go.jp"');
    expect(client).not.toContain("innerHTML");
    expect(worker).not.toContain("dangerouslySetInnerHTML");
  });

  it("states the official source, license, and transformation", () => {
    expect(source).toContain("国立国会図書館サーチ");
    expect(source).toContain("iss-ndl-opac-national");
    expect(source).toContain("クリエイティブ・コモンズ 表示 4.0 国際");
    expect(source).toContain("加工内容");
    expect(worker).toContain("国立国会図書館が作成した画面ではありません");
  });

  it("marks automated QA and uses local-only cards without authentication", () => {
    expect(client).toContain("navigator.webdriver === true");
    expect(client).toContain("localStorage");
    expect(client).toContain("saved.slice(0, 80)");
    expect(`${worker}\n${client}`).not.toMatch(/better-auth|betterAuth/iu);
  });
});
