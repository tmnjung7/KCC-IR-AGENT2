export const getGeminiResponse = async (prompt: string, context: string, model: 'pro' | 'flash' = 'pro', isEnglishMode: boolean = false) => {
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, context, model, isEnglishMode }),
    });

    if (!response.ok) {
      let errorMessage = 'AI 응답 중 오류가 발생했습니다.';
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch (e) {
        errorMessage = `서버 오류 (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    console.error("Gemini API Error (Service):", error);
    // 에러를 그대로 위로 던져서 App.tsx에서 처리하게 함
    throw error;
  }
};
