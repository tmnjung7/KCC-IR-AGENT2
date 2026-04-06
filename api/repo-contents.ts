export default async function handler(req: any, res: any) {
  const { repoPath } = req.query;
  if (!repoPath) return res.status(400).json({ error: "repoPath is required" });

  try {
    const cleanPath = String(repoPath).trim().replace(/\/$/, '').replace(/\.git$/, '');
    const apiUrl = `https://api.github.com/repos/${cleanPath}/contents`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'KCC-IR-Assistant'
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({ 
        error: `GitHub API Error: ${response.status} ${errorData.message || response.statusText}` 
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error("[GitHub Proxy Error]:", error);
    res.status(500).json({ error: "GitHub 데이터를 가져오는 중 오류가 발생했습니다." });
  }
}
