# Implémentation du calcul — carte du code

`docs/CALCUL.md` est la spécification. Ce document dit **où** chaque règle vit,
et quels arbitrages ont été pris là où la spécification laissait le choix.

> Deux parties de la spécification ne sont pas implémentées :
> - la **commission** (§7, §11.4), hors périmètre de cet outil ;
> - l'**eligibility** (§5), retirée pour le moment — voir plus bas.

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
| §5 mouvements | `engine/movements.ts` | Ordre d'évaluation, dates, montants, attribution |
| §6 NRR | `engine/metrics.ts` | Mensuel et agrégation `weighted` / `mean` / `compound` |
| §9 diagnostics | `engine/diagnostics.ts` | Six familles de signaux |
| §10 corrections | `engine/overrides.ts` | Motif obligatoire, valeur d'origine conservée |
| §12 options | `engine/config.ts` | Défauts + lecture depuis la query string |

## L'eligibility est retirée : tous les deals comptent

`deal_eligibility` n'entre dans aucun filtre. Un deal est décompté quel que soit
son eligibility — renseignée à Oui, à Non, ou pas renseignée du tout.

C'est un écart assumé avec la §5 de la spécification, pour une raison de donnée :
la grande majorité des churns de ce CRM n'ont pas d'eligibility renseignée. Le
mode `strict` en écartait l'essentiel, et le NRR s'en trouvait mécaniquement
surévalué — en faveur des CSM. Compter tous les deals donne une image plus
fidèle que filtrer sur une propriété que personne ne remplit.

Conséquences directes :

- le NRR **baisse**, puisque le churn est désormais décompté en entier ;
- la sortie des comptes churnés (§4) se déclenche sur tous les churns, donc le
  MRR fantôme est nettoyé plus complètement ;
- `eligibility_mode` et `apply_eligibility_to_upsell` n'existent plus dans la
  configuration, et les sélecteurs correspondants ont disparu de l'interface.

La propriété reste lue dans le modèle (`Movement.eligibility`) : elle ne coûte
rien à récupérer et la réactiver plus tard reste un petit diff.

**Le filtre de stage, lui, est conservé.** Il ne s'agit pas du même problème :
seuls **5 churns** se trouvent hors de la liste des stages retenus, contre
**348 upsells** — et ces derniers sont des opportunités en cours ou abandonnées
(« Discovery call planned », « Not the good time », « Discard »), le plus souvent
sans montant ni date de paiement. Les compter reviendrait à enregistrer du
revenu qui n'a pas eu lieu.

## Points où le code s'écarte encore de la spécification

**Nora Rodriguez manquait à l'équipe CSM.** Elle porte 52 comptes actifs et
n'était dans aucune constante. Ajoutée à `CSM_TEAM`.

**Le MRR fantôme est plus large que ce que décrit la spécification.** Celle-ci
relève 158 comptes en phase `churn` portant encore un MRR ; à la date de
l'implémentation ils sont **221**. La règle ne change pas, seul son volume.

## À savoir avant de lire un chiffre

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
`hs_mrr`, l'attribution au 1er du mois, et le fait qu'un deal soit compté quelle
que soit son eligibility.

Les trois comptes de la §11 ont été revérifiés dans le portail : les montants,
stages et eligibility correspondent. Seule l'`operation date` de sunii a bougé
depuis la rédaction de la spécification (2025-12-11 au lieu du 2026-01-15 cité).
Les tests fixent les dates telles que la spécification les énonce, puisque c'est
le comportement qu'ils vérifient, pas la donnée.

## Configuration

Toutes les options de la §12 se pilotent par query string sur `/api/metrics` :

```
/api/metrics?months=12&nrrMethod=mean&attribution=owner_at_event
             &excludeChurnedAccounts=false&backfillHistory=true&refresh=true
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
