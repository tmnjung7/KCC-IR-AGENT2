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
    return data;
  } catch (error: any) {
    console.error("Gemini API Error (Service):", error);
    // 에러를 그대로 위로 던져서 App.tsx에서 처리하게 함
    throw error;
  }
};
