import { fetchDartDataset, DartError } from "./_lib/dart";

export default async function handler(req: any, res: any) {
  try {
    const force = String(req.query?.force || "") === "1";
    const dataset = await fetchDartDataset({ force });
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=21600");
    return res.status(200).json(dataset);
  } catch (error: any) {
    console.error("[DART] Fetch error:", error);
    const status = error instanceof DartError ? 502 : 500;
    return res.status(status).json({ error: error.message || "DART 데이터를 가져오는 중 오류가 발생했습니다." });
  }
}
