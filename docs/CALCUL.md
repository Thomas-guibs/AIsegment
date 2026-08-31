# Calcul des commissions CSM — spécification

Document autonome décrivant le calcul du **MRR sous gestion**, du **NRR** et des
**commissions trimestrielles** des Customer Success Managers de Loyoly, à partir de HubSpot.

Il est écrit pour être réimplémenté : les formules, l'ordre d'application des règles, les
arbitrages retenus et — surtout — les pièges de données du CRM, qui se reproduiront à
l'identique sur la même source.

> Implémentation de référence : dépôt `commission-csm`, modules `timeline.py`, `metrics.py`,
> `commission.py`, `config.py`. Les chiffres des exemples de la §11 sont rejoués par
> `tests/test_spec_examples.py` : s'ils cessent d'être vrais, le test casse.

---

## 1. Vue d'ensemble

```
HubSpot ──► snapshot ──► modèle normalisé ──► métriques mensuelles ──► trimestre ──► commission
            (extraction)  comptes +           MRR début, upsell,        NRR agrégé   paliers +
                          transactions        downsell, churn, NRR                   part upsell
                          historisés          par CSM et par mois
```

L'extraction est découplée du calcul : un *snapshot* JSON fige l'état de HubSpot, le calcul
le rejoue hors ligne. Indispensable pour auditer un versement passé et pour tester.

**Vocabulaire**

| Terme | Définition |
|---|---|
| Compte | Une entreprise cliente. Porte un MRR, un CSM propriétaire et une phase, tous **historisés**. |
| Transaction | Un deal HubSpot portant un mouvement de MRR : upsell, downsell ou churn. |
| MRR sous gestion | Somme des MRR des comptes du portefeuille d'un CSM, observée au 1er du mois. |
| Mouvement | Variation de MRR rattachée à un mois et à un CSM. |
| NRR | *Net Revenue Retention* : ce que devient le MRR d'un portefeuille, hors new business. |

---

## 2. Le socle : lecture point-in-time

Un client peut **changer de CSM en cours de route**. Toute la difficulté du calcul tient
là : il ne faut jamais lire la valeur courante d'une propriété, mais sa valeur **à la date
observée**.

```
value_at(T) = valeur de la dernière version dont l'horodatage ≤ T
```

On construit donc, pour chaque compte, trois historiques : MRR (`total_revenue`), CSM
propriétaire (`proprietaire_de_l_entreprise__csm_`) et phase (`phase_du_client`). On les lit
tous à l'instant d'observation.

**Deux pièges :**

1. **HubSpot rend l'historique du plus récent au plus ancien.** Le re-trier par ordre
   croissant avant tout, sinon `value_at()` renvoie systématiquement la dernière valeur.
2. **L'historique peut être tronqué.** Si celui d'un compte ne remonte pas jusqu'au mois
   observé, `value_at()` ne trouve rien : ni CSM, ni MRR. Le compte disparaît du portefeuille
   **sans qu'aucune règle métier ne l'ait écarté**. Il faut le détecter et le signaler (§9),
   avec une option pour faire remonter la plus ancienne valeur connue jusqu'à l'origine.

---

## 3. MRR sous gestion au 1er du mois

**Instant d'observation : T = 1er du mois à 00:00 UTC.** Lire à cet instant exclut de fait
les comptes signés pendant le mois — c'est voulu, la règle métier étant « le client devait
être présent avant le début du mois ».

Un compte entre dans le MRR sous gestion d'un CSM si les **cinq** conditions suivantes sont
réunies, dans cet ordre :

| # | Condition | Détail |
|---|---|---|
| 1 | Un CSM est connu à T | `csm_at(T)` non vide. Sinon le compte n'est dans le portefeuille de personne. |
| 2 | Ce CSM est dans le périmètre demandé | Filtre de restriction (vue collaborateur). |
| 3 | Le MRR à T est strictement positif | `mrr_at(T) > seuil`, seuil = 0 par défaut. |
| 4 | Le client était déjà facturé | Sa plus ancienne *effective payment date* est **antérieure** au 1er du mois. |
| 5 | Il n'est pas sorti du portefeuille | Voir §4. |

```
MRR_début(csm, mois) = Σ mrr_at(T) sur les comptes satisfaisant les 5 conditions
```

**Sur la condition 4.** La propriété `date_de_paiement` **de l'entreprise** porte le
*dernier* paiement, pas le premier — l'utiliser ferait sortir tous les clients actifs. Il
faut prendre la **plus ancienne** `date_de_paiement` parmi les deals du compte, toutes
attributions confondues : la première facturation vient du deal de new business, pas d'un
mouvement de MRR.

---

## 4. La sortie des comptes churnés, et son veto

`total_revenue` **n'est jamais remis à zéro quand un client part**. Sur les données de
juillet 2026 : 158 comptes en phase `churn` portent encore un MRR, pour **48 896 €, soit
15 % des ~327 000 € du portefeuille**. Sans traitement, ce MRR fantôme reste indéfiniment
au crédit de son CSM et gonfle mécaniquement son NRR.

### Les deux signaux de sortie

- **Un deal de churn décompté** dont l'*operation date* est **antérieure** au 1er du mois.
  On applique exactement les mêmes filtres que pour les mouvements (§5) : le churn qui fait
  sortir un compte est celui-là même qui a frappé le NRR. Les deux règles restent alors
  cohérentes — un churn non retenu (eligibility absente, par exemple) ne fait pas sortir le
  compte, sinon on retirerait le MRR sans jamais compter la perte.
- **`phase_du_client`** valant une valeur de sortie (`churn`) à T.

Le mois du churn, le compte **reste** dans la base — il y était bien au 1er — et le churn
frappe le NRR normalement. Il disparaît le mois suivant.

### Le veto : phase active **et** perte partielle

Un deal peut être attribué `Churn` alors qu'il n'est qu'une baisse de MRR. Un compte ne sort
donc **pas** lorsque les deux conditions suivantes sont réunies :

1. sa phase est une phase active (`Activated`, `Run`) — le CRM le dit toujours client ;
2. le total des churns décomptés **n'emporte qu'une partie** de son MRR.

Le montant reste soustrait du NRR — churn et downsell se soustraient à l'identique,
l'arithmétique ne change pas — seule la sortie du portefeuille est annulée.

> **Les deux conditions sont nécessaires.** Sur les données réelles, 13 des 62 churns
> décomptés depuis octobre 2025 portent sur un compte encore en `Run`. Mais **10 d'entre eux
> soldent exactement tout le MRR du compte** (sunii −108,40 € sur 108,40 € ; REVENGEX −260 €
> sur 260 €…). Ce sont de vrais départs dont la phase n'a jamais été mise à jour. Le veto sur
> la seule phase leur rendrait ~1 950 € de MRR fantôme — précisément le problème que la sortie
> des comptes churnés existe pour corriger.

Les deux populations doivent être signalées séparément (§9) : les downsells mal attribués
d'un côté, les phases périmées de l'autre. Ce sont deux corrections différentes dans le CRM.

---

## 5. Les mouvements de MRR

### Ordre d'évaluation

L'ordre importe, parce qu'il sépare ce qui est **hors périmètre** (normal) de ce qui est une
**anomalie de saisie** (à corriger) :

1. **Filtre de stage** — un deal en cours de négociation n'est pas une anomalie, il est
   simplement hors périmètre. Le tester en premier évite de polluer le rapport qualité.
2. **Date de référence** présente — sinon anomalie de saisie.
3. **Mois dans la période analysée** — sinon on ignore, sans rien signaler.
4. **Eligibility** — sinon anomalie.
5. **Montant non nul** — sinon anomalie.
6. **Attribution à un CSM** — sinon anomalie.

### Date de rattachement à un mois

| Type | Propriété | Nom métier |
|---|---|---|
| Upsell | `date_de_paiement` | *effective payment date* |
| Downsell | `date_de_prise_en_compte` | *operation date* |
| Churn | `date_de_prise_en_compte` | *operation date* |

L'upsell est daté au paiement effectif ; le churn et le downsell à la date de prise en
compte. Ce n'est pas une incohérence : un upsell n'est acquis qu'une fois encaissé, une
perte est actée dès qu'elle est constatée.

### Montant

Prendre **`amount`**, en valeur absolue. `amount` porte le *delta* de MRR (négatif pour
churn et downsell). **Ne pas utiliser `hs_mrr`** : il contient tantôt le delta, tantôt le
MRR total après opération, sans moyen de distinguer.

### Eligibility

Règle métier : un churn ou un downsell n'est décompté que si `deal_eligibility` vaut « Yes ».
L'upsell y échappe — il est daté par son paiement. Trois modes utiles :

- `strict` : uniquement Yes (défaut, conforme au plan de rémunération) ;
- `include_unset` : Yes + valeur non renseignée ;
- `all` : tous les deals.

> ⚠️ **200 churns sur 283 n'ont pas `deal_eligibility` renseigné.** En mode strict, la
> majorité du churn n'est pas décomptée et le NRR est mécaniquement surévalué — en faveur des
> CSM. Ce n'est pas un défaut du calcul mais un trou de saisie. **Calculer les deux modes et
> comparer avant de figer un versement.**

### Stages retenus

⚠️ **Dans ce portail, les identifiants internes ne correspondent pas aux libellés affichés.**

| Identifiant interne | Libellé affiché |
|---|---|
| `closedlost` | **Closed won** |
| `143474109` | Paiement reçu |
| `1220133077` | Churn & Downsell |
| `closedwon` | **Offre envoyé (70 %)** |

Stages retenus par type de mouvement :

| Type | Stages retenus |
|---|---|
| Upsell | `closedlost`, `143474109` |
| Downsell | `1220133077`, `closedlost`, `143474109` |
| Churn | `1220133077`, `closedlost`, `143474109` |

Les churns et downsells terminent leur cycle dans **« Churn & Downsell »** — c'est leur stage
gagné à eux. Le retirer de la liste ne laisserait passer que **2 churns sur 283** : le NRR
remonterait faussement près de 100 % et les commissions seraient surévaluées.

### Attribution à un CSM

Trois modes ; le défaut est **`owner_at_month_start`** — le CSM propriétaire du compte au
1er du mois du mouvement. C'est cohérent avec la base MRR, qui est lue au même instant.

Replis successifs si aucun propriétaire n'est connu à cette date : premier CSM jamais
enregistré sur le compte, puis propriétaire du deal, puis « non attribuable » — le mouvement
est alors écarté **et signalé**, jamais silencieusement absorbé.

Les deux autres modes : `owner_at_event` (propriétaire à la date du mouvement) et
`deal_owner` (propriétaire du deal).

---

## 6. NRR

### Mensuel

```
net(mois)      = upsell − downsell − churn
MRR_fin(mois)  = MRR_début + net                    (hors new business, par définition)
NRR(mois)      = MRR_fin / MRR_début
```

Non calculable si `MRR_début ≤ 0` : renvoyer une valeur absente, jamais 0 — un portefeuille
vide n'est pas un portefeuille qui a tout perdu.

### Trimestriel

Trois méthodes ; le défaut est **`weighted`** :

```
weighted  = (Σ MRR_début + Σ net) / Σ MRR_début     sur les mois où MRR_début > 0
mean      = moyenne arithmétique des NRR mensuels
compound  = produit des NRR mensuels
```

`weighted` pondère chaque mois par son MRR de début : un mois à fort portefeuille pèse
davantage. C'est le NRR global du portefeuille sur le trimestre, et c'est la lecture que le
plan de rémunération sous-entend. `mean` donnerait le même poids à un mois à 300 k€ et à un
mois à 30 k€ ; `compound` amplifie les variations.

---

## 7. Commission

### Structure

```
variable_trimestre = variable_annuel / 4
prime_NRR          = variable_trimestre × poids_NRR       (0,60)
prime_upsell       = variable_trimestre × poids_upsell    (0,40)
```

Les deux poids doivent sommer à 1.

### Part NRR — par paliers

```
versé_NRR = prime_NRR × taux(NRR_trimestre)
```

| NRR du trimestre | Taux versé |
|---|---|
| ≥ 102,5 % | 100 % |
| 100 % – 102,5 % | 80 % |
| 95 % – 100 % | 50 % |
| < 95 % | 0 % |

Prendre le premier palier atteint en parcourant les seuils **du plus haut au plus bas**. NRR
indisponible → taux 0, avec un avertissement explicite.

### Part upsell — proportionnelle et déplafonnée

```
atteinte      = upsell_trimestre / objectif_upsell
versé_upsell  = prime_upsell × atteinte
```

**Pas de plafond** : signer le double de l'objectif verse le double de la prime. Un plafond
optionnel existe dans la configuration mais n'est pas activé.

`upsell_trimestre` = somme des transactions d'attribution `Upsell` dont l'*effective payment
date* tombe dans le trimestre, une fois les filtres de la §5 appliqués.

### Total et versement

```
total = versé_NRR + versé_upsell
```

Versé **le mois suivant la fin du trimestre** : Q2 (avril–juin) → versement en juillet.

### Les quatre plans en vigueur

| CSM | Fixe | Variable annuel | Variable / trim. | Prime NRR | Prime upsell | Objectif upsell | Versé / 1 000 € signés |
|---|---|---|---|---|---|---|---|
| Antoine de Chanaleilles | 55 000 € | 10 000 € | 2 500 € | 1 500 € | 1 000 € | 5 334 € HT | 187,48 € |
| Fatima Hilmi | — | 10 000 € | 2 500 € | 1 500 € | 1 000 € | 4 500 € | 222,22 € |
| Farah Bahoui | 48 000 € | 9 000 € | 2 250 € | 1 350 € | 900 € | 4 197 € HT | 214,44 € |
| Nora Rodriguez | 50 000 € | 7 000 € | 1 750 € | 1 050 € | 700 € | 4 467 € HT | 156,70 € |

Le fixe n'entre dans aucun calcul : il ne sert qu'à situer le package.

> À noter : le taux de rémunération n'est pas homogène. 1 000 € de MRR signé rapportent de
> **156,70 € à 222,22 €** selon le CSM, soit 42 % d'écart, parce qu'enveloppe et objectif
> varient indépendamment. C'est peut-être délibéré (séniorité, taille de portefeuille) — mais
> autant que ce soit un choix conscient.

Un plan peut porter une fenêtre d'activité (`active_from` / `active_to`) : hors fenêtre, les
métriques sont calculées mais la commission n'est pas chiffrée.

---

## 8. Pièges HubSpot — récapitulatif

| Piège | Constat | Conséquence si ignoré |
|---|---|---|
| `hs_mrr` ambigu | Tantôt delta, tantôt total après opération | Montants faux, sans erreur visible |
| Identifiants de stage trompeurs | « Closed won » = `closedlost` | Filtrer sur le libellé perd 281 churns sur 283 |
| « Churn & Downsell » exclu | 275 churns et 32 downsells y terminent | NRR faussement proche de 100 % |
| `total_revenue` jamais remis à zéro | 158 comptes, 48 896 €, 15 % du portefeuille | MRR fantôme perpétuel |
| `date_de_paiement` de l'entreprise | Porte le **dernier** paiement | Tous les clients actifs sortent de la base |
| `deal_eligibility` non renseigné | 200 churns sur 283, 26 downsells sur 43 | Churn sous-décompté, NRR surévalué |
| Historique de propriété tronqué | Variable selon les comptes | Comptes absents sans explication |
| Attribution `Churn` sur un downsell | 3 cas identifiés | Client actif retiré de son portefeuille |
| Phase `Run` sur un compte parti | 10 cas identifiés | MRR fantôme si la phase fait foi seule |

---

## 9. Diagnostics — rien ne doit disparaître en silence

Un calcul de rémunération doit rendre compte de **tout** ce qu'il écarte. Six familles de
signaux, à reproduire :

| Signal | Ce qu'il révèle |
|---|---|
| Mouvements écartés, par motif | Anomalies de saisie : date absente, eligibility manquante, montant nul, CSM non identifiable |
| Deals hors périmètre, par stage | Information de pipeline, **pas** un défaut — à distinguer clairement |
| Comptes sans facturation | Portent un MRR et un CSM, mais aucune *effective payment date* : comptés nulle part |
| Comptes sortis après churn | Dont ceux sortis sur la seule phase, **sans deal de churn décompté** : le NRR n'a jamais enregistré la perte, il manque le deal dans le CRM |
| Comptes retenus malgré un churn | Downsells mal attribués : à repasser en `Downsell` |
| Comptes invisibles faute d'historique | Limite de la donnée, pas décision de calcul — le dire explicitement |

---

## 10. Couche de corrections manuelles

Une saisie fausse se corrige dans le CRM, mais un trimestre se verse à date. D'où une couche
d'override, indexée par identifiant de deal, portant un montant retenu et/ou une attribution
retenue.

Trois garde-fous, parce qu'il s'agit de rémunération :

- **Motif obligatoire** — une correction sans explication est refusée au chargement, pas
  ignorée en silence ;
- **Valeur d'origine conservée et affichée** à côté de la valeur retenue, avec l'auteur ;
- **Une correction qui ne vise aucun deal existant est signalée**, au lieu de laisser croire
  qu'elle s'applique.

La source de vérité reste le CRM : corriger dans HubSpot puis retirer l'override.

---

## 11. Cas de référence chiffrés

Quatre cas réels. Une réimplémentation correcte doit reproduire ces chiffres.

### 11.1 Cocorico SAS — churn total, MRR non remis à zéro

MRR 1 941 € depuis le 25/02/2025 · première facturation 25/02/2025 · deal `Churn` −1 941 €,
*operation date* 25/02/2026, eligibility Yes, stage `1220133077`.

| Mois | MRR début | Churn | NRR |
|---|---|---|---|
| 2026-01 | 1 941 € | 0 € | 100,0 % |
| 2026-02 | 1 941 € | 1 941 € | **0,0 %** |
| 2026-03 et suivants | *hors base* | | |

### 11.2 Maison Berger Paris — downsell étiqueté « Churn »

MRR 1 186,25 € · phase `Run` · deal `Churn` **−150 €**, *operation date* 25/03/2026,
eligibility Yes, stage `1220133077`.

| Mois | MRR début | Churn | NRR |
|---|---|---|---|
| 2026-03 | 1 186,25 € | 150 € | **87,4 %** |
| 2026-04 et suivants | 1 186,25 € | 0 € | 100,0 % |

Le compte **reste** au portefeuille : phase active **et** perte partielle. Signalé comme
downsell mal attribué.

### 11.3 sunii — phase périmée

MRR 108,40 € · phase `Run` · deal `Churn` **−108,40 €**, *operation date* 15/01/2026.

Le churn solde **tout** le MRR : le veto ne s'applique pas, le compte sort dès février. Il
est signalé « phase active » — c'est la phase qu'il faut corriger dans HubSpot, pas le calcul.

### 11.4 Commission — Antoine, Q2 2026

Hypothèse : NRR trimestriel 101,0 %, upsell du trimestre 4 000 €.

```
prime_NRR    = (10 000 / 4) × 0,60          = 1 500,00 €
palier       = 100 % – 102,5 %              →      80 %
versé_NRR    = 1 500 × 0,80                 = 1 200,00 €

prime_upsell = (10 000 / 4) × 0,40          = 1 000,00 €
atteinte     = 4 000 / 5 334                =    74,99 %
versé_upsell = 1 000 × 0,7499               =   749,91 €

total                                       = 1 949,91 €
versement                                   =    07/2026
```

---

## 12. Options de configuration

| Option | Défaut | Effet |
|---|---|---|
| `eligibility_mode` | `strict` | Yes seul / + non renseigné / tous |
| `apply_eligibility_to_upsell` | `false` | Soumettre aussi l'upsell à l'eligibility |
| `quarterly_nrr_method` | `weighted` | Agrégation du NRR trimestriel |
| `movement_attribution` | `owner_at_month_start` | Rattachement d'un mouvement à un CSM |
| `min_mrr_under_management` | `0` | Seuil d'entrée dans le portefeuille |
| `require_payment_before_month` | `true` | Exiger une facturation antérieure au mois |
| `exclude_churned_accounts` | `true` | Sortie du portefeuille après churn |
| `churned_customer_stages` | `["churn"]` | Phases signifiant « parti » |
| `active_customer_stages` | `["activated", "run"]` | Phases opposant un veto à la sortie |
| `backfill_history` | `false` | Faire remonter la plus ancienne valeur connue |
| `allowed_stages` | voir §5 | Stages retenus par type de mouvement |

---

## 13. Ordre d'implémentation conseillé

1. **Lecture point-in-time** (§2) — tout en dépend, et c'est la partie que l'on croit
   triviale jusqu'à ce qu'un compte change de CSM en milieu de trimestre.
2. **Modèle normalisé** — comptes avec trois historiques, mouvements avec type, montant,
   dates, stage, eligibility.
3. **MRR sous gestion** (§3–4) — les cinq conditions, puis la sortie et son veto.
4. **Mouvements** (§5) — dans l'ordre d'évaluation indiqué, en accumulant les diagnostics.
5. **NRR** (§6), puis **commission** (§7).
6. **Diagnostics** (§9) — à écrire en même temps que les règles, pas après : c'est en les
   regardant qu'on découvre les pièges de la §8.
