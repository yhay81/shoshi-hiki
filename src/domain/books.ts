import { XMLParser, XMLValidator } from "fast-xml-parser";

export type SearchMode = "title" | "creator" | "isbn";
export type BookSearch = { mode: SearchMode; q: string; creator: string };

export type PublicBook = {
  id: string;
  title: string;
  titleReading: string;
  creators: string[];
  creatorReadings: string[];
  publishers: string[];
  issued: string;
  edition: string;
  series: string;
  extent: string;
  isbns: string[];
  ndlBibId: string;
  jpNumber: string;
  classifications: string[];
  officialUrl: string;
};

type XmlValue = string | number | { [key: string]: unknown } | XmlValue[] | null | undefined;
type XmlRecord = Record<string, XmlValue>;

const cleanText = (value: string, maximum = 180) =>
  value
    .normalize("NFKC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[\s　]+/gu, " ")
    .trim()
    .slice(0, maximum);

export const normalizeIsbn = (value: string) =>
  value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^0-9X]/gu, "")
    .slice(0, 13);

const validIsbn10 = (value: string) => {
  if (!/^\d{9}[\dX]$/u.test(value)) return false;
  const sum = [...value].reduce(
    (total, character, index) =>
      total + (character === "X" ? 10 : Number(character)) * (10 - index),
    0,
  );
  return sum % 11 === 0;
};

const validIsbn13 = (value: string) => {
  if (!/^\d{13}$/u.test(value)) return false;
  const sum = Array.from(value.slice(0, 12)).reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (sum % 10)) % 10 === Number(value[12]);
};

export const isValidIsbn = (value: string) => validIsbn10(value) || validIsbn13(value);

const isbn10To13 = (value: string) => {
  if (!validIsbn10(value)) return "";
  const stem = `978${value.slice(0, 9)}`;
  const sum = [...stem].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return `${stem}${(10 - (sum % 10)) % 10}`;
};

export const normalizeSearch = (input: Record<string, unknown>): BookSearch => {
  const mode: SearchMode = ["creator", "isbn"].includes(String(input.mode))
    ? (input.mode as SearchMode)
    : "title";
  const raw = typeof input.q === "string" ? input.q : "";
  const q = mode === "isbn" ? normalizeIsbn(raw) : cleanText(raw, 80);
  const creator =
    mode === "title" && typeof input.creator === "string" ? cleanText(input.creator, 80) : "";
  return { mode, q, creator };
};

export const validateSearch = (search: BookSearch) => {
  if (search.mode === "isbn") return isValidIsbn(search.q) ? "" : "invalid_isbn";
  return search.q.length >= 2 ? "" : "query_too_short";
};

export const buildApiUrl = (search: BookSearch) => {
  const url = new URL("https://ndlsearch.ndl.go.jp/api/opensearch");
  url.searchParams.set("dpid", "iss-ndl-opac-national");
  url.searchParams.set("mediatype", "books");
  url.searchParams.set("cnt", "20");
  url.searchParams.set(search.mode, search.q);
  if (search.creator) url.searchParams.set("creator", search.creator);
  return url;
};

const asArray = (value: XmlValue): XmlValue[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

const valueText = (value: XmlValue, maximum = 180) => {
  if (typeof value === "string" || typeof value === "number")
    return cleanText(String(value), maximum);
  if (value && !Array.isArray(value) && typeof value === "object") {
    const text = value["#text"];
    if (typeof text === "string" || typeof text === "number")
      return cleanText(String(text), maximum);
  }
  return "";
};

const texts = (value: XmlValue, maximum = 180, limit = 5) =>
  [
    ...new Set(
      asArray(value)
        .map((item) => valueText(item, maximum))
        .filter(Boolean),
    ),
  ].slice(0, limit);

const officialBookUrl = (value: XmlValue) => {
  const candidate = valueText(asArray(value)[0], 260);
  try {
    const url = new URL(candidate);
    return url.origin === "https://ndlsearch.ndl.go.jp" &&
      /^\/books\/[A-Za-z0-9-]{8,80}$/u.test(url.pathname) &&
      !url.search &&
      !url.hash
      ? url.href
      : "";
  } catch {
    return "";
  }
};

const identifierType = (value: XmlValue) => {
  if (!value || Array.isArray(value) || typeof value !== "object") return "";
  return valueText((value as XmlRecord)["@_type"], 40);
};

const identifierValues = (item: XmlRecord) =>
  asArray(item.identifier).map((value) => ({
    type: identifierType(value),
    value: valueText(value, 60),
  }));

const publicBook = (item: XmlRecord): PublicBook | null => {
  const officialUrl = officialBookUrl(item.link ?? item.guid);
  const title = texts(item.title, 240, 1)[0] ?? "";
  if (!officialUrl || !title) return null;

  const identifiers = identifierValues(item);
  const directIsbns = identifiers
    .filter(({ type }) => type.endsWith("ISBN") || type.endsWith("ISBN13"))
    .map(({ value }) => normalizeIsbn(value))
    .filter(isValidIsbn);
  const expandedIsbns = directIsbns.flatMap((isbn) => [isbn, isbn10To13(isbn)]).filter(Boolean);
  const id = new URL(officialUrl).pathname.split("/").at(-1) ?? "";

  return {
    id,
    title,
    titleReading: texts(item.titleTranscription, 260, 1)[0] ?? "",
    creators: texts(item.creator ?? item.author, 220, 3),
    creatorReadings: texts(item.creatorTranscription, 220, 3),
    publishers: texts(item.publisher, 160, 3),
    issued: texts(item.issued ?? item.date, 40, 1)[0] ?? "",
    edition: texts(item.edition, 100, 1)[0] ?? "",
    series: texts(item.seriesTitle, 160, 1)[0] ?? "",
    extent: texts(item.extent, 80, 1)[0] ?? "",
    isbns: [...new Set(expandedIsbns)].slice(0, 2),
    ndlBibId: identifiers.find(({ type }) => type.endsWith("NDLBibID"))?.value.slice(0, 32) ?? "",
    jpNumber: identifiers.find(({ type }) => type.endsWith("JPNO"))?.value.slice(0, 32) ?? "",
    classifications: identifiers.length
      ? texts(
          asArray(item.subject).filter((value) => identifierType(value).includes("NDC")),
          30,
          5,
        )
      : [],
    officialUrl,
  };
};

const matchScore = (book: PublicBook, search: BookSearch) => {
  const query = search.q.normalize("NFKC").toLocaleLowerCase("ja-JP");
  if (search.mode === "isbn") return book.isbns.includes(search.q) ? 4 : 0;
  const candidates = search.mode === "creator" ? book.creators : [book.title, book.titleReading];
  const normalized = candidates.map((value) => value.normalize("NFKC").toLocaleLowerCase("ja-JP"));
  if (normalized.some((value) => value === query)) return 4;
  if (normalized.some((value) => value.startsWith(query))) return 3;
  if (normalized.some((value) => value.includes(query))) return 2;
  return 1;
};

export const transformOpenSearchXml = (search: BookSearch, xml: string) => {
  if (new TextEncoder().encode(xml).byteLength > 2_000_000) throw new Error("xml_too_large");
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new Error("unsafe_xml");
  if (XMLValidator.validate(xml) !== true) throw new Error("invalid_xml");

  const parser = new XMLParser({
    attributeNamePrefix: "@_",
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
    removeNSPrefix: true,
    trimValues: true,
  });
  const root = parser.parse(xml) as { rss?: { channel?: XmlRecord } };
  const channel = root.rss?.channel;
  if (!channel || typeof channel !== "object") throw new Error("invalid_schema");
  const books = asArray(channel.item)
    .filter((value): value is XmlRecord =>
      Boolean(value && !Array.isArray(value) && typeof value === "object"),
    )
    .map(publicBook)
    .filter((book): book is PublicBook => book !== null)
    .map((book, index) => ({ book, index, score: matchScore(book, search) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ book }) => book)
    .slice(0, 20);
  const total = Number(valueText(channel.totalResults, 12));
  return { total: Number.isSafeInteger(total) && total >= 0 ? total : 0, results: books };
};
