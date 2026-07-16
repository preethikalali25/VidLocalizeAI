// Thin wrapper around the Gemini REST API (Files API + generateContent).
// Uses plain fetch rather than the @google/generative-ai SDK because the
// SDK's file-upload support is oriented around Node's fs streams, which
// doesn't map cleanly onto Deno Edge Functions working with Uint8Array from
// Supabase Storage.
//
// Model IDs drift over time as Google renames/retires them (this one was
// bumped from gemini-2.0-flash to gemini-3-flash-preview after the former
// started 404ing) -- if `generateContent` calls start failing with a
// "model not found"/404 error, check the model dropdown in the AI Studio
// Playground for the current name and update GEMINI_MODEL below.

const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";

function apiKey(): string {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return key;
}

// Resumable upload per https://ai.google.dev/gemini-api/docs/document-processing#large-files
// Returns a Files API URI (e.g. "files/abc123") once the file is ACTIVE.
export async function uploadFileToGemini(
  bytes: Uint8Array,
  mimeType: string,
  displayName: string
): Promise<string> {
  const startRes = await fetch(`${GEMINI_API_BASE}/upload/v1beta/files?key=${apiKey()}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!startRes.ok) {
    throw new Error(`Gemini upload start failed: ${startRes.status} ${await startRes.text()}`);
  }
  const uploadUrl = startRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("Gemini upload start response missing X-Goog-Upload-URL header");

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: new Blob([bytes]),
  });
  if (!uploadRes.ok) {
    throw new Error(`Gemini upload finalize failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  const uploaded = await uploadRes.json();
  const fileUri: string = uploaded.file.uri;
  const fileName: string = uploaded.file.name; // e.g. "files/abc123"

  await waitForFileActive(fileName);
  return fileUri;
}

async function waitForFileActive(fileName: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${GEMINI_API_BASE}/v1beta/${fileName}?key=${apiKey()}`);
    if (!res.ok) throw new Error(`Gemini file status check failed: ${res.status} ${await res.text()}`);
    const file = await res.json();
    if (file.state === "ACTIVE") return;
    if (file.state === "FAILED") throw new Error("Gemini file processing failed");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Gemini file ${fileName} did not become ACTIVE within ${timeoutMs}ms`);
}

async function generateContent(parts: unknown[]): Promise<string> {
  const res = await fetch(
    `${GEMINI_API_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    }
  );
  if (!res.ok) {
    throw new Error(`Gemini generateContent failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini generateContent returned no text");
  return text;
}

export async function transcribeVideo(fileUri: string, mimeType: string, sourceLang: string): Promise<string> {
  return generateContent([
    { file_data: { file_uri: fileUri, mime_type: mimeType } },
    {
      text: `Transcribe the speech in this video verbatim, in its original language (${sourceLang}). ` +
        `Return only the transcript text, no timestamps, no speaker labels, no commentary.`,
    },
  ]);
}

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  return generateContent([
    {
      text: `Translate the following transcript into ${targetLanguage}, written for a voice presenter to read ` +
        `aloud naturally (not a stiff literal translation). Return only the translated text.\n\n${text}`,
    },
  ]);
}
