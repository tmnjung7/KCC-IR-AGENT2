import { streamChat, type ChatRequest } from "./_lib/llm.js";
import { checkRateLimit } from "./_lib/ratelimit.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, context, model, provider, isEnglishMode } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const limit = checkRateLimit(req);
  if (!limit.allowed) {
    return res.status(429).json({ error: limit.message });
  }

  const chatReq: ChatRequest = {
    provider: provider === "claude" ? "claude" : "gemini",
    // PRO 티어는 비용 문제로 비활성화 — 요청이 와도 FLASH로 처리
    tier: model === "lite" ? "lite" : "flash",
    prompt: String(prompt),
    context: String(context || ""),
    isEnglishMode: !!isEnglishMode,
  };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  let clientAborted = false;
  req.on("close", () => { clientAborted = true; });

  const send = (data: object) => {
    if (clientAborted) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  };

  try {
    await streamChat(chatReq, send, () => clientAborted);
  } catch (error: any) {
    console.error("Streaming Error:", error);
    if (!clientAborted) send({ error: error.message || "AI 응답 중 오류가 발생했습니다." });
  } finally {
    res.end();
  }
}
