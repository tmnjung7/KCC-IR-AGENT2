export const getGeminiResponse = async (
  prompt: string,
  context: string,
  model: 'pro' | 'flash' = 'pro',
  isEnglishMode: boolean = false
) => {
  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
        // 할당량 초과는 재시도해도 소용없으므로 즉시 throw
        if (response.status === 429) throw new Error(errorMessage);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error(`Gemini API Error (attempt ${attempt}/${MAX_RETRIES}):`, error);

      // 할당량 초과(429)는 재시도 없이 바로 상위로 전달
      if (error.message?.includes('429') || error.message?.includes('quota')) {
        throw error;
      }

      // 마지막 시도까지 실패했으면 throw
      if (attempt === MAX_RETRIES) {
        throw error;
      }

      // 재시도 전 1.5초 대기 (첫 질문 cold-start 오류 대응)
      console.warn(`[Retry] ${attempt}/${MAX_RETRIES - 1} 재시도 중... 1.5초 대기`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
};
