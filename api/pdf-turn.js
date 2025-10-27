// /api/pdf-turn.js
function setCORS(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", "https://berkeley.yul1.qualtrics.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");
}

function extractReply(data) {
  // 1) Preferred: flat text provided by Responses
  if (data && typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  // 2) Search the structured output array for any output_text blocks
  try {
    if (data && Array.isArray(data.output)) {
      for (var i = 0; i < data.output.length; i++) {
        var item = data.output[i];
        if (item && Array.isArray(item.content)) {
          for (var j = 0; j < item.content.length; j++) {
            var c = item.content[j];
            // Common shapes: { type: "output_text", text: "..." } or nested
            if (c && c.type === "output_text" && typeof c.text === "string" && c.text.trim()) {
              return c.text.trim();
            }
            if (c && c.type === "output_text" && c.text && typeof c.text.value === "string" && c.text.value.trim()) {
              return c.text.value.trim();
            }
          }
        }
      }
    }
  } catch (_) {}
  // 3) Nothing found
  return "";
}


export default async function handler(req, res) {
  // 1️⃣  Always set CORS first
  setCORS(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 2️⃣  Parse body & build your OpenAI payload
    const body = req.body ? (typeof req.body === "string" ? JSON.parse(req.body) : req.body) : {};
    const { file_id, conversation } = body;

    const input = [
      {
        role: "system",
        content: [{ type: "input_text", text: "You are a helpful assistant summarizing PDFs." }]
      },
      {
        role: "user",
        content: [
          { type: "input_file", file_id },
          { type: "input_text", text: "Conversation so far:\n" + JSON.stringify(conversation) }
        ]
      }
    ];

    // 3️⃣  ✅ This is the “step 4” block — the OpenAI call wrapped in a safe try/catch
    let raw = "";
    try {
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: "gpt-4o-mini", input })
      });
      raw = await r.text();

      // always send JSON response even on error
      if (!r.ok) {
        res.status(r.status).json({
          error: "OpenAI error",
          body: raw.slice(0, 500)
        });
        return; // prevent fall-through
      }
    } catch (err) {
      res.status(502).json({ error: "Upstream fetch failed", detail: String(err) });
      return;
    }

    // 4️⃣  Parse & send final reply (so Qualtrics always gets a body)
    let data;
    try { data = JSON.parse(raw); } catch (_) {}
    const reply = extractReply(data) || "(no reply)";
    res.status(200).json({ reply });
  } catch (err) {
    // 5️⃣  Safety net: catch anything else
    res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
