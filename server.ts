import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";
import fetch from "node-fetch";

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
    const { prompt, context, model } = req.body;
    
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
        당신은 KCC IR 부서의 '수석 분석가급' AI 어시스턴트입니다. 
        제공된 데이터(Context)는 엑셀/CSV 형태의 재무 제표 데이터입니다.

        [분석 가이드라인]
        1. 당신은 KCC의 IR(Investor Relations) 담당자입니다.
        2. 내부 데이터(Context)를 최우선으로 분석하고, 수치 데이터는 반드시 Context에서 추출하여 답변하세요.
        3. 질문에 특정 연도(예: 2025년)나 특정 항목(예: 부채비율)이 포함되어 있다면, Context에서 해당 데이터를 반드시 찾아보고, 단 하나의 데이터라도 있다면 이를 바탕으로 답변하세요. 
        4. "데이터가 없다"고 말하기 전에 Context를 최소 3번 이상 다시 확인하세요. 특히 '부채비율', '매출액', '영업이익', 'EBITDA(상각전영업이익)' 등 핵심 지표는 표의 행이나 열에 흩어져 있을 수 있으니 꼼꼼히 조합하세요.
        5. 사용자가 특정 파일(예: 4번 파일)을 지목했다면, 해당 파일 섹션의 데이터를 최우선적으로 정밀 분석하세요.
        6. 내부 데이터(Context)에 없는 정보는 '구글 검색(Grounding)' 기능을 활용하되, 내부 데이터와 외부 데이터가 충돌할 경우 내부 데이터를 우선시하세요.

        [필수 규칙]
        1. 모든 재무 수치에는 반드시 천 단위 콤마(,)를 사용하세요.
        2. 답변 마지막에 [출처: 파일명 또는 검색 결과]을 명시하세요.
        3. [답변 우선순위 및 예외 처리]
           - 1순위: 반드시 제공된 내부 데이터(Context)를 최우선으로 검색하여 답변하세요.
           - 2순위: 내부 데이터에 도저히 정보가 없는 경우에만 당신의 기본 지식(Gemini)과 구글 검색을 활용하세요.
           - 단, 2순위로 답변할 때는 불확실한 추정이나 추측을 최소화하고, 반드시 'KCC'와 직접적으로 연관된 사실 기반의 정보만 제공하세요.
           - 또한, 2순위로 답변할 경우 반드시 답변 서두에 "제공된 내부 IR 자료에는 해당 내용이 없으나, 외부 공개 정보(또는 일반적인 정보)를 바탕으로 말씀드리면..."과 같이 정보의 출처 한계와 우려 사항을 명확하고 부드럽게 안내하세요.
        4. 전문적인 비즈니스 어조를 사용하고, 수치 뒤에 적절한 단위(원, 천원 등)를 붙이세요.
        5. **매출액 추이, 부문별 실적 비교 등 숫자가 나열되는 데이터는 반드시 Markdown 표(Table) 형식을 사용하여 깔끔하게 정리하세요.** 텍스트로만 나열하는 것은 금지됩니다.
        6. 표 하단에는 해당 수치에 대한 핵심 요약이나 분석을 1~2문장으로 덧붙이세요.

        [데이터 컨텍스트]
        ${context}
      `;

      let response;
      let usedModel = model === 'flash' ? "gemini-3-flash-preview" : "gemini-3.1-pro-preview";

      const generateWithRetry = async (modelName: string, maxRetries = 1) => {
        for (let i = 0; i <= maxRetries; i++) {
          try {
            return await ai.models.generateContent({
              model: modelName,
              contents: [{ parts: [{ text: prompt }] }],
              config: {
                systemInstruction: systemInstruction,
                temperature: 0.2,
                tools: [{ googleSearch: {} }],
              },
            });
          } catch (err: any) {
            const errorMsg = err.message || "";
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
        if (errorMsg.includes('429') || errorMsg.includes('quota')) {
          console.warn("[Fallback] Pro model quota exceeded. Switching to Flash model...");
          usedModel = "gemini-3-flash-preview";
          response = await ai.models.generateContent({
            model: usedModel,
            contents: [{ parts: [{ text: prompt }] }],
            config: {
              systemInstruction: systemInstruction,
              temperature: 0.1,
              tools: [{ googleSearch: {} }],
            },
          });
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
