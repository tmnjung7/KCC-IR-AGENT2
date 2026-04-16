export const getGeminiResponse = async (
  prompt: string,
  context: string,
  model: 'pro' | 'flash' = 'pro',
  isEnglishMode: boolean = false,
  onChunk?: (text: string) => void
) => {
  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, context, model, isEnglishMode }),
      });

      if (!response.ok) {
        let errorMessage = 'AI 응답 중 오류가 발생했습니다.';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = `서버 오류 (${response.status}): ${response.statusText}`;
        }
        if (response.status === 429) throw new Error(errorMessage);
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type') || '';

      // ── SSE 스트리밍 응답 처리 ──────────────────────────────────────────
      if (contentType.includes('text/event-stream')) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const result: { text: string; groundingMetadata?: any; model?: string } = { text: '' };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            let data: any;
            try { data = JSON.parse(raw); } catch { continue; }

            if (data.error) throw new Error(data.error);

            if (data.done) {
              result.groundingMetadata = data.groundingMetadata;
              result.model = data.model;
            } else if (data.text) {
              result.text += data.text;
              onChunk?.(data.text);
            }
          }
        }
        return result;
      }

      // ── 일반 JSON 응답 처리 (fallback) ─────────────────────────────────
      const data = await response.json();
      if (data.text) onChunk?.(data.text);
      return data;

    } catch (error: any) {
      console.error(`Gemini API Error (attempt ${attempt}/${MAX_RETRIES}):`, error);
      if (error.message?.includes('429') || error.message?.includes('quota')) throw error;
      if (attempt === MAX_RETRIES) throw error;
      console.warn(`[Retry] ${attempt}/${MAX_RETRIES - 1} 재시도 중... 1.5초 대기`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
};
