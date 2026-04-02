import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API routes
  app.post("/api/chat", async (req, res) => {
    const { prompt, context, model } = req.body;
    
    // Get key and clean it thoroughly
    let rawKey = process.env.GEMINI_API_KEY || "";
    
    // If the default key is the placeholder "AI Studio Free Tier", use the custom API_KEY instead
    if (!rawKey || rawKey.includes("Free Tier") || rawKey.length < 20) {
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
        3. 질문에 특정 연도(예: 2025년)가 포함되어 있다면, Context에서 해당 연도 데이터를 반드시 찾아보고, 단 하나의 데이터라도 있다면 이를 바탕으로 답변하세요. "데이터가 없다"고 말하기 전에 Context를 다시 한번 꼼꼼히 확인하세요.
        4. 내부 데이터(Context)에 없는 정보는 '구글 검색(Grounding)' 기능을 활용하여 최신 시장 동향이나 업계 리포트를 참고하여 답변하세요.
        5. 수치 계산이 필요한 경우(예: 영업이익률, 연도별 누계 합, 성장률 등), 반드시 직접 계산 과정을 상세히 보여주세요. (예: 1Q + 2Q + 3Q + 4Q = 합계)

        [필수 규칙]
        1. 모든 재무 수치에는 반드시 천 단위 콤마(,)를 사용하세요.
        2. 답변 마지막에 [출처: 파일명 또는 검색 결과]을 명시하세요.
        3. 데이터가 전혀 없으면 "해당 데이터가 분석 대상 파일에 존재하지 않으며, 외부 검색으로도 확인이 어렵습니다."라고 답하세요.
        4. 전문적인 비즈니스 어조를 사용하고, 수치 뒤에 적절한 단위(원, 천원 등)를 붙이세요.
        5. 복잡한 비교는 Markdown 표(Table)를 활용하여 가독성을 높이세요.

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
