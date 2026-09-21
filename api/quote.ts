import { fetchQuote } from "./_lib/market.js";

export default async function handler(_req: any, res: any) {
  try {
    const quote = await fetchQuote();
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(quote);
  } catch (error: any) {
    console.error("[Quote] Fetch error:", error);
    return res.status(502).json({ error: error.message || "주가 정보를 가져오는 중 오류가 발생했습니다." });
  }
}
