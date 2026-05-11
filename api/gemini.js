// api/gemini.js — Vercel Serverless Function (usando Groq como backend)

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GROQ_API_KEY not configured" });
  }

  try {
    const body = req.body;

    // Converte formato Gemini (contents[].parts[].text) → formato OpenAI (messages[].content)
    let messages = [];

    if (body.messages) {
      // Já está no formato OpenAI — usa direto
      messages = body.messages;
    } else if (body.contents) {
      // Converte de Gemini para OpenAI
      for (const item of body.contents) {
        const role = item.role === "model" ? "assistant" : "user";
        const text = item.parts?.map(p => p.text || "").join("") || "";
        messages.push({ role, content: text });
      }
    }

    const temperature = body.generationConfig?.temperature ?? 0.8;
    const max_tokens = body.generationConfig?.maxOutputTokens ?? 4096;

    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, messages, temperature, max_tokens }),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      console.error("Groq API error:", JSON.stringify(data));
      return res.status(groqRes.status).json(data);
    }

    // Converte resposta Groq (OpenAI) → formato Gemini para o App.jsx não precisar mudar
    const text = data.choices?.[0]?.message?.content || "";
    return res.status(200).json({
      candidates: [{ content: { parts: [{ text }] } }],
    });

  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}
