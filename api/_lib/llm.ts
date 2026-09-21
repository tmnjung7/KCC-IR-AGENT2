/**
 * LLM 프로바이더 추상화 — Gemini + Claude를 하나의 SSE 스트림 인터페이스로 통합
 *
 * 이벤트 규약 (프론트엔드 공통):
 *   { text: string }                                      — 응답 청크
 *   { done: true, groundingMetadata?, model: string }     — 완료 (출처 메타 포함)
 *   { error: string }                                     — 오류
 *
 * 환경변수:
 *   GEMINI_API_KEY / API_KEY : Gemini 인증키
 *   ANTHROPIC_API_KEY        : Claude 인증키
 */
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import {
  STATIC_SYSTEM_INSTRUCTION,
  ENGLISH_MODE_SUFFIX,
  buildFullSystemInstruction,
  shouldUseSearch,
  STRICT_ANSWER_RULES,
} from "./prompt.js";

export type Provider = "gemini" | "claude";
export type ModelTier = "lite" | "flash" | "pro";

export interface ChatRequest {
  provider: Provider;
  tier: ModelTier;
  prompt: string;
  context: string;
  isEnglishMode: boolean;
  strict?: boolean; // 개선판(v2): 전망치·추정치 인용 차단 규칙 적용
}

export type SendEvent = (data: object) => void;

// ─────────────────────────────────────────────────────────────────────────────
// API 키 확인
// ─────────────────────────────────────────────────────────────────────────────
export function getGeminiKey(): string | null {
  let rawKey = process.env.GEMINI_API_KEY || "";
  if (!rawKey || rawKey.includes("Free Tier") || rawKey.length < 20) {
    rawKey = process.env.API_KEY || "";
  }
  const key = rawKey.trim().replace(/["'\s\t\n\r]/g, "");
  return key && key !== "undefined" && key.length >= 20 ? key : null;
}

export function getClaudeKey(): string | null {
  const key = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
  return key.length >= 20 ? key : null;
}

export function availableProviders(): { gemini: boolean; claude: boolean; dart: boolean } {
  return {
    gemini: !!getGeminiKey(),
    claude: !!getClaudeKey(),
    dart: !!(process.env.DART_API_KEY || "").trim(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini
// ─────────────────────────────────────────────────────────────────────────────
const GEMINI_MODELS: Record<ModelTier, string> = {
  lite: "gemini-2.5-flash-lite",
  flash: "gemini-2.5-flash",
  pro: "gemini-2.5-pro",
};

async function streamGemini(req: ChatRequest, send: SendEvent, isAborted: () => boolean): Promise<void> {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    send({ error: "Gemini API 키가 설정되지 않았습니다. GEMINI_API_KEY 환경변수를 확인해 주세요." });
    return;
  }

  const ai = new GoogleGenAI({ apiKey });
  const systemInstruction = buildFullSystemInstruction(req.context, req.isEnglishMode, !!req.strict);
  const useSearch = shouldUseSearch(req.prompt, req.context);
  let usedModel = GEMINI_MODELS[req.tier] || GEMINI_MODELS.flash;

  const startStream = async (modelName: string, searchOn: boolean, depth = 0): Promise<{ stream: any; model: string }> => {
    const config: any = {
      systemInstruction,
      temperature: modelName.includes("pro") ? 0.4 : 0.2,
    };
    if (searchOn) config.tools = [{ googleSearch: {} }];

    try {
      const stream = await ai.models.generateContentStream({
        model: modelName,
        contents: [{ parts: [{ text: req.prompt }] }],
        config,
      });
      return { stream, model: modelName };
    } catch (err: any) {
      const msg = err.message || "";
      if (depth > 2) throw err;

      if (searchOn && (msg.includes("tool") || msg.includes("search") || msg.includes("400"))) {
        return startStream(modelName, false, depth + 1);
      }
      // 모델이 없어진 경우(서비스 종료 등) 상위 모델로 폴백
      const isNotFound = msg.includes("404") || msg.toLowerCase().includes("not found") || msg.includes("NOT_FOUND");
      if (isNotFound && modelName.includes("lite")) {
        return startStream("gemini-2.5-flash", searchOn, depth + 1);
      }
      const isRateLimit = msg.includes("429") || msg.includes("quota") || msg.includes("limit") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("exhausted");
      if (isRateLimit && modelName === "gemini-2.5-pro") {
        return startStream("gemini-2.5-flash", searchOn, depth + 1);
      }
      if (isRateLimit && modelName === "gemini-2.5-flash") {
        return startStream("gemini-2.5-flash-lite", searchOn, depth + 1);
      }
      if (isRateLimit && searchOn) {
        return startStream(modelName, false, depth + 1);
      }
      if (depth < 2 && !msg.includes("400") && !msg.includes("401") && !msg.includes("403")) {
        await new Promise((r) => setTimeout(r, 1000 * (depth + 1)));
        return startStream(modelName, searchOn, depth + 1);
      }
      throw err;
    }
  };

  const { stream, model: activeModel } = await startStream(usedModel, useSearch);
  usedModel = activeModel;

  let lastChunk: any = null;
  for await (const chunk of stream) {
    if (isAborted()) return;
    if (chunk.text) send({ text: chunk.text });
    lastChunk = chunk;
  }

  if (!isAborted()) {
    const groundingMetadata = lastChunk?.candidates?.[0]?.groundingMetadata;
    send({ done: true, groundingMetadata, model: usedModel });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude
// ─────────────────────────────────────────────────────────────────────────────
const CLAUDE_MODELS: Record<ModelTier, string> = {
  lite: "claude-haiku-4-5",
  flash: "claude-sonnet-5",
  pro: "claude-opus-5",
};

// 웹검색 서버 도구: Sonnet 5 / Opus 5는 동적 필터링 버전, Haiku 4.5는 기본 버전
function claudeSearchTool(model: string): any {
  const type = model.includes("haiku") ? "web_search_20250305" : "web_search_20260209";
  return { type, name: "web_search", max_uses: 3 };
}

// 효과(effort) 설정: Haiku 4.5는 미지원이므로 생략
function claudeOutputConfig(model: string, tier: ModelTier): any | undefined {
  if (model.includes("haiku")) return undefined;
  return { effort: tier === "pro" ? "high" : "medium" };
}

async function streamClaude(req: ChatRequest, send: SendEvent, isAborted: () => boolean): Promise<void> {
  const apiKey = getClaudeKey();
  if (!apiKey) {
    send({ error: "Claude API 키가 설정되지 않았습니다. ANTHROPIC_API_KEY 환경변수를 확인해 주세요." });
    return;
  }

  const client = new Anthropic({ apiKey });
  const useSearch = shouldUseSearch(req.prompt, req.context);

  // 프롬프트 캐싱: 고정 지침 블록에만 cache_control → 이후 요청은 해당 부분 ~90% 절감
  const contextBlockText = `## 8. 데이터 컨텍스트\n\n${req.context}${req.strict ? STRICT_ANSWER_RULES : ""}${req.isEnglishMode ? ENGLISH_MODE_SUFFIX : ""}`;
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: STATIC_SYSTEM_INSTRUCTION, cache_control: { type: "ephemeral" } },
    { type: "text", text: contextBlockText },
  ];

  const fallbackChain: ModelTier[] = req.tier === "pro" ? ["pro", "flash", "lite"] : req.tier === "flash" ? ["flash", "lite"] : ["lite"];

  let lastError: any = null;
  for (const tier of fallbackChain) {
    const model = CLAUDE_MODELS[tier];
    try {
      const params: Anthropic.MessageStreamParams = {
        model,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: req.prompt }],
      };
      const outputConfig = claudeOutputConfig(model, tier);
      if (outputConfig) (params as any).output_config = outputConfig;
      if (useSearch) params.tools = [claudeSearchTool(model)];

      const stream = client.messages.stream(params);

      stream.on("text", (text) => {
        if (!isAborted() && text) send({ text });
      });

      const finalMessage = await stream.finalMessage();
      if (isAborted()) return;

      // 웹검색 출처 → Gemini groundingMetadata와 호환되는 형태로 매핑
      const chunks: { web: { uri: string; title: string } }[] = [];
      const seen = new Set<string>();
      for (const block of finalMessage.content) {
        if ((block as any).type === "web_search_tool_result") {
          const content = (block as any).content;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item?.type === "web_search_result" && item.url && !seen.has(item.url)) {
                seen.add(item.url);
                chunks.push({ web: { uri: item.url, title: item.title || item.url } });
              }
            }
          }
        }
      }

      send({
        done: true,
        groundingMetadata: chunks.length > 0 ? { groundingChunks: chunks.slice(0, 8) } : undefined,
        model,
      });
      return;
    } catch (err: any) {
      lastError = err;
      // 레이트리밋/과부하 → 하위 티어로 폴백, 그 외 오류는 즉시 중단
      const retryable =
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        (err instanceof Anthropic.APIError && (err.status === 429 || (err.status !== undefined && err.status >= 500)));
      if (!retryable) break;
    }
  }

  if (!isAborted()) {
    let message = "AI 응답 중 오류가 발생했습니다.";
    if (lastError instanceof Anthropic.AuthenticationError) {
      message = "Claude API 키가 유효하지 않습니다. ANTHROPIC_API_KEY를 확인해 주세요.";
    } else if (lastError instanceof Anthropic.RateLimitError) {
      message = "현재 AI 요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요. (API 한도 초과)";
    } else if (lastError?.message) {
      message = lastError.message;
    }
    send({ error: message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────
export async function streamChat(req: ChatRequest, send: SendEvent, isAborted: () => boolean): Promise<void> {
  if (req.provider === "claude") {
    return streamClaude(req, send, isAborted);
  }
  return streamGemini(req, send, isAborted);
}
