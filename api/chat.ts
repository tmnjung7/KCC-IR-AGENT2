import { GoogleGenAI } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, context } = req.body;
  
  // Get key and clean it thoroughly
  let rawKey = process.env.GEMINI_API_KEY || "";
  
  // If the default key is the placeholder "AI Studio Free Tier", use the custom API_KEY instead
  if (!rawKey || rawKey.includes("Free Tier") || rawKey.length < 20) {
    rawKey = process.env.API_KEY || "";
  }

  let API_KEY = rawKey.trim().replace(/["'\s\t\n\r]/g, "");

  if (!API_KEY || API_KEY === "undefined" || API_KEY.length < 20) {
    return res.status(500).json({ 
      error: "유효한 API 키가 서버에 설정되지 않았습니다. Vercel 설정에서 API_KEY 환경 변수를 확인해 주세요. (키는 AIza로 시작해야 합니다)" 
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    
    const systemInstruction = `
      당신은 KCC IR 부서의 전문 AI 어시스턴트입니다. 
      제공된 데이터(Context)는 엑셀/CSV 형태의 재무 제표 데이터입니다.

      [필수 규칙]
      1. 모든 재무 수치에는 반드시 천 단위 콤마(,)를 사용하세요.
      2. 답변 마지막에 [출처: 파일명]을 명시하세요.
      3. 데이터가 없으면 "해당 데이터가 분석 대상 파일에 존재하지 않습니다."라고 답하세요.
      4. 전문적인 비즈니스 어조를 사용하고, 수치 뒤에 적절한 단위(원, 천원 등)를 붙이세요.

      [데이터 컨텍스트]
      ${context}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
      },
    });

    return res.status(200).json({ text: response.text });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return res.status(500).json({ error: error.message || "AI 응답 중 오류가 발생했습니다." });
  }
}
