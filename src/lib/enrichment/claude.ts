// Claude API fallback for HTML extraction
// Used when regex-based extraction fails on complex pages

import Anthropic from "@anthropic-ai/sdk"

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  return new Anthropic({ apiKey: key })
}

// Truncate HTML to stay under token limits
// Strip scripts, styles, and comments to reduce size
function cleanHtml(html: string, maxChars = 40000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .slice(0, maxChars)
}

export interface ClaudeExtraction {
  siren: string | null
  raisonSociale: string | null
  storesCount: number | null
}

// Single call to Claude to extract multiple signals
export async function extractWithClaude(html: string, companyName: string): Promise<ClaudeExtraction> {
  const result: ClaudeExtraction = { siren: null, raisonSociale: null, storesCount: null }

  const client = getClient()
  if (!client) return result

  const cleaned = cleanHtml(html)
  if (cleaned.length < 200) return result

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system:
        "Tu es un extracteur de donnees structurees a partir de pages web d'entreprises francaises. " +
        "Reponds UNIQUEMENT avec un JSON valide au format exact demande. Pas de texte avant/apres.",
      messages: [
        {
          role: "user",
          content: `Analyse ce HTML d'une page d'entreprise (${companyName}) et extrait trois informations.

HTML:
${cleaned}

Retourne un JSON exactement au format suivant :
{
  "siren": "123456789" ou null si non trouve (9 chiffres),
  "raisonSociale": "Nom legal de la societe" ou null,
  "storesCount": nombre de boutiques/magasins/points de vente mentionnes (entier), ou 0 si non mentionne
}

Regles:
- siren: extrait SIREN (9 chiffres) des mentions legales, RCS, ou toute section legale
- raisonSociale: nom legal complet (ex: "ISOTONER SAS", "LOYOLY SAS")
- storesCount: nombre de boutiques physiques detectees. Compte les adresses postales. 0 si pas de boutiques. Si plus de 500, retourne 500.

JSON uniquement:`,
        },
      ],
    })

    const text = response.content[0].type === "text" ? response.content[0].text : ""
    // Extract JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return result

    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.siren && /^\d{9}$/.test(String(parsed.siren))) {
        result.siren = String(parsed.siren)
      }
      if (parsed.raisonSociale && typeof parsed.raisonSociale === "string") {
        result.raisonSociale = parsed.raisonSociale.slice(0, 100)
      }
      if (typeof parsed.storesCount === "number" && parsed.storesCount >= 0) {
        result.storesCount = Math.min(Math.floor(parsed.storesCount), 500)
      }
    } catch {
      // JSON parse failed
    }

    return result
  } catch (err) {
    console.warn("Claude extraction failed:", err)
    return result
  }
}
