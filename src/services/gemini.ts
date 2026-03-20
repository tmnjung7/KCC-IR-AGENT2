import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY || "";

export const getGeminiResponse = async (prompt: string, context: string) => {
  if (!API_KEY) {
    throw new Error("GEMINI_API_KEY is missing. Please add it to your secrets.");
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const systemInstruction = `
    당신은 KCC IR 부서의 전문 AI 어시스턴트입니다. 
    제공된 데이터(Context)를 바탕으로 투자자와 애널리스트의 질문에 정확하게 답변해야 합니다.

    [필수 규칙]
    1. 모든 재무 수치에는 반드시 천 단위 콤마(,)를 사용하세요 (예: 1,234,567).
    2. 답변의 마지막에는 반드시 출처를 명시하세요. 데이터에 출처 정보가 있다면 그것을 사용하고, 없다면 [출처: KCC IR Data]라고 표기하세요.
    3. 제공된 데이터에 없는 내용은 절대 지어내지 마세요. 데이터가 없으면 "해당 데이터가 존재하지 않아 답변이 어렵습니다."라고 정중히 답하세요.
    4. 전문적이고 신뢰감 있는 비즈니스 어조(한국어)를 사용하세요.
    5. 질문이 구체적인 수치를 요구할 경우, 표나 리스트 형식을 활용해 가독성을 높여주세요.

    [데이터 컨텍스트]
    ${context}
  `;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1, // 낮은 온도로 환각 최소화
      },
    });

    return response.text || "답변을 생성할 수 없습니다.";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "AI 응답 중 오류가 발생했습니다.";
  }
};
