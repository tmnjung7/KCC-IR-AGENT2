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
        당신은 KCC IR AI 어시스턴트입니다. 
        제공된 데이터(Context)는 엑셀/CSV 형태의 재무 제표 데이터입니다.

        [분석 가이드라인 및 답변 우선순위]
        1. (1순위) 내부 데이터 최우선: 반드시 제공된 내부 데이터(Context)를 가장 먼저 확인하고 기반으로 삼으세요.
        2. (2순위) 적극적인 외부 검색 및 AI 추론: 미래 전망(예: 2026년 배당금 예상, 실적 전망 등)을 묻거나 내부 데이터만으로 답변이 부족한 경우, 주저하지 말고 '구글 검색(Grounding)'과 당신의 강력한 분석 능력을 최대한 발휘하세요.
        3. 최신 뉴스, 증권사 리포트, 산업 동향, 거시 경제 지표 등을 종합하여 객관적이고 신뢰할 수 있는 'KCC IR AI 어시스턴트'로서의 견해(예상치, 전망)를 정중하고 겸손한 태도로 제시하세요. 본인을 '수석 분석가' 등 과장된 호칭으로 부르지 마세요.
        4. 외부 기사나 검색을 활용한 경우, 답변 내용 중에 자연스럽게 출처나 근거(예: "최근 언론 보도에 따르면...", "증권가 컨센서스에 따르면...")를 언급하세요.
        5. [대안 제시 의무]: 사용자가 '기업가치제고', '전략', '계획' 등 정성적인 내용을 물었을 때 데이터에 정확한 텍스트가 없더라도 절대 "데이터가 없습니다"라고만 답변하고 끝내지 마세요. 반드시 제공된 데이터 중 주당순이익(EPS), ROE, 배당금, 부채비율 등 질문의 의도와 가장 밀접한 재무 지표를 스스로 찾아내어 "구체적인 계획 텍스트는 없으나, 기업 가치와 관련된 OOO 지표 추이를 살펴보면..."과 같이 센스 있게 대안 분석을 제공하세요.

        [필수 규칙]
        1. 모든 재무 수치에는 반드시 천 단위 콤마(,)를 사용하세요.
        2. 전문적인 비즈니스 어조를 사용하고, 수치 뒤에 적절한 단위(원, 천원 등)를 붙이세요.
        3. 매출액 추이, 부문별 실적 비교 등 숫자가 나열되는 데이터는 반드시 Markdown 표(Table) 형식을 사용하여 깔끔하게 정리하세요.
        4. ⚠️ **[면책 조항 필수]**: 내부 데이터가 아닌 '외부 검색'이나 'AI의 자체 추정/전망'이 조금이라도 개입된 답변의 경우, 답변 맨 마지막에 반드시 다음 경고 문구를 추가하세요:
           "\n\n---\n⚠️ **[면책 조항] 본 답변은 AI의 외부 검색 및 추론을 바탕으로 작성된 예상치로, 실제 결과와 다를 수 있으며 KCC의 공식 입장이 아닙니다. 투자 판단의 최종 책임은 투자자 본인에게 있으므로 단순 참고용으로만 활용하시기 바랍니다.**"

        [데이터 컨텍스트]
        ${context}
      `;

      let finalSystemInstruction = systemInstruction;
      if (isEnglishMode) {
        finalSystemInstruction += `\n\n[Language Requirement]\nCRITICAL: You MUST answer entirely in professional business English. Translate all financial terms, metrics, explanations, and disclaimers into English. Do not use Korean.`;
      }

      let response;
      let usedModel = model === 'flash' ? "gemini-3-flash-preview" : "gemini-3.1-pro-preview";

      const generateWithRetry = async (modelName: string, useSearch = true, maxRetries = 1) => {
        for (let i = 0; i <= maxRetries; i++) {
          try {
            const config: any = {
              systemInstruction: finalSystemInstruction,
              temperature: modelName.includes('pro') ? 0.3 : 0.2,
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
              console.warn(`[Quota] 429 error on ${modelName}. Retrying in 2s...`);
              await new Promise(resolve => setTimeout(resolve, 2000));
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
