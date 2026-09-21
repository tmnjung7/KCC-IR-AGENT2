/**
 * 시장 데이터 모듈 — KCC 관련 뉴스 + 실시간 주가
 *
 * 뉴스: NAVER_CLIENT_ID/SECRET 환경변수가 있으면 네이버 뉴스 검색 API,
 *       없으면 키가 필요 없는 Google News RSS를 사용한다.
 * 주가: 네이버 금융 시세 API 우선, 실패 시 Yahoo Finance로 폴백.
 */

const STOCK_CODE = () => (process.env.DART_STOCK_CODE || "002380").trim();

export interface NewsItem {
  title: string;
  link: string;
  date: string;   // YYYY-MM-DD
  source: string;
}

export interface Quote {
  name: string;
  code: string;
  price: number;
  change: number;
  changePct: number;
  updatedAt: string;
  source: string;
  // 종목 상세 (네이버 모바일 증권, 조회 실패 시 생략)
  marketCap?: string;   // 시가총액 (표시용 문자열)
  high52?: string;      // 52주 최고
  low52?: string;       // 52주 최저
  foreignRate?: string; // 외국인 소진율
  volume?: string;      // 당일 누적 거래량 (표시용)
  dayHigh?: number;     // 당일 고가
  dayLow?: number;      // 당일 저가
}

// KCC 농구단 등 회사와 무관한 기사 제외 키워드
const NEWS_BLOCKLIST = [
  "농구", "KBL", "이지스", "프로농구", "배구", "야구", "골프단", "구단", "스폰서십",
  // 계열사·동명 이종 기사 제외
  "KCC글라스", "케이씨씨글라스", "KCC건설", "케이씨씨건설", "KCC정보통신", "KCC오토", "KCC캐피탈",
];

// ── 캐시 ─────────────────────────────────────────────────────────────────────
let newsCache: { at: number; data: NewsItem[] } | null = null;
let quoteCache: { at: number; data: Quote } | null = null;
const NEWS_TTL = 30 * 60 * 1000; // 30분
const QUOTE_TTL = 60 * 1000;     // 60초

async function fetchWithTimeout(url: string, init: any = {}, ms = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function toDateStr(d: Date): string {
  if (isNaN(d.getTime())) return "";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// ── 뉴스: 네이버 뉴스 검색 API ───────────────────────────────────────────────
async function fetchNaverNews(): Promise<NewsItem[] | null> {
  const id = (process.env.NAVER_CLIENT_ID || "").trim();
  const secret = (process.env.NAVER_CLIENT_SECRET || "").trim();
  if (!id || !secret) return null;

  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent("KCC")}&display=30&sort=date`;
  const res = await fetchWithTimeout(url, {
    headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
  });
  if (!res.ok) throw new Error(`네이버 뉴스 API 오류: ${res.status}`);
  const json: any = await res.json();

  const items: NewsItem[] = [];
  for (const it of json.items || []) {
    const title = decodeEntities(String(it.title || ""));
    // 제목뿐 아니라 본문 요약에서도 스포츠단·계열사 키워드 검사
    // (예: 농구단 스폰서십 기사는 제목에 KCC만 있고 본문에 '이지스'가 등장)
    const desc = decodeEntities(String(it.description || ""));
    if (!title || NEWS_BLOCKLIST.some((b) => title.includes(b) || desc.includes(b))) continue;
    let source = "";
    try { source = new URL(it.originallink || it.link).hostname.replace(/^www\./, ""); } catch { /* 무시 */ }
    items.push({
      title,
      link: String(it.originallink || it.link || ""),
      date: toDateStr(new Date(it.pubDate)),
      source,
    });
    if (items.length >= 10) break;
  }
  return items;
}

// ── 뉴스: Google News RSS (키 불필요) ───────────────────────────────────────
async function fetchGoogleNews(): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent("KCC")}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Google News RSS 오류: ${res.status}`);
  const xml = await res.text();

  const items: NewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && items.length < 10) {
    const block = m[1];
    const rawTitle = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || "";
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || "";
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
    const source = decodeEntities(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "");
    // 구글 뉴스 제목은 "기사제목 - 매체명" 형태
    let title = decodeEntities(rawTitle);
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    if (!title || NEWS_BLOCKLIST.some((b) => title.includes(b))) continue;
    items.push({ title, link, date: toDateStr(new Date(pubDate)), source });
  }
  return items;
}

export async function fetchNews(): Promise<{ items: NewsItem[]; provider: string }> {
  const now = Date.now();
  if (newsCache && now - newsCache.at < NEWS_TTL) {
    return { items: newsCache.data, provider: "cache" };
  }

  let items: NewsItem[] | null = null;
  let provider = "google";
  try {
    items = await fetchNaverNews();
    if (items) provider = "naver";
  } catch (e) {
    console.warn("[News] 네이버 API 실패, Google News로 폴백:", e);
  }
  if (!items) items = await fetchGoogleNews();

  newsCache = { at: now, data: items };
  return { items, provider };
}

// ── 주가: 네이버 금융 ────────────────────────────────────────────────────────
const numOf = (v: any): number => Number(String(v ?? "").replace(/[,+%\s]/g, "")) || 0;

async function fetchNaverQuote(): Promise<Quote | null> {
  const code = STOCK_CODE();
  const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  const d = json?.datas?.[0];
  if (!d?.closePrice) return null;

  const price = numOf(d.closePrice);
  let change = numOf(d.compareToPreviousClosePrice);
  let changePct = Number(String(d.fluctuationsRatio ?? "").replace(/[+%\s]/g, "")) || 0;
  // 하락 여부 보정 (네이버는 code로 방향 제공: 2=상승, 5=하락)
  const dirCode = String(d.compareToPreviousPrice?.code ?? "");
  if (dirCode === "5" || String(d.fluctuationsRatio).startsWith("-")) {
    change = -Math.abs(change);
    changePct = -Math.abs(changePct);
  }
  const q: Quote = {
    name: String(d.stockName || "KCC"),
    code,
    price,
    change,
    changePct,
    updatedAt: new Date().toISOString(),
    source: "네이버 금융",
  };
  const vol = numOf(d.accumulatedTradingVolume);
  if (vol > 0) q.volume = vol >= 10000 ? `${Math.round(vol / 10000).toLocaleString()}만주` : `${vol.toLocaleString()}주`;
  const dh = numOf(d.highPrice); const dl = numOf(d.lowPrice);
  if (dh > 0) q.dayHigh = dh;
  if (dl > 0) q.dayLow = dl;
  return q;
}

// ── 종목 상세(시총·52주·외국인) — 네이버 모바일 증권 ────────────────────────
async function fetchNaverExtra(code: string): Promise<Partial<Quote>> {
  try {
    const res = await fetchWithTimeout(`https://m.stock.naver.com/api/stock/${code}/integration`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!res.ok) return {};
    const json: any = await res.json();
    const infos: any[] = Array.isArray(json?.totalInfos) ? json.totalInfos : [];
    const pick = (...keys: string[]): string | undefined => {
      const entry = infos.find((i) =>
        keys.some((k) =>
          String(i?.code || "").toLowerCase().includes(k.toLowerCase()) ||
          String(i?.key || "").includes(k)
        )
      );
      const v = entry ? String(entry.value ?? "").trim() : "";
      return v && v !== "-" ? v : undefined;
    };
    return {
      marketCap: pick("marketValue", "시가총액", "시총"),
      high52: pick("high52", "52주 최고"),
      low52: pick("low52", "52주 최저"),
      foreignRate: pick("foreignRate", "외국인소진율", "외국인"),
    };
  } catch {
    return {};
  }
}

// ── 주가: Yahoo Finance 폴백 ────────────────────────────────────────────────
async function fetchYahooQuote(): Promise<Quote | null> {
  const code = STOCK_CODE();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.KS?range=1d&interval=1d`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  const json: any = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return null;
  const price = Number(meta.regularMarketPrice);
  const prev = Number(meta.chartPreviousClose || meta.previousClose || price);
  const change = Math.round((price - prev) * 100) / 100;
  const changePct = prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0;
  const q: Quote = {
    name: "KCC",
    code,
    price,
    change,
    changePct,
    updatedAt: new Date().toISOString(),
    source: "Yahoo Finance",
  };
  if (meta.fiftyTwoWeekHigh) q.high52 = Number(meta.fiftyTwoWeekHigh).toLocaleString();
  if (meta.fiftyTwoWeekLow) q.low52 = Number(meta.fiftyTwoWeekLow).toLocaleString();
  return q;
}

export async function fetchQuote(): Promise<Quote> {
  const now = Date.now();
  if (quoteCache && now - quoteCache.at < QUOTE_TTL) return quoteCache.data;

  let quote: Quote | null = null;
  try { quote = await fetchNaverQuote(); } catch (e) { console.warn("[Quote] 네이버 실패:", e); }
  if (!quote) {
    try { quote = await fetchYahooQuote(); } catch (e) { console.warn("[Quote] Yahoo 실패:", e); }
  }
  if (!quote) throw new Error("주가 정보를 가져오지 못했습니다.");

  // 시총·52주·외국인 소진율 보강 (실패해도 기본 시세는 유지)
  const extra = await fetchNaverExtra(quote.code);
  quote = { ...quote, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v)) };

  quoteCache = { at: now, data: quote };
  return quote;
}
