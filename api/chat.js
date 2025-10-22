// /api/chat.js  (Node runtime on Vercel, ES module ok)
const ALLOW_ALL = true; // flip to false after it works
const ORIGIN_WHITELIST = [
  // add your exact survey origins here when ALLOW_ALL=false
  "https://YOURBRAND.qualtrics.com",
  "https://YOURVANITYDOMAIN.example.edu" // if you use one
];

function corsHeaders(origin) {
  const allowOrigin = ALLOW_ALL ? "*" :
    (ORIGIN_WHITELIST.indexOf(origin) >= 0 ? origin : "https://YOURBRAND.qualtrics.com");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  // 1) Handle preflight cleanly
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Only POST is allowed
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    const body = req.body || {};
    const conversation = Array.isArray(body.conversation) ? body.conversation : [];
    const embeddedData = body.embeddedData || {};
    const model = body.model || "gpt-4o-mini";

    // Build OpenAI payload
    const system = { role: "system", content: "You are an assistant in a research survey. Keep replies <=120 words." };
    const context = { role: "user", content: "Earlier answers: " + JSON.stringify(embeddedData) };

    // Call OpenAI Responses API
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, input: [system, context, ...conversation] })
    });

    const raw = await r.text();
    if (!r.ok) {
      // Bubble details to the browser (keep CORS headers on error too)
      res.status(r.status).json({ error: "OpenAI " + r.status, body: raw.slice(0, 500) });
      return;
    }

    let data = {};
    try { data = JSON.parse(raw); } catch (_) {}

    // Extract assistant text for both known shapes
    let assistantText = "";
    if (data && data.output && data.output[0] && data.output[0].content && data.output[0].content[0]) {
      assistantText = data.output[0].content[0].text || "";
    }
    if (!assistantText && typeof data.output_text === "string") assistantText = data.output_text;

    const updated = conversation.concat({ role: "assistant", content: assistantText || "(empty)" });

    res.status(200).json({ reply: assistantText || "(empty)", conversation: updated });
  } catch (err) {
    // Still return CORS headers here
    res.status(500).json({ error: String(err) });
  }
}
