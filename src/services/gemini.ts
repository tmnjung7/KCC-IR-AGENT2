export const getGeminiResponse = async (prompt: string, context: string) => {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, context }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "서버 응답 오류가 발생했습니다.");
    }

    const data = await response.json();
    return data.text || "답변을 생성할 수 없습니다.";
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error.message?.includes("413")) {
      return "데이터가 너무 방대하여 분석에 실패했습니다. 질문을 더 구체적으로(예: 특정 연도나 항목 지정) 해주세요.";
    }
    return `AI 응답 중 오류가 발생했습니다: ${error.message || "알 수 없는 오류"}`;
  }
};
