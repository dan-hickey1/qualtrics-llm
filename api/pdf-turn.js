// /api/pdf-turn.js
function setCORS(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", "https://berkeley.yul1.qualtrics.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");
}

export default async function handler(req, res) {
  setCORS(res, req.headers.origin);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = req.body || {};
    const file_id = body.file_id || "";
    const conversation = Array.isArray(body.conversation) ? body.conversation : [];
    if (!file_id) return res.status(400).json({ error: "Missing file_id" });

    // 1) System rules to reduce repetition and keep answers tight
    // Build the Responses API input with the FULL history
    function asTranscript(convo) {
      var lines = [];
      for (var i = 0; i < convo.length; i++) {
        var t = convo[i];
        var role = (t && t.role === "assistant") ? "Assistant" : "User";
        lines.push(role + ": " + String((t && t.content) || ""));
      }
      return lines.join("\n");
    }
    
    // latest user message should be the last item in `conversation`
    const lastUser = (conversation[conversation.length - 1] && conversation[conversation.length - 1].content) || "";
    
    // Build inputs: system → user (pdf + transcript + latest question)
    const input = [
      {
        role: "system",
        content: [{
          type: "input_text",
          text:
            "You are answering questions about the attached PDF. Be concise (≤80 words). " +
            "Do not repeat prior advice; build on it or ask a clarifying question. " +
            "Mention page numbers when clear from the text."
        }]
      },
      {
        role: "user",
        content: [
          { type: "input_file", file_id: file_id },                                    // PDF
          { type: "input_text", text: "Conversation so far:\n" + asTranscript(conversation) },
          { type: "input_text", text: "Latest user question:\n" + String(lastUser || "") }
        ]
      }
    ];
    
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        // temperature: 0.4, frequency_penalty: 0.2,  // optional anti-repeat nudge
        input
      })
    });
    
    const raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: "OpenAI error", body: raw.slice(0, 500) });
    
    let data = {}; try { data = JSON.parse(raw); } catch (_) {}
    let reply = (typeof data.output_text === "string") ? data.output_text : "";
    const updated = conversation.concat({ role: "assistant", content: reply || "(no reply)" });
    
    return res.status(200).json({ reply: reply || "(no reply)", conversation: updated });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
