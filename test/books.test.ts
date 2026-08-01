import { describe, expect, it } from "vitest";

import {
  buildApiUrl,
  isValidIsbn,
  normalizeIsbn,
  normalizeSearch,
  transformOpenSearchXml,
  validateSearch,
} from "../src/domain/books";

const item = ({
  id = "R100000002-I000007305653",
  title = "吾輩は猫である",
  creator = "夏目, 漱石, 1867-1916",
  isbn = "4-10-101001-3",
}: {
  id?: string;
  title?: string;
  creator?: string;
  isbn?: string;
} = {}) => `<item>
  <title>${title}</title>
  <link>https://ndlsearch.ndl.go.jp/books/${id}</link>
  <dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${title}</dc:title>
  <dcndl:titleTranscription xmlns:dcndl="http://ndl.go.jp/dcndl/terms/">ワガハイ ワ ネコ デ アル</dcndl:titleTranscription>
  <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">${creator}</dc:creator>
  <dcndl:creatorTranscription xmlns:dcndl="http://ndl.go.jp/dcndl/terms/">ナツメ, ソウセキ</dcndl:creatorTranscription>
  <dcndl:edition xmlns:dcndl="http://ndl.go.jp/dcndl/terms/">改版</dcndl:edition>
  <dcndl:seriesTitle xmlns:dcndl="http://ndl.go.jp/dcndl/terms/">新潮文庫</dcndl:seriesTitle>
  <dc:publisher xmlns:dc="http://purl.org/dc/elements/1.1/">新潮社</dc:publisher>
  <dcterms:issued xmlns:dcterms="http://purl.org/dc/terms/">2003.6</dcterms:issued>
  <dc:extent xmlns:dc="http://purl.org/dc/elements/1.1/">610p</dc:extent>
  <dc:identifier xsi:type="dcndl:ISBN" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dc="http://purl.org/dc/elements/1.1/">${isbn}</dc:identifier>
  <dc:identifier xsi:type="dcndl:NDLBibID" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dc="http://purl.org/dc/elements/1.1/">000007305653</dc:identifier>
  <dc:identifier xsi:type="dcndl:JPNO" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dc="http://purl.org/dc/elements/1.1/">20570720</dc:identifier>
  <dc:subject xsi:type="dcndl:NDC9" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dc="http://purl.org/dc/elements/1.1/">913.6</dc:subject>
</item>`;

const feed = (items: string, total = 1) => `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:openSearch="http://a9.com/-/spec/opensearch/1.1/" version="2.0"><channel>
  <openSearch:totalResults>${total}</openSearch:totalResults>${items}
</channel></rss>`;

describe("bibliographic search domain", () => {
  it("normalizes modes, Japanese text, and ISBN punctuation", () => {
    expect(normalizeSearch({ mode: "creator", q: "  夏目　 漱石  " })).toEqual({
      creator: "",
      mode: "creator",
      q: "夏目 漱石",
    });
    expect(normalizeSearch({ mode: "isbn", q: "ISBN 978-4-10-101001-4" })).toEqual({
      creator: "",
      mode: "isbn",
      q: "9784101010014",
    });
    expect(normalizeSearch({ mode: "other", q: " こころ " }).mode).toBe("title");
  });

  it("validates ISBN-10 and ISBN-13 checksums", () => {
    expect(normalizeIsbn("4-10-101001-3")).toBe("4101010013");
    expect(isValidIsbn("4101010013")).toBe(true);
    expect(isValidIsbn("9784101010014")).toBe(true);
    expect(isValidIsbn("9784101010015")).toBe(false);
    expect(validateSearch(normalizeSearch({ mode: "isbn", q: "9784101010015" }))).toBe(
      "invalid_isbn",
    );
  });

  it("requires useful title and creator queries", () => {
    expect(validateSearch(normalizeSearch({ mode: "title", q: "本" }))).toBe("query_too_short");
    expect(validateSearch(normalizeSearch({ mode: "creator", q: "漱石" }))).toBe("");
  });

  it("builds a bounded request for only completed NDL book records", () => {
    const url = buildApiUrl(normalizeSearch({ mode: "title", q: "こころ", creator: "夏目漱石" }));
    expect(url.origin).toBe("https://ndlsearch.ndl.go.jp");
    expect(url.pathname).toBe("/api/opensearch");
    expect(url.searchParams.get("dpid")).toBe("iss-ndl-opac-national");
    expect(url.searchParams.get("mediatype")).toBe("books");
    expect(url.searchParams.get("cnt")).toBe("20");
    expect(url.searchParams.get("title")).toBe("こころ");
    expect(url.searchParams.get("creator")).toBe("夏目漱石");
  });

  it("extracts bounded public metadata and derives ISBN-13", () => {
    const result = transformOpenSearchXml(
      normalizeSearch({ mode: "isbn", q: "9784101010014" }),
      feed(item()),
    );
    expect(result.total).toBe(1);
    expect(result.results[0]).toMatchObject({
      title: "吾輩は猫である",
      creators: ["夏目, 漱石, 1867-1916"],
      publishers: ["新潮社"],
      issued: "2003.6",
      isbns: ["4101010013", "9784101010014"],
      classifications: ["913.6"],
      officialUrl: "https://ndlsearch.ndl.go.jp/books/R100000002-I000007305653",
    });
    expect(result.results[0]).not.toHaveProperty("description");
  });

  it("moves exact title matches ahead within the official result set", () => {
    const result = transformOpenSearchXml(
      normalizeSearch({ mode: "title", q: "こころ" }),
      feed(
        item({ id: "R100000002-I000000000001", title: "近代文学館" }) +
          item({ id: "R100000002-I000000000002", title: "こころ" }),
        2,
      ),
    );
    expect(result.results.map((book) => book.title)).toEqual(["こころ", "近代文学館"]);
  });

  it("rejects DTDs and excludes destinations outside official book records", () => {
    expect(() =>
      transformOpenSearchXml(normalizeSearch({ q: "こころ" }), `<!DOCTYPE rss>${feed(item())}`),
    ).toThrow("unsafe_xml");
    const unsafe = item().replace(
      "https://ndlsearch.ndl.go.jp/books/R100000002-I000007305653",
      "https://example.com/books/R100000002-I000007305653",
    );
    expect(transformOpenSearchXml(normalizeSearch({ q: "こころ" }), feed(unsafe)).results).toEqual(
      [],
    );
  });
});
