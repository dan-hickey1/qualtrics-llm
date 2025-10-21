// Vercel will deploy any JS file under /api as a serverless function.
// POST https://<your-project>.vercel.app/api/chat

export default async function handler(req, res) {
  // Basic CORS for your Qualtrics brand domain (adjust to yours)
  const allowOrigin = "https://berkeley.qualtrics.com";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end(); // preflight

  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { conversation = [], embeddedData = {}, model = "gpt-4o-mini" } = req.body || {};

    const system = { role: "system", content: "You are an assistant in a research survey. Keep replies <=120 words." };
    const context = { role: "user", content: `Earlier answers: ${JSON.stringify(embeddedData)}` };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        // Responses API accepts arrays of input items; we pass system/context + prior turns
        input: [system, context, ...conversation]
      })
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: text });
    }
    const data = await r.json();

    // Pull assistant text from Responses API output
    const assistantText =
      data.output?.[0]?.content?.[0]?.text ??
      data.output_text ?? "";

    return res.status(200).json({
      reply: assistantText,
      conversation: [...conversation, { role: "assistant", content: assistantText }]
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
