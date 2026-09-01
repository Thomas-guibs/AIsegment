// Claude API integration for enrichment
// 1. SIREN extraction from HTML (fallback when regex fails)
// 2. Company qualification with autonomous web search

import Anthropic from "@anthropic-ai/sdk"
import { getCached, setCache } from "../cache"

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

// =============================================================================
// Company qualification with autonomous web search
// =============================================================================

export interface CompanyQualification {
  domain: string | null           // e.g. "muscintime.fr"
  commercialName: string | null   // e.g. "Musc Intime" (null if same as legal)
  isEcommerce: boolean
  icpScore: number                // 0-100
  platform: string | null         // "Shopify" | "PrestaShop" | "WooCommerce" | etc.
  reasoning: string
  searchesUsed: number
}

const EMPTY_QUALIFICATION: CompanyQualification = {
  domain: null,
  commercialName: null,
  isEcommerce: false,
  icpScore: 0,
  platform: null,
  reasoning: "",
  searchesUsed: 0,
}

export interface QualifyInput {
  denomination: string
  siren: string
  codeNaf?: string
  libelleNaf?: string
  objetSocial?: string
  formeJuridique?: string
}

// Use Claude with the native web_search tool to find a company's website,
// determine if it's a B2C ecommerce, and score it for Loyoly's ICP.
// Cached by SIREN — qualifications change rarely.
export async function qualifyCompany(input: QualifyInput): Promise<CompanyQualification> {
  const cacheKey = `qualify_${input.siren}`
  const cached = getCached<CompanyQualification>(cacheKey)
  if (cached) {
    console.log(`[qualify:${input.siren}] cache hit → ${cached.domain ?? "null"} ecom=${cached.isEcommerce} icp=${cached.icpScore}`)
    return cached
  }

  const client = getClient()
  if (!client) {
    console.warn(`[qualify:${input.siren}] ANTHROPIC_API_KEY not set`)
    return EMPTY_QUALIFICATION
  }

  const prompt = `Qualifie cette entreprise française :

Dénomination légale : ${input.denomination}
SIREN : ${input.siren}
${input.codeNaf ? `NAF : ${input.codeNaf}${input.libelleNaf ? ` (${input.libelleNaf})` : ""}` : ""}
${input.objetSocial ? `Objet social : ${input.objetSocial}` : ""}
${input.formeJuridique ? `Forme juridique : ${input.formeJuridique}` : ""}

Étapes :
1. Cherche le site officiel (le nom commercial peut différer du nom légal)
2. Vérifie sur le site qu'il s'agit d'un e-commerce B2C
3. Identifie la plateforme (Shopify / PrestaShop / WooCommerce / autre)
4. Calcule l'ICP score Loyoly :
   - E-commerce B2C confirmé : base 50
   - Plateforme Shopify ou PrestaShop : +30
   - Secteur cosmétiques/mode/alimentation/maison : +10
   - PME/ETI française : +10
   - Pas de site OU pas e-commerce : score < 30

Réponds UNIQUEMENT avec ce JSON (pas de texte avant/après) :
{
  "domain": "exemple.fr" ou null,
  "commercialName": "Marque Commerciale" ou null si identique au nom légal,
  "isEcommerce": true/false,
  "icpScore": 0-100,
  "platform": "Shopify" ou null,
  "reasoning": "explication en 2 phrases max"
}`

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 3,
        },
      ],
      system:
        "Tu es un analyste e-commerce expert du marché français pour Loyoly (plateforme de fidélité e-commerce). " +
        "Utilise web_search pour trouver le site officiel de l'entreprise et vérifier qu'il s'agit d'un e-commerce B2C.",
      messages: [{ role: "user", content: prompt }],
    })

    // Count tool uses (each web_search call)
    let searchesUsed = 0
    let lastText = ""
    for (const block of response.content) {
      if (block.type === "server_tool_use" || block.type === "tool_use") {
        searchesUsed++
      } else if (block.type === "text") {
        lastText = block.text
      }
    }

    // Extract JSON from the last text block
    const jsonMatch = lastText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn(`[qualify:${input.siren}] no JSON in response, text="${lastText.slice(0, 200)}"`)
      return { ...EMPTY_QUALIFICATION, searchesUsed }
    }

    const parsed = JSON.parse(jsonMatch[0])
    const result: CompanyQualification = {
      domain: typeof parsed.domain === "string" && parsed.domain.length > 0
        ? parsed.domain.replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0]
        : null,
      commercialName: typeof parsed.commercialName === "string" && parsed.commercialName.length > 0
        ? parsed.commercialName
        : null,
      isEcommerce: parsed.isEcommerce === true,
      icpScore: typeof parsed.icpScore === "number"
        ? Math.max(0, Math.min(100, Math.round(parsed.icpScore)))
        : 0,
      platform: typeof parsed.platform === "string" && parsed.platform.length > 0
        ? parsed.platform
        : null,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 300) : "",
      searchesUsed,
    }

    console.log(`[qualify:${input.siren}] domain=${result.domain ?? "null"} ecom=${result.isEcommerce} icp=${result.icpScore} searches=${searchesUsed}`)
    setCache(cacheKey, result)
    return result
  } catch (err) {
    console.warn(`[qualify:${input.siren}] failed: ${String(err).slice(0, 200)}`)
    return EMPTY_QUALIFICATION
  }
}
