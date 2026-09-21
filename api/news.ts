import { fetchNews } from "./_lib/market.js";

export default async function handler(_req: any, res: any) {
  try {
    const result = await fetchNews();
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
    return res.status(200).json(result);
  } catch (error: any) {
    console.error("[News] Fetch error:", error);
    return res.status(502).json({ error: error.message || "뉴스를 가져오는 중 오류가 발생했습니다." });
  }
}
