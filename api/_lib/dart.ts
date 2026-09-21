/**
 * DART(전자공시시스템) Open API 연동 모듈
 * https://opendart.fss.or.kr 에서 KCC의 재무제표·재무지표·배당·공시목록을 자동 수집한다.
 *
 * 필요 환경변수:
 *  - DART_API_KEY   : Open DART 인증키 (https://opendart.fss.or.kr 에서 무료 발급)
 *  - DART_CORP_CODE : (선택) DART 고유번호 8자리. 미설정 시 종목코드로 자동 조회
 *  - DART_STOCK_CODE: (선택) 종목코드. 기본값 002380 (KCC)
 */
import { unzipSync, strFromU8 } from "fflate";
import fs from "fs";
import path from "path";
import os from "os";

const DART_BASE = "https://opendart.fss.or.kr/api";
const DEFAULT_STOCK_CODE = "002380"; // KCC(주)

// 보고서 코드: 11011 사업보고서 / 11012 반기 / 11014 3분기 / 11013 1분기
const REPRT = { ANNUAL: "11011", HALF: "11012", Q3: "11014", Q1: "11013" } as const;
const REPRT_NAME: Record<string, string> = {
  "11011": "사업보고서(연간)",
  "11012": "반기보고서",
  "11014": "3분기보고서",
  "11013": "1분기보고서",
};

// 재무지표 분류코드 (fnlttSinglIndx)
const IDX_CLASSES: { code: string; name: string }[] = [
  { code: "M210000", name: "수익성지표" },
  { code: "M220000", name: "안정성지표" },
  { code: "M230000", name: "성장성지표" },
  { code: "M240000", name: "활동성지표" },
];

export interface DartFile {
  name: string;
  data: string[][];
}

export interface DartSummary {
  corpName: string;
  corpCode: string;
  latestYear: string;
  revenue: number | null;          // 백만원
  operatingProfit: number | null;  // 백만원
  totalAssets: number | null;      // 백만원
  yoy: { revenue: number | null; operatingProfit: number | null; totalAssets: number | null };
  debtRatioTrend: { year: string; value: number }[];
  dividendPerShare: { year: string; value: number }[];
  lastSync: string;
}

export interface DartDataset {
  files: DartFile[];
  summary: DartSummary;
}

// ─────────────────────────────────────────────────────────────────────────────
// 캐시 (서버리스 웜 인스턴스 재사용 + /tmp 파일 캐시)
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6시간
let memCache: { at: number; data: DartDataset } | null = null;
const tmpCachePath = () => path.join(os.tmpdir(), "kcc-dart-cache.json");

function readFileCache(): { at: number; data: DartDataset } | null {
  try {
    const raw = fs.readFileSync(tmpCachePath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.at && parsed.data) return parsed;
  } catch { /* 캐시 없음 */ }
  return null;
}

function writeFileCache(entry: { at: number; data: DartDataset }) {
  try {
    fs.writeFileSync(tmpCachePath(), JSON.stringify(entry), "utf-8");
  } catch { /* 읽기전용 파일시스템이면 무시 */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// API 호출 유틸
// ─────────────────────────────────────────────────────────────────────────────
class DartError extends Error {
  constructor(message: string, public status?: string) {
    super(message);
  }
}

const DART_STATUS_MESSAGES: Record<string, string> = {
  "010": "등록되지 않은 DART 인증키입니다. DART_API_KEY를 확인해 주세요.",
  "011": "사용할 수 없는 DART 인증키입니다. Open DART에서 키 상태를 확인해 주세요.",
  "012": "접근할 수 없는 IP입니다.",
  "013": "조회된 데이터가 없습니다.",
  "020": "DART API 일일 요청 한도를 초과했습니다.",
  "021": "조회 가능한 회사 개수를 초과했습니다.",
  "100": "요청 파라미터가 부적절합니다.",
  "800": "DART 시스템 점검 중입니다.",
  "900": "정의되지 않은 DART 오류입니다.",
};

async function dartJson(endpoint: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const url = `${DART_BASE}/${endpoint}?${qs}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new DartError(`DART API HTTP 오류: ${res.status}`);
    const json: any = await res.json();
    if (json.status && json.status !== "000") {
      throw new DartError(DART_STATUS_MESSAGES[json.status] || `DART 오류(${json.status}): ${json.message || ""}`, json.status);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

/** "013 데이터 없음"은 null로 넘기고, 그 외 오류는 그대로 던진다 */
async function dartJsonOrNull(endpoint: string, params: Record<string, string>): Promise<any | null> {
  try {
    return await dartJson(endpoint, params);
  } catch (e: any) {
    if (e instanceof DartError && e.status === "013") return null;
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 고유번호(corp_code) 조회
//  1) DART_CORP_CODE 환경변수  2) /tmp 캐시
//  3) 최근 정기공시 목록(list.json)에서 종목코드 매칭 — 전체 파일 다운로드 불필요
//  4) corpCode.xml(zip) 전체 파일 — 최후 폴백
// ─────────────────────────────────────────────────────────────────────────────
async function resolveViaRecentFilings(apiKey: string, stockCode: string): Promise<{ corpCode: string; corpName: string } | null> {
  const fmtDate = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const end = new Date();
  const begin = new Date(end.getTime() - 150 * 24 * 60 * 60 * 1000);
  const baseParams = {
    crtfc_key: apiKey,
    bgn_de: fmtDate(begin),
    end_de: fmtDate(end),
    pblntf_ty: "A", // 정기공시(사업·반기·분기보고서) — 상장사는 최소 분기마다 제출
    corp_cls: "Y",  // 유가증권시장
    page_count: "100",
  };

  const findInPage = (json: any): { corpCode: string; corpName: string } | null => {
    for (const row of json?.list || []) {
      if (String(row.stock_code || "").trim() === stockCode && row.corp_code) {
        return { corpCode: String(row.corp_code), corpName: String(row.corp_name || "KCC") };
      }
    }
    return null;
  };

  try {
    const first = await dartJsonOrNull("list.json", { ...baseParams, page_no: "1" });
    if (!first) return null;
    const hit = findInPage(first);
    if (hit) return hit;

    const totalPages = Math.min(Number(first.total_page) || 1, 40);
    if (totalPages <= 1) return null;
    const pagePromises: Promise<any | null>[] = [];
    for (let p = 2; p <= totalPages; p++) {
      pagePromises.push(dartJsonOrNull("list.json", { ...baseParams, page_no: String(p) }).catch(() => null));
    }
    const pages = await Promise.all(pagePromises);
    for (const page of pages) {
      const found = findInPage(page);
      if (found) return found;
    }
    return null;
  } catch (e: any) {
    // 인증키 오류 등은 그대로 전달해 원인을 명확히 보여준다
    if (e instanceof DartError && ["010", "011", "012", "020"].includes(e.status || "")) throw e;
    return null;
  }
}

async function resolveCorpCode(apiKey: string): Promise<{ corpCode: string; corpName: string }> {
  const envCode = (process.env.DART_CORP_CODE || "").trim();
  if (/^\d{8}$/.test(envCode)) {
    return { corpCode: envCode, corpName: process.env.DART_CORP_NAME || "KCC" };
  }

  const stockCode = (process.env.DART_STOCK_CODE || DEFAULT_STOCK_CODE).trim();
  const cachePath = path.join(os.tmpdir(), `dart-corpcode-${stockCode}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (cached?.corpCode) return cached;
  } catch { /* 캐시 없음 */ }

  // 가벼운 방식 우선: 최근 정기공시 목록에서 종목코드 매칭 (JSON 몇 번 호출로 끝)
  const viaList = await resolveViaRecentFilings(apiKey, stockCode);
  if (viaList) {
    try { fs.writeFileSync(cachePath, JSON.stringify(viaList), "utf-8"); } catch { /* 무시 */ }
    return viaList;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${DART_BASE}/corpCode.xml?crtfc_key=${encodeURIComponent(apiKey)}`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new DartError(`고유번호 파일 다운로드 실패: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());

    // 인증키 오류 시 zip 대신 XML 오류 메시지가 내려온다
    if (buf.length < 4 || !(buf[0] === 0x50 && buf[1] === 0x4b)) {
      const text = strFromU8(buf.slice(0, 500));
      const statusMatch = text.match(/<status>(\d+)<\/status>/);
      const status = statusMatch?.[1];
      throw new DartError(
        (status && DART_STATUS_MESSAGES[status]) || "고유번호 파일이 올바르지 않습니다. DART_API_KEY를 확인해 주세요.",
        status
      );
    }

    const unzipped = unzipSync(buf);
    const xmlName = Object.keys(unzipped).find((n) => n.toLowerCase().endsWith(".xml"));
    if (!xmlName) throw new DartError("고유번호 zip 안에 XML 파일이 없습니다.");
    const xml = strFromU8(unzipped[xmlName]);

    // <list><corp_code>..</corp_code><corp_name>..</corp_name>...<stock_code>..</stock_code>...</list>
    const re = /<list>([\s\S]*?)<\/list>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const block = m[1];
      const sc = block.match(/<stock_code>\s*([0-9A-Za-z]*)\s*<\/stock_code>/)?.[1]?.trim();
      if (sc === stockCode) {
        const corpCode = block.match(/<corp_code>\s*(\d+)\s*<\/corp_code>/)?.[1]?.trim() || "";
        const corpName = block.match(/<corp_name>\s*([^<]*)\s*<\/corp_name>/)?.[1]?.trim() || "KCC";
        if (corpCode) {
          const result = { corpCode, corpName };
          try { fs.writeFileSync(cachePath, JSON.stringify(result), "utf-8"); } catch { /* 무시 */ }
          return result;
        }
      }
    }
    throw new DartError(`종목코드 ${stockCode}에 해당하는 회사를 DART에서 찾지 못했습니다.`);
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 수치 파싱
// ─────────────────────────────────────────────────────────────────────────────
function toNumber(v: any): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/,/g, "").trim();
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 원 단위 금액을 백만원 단위로 변환 */
function toMillions(v: any): number | null {
  const n = toNumber(v);
  return n === null ? null : Math.round(n / 1_000_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 데이터 수집 → "가상 CSV" 변환
// 기존 GitHub CSV 파이프라인(searchContext)이 그대로 검색할 수 있도록
// string[][] 행 형태로 만든다. 각 행 끝에 자연어 fact 문장을 포함해 LLM 가독성을 높인다.
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchDartDataset(options?: { force?: boolean }): Promise<DartDataset> {
  const now = Date.now();
  if (!options?.force) {
    if (memCache && now - memCache.at < CACHE_TTL_MS) return memCache.data;
    const fileCached = readFileCache();
    if (fileCached && now - fileCached.at < CACHE_TTL_MS) {
      memCache = fileCached;
      return fileCached.data;
    }
  }

  const apiKey = (process.env.DART_API_KEY || "").trim();
  if (!apiKey) {
    throw new DartError("DART_API_KEY가 설정되지 않았습니다. https://opendart.fss.or.kr 에서 무료 인증키를 발급받아 환경변수에 등록해 주세요.");
  }

  const { corpCode, corpName } = await resolveCorpCode(apiKey);

  const thisYear = new Date().getFullYear();
  // 사업보고서는 통상 3월 말 제출 → 4월 이후에는 전년도 연간 데이터가 존재
  const latestAnnualYear = new Date().getMonth() >= 3 ? thisYear - 1 : thisYear - 2;

  const files: DartFile[] = [];
  const summary: DartSummary = {
    corpName,
    corpCode,
    latestYear: String(latestAnnualYear),
    revenue: null,
    operatingProfit: null,
    totalAssets: null,
    yoy: { revenue: null, operatingProfit: null, totalAssets: null },
    debtRatioTrend: [],
    dividendPerShare: [],
    lastSync: new Date().toISOString(),
  };

  // ── 모든 DART 요청을 병렬로 시작 (서버리스 함수 시간 제한 대응) ──────────
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const listEnd = new Date();
  const listBegin = new Date(listEnd.getTime() - 30 * 24 * 60 * 60 * 1000); // 최근 1개월

  const majorP = dartJsonOrNull("fnlttSinglAcnt.json", {
    crtfc_key: apiKey,
    corp_code: corpCode,
    bsns_year: String(latestAnnualYear),
    reprt_code: REPRT.ANNUAL,
  });
  const quarterReprts = [REPRT.Q3, REPRT.HALF, REPRT.Q1];
  const quarterPs = quarterReprts.map((reprt) =>
    dartJsonOrNull("fnlttSinglAcnt.json", {
      crtfc_key: apiKey,
      corp_code: corpCode,
      bsns_year: String(thisYear),
      reprt_code: reprt,
    }).catch(() => null)
  );
  const idxJobs: { year: number; clsName: string; p: Promise<any | null> }[] = [];
  for (let y = latestAnnualYear - 1; y <= latestAnnualYear; y++) {
    for (const cls of IDX_CLASSES) {
      idxJobs.push({
        year: y,
        clsName: cls.name,
        p: dartJsonOrNull("fnlttSinglIndx.json", {
          crtfc_key: apiKey,
          corp_code: corpCode,
          bsns_year: String(y),
          reprt_code: REPRT.ANNUAL,
          idx_cl_code: cls.code,
        }).catch(() => null),
      });
    }
  }
  const divJobs: { year: number; p: Promise<any | null> }[] = [];
  for (let y = latestAnnualYear - 2; y <= latestAnnualYear; y++) {
    divJobs.push({
      year: y,
      p: dartJsonOrNull("alotMatter.json", {
        crtfc_key: apiKey,
        corp_code: corpCode,
        bsns_year: String(y),
        reprt_code: REPRT.ANNUAL,
      }).catch(() => null),
    });
  }
  const listP = dartJsonOrNull("list.json", {
    crtfc_key: apiKey,
    corp_code: corpCode,
    bgn_de: fmt(listBegin),
    end_de: fmt(listEnd),
    page_no: "1",
    page_count: "30",
  }).catch(() => null);

  // ── 1) 주요계정 (연결/개별, 당기·전기·전전기 3개년이 한 번에 제공됨) ──────
  const majorRows: string[][] = [
    ["연도", "보고서", "재무제표구분", "재무제표종류", "항목", "수치", "단위", "설명"],
  ];
  const majorByYear: Record<string, Record<string, number | null>> = {}; // 연결 기준 요약(백만원)

  const major = await majorP;

  if (major?.list) {
    for (const row of major.list) {
      const isConsolidated = String(row.fs_nm || "").includes("연결");
      const account = String(row.account_nm || "").trim();
      const periods: { label: string; year: string; amount: any }[] = [
        { label: "당기", year: String(latestAnnualYear), amount: row.thstrm_amount },
        { label: "전기", year: String(latestAnnualYear - 1), amount: row.frmtrm_amount },
        { label: "전전기", year: String(latestAnnualYear - 2), amount: row.bfefrmtrm_amount },
      ];
      for (const p of periods) {
        const millions = toMillions(p.amount);
        if (millions === null) continue;
        majorRows.push([
          p.year,
          REPRT_NAME[REPRT.ANNUAL],
          row.sj_nm || "",
          row.fs_nm || "",
          account,
          String(millions),
          "백만원",
          `${p.year}년 ${row.fs_nm || ""} 기준 ${account}은(는) ${millions.toLocaleString()}백만원입니다. (출처: DART ${latestAnnualYear}년 사업보고서)`,
        ]);
        if (isConsolidated) {
          majorByYear[p.year] = majorByYear[p.year] || {};
          majorByYear[p.year][account] = millions;
        }
      }
    }
  }

  // 사이드바 KPI 요약 (연결 기준)
  const latest = majorByYear[String(latestAnnualYear)] || {};
  const prev = majorByYear[String(latestAnnualYear - 1)] || {};
  const pick = (obj: Record<string, number | null>, names: string[]) => {
    for (const n of names) {
      const key = Object.keys(obj).find((k) => k.replace(/\s+/g, "") === n);
      if (key && obj[key] !== null) return obj[key];
    }
    return null;
  };
  summary.revenue = pick(latest, ["매출액", "영업수익", "수익(매출액)"]);
  summary.operatingProfit = pick(latest, ["영업이익", "영업이익(손실)"]);
  summary.totalAssets = pick(latest, ["자산총계"]);
  const yoyPct = (cur: number | null, before: number | null) =>
    cur !== null && before !== null && before !== 0 ? Math.round(((cur - before) / Math.abs(before)) * 1000) / 10 : null;
  summary.yoy = {
    revenue: yoyPct(summary.revenue, pick(prev, ["매출액", "영업수익", "수익(매출액)"])),
    operatingProfit: yoyPct(summary.operatingProfit, pick(prev, ["영업이익", "영업이익(손실)"])),
    totalAssets: yoyPct(summary.totalAssets, pick(prev, ["자산총계"])),
  };

  // 부채비율 3개년 추이 (연결: 부채총계/자본총계)
  for (let y = latestAnnualYear - 2; y <= latestAnnualYear; y++) {
    const acc = majorByYear[String(y)] || {};
    const liab = pick(acc, ["부채총계"]);
    const equity = pick(acc, ["자본총계"]);
    if (liab !== null && equity !== null && equity !== 0) {
      const ratio = Math.round((liab / equity) * 1000) / 10;
      summary.debtRatioTrend.push({ year: `${y}년`, value: ratio });
      majorRows.push([
        String(y), REPRT_NAME[REPRT.ANNUAL], "재무비율", "연결재무제표", "부채비율", String(ratio), "%",
        `${y}년말 연결 기준 부채비율(부채총계/자본총계)은 ${ratio}%입니다. (출처: DART 사업보고서 기준 계산)`,
      ]);
    }
  }

  if (majorRows.length > 1) files.push({ name: `DART_주요재무계정(${latestAnnualYear - 2}-${latestAnnualYear})`, data: majorRows });

  // ── 2) 최신 분기/반기 주요계정 (당해년도) ────────────────────────────────
  const quarterRows: string[][] = [
    ["연도", "보고서", "재무제표구분", "재무제표종류", "항목", "수치", "단위", "설명"],
  ];
  const quarterResults = await Promise.all(quarterPs);
  for (let qi = 0; qi < quarterReprts.length; qi++) {
    const reprt = quarterReprts[qi];
    const q = quarterResults[qi];
    if (q?.list?.length) {
      for (const row of q.list) {
        const millions = toMillions(row.thstrm_amount);
        if (millions === null) continue;
        const account = String(row.account_nm || "").trim();
        quarterRows.push([
          String(thisYear),
          REPRT_NAME[reprt],
          row.sj_nm || "",
          row.fs_nm || "",
          account,
          String(millions),
          "백만원",
          `${thisYear}년 ${REPRT_NAME[reprt]} ${row.fs_nm || ""} 기준 ${account}은(는) ${millions.toLocaleString()}백만원입니다. (누적, 출처: DART)`,
        ]);
      }
      break; // 가장 최신 보고서 하나만 사용
    }
  }
  if (quarterRows.length > 1) files.push({ name: `DART_${thisYear}년_최신분기실적`, data: quarterRows });

  // ── 3) 주요 재무지표 (수익성/안정성/성장성/활동성) ───────────────────────
  const idxRows: string[][] = [["연도", "지표분류", "지표명", "수치", "단위", "설명"]];
  for (const job of idxJobs) {
    const idx = await job.p;
    if (!idx?.list) continue;
    for (const row of idx.list) {
      const val = toNumber(row.thstrm_amount ?? row.idx_val);
      if (val === null) continue;
      const idxName = String(row.idx_nm || "").trim();
      idxRows.push([
        String(job.year), job.clsName, idxName, String(val), "%",
        `${job.year}년 ${job.clsName} 기준 ${idxName}은(는) ${val}입니다. (출처: DART 재무지표)`,
      ]);
    }
  }
  if (idxRows.length > 1) files.push({ name: "DART_주요재무지표", data: idxRows });

  // ── 4) 배당에 관한 사항 ─────────────────────────────────────────────────
  const divRows: string[][] = [["연도", "구분", "항목", "수치", "설명"]];
  for (const job of divJobs) {
    const y = job.year;
    const div = await job.p;
    if (!div?.list) continue;
    for (const row of div.list) {
      const se = String(row.se || "").trim();
      const val = toNumber(row.thstrm);
      if (val === null) continue;
      const stockKind = String(row.stock_knd || "").trim();
      const label = stockKind ? `${se}(${stockKind})` : se;
      divRows.push([
        String(y), "배당", label, String(val),
        `${y}년 ${label}은(는) ${val.toLocaleString()}입니다. (출처: DART 사업보고서 배당에 관한 사항)`,
      ]);
      if (se.includes("주당") && se.includes("현금배당금") && (!stockKind || stockKind.includes("보통"))) {
        summary.dividendPerShare.push({ year: `${y}년`, value: val });
      }
    }
  }
  if (divRows.length > 1) files.push({ name: "DART_배당현황", data: divRows });

  // ── 5) 최근 공시 목록 (최근 90일, 최대 30건) ────────────────────────────
  const list = await listP;
  if (list?.list?.length) {
    const listRows: string[][] = [["접수일자", "보고서명", "제출인", "공시뷰어링크", "설명"]];
    for (const row of list.list) {
      const rcpNo = String(row.rcept_no || "");
      listRows.push([
        String(row.rcept_dt || ""),
        String(row.report_nm || ""),
        String(row.flr_nm || ""),
        rcpNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}` : "",
        `${row.rcept_dt} 접수된 공시: ${row.report_nm} (제출인: ${row.flr_nm})`,
      ]);
    }
    files.push({ name: "DART_최근공시목록(1개월)", data: listRows });
  }

  if (files.length === 0) {
    throw new DartError("DART에서 조회된 데이터가 없습니다. 인증키와 회사 코드를 확인해 주세요.");
  }

  const dataset: DartDataset = { files, summary };
  memCache = { at: now, data: dataset };
  writeFileCache(memCache);
  return dataset;
}

export { DartError };
