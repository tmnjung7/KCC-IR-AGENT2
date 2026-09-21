import { fetchDartDataset, DartError } from "./_lib/dart.js";

// DART 첫 수집은 고유번호 파일(10MB) 다운로드 포함으로 기본 10초 제한을 넘을 수 있음
export const config = { maxDuration: 60 };

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
