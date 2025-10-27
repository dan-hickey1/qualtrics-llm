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
  setCORS(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const file_id = body.file_id || "";
    const conversation = Array.isArray(body.conversation) ? body.conversation : [];
    if (!file_id) return res.status(400).json({ error: "Missing file_id" });

    // Build a minimal, stable Responses payload
    const input = [
      { role: "system", content: [{ type: "input_text", text: "Answer concisely (≤80 words). Avoid repeating prior advice." }] },
      { role: "user",   content: [
          { type: "input_file", file_id },
          { type: "input_text", text: "Transcript:\n" + conversation.map(t => ((t.role==="assistant"?"Assistant: ":"User: ")+String(t.content||""))).join("\n") }
      ] }
    ];

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
      if (!r.ok) {
        res.status(r.status).json({ error: "OpenAI error", body: raw.slice(0, 500) });
        return;
      }
    } catch (err) {
      res.status(502).json({ error: "Upstream fetch failed", detail: String(err) });
      return;
    }

    let data; try { data = JSON.parse(raw); } catch (_){}
    // robust extraction
    let reply = "";
    if (data && typeof data.output_text === "string" && data.output_text.trim()) reply = data.output_text.trim();
    if (!reply && Array.isArray(data?.output)) {
      for (const item of data.output) {
        for (const c of (item?.content||[])) {
          if (c?.type === "output_text" && typeof c.text === "string" && c.text.trim()) { reply = c.text.trim(); break; }
          if (c?.type === "output_text" && typeof c.text?.value === "string" && c.text.value.trim()) { reply = c.text.value.trim(); break; }
        }
        if (reply) break;
      }
    }
    res.status(200).json({ reply: reply || "(no reply)", conversation: conversation.concat({ role:"assistant", content: reply || "(no reply)" }) });
  } catch (e) {
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
}

