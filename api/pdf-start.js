export const config = { api: { bodyParser: false } };

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
    const Busboy = (await import("busboy")).default || (await import("busboy")).default;
    const bb = Busboy({ headers: req.headers });

    const files = [];
    let age = "", topic = "";
    await new Promise((resolve, reject) => {
      bb.on("file", (_name, file, info) => {
        const chunks = [];
        file.on("data", d => chunks.push(d));
        file.on("end", () => files.push({
          filename: info.filename || "upload.pdf",
          buffer: Buffer.concat(chunks),
          mime: info.mimeType || "application/pdf"
        }));
      });
      bb.on("field", (name, val) => { if (name==="age") age=String(val||""); if (name==="topic") topic=String(val||""); });
      bb.on("error", reject);
      bb.on("close", resolve);
      req.pipe(bb);
    });

    if (!files.length) return res.status(400).json({ error: "No PDF uploaded" });
    const pdf = files[0];

    // Upload file → OpenAI Files
    const form = new FormData();
    form.append("file", new Blob([pdf.buffer], { type: pdf.mime }), pdf.filename);
    form.append("purpose", "file-extract");

    const up = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const uploaded = await up.json();
    if (!up.ok) return res.status(up.status).json({ error: "File upload failed", body: uploaded });

    // Opening feedback using the file
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system",
            content: [ { type: "text", text: "You are a nutrition assistant. Give concise, supportive feedback with actionable suggestions." } ] },
          { role: "user",
            content: [
              { type: "input_text", text: "Please review the attached PDF and provide brief feedback, then invite the user to ask questions if they would like nutrition advice." },
              { type: "input_file", file_id: uploaded.id }
            ] }
        ]
      })
    });

    const raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: "OpenAI error", body: raw.slice(0,500) });

    let data = {}; try { data = JSON.parse(raw); } catch(_) {}
    let reply = "";
    if (typeof data.output_text === "string") reply = data.output_text;
    if (!reply && data.output && data.output[0] && data.output[0].content && data.output[0].content[0]) {
      reply = data.output[0].content[0].text || "";
    }

    return res.status(200).json({ file_id: uploaded.id, reply: reply || "(no reply)" });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
