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
    
    // Get key and clean it thoroughly
    let rawKey = process.env.GEMINI_API_KEY || "";
    
    // If the default key is the placeholder "AI Studio Free Tier", use the custom API_KEY instead
    if (!rawKey || rawKey.includes("Free Tier") || rawKey.length < 20) {
      console.log(`[Auth] GEMINI_API_KEY is placeholder or missing. Trying API_KEY from Secrets...`);
      rawKey = process.env.API_KEY || "";
    }

    // Remove all whitespace, quotes, and hidden characters
    let API_KEY = rawKey.trim().replace(/["'\s\t\n\r]/g, ""); 

    if (!API_KEY || API_KEY === "undefined" || API_KEY.length < 20) {
      console.error(`[Auth Error] No valid key found. GEMINI_API_KEY: ${process.env.GEMINI_API_KEY?.substring(0, 10)}..., API_KEY: ${process.env.API_KEY?.substring(0, 4)}...`);
      return res.status(500).json({ 
        error: "유효한 API 키가 설정되지 않았습니다. AI Studio의 Secrets 메뉴에서 API_KEY가 정확히 입력되었는지 확인해 주세요." 
      });
    }

    try {
      // Log key info for debugging (masked)
      console.log(`[API Call] Using key starting with: ${API_KEY.substring(0, 4)}... and ending with: ...${API_KEY.substring(API_KEY.length - 4)}`);
      
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      
      const systemInstruction = `
당신은 KCC(주)의 공식 IR AI 어시스턴트입니다.
KCC의 재무 데이터, 사업 전략, 투자 정보에 대해 전문적이고 신뢰할 수 있는 답변을 제공합니다.

---

## 1. 답변 우선순위 (반드시 준수)

**[1순위] 내부 데이터 최우선**
- 아래 [데이터 컨텍스트]를 가장 먼저 확인하고, 관련 수치는 반드시 해당 데이터를 인용하세요.
- 수치를 제시할 때는 출처 파일명(예: "연결손익계산서 기준")을 자연스럽게 언급하세요.

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

## 3. 답변 형식 규칙 (반드시 준수)

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

## 4. 데이터 컨텍스트

${context}
      `;

      let finalSystemInstruction = systemInstruction;
      if (isEnglishMode) {
        finalSystemInstruction += `\n\n[Language Requirement]\nCRITICAL: You MUST answer entirely in professional business English. Translate all financial terms, metrics, explanations, and disclaimers into English. Do not use Korean.`;
      }

      let response;
      let usedModel = model === 'flash' ? "gemini-3-flash-preview" : "gemini-3.1-pro-preview";

      const generateWithRetry = async (modelName: string, useSearch = true, maxRetries = 2) => {
        for (let i = 0; i <= maxRetries; i++) {
          try {
            const config: any = {
              systemInstruction: finalSystemInstruction,
              temperature: modelName.includes('pro') ? 0.4 : 0.2,
            };

            if (useSearch) {
              config.tools = [{ googleSearch: {} }];
            }

            return await ai.models.generateContent({
              model: modelName,
              contents: [{ parts: [{ text: prompt }] }],
              config: config,
            });
          } catch (err: any) {
            const errorMsg = err.message || "";
            
            // Handle search tool errors (some regions or keys might not support it)
            if (useSearch && (errorMsg.includes('tool') || errorMsg.includes('search') || errorMsg.includes('400'))) {
              console.warn(`[Search Error] Google Search failed for ${modelName}. Retrying without search...`);
              return await generateWithRetry(modelName, false, 0);
            }

            if ((errorMsg.includes('429') || errorMsg.includes('quota')) && i < maxRetries) {
              const delay = 2000 * (i + 1); // 2s, 4s 지수 백오프
              console.warn(`[Quota] 429 error on ${modelName}. Retrying in ${delay / 1000}s... (${i + 1}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            // 일반 네트워크 오류도 한 번 재시도
            if (i < maxRetries && !errorMsg.includes('400') && !errorMsg.includes('401') && !errorMsg.includes('403')) {
              console.warn(`[Error] Network error on ${modelName}. Retrying in 1s... (${i + 1}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
            throw err;
          }
        }
      };

      try {
        // 1차 시도: 최고 성능 Pro 모델
        response = await generateWithRetry(usedModel);
      } catch (proError: any) {
        // Pro 모델 할당량 초과 시 Flash 모델로 자동 전환 (Fallback)
        const errorMsg = proError.message || "";
        if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('limit')) {
          console.warn("[Fallback] Pro model quota exceeded. Switching to Flash model...");
          usedModel = "gemini-3-flash-preview";
          response = await generateWithRetry(usedModel, true, 0);
        } else {
          throw proError;
        }
      }

      res.json({ 
        text: response.text,
        groundingMetadata: response.candidates?.[0]?.groundingMetadata,
        model: usedModel
      });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message || "AI 응답 중 오류가 발생했습니다." });
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
