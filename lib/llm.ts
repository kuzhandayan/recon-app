import Groq from "groq-sdk";

// Structured output, never called from reconcile.ts, see docs/RECONCILIATION-RULES.md and LEARNING.md
const MODEL = "openai/gpt-oss-20b";
const TEMPERATURE = 0.2; // low but not 0 — factual, low-variance explanations, still natural phrasing; see README

export interface DiscrepancyForExplanation {
  orderKey: string;
  class: string;
  severity: string;
  amountDifference: number | null;
  details: Record<string, unknown>;
}

export interface LlmExplanation {
  whatHappened: string;
  recommendedAction: string;
}

const SYSTEM_PROMPT = `You are a financial-reconciliation assistant. A deterministic rules engine has already matched orders against payments and classified this discrepancy — your only job is to explain that classification in plain language for someone responsible for the store's revenue.

Never suggest a different classification and never question whether the match is correct. Only explain what likely happened and what someone should do about it, grounded in the specific numbers given.

Respond with ONLY a JSON object of this exact shape, no other text:
{"whatHappened": string, "recommendedAction": string}

Keep each field to 1-2 concrete sentences. No hedging, no restating the class name verbatim.`;

function parseExplanation(raw: string | null | undefined, sourceLabel: string): LlmExplanation {
  if (!raw) throw new Error(`Empty response from ${sourceLabel}.`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${sourceLabel} returned malformed JSON.`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).whatHappened !== "string" ||
    typeof (parsed as Record<string, unknown>).recommendedAction !== "string"
  ) {
    throw new Error(`${sourceLabel} response was missing the expected fields.`);
  }

  return parsed as LlmExplanation;
}

async function explainWithGroq(d: DiscrepancyForExplanation): Promise<LlmExplanation> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");

  const client = new Groq({ apiKey });
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(d) },
    ],
  });

  return parseExplanation(completion.choices[0]?.message?.content, "Groq");
}

// Manual fallback promoted to automatic: only used when Groq errors (rate limit, outage, etc).
async function explainWithGemini(d: DiscrepancyForExplanation): Promise<LlmExplanation> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  // "-latest" alias, not a pinned version — avoids going stale, see LEARNING.md
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: JSON.stringify(d) }] }],
        systemInstruction: { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { temperature: TEMPERATURE, responseMimeType: "application/json" },
      }),
    }
  );

  if (!res.ok) throw new Error(`Gemini request failed (${res.status}).`);
  const data = await res.json().catch(() => null);
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return parseExplanation(raw, "Gemini");
}

export async function explainDiscrepancy(d: DiscrepancyForExplanation): Promise<LlmExplanation> {
  try {
    return await explainWithGroq(d);
  } catch (groqError) {
    if (!process.env.GEMINI_API_KEY) throw groqError;
    try {
      return await explainWithGemini(d);
    } catch (geminiError) {
      const groqMsg = groqError instanceof Error ? groqError.message : String(groqError);
      const geminiMsg = geminiError instanceof Error ? geminiError.message : String(geminiError);
      throw new Error(`Groq failed (${groqMsg}); Gemini fallback also failed (${geminiMsg}).`);
    }
  }
}
