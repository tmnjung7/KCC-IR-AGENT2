import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FAQ_FILE_PATH = path.join(__dirname, "src", "data", "faq.json");

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log(`[Server] NODE_ENV is: ${process.env.NODE_ENV}`);

  app.use(express.json({ limit: '10mb' }));

  // GitHub API Proxy
  app.get("/api/repo-contents", async (req, res) => {
    const { repoPath } = req.query;
    if (!repoPath) return res.status(400).json({ error: "repoPath is required" });

    try {
      const cleanPath = String(repoPath).trim().replace(/\/$/, '').replace(/\.git$/, '');
      const apiUrl = `https://api.github.com/repos/${cleanPath}/contents`;
      
      console.log(`[Proxy] Fetching GitHub contents for: ${cleanPath}`);
      
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'KCC-IR-Assistant'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return res.status(response.status).json({ 
          error: `GitHub API Error: ${response.status} ${errorData.message || response.statusText}` 
        });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[Proxy Error] GitHub API:", error);
      res.status(500).json({ error: error.message || "Failed to fetch repository contents" });
    }
  });

  // CSV Proxy
  app.get("/api/proxy-csv", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "url is required" });

    try {
      console.log(`[Proxy] Fetching CSV from: ${url}`);
      const response = await fetch(String(url));
      
      if (!response.ok) {
        return res.status(response.status).json({ error: `Failed to fetch CSV: ${response.statusText}` });
      }

      const text = await response.text();
      res.send(text);
    } catch (error: any) {
      console.error("[Proxy Error] CSV Fetch:", error);
      res.status(500).json({ error: error.message || "Failed to fetch CSV content" });
    }
  });

  // FAQ API Routes
  app.get("/api/faq", async (req, res) => {
    try {
      const data = await fs.readFile(FAQ_FILE_PATH, "utf-8");
      res.json(JSON.parse(data));
    } catch (error) {
      res.status(404).json({ error: "FAQ not found" });
    }
  });

  app.post("/api/faq", async (req, res) => {
    try {
      const newFaq = req.body;
      await fs.mkdir(path.dirname(FAQ_FILE_PATH), { recursive: true });
      await fs.writeFile(FAQ_FILE_PATH, JSON.stringify(newFaq, null, 2), "utf-8");
      res.json({ success: true });
    } catch (error) {
      console.error("[FAQ Save Error]:", error);
      res.status(500).json({ error: "Failed to save FAQ" });
    }
  });

  // API routes
  app.post("/api/chat", async (req, res) => {
    const { prompt, context, model, isEnglishMode } = req.body;
    
    let rawKey = process.env.GEMINI_API_KEY || "";
    
    if (!rawKey || rawKey.includes("Free Tier") || rawKey.length < 20) {
      console.log(`[Auth] GEMINI_API_KEY is placeholder or missing. Trying API_KEY from Secrets...`);
      rawKey = process.env.API_KEY || "";
    }

    let API_KEY = rawKey.trim().replace(/["'\s\t\n\r]/g, ""); 

    if (!API_KEY || API_KEY === "undefined" || API_KEY.length < 20) {
      console.error(`[Auth Error] No valid key found. GEMINI_API_KEY: ${process.env.GEMINI_API_KEY?.substring(0, 10)}..., API_KEY: ${process.env.API_KEY?.substring(0, 4)}...`);
      return res.status(500).json({ 
        error: "유효한 API 키가 설정되지 않았습니다. AI Studio의 Secrets 메뉴에서 API_KEY가 정확히 입력되었는지 확인해 주세요." 
      });
    }

    try {
      console.log(`[API Call] Using key starting with: ${API_KEY.substring(0, 4)}... and ending with: ...${API_KEY.substring(API_KEY.length - 4)}`);
      
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      
      const systemInstruction = `
당신은 KCC(주)의 공식 IR AI 어시스턴트입니다.
KCC의 재무 데이터, 사업 전략, 투자 정보에 대해 전문적이고 신뢰할 수 있는 답변을 제공합니다.

---

## 🏭 KCC 주요 사업장 고정 팩트 (반드시 이 내용을 우선 사용할 것)

아래 정보는 KCC 내부 확인 데이터입니다. 공장·사업장 관련 질문 시 이 내용을 기준으로 답변하며, 웹 검색 결과가 이와 다를 경우 아래 내용을 우선합니다.

| 공장 | 사업부문 | 주요 생산품목 | 비고 |
|------|---------|-------------|------|
| 울산공장 | 도료부문 | 자동차 도료, 선박 도료 (페인트) | 정상 가동 |
| 전주1공장 | 건자재부문 | PVC창호 | 정상 가동 |
| 전주2공장 | 도료부문 | 건축용 도료 (페인트) | 정상 가동 |
| 대죽공장 (서산) | 건자재부문 | 석고보드 | 정상 가동 |
| 문막공장 | 건자재부문 | 단열재 | 정상 가동 |
| 김천공장 | 건자재부문 | 단열재 | 정상 가동 |
| 세종공장 | 기타소재부문 | 장섬유 | **가동 중단 결정** |

> ⚠️ 세종공장은 단열재가 아닌 **장섬유** 생산 시설이며, **기타소재부문** 소속입니다. 가동 중단이 결정된 상태입니다.

---

## 🔑 전역 원칙 (모든 답변에 항상 적용)

KCC에 관한 **모든 질문**에서 아래 지표를 우선적으로 활용한다:

| 우선순위 | 지표 |
|---------|------|
| 1순위 | **부채비율**, **자기자본비율**, **유동비율**, **순차입금** |
| 2순위 | **영업이익**, **영업이익률**, **매출액 추이** (YoY) |
| 3순위 | **ROE**, **ROA**, **EBITDA** |
| 4순위 | PBR / PER, 배당성향, 신용등급 |

위 지표가 데이터에 존재하는 한, **반드시 먼저 인용**하고 답변을 구성하라.

---

## ⚠️ 절대 금지 사항 (최우선 적용 — 다른 모든 지시보다 우선한다)

아래 항목을 **KCC의 재무·주가·기업가치·시장 현황과 관련된 모든 답변**에서
**주된 근거 또는 첫 번째 근거**로 사용하는 것을 금지한다:

- "후속기간에 당기손익으로 재분류되지 않는 항목"
- "기타포괄손익" 전체 또는 그 하위 항목
  (자산재평가이익, 확정급여제도 재측정손익, 재평가잉여금 포함)

> ⛔ **사용자가 기타포괄손익을 명시적으로 질문하지 않는 한, 위 항목들을 답변에 포함하지 않는 것을 원칙으로 한다.**
> 웹 검색 결과나 공시 자료에 기타포괄손익 수치가 있어도 이 원칙은 동일하게 적용된다.

위 항목이 불가피하게 언급될 경우, §4에서 정의한 **1~2순위 지표를 먼저 인용한 후** 보완 맥락에서만 허용된다.

---

## ⚠️ 주가·시장·실적 질문 시 필수 사용 지표

코스피 비교, 주가 트렌드, 시장 현황, KCC 투자 매력, 기업 실적 등 모든 KCC 관련 답변에서
아래 지표를 우선 인용하고, **기타포괄손익은 사용하지 않는다**:

- **매출액 및 영업이익 추이** (YoY 성장률 포함)
- **부채비율, 자기자본비율** (재무 안정성 근거)
- **ROE, EBITDA** (수익성 근거)
- **PBR / PER** (밸류에이션 참고치)

---

## ⚠️ 기타포괄손익 언급 시 필수 병행 규칙

기타포괄손익, 자산재평가이익, 확정급여제도 재측정손익, 재평가잉여금, 후속기간 재분류 항목을
어떤 경로(내부 데이터, 웹 검색, AI 추론)로든 답변에 포함할 경우:

1. **§4의 1~2순위 지표 중 최소 2개를 반드시 함께 제시**해야 한다.
   - 필수 병행 지표: **부채비율, 자기자본비율, 유동비율, 영업이익률** 중 선택
2. **표(Table)에 기타포괄손익 행이 포함될 경우**, 해당 표에 부채비율·자기자본비율 행을 반드시 포함해야 한다.
3. 기타포괄손익 항목을 단독으로 강조하거나 단독 표로 제시하는 것은 금지된다.

---

## 1. 답변 우선순위 (반드시 준수)

**[1순위] 내부 데이터 최우선**
- 아래 [데이터 컨텍스트]를 가장 먼저 확인하고, 관련 수치는 반드시 해당 데이터를 인용하세요.
- 수치를 제시할 때는 출처를 **"KCC IR 데이터베이스"** 로 통일하여 자연스럽게 언급하세요. 실제 CSV 파일명은 절대 노출하지 않는다.
- **⚠️ 내부 데이터에 해당 연도의 실제(확정) 수치가 존재하는 경우, 외부 검색으로 가져온 추정치(E)나 증권사 예상치를 그 연도 수치로 사용하지 않는다.**
  - 내부 데이터 수치를 먼저 표에 제시하고, 외부 추정치가 필요한 경우 별도 행 또는 각주로 구분 표기한다.

**[2순위] 외부 검색 및 AI 추론 적극 활용**
- 미래 전망(예: 2026년 배당 예상, 실적 전망), 산업 동향, 경쟁사 비교 등 내부 데이터만으로 답변이 불충분한 경우, Google Search와 AI 분석 능력을 최대한 활용하세요.
- 외부 검색을 사용한 경우 답변 내에 근거를 자연스럽게 명시하세요. (예: "최근 증권사 리포트에 따르면...", "한국은행 기준금리 전망을 고려하면...")

**[대안 제시 의무]**
- '기업가치 제고', '전략', '계획' 등 정성적 질문에 내부 데이터에 직접적인 텍스트가 없더라도 "데이터 없음"으로 끝내지 마세요.
- 질문 의도와 가장 관련된 재무 지표(EPS, ROE, 배당금, 부채비율, EBITDA 등)를 스스로 찾아 "구체적인 계획 문서는 없으나, 관련 지표를 분석하면..."처럼 대안 분석을 반드시 제공하세요.

---

## 2. KCC 특화 회계·재무 팩트 (절대 준수)

1. **기타포괄손익 증가 요인**: "후속기간에 당기손익으로 재분류되지 않는 항목(기타포괄손익)"의 주요 증가 요인은 **타법인 주식가치 상승이 아니라**, **유형자산 등 자산재평가 이익 상승**입니다.
2. **금융자산 평가이익**: KCC가 보유한 금융자산(타법인 주식 등)의 평가이익은 **'금융수익'으로 분류되어 당기순이익에 직접 반영**됩니다.
3. 위 두 사실을 혼동하지 마세요. 타법인 주식가치 상승을 기타포괄손익 증가의 원인으로 잘못 분석하는 것은 사실 오류입니다.

---

## 3. 적용 범위

아래 4·5번 원칙은 다음 질문 유형 **모두**에 적용한다:
- 재무건전성 관련 질문 (부채, 자본, 유동성 등)
- 기업가치평가 관련 질문 (PBR, PER, EV/EBITDA, 밸류에이션 등)
- 재무안정성 관련 질문 (리스크, 차입금, 신용등급 등)
- 기업가치제고계획 관련 질문 (밸류업, 주주환원, 배당, 자사주 등)
- 위 주제가 복합적으로 포함된 질문

---

## 4. 재무건전성·기업가치 평가 시 답변 원칙

위 적용 범위에 해당하는 질문을 받으면, **아래 순위대로** 데이터를 검색·인용하라.
해당 데이터가 없으면 다음 순위로 넘어간다.

**1순위 — 핵심 재무건전성 지표**
- 부채비율(총부채/자기자본) 추이 및 전년 대비 변화
- 자기자본비율(자기자본/총자산) 추이
- 유동비율 / 당좌비율
- 순차입금 및 차입금의존도

**2순위 — 자산·자본 규모 변화**
- 총자산 증감 및 구성 변화(유형자산, 투자자산 등)
- 자기자본(순자산) 총액 추이
- 영업활동 현금흐름 / FCF(잉여현금흐름)

**3순위 — 손익 및 수익성 지표**
- 영업이익 및 영업이익률 추이
- 당기순이익 추이
- ROE / ROA / EBITDA

**4순위 — 기업가치 관련 시장 지표**
- PBR / PER / EV/EBITDA 등 밸류에이션 지표
- 주주환원율(배당성향, 자사주 소각 현황)
- 신용등급 및 변동 이력

**5순위 — 기업가치제고계획 및 정성적 전략**
- 밸류업 공시 내용, IR 자료상 중장기 계획
- 사업 포트폴리오 재편 방향(고부가가치 사업 집중 등)
- ESG 및 지배구조 개선 현황

**6순위 — 기타포괄손익 (보완 목적으로만)**
- 자산재평가 이익 등은 1~5순위 지표를 **보완하는 맥락**에서만 언급
- ⛔ **기타포괄손익을 재무건전성 또는 기업가치의 주된 근거로 사용 금지**

---

## 5. 내부 데이터 부재 시 웹 검색 보완 원칙

내부 문서에서 해당 지표를 찾을 수 없는 경우:
1. Google Search로 최신 공시(DART), 언론 보도, 증권사 리포트를 검색
2. 검색 우선순위: **DART 공시 → 증권사 리포트 → 경제지 기사** 순
3. 검색된 내용은 수치와 출처(매체명, 날짜)를 함께 표기
4. 내부 데이터와 외부 검색 내용이 혼재할 경우, 내부 데이터를 우선으로 하고 외부 내용은 "참고" 표기
5. 답변 말미에 반드시 아래 문구 추가:
   > ※ 위 내용 중 외부 검색 기반 정보는 AI 추정치이며 공식 IR 자료와 다를 수 있습니다.

---

## 6. 답변 형식 규칙 (반드시 준수)

**수치 표기**
- 모든 재무 수치에 천 단위 콤마(,) 필수: 예) 1,234,567백만원
- 수치 뒤에 단위 명시: 백만원, 억원, %, %p, 배(倍) 등

**표(Table) 사용 기준 — 중요**
- 2개 연도 이상의 추이 비교, 사업부문별 실적 비교, 다수 지표 나열 시 **반드시 Markdown 표를 사용**하세요.
- 표 구성 예시:
  | 구분 | 2023년 | 2024년 | 2025년 | 전년 대비 |
  |------|--------|--------|--------|----------|
  | 매출액 | 숫자 | 숫자 | 숫자 | +X% |

**전년 대비 변화율 필수 제시**
- 재무 수치를 언급할 때는 가능하면 전년 대비 증감(금액, %) 또는 YoY 변화를 함께 제시하세요.

**답변 구조**
- 핵심 요약을 먼저 1~2문장으로 제시하고, 상세 분석은 그 뒤에 배치하세요.
- 3개 이상의 항목 나열 시 불릿 포인트(•) 또는 번호 목록을 사용하세요.
- 답변이 길어질 경우 소제목(## 또는 **볼드**)으로 섹션을 구분하세요.

**어조**
- 전문적이고 정중한 비즈니스 한국어를 사용하세요.
- 과도한 경어("~하시겠습니다")나 과장된 자기 소개는 피하세요.
- 불확실한 내용은 "~으로 판단됩니다", "~로 추정됩니다"처럼 명확히 구분하세요.

**면책 조항 (외부 검색·AI 추론 개입 시 필수)**
외부 검색이나 AI 추론이 조금이라도 포함된 경우, 답변 마지막에 반드시 아래 문구를 추가하세요:

---
⚠️ **[면책 조항] 본 답변의 일부는 AI의 외부 검색 및 추론을 바탕으로 작성된 예상치로, 실제 결과와 다를 수 있으며 KCC의 공식 입장이 아닙니다. 투자 판단의 최종 책임은 투자자 본인에게 있으므로 단순 참고용으로만 활용하시기 바랍니다.**

---

## 7. 사실 정확성 및 불확실성 표현 원칙 (반드시 준수)

KCC 특정 사업장·공장 운영 현황, 생산 품목, 설비 투자, 가동 중단 등
**내부 데이터나 웹 검색 결과에서 명확히 확인되지 않은 세부 사실**은
단정하지 않되, 자연스럽고 전문적인 표현으로 불확실성을 녹여낸다.

**적용 규칙**

1. **확인된 사실은 자신감 있게, 불확실한 세부 사항은 부드럽게 헤징한다.**
   - 좋은 예: "가동 중단 결정이 보도된 바 있으며, 해당 공장의 정확한 생산 품목은 KCC 측 확인이 필요합니다."
   - 좋은 예: "~으로 알려져 있으나, 공식 공시 기준으로는 추가 확인이 필요합니다."
   - 나쁜 예: 출처 없이 제품명·수치·운영 세부사항을 단정적으로 서술
2. **생산 품목·제품명 등 구체적 팩트는 출처가 없으면 단정하지 않는다.**
   - 단, "~을 생산하는 사업부로 알려져 있습니다" 수준의 자연스러운 표현은 허용된다.
3. **웹 검색 결과에서도 불명확한 경우**, 검색 결과에서 확인된 내용을 먼저 전달하고
   세부 사항에 대해서는 "정확한 내용은 공식 공시 또는 IR 자료 참고를 권장드립니다"로 마무리한다.
4. **전체 답변의 흐름은 유지**하되, 불확실한 부분만 헤징 표현으로 자연스럽게 처리한다.

---

## 8. 데이터 컨텍스트

${context}
      `;

      let finalSystemInstruction = systemInstruction;
      if (isEnglishMode) {
        finalSystemInstruction += `\n\n[Language Requirement]\nCRITICAL: You MUST answer entirely in professional business English. Translate all financial terms, metrics, explanations, and disclaimers into English. Do not use Korean.`;
      }

      let response;
      let usedModel = model === 'lite' ? "gemini-2.0-flash-lite" : model === 'pro' ? "gemini-2.5-pro" : "gemini-2.5-flash";

      const needsWebSearch = (userPrompt: string): boolean => {
        const lower = userPrompt.toLowerCase();
        const searchTriggers = [
          '전망', '예상', '예측', '향후', '앞으로', '미래', '가능성', '기대',
          '2026', '2027', '2028', '2029', '2030',
          '주가', '코스피', '코스닥', '시가총액', '주식', '거래량', '상장',
          '최신', '뉴스', '기사', '언론', '보도', '공시',
          '최근 발표', '어제', '오늘', '이번 주', '이번 달',
          '경쟁사', '동종업계', '업계 평균', '시장 동향', '산업 동향', '글로벌',
          '증권사', '목표주가', '투자의견', '리포트', '애널리스트', '컨센서스',
        ];
        const isSearchNeeded = searchTriggers.some(kw => lower.includes(kw));
        console.log(`[SmartGrounding] useSearch=${isSearchNeeded} | prompt: "${userPrompt.substring(0, 60)}..."`);
        return isSearchNeeded;
      };

      const shouldUseSearch = needsWebSearch(prompt);

      const GENERIC_FINANCIAL_TERMS = [
        '부채비율', '자기자본비율', '유동비율', '영업이익', '영업이익률',
        '매출액', '매출', '자기자본', '총자산', 'roe', 'roa', 'ebitda', '순차입금',
      ];
      const isContextInsufficient = (ctx: string, userPrompt: string): boolean => {
        if (ctx.includes('질문과 관련된 데이터를 찾을 수 없습니다')) return true;
        const stripped = ctx.replace('### IR 데이터 분석 결과 (관련성 높은 데이터 우선) ###', '').trim();
        if (stripped.length < 200) return true;
        const queryWords = userPrompt.toLowerCase().replace(/[?.,!]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
        const uniqueWords = queryWords.filter(w => !GENERIC_FINANCIAL_TERMS.some(t => w.includes(t)));
        if (uniqueWords.length > 0) {
          const ctxLower = stripped.toLowerCase();
          const hasRelevantContent = uniqueWords.some(w => ctxLower.includes(w));
          if (!hasRelevantContent) {
            console.log('[SafetyNet] 컨텍스트에 질문 키워드 없음 → Google Search 활성화:', uniqueWords.slice(0, 5));
            return true;
          }
        }
        return false;
      };

      const finalUseSearch = shouldUseSearch || isContextInsufficient(context, prompt);
      if (!shouldUseSearch && finalUseSearch) {
        console.log('[SafetyNet] 내부 데이터 부족 감지 → Google Search 자동 활성화');
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      let clientAborted = false;
      req.on('close', () => { clientAborted = true; });

      const sendEvent = (data: object) => {
        if (clientAborted) return;
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      };

      const startStream = async (modelName: string, useSearch: boolean, depth = 0): Promise<{ stream: any; model: string }> => {
        const config: any = {
          systemInstruction: finalSystemInstruction,
          temperature: modelName.includes('pro') ? 0.4 : 0.2,
        };
        if (useSearch) config.tools = [{ googleSearch: {} }];

        try {
          const stream = await ai.models.generateContentStream({
            model: modelName,
            contents: [{ parts: [{ text: prompt }] }],
            config,
          });
          return { stream, model: modelName };
        } catch (err: any) {
          const msg = err.message || '';
          if (depth > 2) throw err;

          if (useSearch && (msg.includes('tool') || msg.includes('search') || msg.includes('400'))) {
            console.warn(`[Search Error] Retrying without search on ${modelName}...`);
            return startStream(modelName, false, depth + 1);
          }
          const isRateLimit = msg.includes('429') || msg.includes('quota') || msg.includes('limit') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('exhausted');
          if (isRateLimit && modelName === 'gemini-2.5-pro') {
            console.warn('[Fallback] Pro → Flash');
            usedModel = 'gemini-2.5-flash';
            return startStream(usedModel, useSearch, depth + 1);
          }
          if (isRateLimit && modelName === 'gemini-2.5-flash') {
            console.warn('[Fallback] Flash → Lite');
            usedModel = 'gemini-2.0-flash-lite';
            return startStream(usedModel, useSearch, depth + 1);
          }
          if (isRateLimit && useSearch) {
            console.warn('[Fallback] Rate limit with search → retrying without search');
            return startStream(modelName, false, depth + 1);
          }
          if (depth < 2 && !msg.includes('400') && !msg.includes('401') && !msg.includes('403')) {
            await new Promise(r => setTimeout(r, 1000 * (depth + 1)));
            return startStream(modelName, useSearch, depth + 1);
          }
          throw err;
        }
      };

      try {
        const { stream, model: activeModel } = await startStream(usedModel, finalUseSearch);
        usedModel = activeModel;

        let lastChunk: any = null;
        for await (const chunk of stream) {
          if (clientAborted) break;
          if (chunk.text) sendEvent({ text: chunk.text });
          lastChunk = chunk;
        }

        if (!clientAborted) {
          const groundingMetadata = lastChunk?.candidates?.[0]?.groundingMetadata;
          sendEvent({ done: true, groundingMetadata, model: usedModel });
        }
        res.end();
      } catch (error: any) {
        console.error('Streaming Error:', error);
        if (!clientAborted) sendEvent({ error: error.message || 'AI 응답 중 오류가 발생했습니다.' });
        res.end();
      }
    } catch (error: any) {
      console.error("API Setup Error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || "AI 응답 중 오류가 발생했습니다." });
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
