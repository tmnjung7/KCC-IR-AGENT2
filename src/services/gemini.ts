import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY || "";

export const getGeminiResponse = async (prompt: string, context: string) => {
  try {
    if (!API_KEY) {
      return "GEMINI_API_KEY가 설정되지 않았습니다. 설정 메뉴의 Secrets에서 키를 추가해 주세요.";
    }

    const ai = new GoogleGenAI({ apiKey: API_KEY });
    
    const systemInstruction = `
      당신은 KCC IR 부서의 전문 AI 어시스턴트입니다. 
      제공된 데이터(Context)는 엑셀/CSV 형태의 재무 제표 데이터입니다.

      [데이터 해석 가이드]
      1. 데이터는 '[파일명] 항목: ... | 기간: 값 | 기간: 값' 또는 '데이터: 컬럼명: 값 | 컬럼명: 값' 형식으로 제공됩니다.
      2. 각 행(Row)은 특정 항목의 시계열 데이터이거나, 특정 시점의 상세 데이터입니다.
      3. 질문에서 요구하는 '기간(예: 3Q25, 2025 3분기)'과 '항목(예: 연결 매출액, 영업이익)'을 데이터 내에서 찾아 정확한 수치를 읽으세요.
      4. '3Q25'는 '2025년 3분기'와 동일한 의미입니다.

      [필수 규칙]
      1. 모든 재무 수치에는 반드시 천 단위 콤마(,)를 사용하세요.
      2. 답변 마지막에 [출처: 파일명]을 명시하세요.
      3. 데이터가 없으면 "해당 데이터가 분석 대상 파일에 존재하지 않습니다."라고 답하세요. 절대 추측하지 마세요.
      4. 전문적인 비즈니스 어조를 사용하세요.
      5. 추세(Trend)를 물어보는 경우, 수치 변화를 언급하며 간단히 분석해 주세요.

      [데이터 컨텍스트]
      ${context}
    `;

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
      },
    });

    return response.text || "답변을 생성할 수 없습니다.";
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error.message?.includes("413")) {
      return "데이터가 너무 방대하여 분석에 실패했습니다. 질문을 더 구체적으로(예: 특정 연도나 항목 지정) 해주세요.";
    }
    return `AI 응답 중 오류가 발생했습니다: ${error.message || "알 수 없는 오류"}`;
  }
};
