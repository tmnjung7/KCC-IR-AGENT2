import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import "dotenv/config";
import { streamChat, availableProviders, type ChatRequest } from "./api/_lib/llm.js";
import { fetchDartDataset, DartError } from "./api/_lib/dart.js";
import { fetchNews, fetchQuote } from "./api/_lib/market.js";
import { checkRateLimit } from "./api/_lib/ratelimit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FAQ_FILE_PATH = path.join(__dirname, "src", "data", "faq.json");

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log(`[Server] NODE_ENV is: ${process.env.NODE_ENV}`);

  app.use(express.json({ limit: "10mb" }));

  // ── 프로바이더 가용성 (API 키 존재 여부) ─────────────────────────────────
  app.get("/api/providers", (_req, res) => {
    res.json(availableProviders());
  });

  // ── DART 전자공시 데이터 (자동 수집 + 6시간 캐시) ────────────────────────
  app.get("/api/dart-data", async (req, res) => {
    try {
      const force = String(req.query.force || "") === "1";
      const dataset = await fetchDartDataset({ force });
      res.json(dataset);
    } catch (error: any) {
      console.error("[DART] Fetch error:", error);
      const status = error instanceof DartError ? 502 : 500;
      res.status(status).json({ error: error.message || "DART 데이터를 가져오는 중 오류가 발생했습니다." });
    }
  });

  // ── KCC 뉴스 / 실시간 주가 ───────────────────────────────────────────────
  app.get("/api/news", async (_req, res) => {
    try {
      res.json(await fetchNews());
    } catch (error: any) {
      console.error("[News] Fetch error:", error);
      res.status(502).json({ error: error.message || "뉴스를 가져오는 중 오류가 발생했습니다." });
    }
  });

  app.get("/api/quote", async (_req, res) => {
    try {
      res.json(await fetchQuote());
    } catch (error: any) {
      console.error("[Quote] Fetch error:", error);
      res.status(502).json({ error: error.message || "주가 정보를 가져오는 중 오류가 발생했습니다." });
    }
  });

  // ── GitHub API Proxy (보조 데이터: 지식베이스 CSV 등) ────────────────────
  app.get("/api/repo-contents", async (req, res) => {
    const { repoPath } = req.query;
    if (!repoPath) return res.status(400).json({ error: "repoPath is required" });

    try {
      const cleanPath = String(repoPath).trim().replace(/\/$/, "").replace(/\.git$/, "");
      const apiUrl = `https://api.github.com/repos/${cleanPath}/contents`;

      const response = await fetch(apiUrl, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "KCC-IR-Assistant",
        },
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        return res.status(response.status).json({
          error: `GitHub API Error: ${response.status} ${errorData.message || response.statusText}`,
        });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[Proxy Error] GitHub API:", error);
      res.status(500).json({ error: error.message || "Failed to fetch repository contents" });
    }
  });

  // ── CSV Proxy ────────────────────────────────────────────────────────────
  app.get("/api/proxy-csv", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "url is required" });

    try {
      const response = await fetch(String(url));
      if (!response.ok) {
        return res.status(response.status).json({ error: `Failed to fetch CSV: ${response.statusText}` });
      }
      const text = await response.text();
      res.send(text);
    } catch (error: any) {
      console.error("[Proxy Error] CSV Fetch:", error);
      res.status(500).json({ error: error.message || "Failed to fetch CSV content" });
    }
  });

  // ── FAQ ──────────────────────────────────────────────────────────────────
  app.get("/api/faq", async (_req, res) => {
    try {
      const data = await fs.readFile(FAQ_FILE_PATH, "utf-8");
      res.json(JSON.parse(data));
    } catch {
      res.status(404).json({ error: "FAQ not found" });
    }
  });

  app.post("/api/faq", async (req, res) => {
    try {
      const newFaq = req.body;
      await fs.mkdir(path.dirname(FAQ_FILE_PATH), { recursive: true });
      await fs.writeFile(FAQ_FILE_PATH, JSON.stringify(newFaq, null, 2), "utf-8");
      res.json({ success: true });
    } catch (error) {
      console.error("[FAQ Save Error]:", error);
      res.status(500).json({ error: "Failed to save FAQ" });
    }
  });

  // ── 채팅 (Gemini / Claude 공용 SSE 스트림) ───────────────────────────────
  app.post("/api/chat", async (req, res) => {
    const { prompt, context, model, provider, isEnglishMode } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    const limit = checkRateLimit(req);
    if (!limit.allowed) return res.status(429).json({ error: limit.message });

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
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
