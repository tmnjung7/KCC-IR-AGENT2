import fs from "fs/promises";
import path from "path";

export default async function handler(req: any, res: any) {
  const FAQ_FILE_PATH = path.join(process.cwd(), "src", "data", "faq.json");

  if (req.method === 'GET') {
    try {
      const data = await fs.readFile(FAQ_FILE_PATH, "utf-8");
      return res.status(200).json(JSON.parse(data));
    } catch (error) {
      return res.status(404).json({ error: "FAQ not found" });
    }
  }

  if (req.method === 'POST') {
    try {
      const newFaq = req.body;
      // Note: This will likely fail on Vercel's read-only filesystem
      // but we keep it for local dev and consistency.
      await fs.mkdir(path.dirname(FAQ_FILE_PATH), { recursive: true });
      await fs.writeFile(FAQ_FILE_PATH, JSON.stringify(newFaq, null, 2), "utf-8");
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("[FAQ Save Error]:", error);
      return res.status(500).json({ error: "Failed to save FAQ (Vercel is read-only)" });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
