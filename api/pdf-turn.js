// /api/pdf-turn.js
function setCORS(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "https://berkeley.yul1.qualtrics.com");
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

    // Build an input that includes the PDF every time
    // We send the latest user message + prior assistant turns as plain text
    const contentBlocks = [];
    // System style
    contentBlocks.push({
      role: "system",
      content: [ { type: "text", text: "You are a helpful assistant that offers nutrition advice to college students." } ]
    });

    // Fold convo into one 'user' block followed by the file
    // (Responses API will accept multiple input blocks; this is a compact pattern.)
    var last = conversation[conversation.length - 1] || { role:"user", content:"" };
    contentBlocks.push({
      role: "user",
      content: [
        { type: "input_text", text: last.content || "" },
        { type: "input_file", file_id: file_id }
      ]
    });

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: "gpt-4o-mini", input: contentBlocks })
    });

    const raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: "OpenAI error", body: raw.slice(0,500) });

    let data = {}; try { data = JSON.parse(raw); } catch(_) {}
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
