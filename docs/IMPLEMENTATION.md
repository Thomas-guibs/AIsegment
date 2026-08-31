# Implémentation du calcul — carte du code

`docs/CALCUL.md` est la spécification. Ce document dit **où** chaque règle vit,
et quels arbitrages ont été pris là où la spécification laissait le choix.

> La partie **commission** (§7 et §11.4 de la spécification) n'est pas
> implémentée : elle est hors périmètre de cet outil.

## Chaîne de calcul

```
HubSpot ──► snapshot.ts ──► movements.ts ──► portfolio.ts ──► metrics.ts
            (extraction)    (§5)             (§3–4)           (§6)
                                │                 │
                                └──► diagnostics.ts (§9) ◄────┘
```

Tout passe par `computeMetrics()` (`src/lib/engine/index.ts`). Aucune vue ne
recalcule un MRR ou un NRR de son côté.

## Où vit chaque section

| Spec | Module | Notes |
|---|---|---|
| §2 lecture point-in-time | `engine/timeline.ts` | `valueAt()`, re-tri croissant, détection d'historique tronqué |
| §2 accès HubSpot | `hubspot/history.ts` | `batch/read` avec `propertiesWithHistory`, par lots de 100 |
| §1 snapshot | `engine/snapshot.ts` | Fige l'état du CRM ; le calcul le rejoue hors ligne |
| modèle normalisé | `engine/model.ts` | Comptes à trois historiques, mouvements typés |
| §3 MRR sous gestion | `engine/portfolio.ts` | Les cinq conditions, dans l'ordre |
| §4 sortie + veto | `engine/portfolio.ts` | Signaux de sortie et veto phase active + perte partielle |
| §5 mouvements | `engine/movements.ts` | Ordre d'évaluation, dates, montants, eligibility, attribution |
| §6 NRR | `engine/metrics.ts` | Mensuel et agrégation `weighted` / `mean` / `compound` |
| §9 diagnostics | `engine/diagnostics.ts` | Six familles de signaux |
| §10 corrections | `engine/overrides.ts` | Motif obligatoire, valeur d'origine conservée |
| §12 options | `engine/config.ts` | Défauts + lecture depuis la query string |

## Points où le code s'écarte de la lettre de la spécification

Trois écarts, tous dictés par l'état réel du portail.

**`deal_eligibility` vaut `true` / `false`, pas `Yes` / `No`.** La propriété est
une énumération dont les valeurs internes sont `true` et `false` (libellés
Oui / Non). `parseEligibility()` accepte les deux familles ; toute autre valeur,
vide comprise, est traitée comme **non renseignée** — ce qui n'est pas la même
chose que Non, et les deux sont diagnostiqués séparément.

**Nora Rodriguez manquait à l'équipe CSM.** Elle porte 52 comptes actifs et
n'était dans aucune constante. Ajoutée à `CSM_TEAM`.

**Le MRR fantôme est plus large que ce que décrit la spécification.** Celle-ci
relève 158 comptes en phase `churn` portant encore un MRR ; à la date de
l'implémentation ils sont **221**. La règle ne change pas, seul son volume.

## Deux choses à savoir avant de lire un chiffre

**Le mode `strict` masque la majeure partie du churn.** La plupart des deals de
churn de ce CRM n'ont pas d'`eligibility` renseignée. En strict, ils ne sont pas
décomptés et le NRR est mécaniquement surévalué — en faveur des CSM. Ce n'est
pas un défaut du calcul, c'est un trou de saisie : la page Tendances affiche un
bandeau dès que le cas se présente, et les deux modes se comparent depuis la
barre d'outils.

**Un NRR absent n'est pas un NRR à zéro.** Un portefeuille vide ne peut pas
avoir de NRR ; le calcul renvoie `null` et les vues affichent « n/a ». Le seul
endroit qui substitue une valeur est l'adaptateur `/api/nrr-trends`, pour ses
consommateurs historiques — il joint `nrrAvailable` pour lever l'ambiguïté.

## Tests

```bash
npm test
```

`tests/spec-examples.test.ts` rejoue les cas chiffrés de la §11 : Cocorico SAS,
Maison Berger Paris, sunii. `tests/rules.test.ts` couvre les règles que ces cas
n'exercent pas et les pièges de la §8 qui échoueraient en silence — l'ordre de
l'historique HubSpot, le stage « Churn & Downsell », `abs(amount)` contre
`hs_mrr`, l'attribution au 1er du mois.

Les trois comptes de la §11 ont été revérifiés dans le portail : les montants,
stages et eligibility correspondent. Seule l'`operation date` de sunii a bougé
depuis la rédaction de la spécification (2025-12-11 au lieu du 2026-01-15 cité).
Les tests fixent les dates telles que la spécification les énonce, puisque c'est
le comportement qu'ils vérifient, pas la donnée.

## Configuration

Toutes les options de la §12 se pilotent par query string sur `/api/metrics` :

```
/api/metrics?months=12&eligibility=include_unset&nrrMethod=mean
             &attribution=owner_at_event&excludeChurnedAccounts=false
             &backfillHistory=true&refresh=true
```

Une valeur inconnue retombe silencieusement sur le défaut — une query string
malformée ne doit pas produire un chiffre faux sans le dire.

## Coût et cache

Un snapshot demande ~30 à 40 appels HubSpot (recherche des deals, associations
deal → compte, historiques des comptes par lots). Il est mis en cache 10 minutes
en mémoire ; `refresh=true` le force. Les routes portent `maxDuration = 300`.

Le cache est en mémoire du process : sur un déploiement serverless il n'est pas
partagé entre instances. C'est acceptable ici, mais c'est la première chose à
revoir si le nombre de comptes grossit nettement.
