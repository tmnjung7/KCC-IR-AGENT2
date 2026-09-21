export type Provider = 'gemini' | 'claude';
export type ModelTier = 'lite' | 'flash' | 'pro';

export interface ProviderAvailability {
  gemini: boolean;
  claude: boolean;
  dart: boolean;
}

export const fetchProviderAvailability = async (): Promise<ProviderAvailability> => {
  try {
    const res = await fetch('/api/providers');
    if (!res.ok) throw new Error('unavailable');
    return await res.json();
  } catch {
    // 확인 불가 시 기존 동작(Gemini)만 노출
    return { gemini: true, claude: false, dart: false };
  }
};

export const getAIResponse = async (
  prompt: string,
  context: string,
  provider: Provider = 'gemini',
  model: ModelTier = 'flash',
  isEnglishMode: boolean = false,
  onChunk?: (text: string) => void
) => {
  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 관리자 모드 인증 시 저장된 토큰 → 요청 제한 우회 (관리자 테스트용)
      let adminToken = '';
      try { adminToken = sessionStorage.getItem('kcc_admin_token') || ''; } catch { /* 무시 */ }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminToken ? { "x-admin-token": adminToken } : {}),
        },
        body: JSON.stringify({ prompt, context, provider, model, isEnglishMode }),
      });

      if (!response.ok) {
        let errorMessage = 'AI 응답 중 오류가 발생했습니다.';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = `서버 오류 (${response.status}): ${response.statusText}`;
        }
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
      console.error(`LLM API Error (attempt ${attempt}/${MAX_RETRIES}):`, error);
      if (error.message?.includes('429') || error.message?.includes('quota')) throw error;
      if (attempt === MAX_RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
};

/** 화면 표시용 모델명 */
export const modelDisplayName = (provider: Provider, tier: ModelTier): string => {
  if (provider === 'claude') {
    return tier === 'pro' ? 'Claude Opus 5' : tier === 'lite' ? 'Claude Haiku 4.5' : 'Claude Sonnet 5';
  }
  return tier === 'pro' ? 'Gemini 2.5 Pro' : tier === 'lite' ? 'Gemini 2.0 Flash Lite' : 'Gemini 2.5 Flash';
};
