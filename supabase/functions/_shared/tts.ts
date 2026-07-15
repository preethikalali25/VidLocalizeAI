// Text-to-speech for the translated transcript.
//
// Primary path: Gemini's native TTS (same GEMINI_API_KEY as transcription/
// translation, no separate account or billing card). Risk (flagged in the
// project plan, unverified as of writing): Gemini TTS's prebuilt voices may
// not cover all five target languages (Hindi/Telugu/Tamil/Kannada/Bengali)
// with good quality -- test this per-language before relying on it.
//
// Fallback path: Google Cloud Text-to-Speech, which has well-established
// per-locale voice support for all five languages, but requires a GCP
// project with billing enabled even on the free tier. Only used if
// GOOGLE_TTS_API_KEY is set as a secret; otherwise Gemini TTS is used.

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

// Google Cloud TTS voice per target language -- verify these still exist in
// the GCP console (Text-to-Speech -> Voices) when you set this up; voice
// catalogs change over time.
const GOOGLE_TTS_VOICE: Record<string, { languageCode: string; name: string }> = {
  hindi: { languageCode: "hi-IN", name: "hi-IN-Wavenet-A" },
  telugu: { languageCode: "te-IN", name: "te-IN-Standard-A" },
  tamil: { languageCode: "ta-IN", name: "ta-IN-Wavenet-A" },
  kannada: { languageCode: "kn-IN", name: "kn-IN-Standard-A" },
  bengali: { languageCode: "bn-IN", name: "bn-IN-Wavenet-A" },
};

export async function synthesizeSpeech(
  text: string,
  targetLanguage: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const googleTtsKey = Deno.env.get("GOOGLE_TTS_API_KEY");
  return googleTtsKey
    ? synthesizeWithGoogleCloudTts(text, targetLanguage, googleTtsKey)
    : synthesizeWithGemini(text);
}

async function synthesizeWithGemini(text: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const res = await fetch(
    `${GEMINI_API_BASE}/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
        },
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Gemini TTS failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const part = data.candidates?.[0]?.content?.parts?.[0];
  const base64: string | undefined = part?.inlineData?.data;
  const mimeType: string = part?.inlineData?.mimeType ?? "audio/pcm;rate=24000";
  if (!base64) throw new Error("Gemini TTS returned no audio data");

  const pcm = base64ToBytes(base64);
  const sampleRateMatch = /rate=(\d+)/.exec(mimeType);
  const sampleRate = sampleRateMatch ? Number(sampleRateMatch[1]) : 24000;
  return { bytes: pcmToWav(pcm, sampleRate), contentType: "audio/wav" };
}

async function synthesizeWithGoogleCloudTts(
  text: string,
  targetLanguage: string,
  apiKey: string
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const voice = GOOGLE_TTS_VOICE[targetLanguage];
  if (!voice) throw new Error(`No Google Cloud TTS voice configured for "${targetLanguage}"`);

  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: voice.languageCode, name: voice.name },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Google Cloud TTS failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.audioContent) throw new Error("Google Cloud TTS returned no audioContent");
  return { bytes: base64ToBytes(data.audioContent), contentType: "audio/mpeg" };
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Gemini TTS returns raw 16-bit little-endian PCM with no container, so it
// needs a WAV header before it's a playable/uploadable audio file.
function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1, bitsPerSample = 16): Uint8Array {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);

  const wav = new Uint8Array(buffer);
  wav.set(pcm, 44);
  return wav;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
