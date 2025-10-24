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
    // Build a readable transcript from the whole conversation
    function asTranscript(convo) {
      var lines = [];
      for (var i = 0; i < (convo || []).length; i++) {
        var t = convo[i] || {};
        var role = (t.role === "assistant") ? "Assistant" : "User";
        lines.push(role + ": " + String(t.content || ""));
      }
      return lines.join("\n");
    }
    
    // Find the most recent *user* message (don’t assume last item — it might be assistant)
    function lastUserMessage(convo) {
      for (var i = (convo || []).length - 1; i >= 0; i--) {
        var t = convo[i] || {};
        if (t.role !== "assistant") return String(t.content || "");
      }
      return "";
    }
    
    // ----- inside your handler after reading body -----
    var file_id = body.file_id || "";
    var conversation = Array.isArray(body.conversation) ? body.conversation : [];
    
    if (!file_id) return res.status(400).json({ error: "Missing file_id" });
    
    var transcript = asTranscript(conversation);
    var latestUser = lastUserMessage(conversation);
    
    // Build Responses input: system + one user message containing the PDF and text prompts
    var input = [
      {
        role: "system",
        content: [{
          type: "input_text",
          text:
            "You are answering questions about the attached PDF. " +
            "Be concise (≤80 words). Do not repeat prior advice; build on it or ask a clarifying question. " +
            "Mention page numbers when clear."
        }]
      },
      {
        role: "user",
        content: [
          { type: "input_file", file_id: file_id },
          { type: "input_text", text: "Conversation so far:\n" + transcript },
          { type: "input_text", text: "Latest user question:\n" + latestUser }
        ]
      }
    ];
    
    var r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: input
        // (INTENTIONALLY omit text/response_format to avoid schema mismatches)
        // Optional anti-repeat:
        // temperature: 0.4,
        // frequency_penalty: 0.2
      })
    });
    
    var raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: "OpenAI error", body: raw.slice(0, 500) });
    
    var data = {};
    try { data = JSON.parse(raw); } catch (_){}
    var reply = extractReply(data);
    
    var updated = conversation.concat({ role: "assistant", content: reply || "(no reply)" });
    return res.status(200).json({ reply: reply || "(no reply)", conversation: updated });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
