// api/gemini.js — Vercel Serverless Function

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured" });
  }

  // GET: lista modelos disponíveis para debug
  if (req.method === "GET") {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const d = await r.json();
    return res.status(200).json(d);
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Tenta cada modelo até um funcionar
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const geminiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await geminiRes.json();
      if (geminiRes.ok) {
        console.log(`Using model: ${model}`);
        return res.status(200).json(data);
      }
      if (geminiRes.status !== 404) {
        console.error(`Model ${model} error ${geminiRes.status}:`, JSON.stringify(data));
        return res.status(geminiRes.status).json(data);
      }
      console.log(`Model ${model} not found, trying next...`);
    } catch (err) {
      console.error(`Model ${model} threw:`, err.message);
    }
  }

  return res.status(404).json({ error: "No available Gemini model found for this API key" });
}
