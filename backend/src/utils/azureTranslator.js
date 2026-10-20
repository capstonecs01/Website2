// Chat message translation with Azure AI Translator (plain text only).
// This is separate from the PDF translator: no Python server and no Claude.
//
// Settings in backend/.env:
//   AZURE_TRANSLATOR_KEY       "KEY 1" from the Translator resource's "Keys and Endpoint" page
//   AZURE_TRANSLATOR_REGION    "Location/Region" from the same page, e.g. japaneast
//                              (leave empty only if the resource's region is Global)
//   AZURE_TRANSLATOR_ENDPOINT  optional; default https://api.cognitive.microsofttranslator.com
//
// With no key set, chat translation runs in test mode: the message comes back
// as "(test translation) <original>" so the button can be tried for free.

const DEFAULT_ENDPOINT = "https://api.cognitive.microsofttranslator.com";

// Longest message we send to Azure, in characters (Azure bills per character).
export const MAX_CHARS = 2000;

export class ChatTranslateError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status; // HTTP status to pass on to the browser
  }
}

// Rough English/Japanese guess from the characters a message uses (no API call).
// Returns "ja", "en", or null when there are no letters (only numbers/emoji).
export function guessLanguage(text) {
  const ja = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (ja + latin === 0) return null;
  return ja / (ja + latin) >= 0.3 ? "ja" : "en";
}

export function isTestMode() {
  return !(process.env.AZURE_TRANSLATOR_KEY || "").trim();
}

function translateUrl(to) {
  let base = (process.env.AZURE_TRANSLATOR_ENDPOINT || DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
  // A resource's own domain (https://<name>.cognitiveservices.azure.com) needs this extra path.
  if (/cognitiveservices\.azure\.com$/i.test(base)) base += "/translator/text/v3.0";
  return `${base}/translate?api-version=3.0&to=${encodeURIComponent(to)}`;
}

function friendlyError(status, code) {
  if (status === 401) {
    return ["Chat translation isn't set up correctly (check AZURE_TRANSLATOR_KEY and AZURE_TRANSLATOR_REGION).", 503];
  }
  if (status === 403 && code === 403001) {
    return ["This month's free translation allowance has been used up.", 503];
  }
  if (status === 403) {
    return ["The translation service refused the request. Please try again later.", 503];
  }
  if (status === 429) {
    return ["Too many translations at once. Please wait a moment and try again.", 429];
  }
  if (status === 400) {
    return ["This message couldn't be translated.", 400];
  }
  return ["The translation service had a problem. Please try again.", 502];
}

// Translates `text` into `to` ("en" or "ja").
// Resolves to { text, from, test } — `from` is the language Azure detected.
export async function translateChatText(text, to) {
  if (isTestMode()) {
    const prefix = to === "ja" ? "（テスト翻訳）" : "(test translation) ";
    return { text: prefix + text, from: null, test: true };
  }

  const headers = {
    "Ocp-Apim-Subscription-Key": process.env.AZURE_TRANSLATOR_KEY.trim(),
    "Content-Type": "application/json; charset=UTF-8",
  };
  const region = (process.env.AZURE_TRANSLATOR_REGION || "").trim();
  if (region && region.toLowerCase() !== "global") headers["Ocp-Apim-Subscription-Region"] = region;

  let res;
  try {
    res = await fetch(translateUrl(to), {
      method: "POST",
      headers,
      body: JSON.stringify([{ Text: text }]),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ChatTranslateError("Couldn't reach the translation service. Please try again.", 503);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const code = data?.error?.code;
    console.error(`[azure-translator] ${res.status} ${code || ""} ${data?.error?.message || ""}`.trim());
    const [message, status] = friendlyError(res.status, code);
    throw new ChatTranslateError(message, status);
  }

  const item = Array.isArray(data) ? data[0] : null;
  const out = item?.translations?.[0]?.text;
  if (typeof out !== "string") {
    console.error("[azure-translator] unexpected response", JSON.stringify(data).slice(0, 300));
    throw new ChatTranslateError("The translation service had a problem. Please try again.", 502);
  }
  return { text: out, from: item.detectedLanguage?.language || null, test: false };
}
