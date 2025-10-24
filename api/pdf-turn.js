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
    var input = [{
      role: "system",
      content: [{
        type: "input_text",
        text:
          "You are a helpful assistant answering questions about the attached PDF.\n" +
          "Rules: Be concise (≤80 words). Do NOT repeat earlier advice—build on it or ask a clarifying question.\n" +
          "Mention page numbers if they are clear from the text."
      }]
    }];
    
    // Push every prior turn (user/assistant) as input_text blocks
    (conversation || []).forEach(function (turn) {
      input.push({
        role: (turn && turn.role === "assistant") ? "assistant" : "user",
        content: [{ type: "input_text", text: String((turn && turn.content) || "") }]
      });
    });
    
    // Attach the PDF to the *latest user* message so file_search can ground the reply
    for (var i = input.length - 1; i >= 0; i--) {
      if (input[i].role === "user") {
        input[i].attachments = [{ file_id: file_id, tools: [{ type: "file_search" }] }];
        break;
      }
    }
    
    // Call Responses
    var r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        tools: [{ type: "file_search" }],       // enable tool globally
        text: { type: "text" },      // so data.output_text is present
        // temperature: 0.4, frequency_penalty: 0.2, // optional anti-repeat nudge
        input: input
      })
    });
    
    var raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: "OpenAI error", body: raw.slice(0, 500) });
    
    var data = {};
    try { data = JSON.parse(raw); } catch (e) {}
    
    var reply = (typeof data.output_text === "string") ? data.output_text : "";
    if (!reply && data.output && data.output[0] && data.output[0].content && data.output[0].content[0]) {
      reply = data.output[0].content[0].text || "";
    }
    
    var updated = conversation.concat({ role: "assistant", content: reply || "(no reply)" });
    return res.status(200).json({ reply: reply || "(no reply)", conversation: updated });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
