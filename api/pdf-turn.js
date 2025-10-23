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
    const input = [{
      role: "system",
      content: [{
        type: "text",
        text: [
          "You are a helpful assistant answering questions about the attached PDF.",
          "Rules:",
          "• Do NOT repeat advice already given; instead build on it or ask a clarifying follow-up.",
          "• If you refer to specific text, mention page numbers when clear."
        ].join("\n")
      }]
    }];

    // 2) Push the full back-and-forth as text blocks
    //    (We’ll add the file to the *latest* user block below.)
    for (const turn of conversation) {
      const role = turn.role === "assistant" ? "assistant" : "user";
      input.push({
        role,
        content: [{ type: "text", text: String(turn.content || "") }]
      });
    }

    // 3) Attach the file to the last user message so the model can ground answers
    for (let i = input.length - 1; i >= 0; i--) {
      if (input[i].role === "user") {
        input[i].content.push({ type: "input_file", file_id });
        break;
      }
    }

    // 4) Call OpenAI Responses
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        // You can also set temperature or penalties if you want slightly more variety:
        // temperature: 0.4,
        // frequency_penalty: 0.2,
        input
      })
    });

    const raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: "OpenAI error", body: raw.slice(0, 500) });

    let data = {};
    try { data = JSON.parse(raw); } catch {}
    let reply = "";
    if (typeof data.output_text === "string") reply = data.output_text;
    if (!reply && data.output && data.output[0] && data.output[0].content && data.output[0].content[0]) {
      reply = data.output[0].content[0].text || "";
    }

    const updated = conversation.concat({ role: "assistant", content: reply || "(no reply)" });
    return res.status(200).json({ reply: reply || "(no reply)", conversation: updated });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
