import { availableProviders } from "./_lib/llm.js";

export default async function handler(_req: any, res: any) {
  res.status(200).json(availableProviders());
}
