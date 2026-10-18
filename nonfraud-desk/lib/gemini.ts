import { BRIEF_HEADINGS, evidencePacket, parseBrief } from "@/lib/brief"
import type { BriefSection, CaseFile } from "@/lib/types"

const DEFAULT_MODEL = "gemini-3.5-flash-lite"

export function geminiConfigured(): boolean {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return true
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT && vertexEnabled())
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL
}

function vertexEnabled(): boolean {
  return process.env.GOOGLE_GENAI_USE_VERTEXAI === "true" || Boolean(process.env.K_SERVICE)
}

export async function writeGeminiBrief(
  file: CaseFile,
  revealed: number,
  rank1CrossCount: number,
  accountCount: number,
): Promise<{ model: string; sections: BriefSection[]; raw: string }> {
  const model = geminiModel()
  const evidence = evidencePacket(file, revealed, rank1CrossCount, accountCount)
  const prompt = [
    "You are the case writer on Non_Fraud, a card-fraud desk.",
    "Rewrite the draft brief using only the evidence JSON.",
    "Keep these four headings exactly, each followed by one paragraph:",
    BRIEF_HEADINGS.join("\n"),
    "Keep every figure, time, masked identifier, merchant, group id, and point score.",
    "Do not invent people, cities, devices, jobs, or prior disputes.",
    "Do not claim the behaviour map observed this authorization. The map describes the account's group as of 30 Sep 2026. The tape is a scenario built from the Sparkov fraud profile.",
    "The fraud_ prefix on merchant names is from the data generator. It is not a fraud label. Use the display name from the evidence.",
    "Plain prose. No bullet lists. No markdown.",
    "",
    "EVIDENCE",
    JSON.stringify(evidence),
  ].join("\n")

  const raw = await generate(model, prompt)
  const sections = parseBrief(raw)
  if (!sections) {
    return {
      model,
      raw,
      sections: [{ heading: "Brief", body: raw.trim() }],
    }
  }
  return { model, sections, raw }
}

async function generate(model: string, prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (key) return callDeveloper(model, prompt, key)
  if (process.env.GOOGLE_CLOUD_PROJECT && vertexEnabled()) return callVertex(model, prompt)
  throw new Error("NO_KEY")
}

async function callDeveloper(model: string, prompt: string, key: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const withThinking = await postJson(url, { "x-goog-api-key": key }, body(prompt, true))
  if (withThinking.ok) return readText(await withThinking.json())
  if (withThinking.status === 400) {
    const plain = await postJson(url, { "x-goog-api-key": key }, body(prompt, false))
    if (!plain.ok) throw new Error(await plain.text())
    return readText(await plain.json())
  }
  throw new Error(await withThinking.text())
}

async function callVertex(model: string, prompt: string): Promise<string> {
  const project = process.env.GOOGLE_CLOUD_PROJECT
  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1"
  if (!project) throw new Error("NO_KEY")
  const token = await vertexToken()
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`
  const response = await postJson(
    url,
    { Authorization: `Bearer ${token}` },
    body(prompt, false),
  )
  if (!response.ok) throw new Error(await response.text())
  return readText(await response.json())
}

async function vertexToken(): Promise<string> {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(4000) },
  )
  if (!response.ok) throw new Error("Could not read the Cloud Run service account token.")
  const payload = (await response.json()) as { access_token?: string }
  if (!payload.access_token) throw new Error("The metadata server returned no access token.")
  return payload.access_token
}

function body(prompt: string, thinking: boolean) {
  return {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 900,
      ...(thinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  }
}

async function postJson(url: string, headers: Record<string, string>, payload: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  })
}

function readText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return ""
  const candidates = (payload as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return ""
  const content = (candidates[0] as { content?: { parts?: unknown } }).content
  if (!content || !Array.isArray(content.parts)) return ""
  const texts = content.parts
    .filter((part) => part && typeof part === "object")
    .filter((part) => !(part as { thought?: boolean }).thought)
    .map((part) => (part as { text?: string }).text ?? "")
  return texts.join("\n").trim()
}
