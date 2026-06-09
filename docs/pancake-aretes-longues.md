# Caustiques des arêtes `rₙ` du graphe pancake de Zaks

## L'hypothèse

Le graphe pancake `Pₙ`, dessiné dans l'ordre de Zaks (sommets sur un cercle,
arêtes `rₙ` en cordes), produirait des **caustiques** — les enveloppes où les
cordes s'accumulent — au comportement voisin de l'ensemble de Mandelbrot :
**auto-similarité** atténuée, **nouvelles branches** qui se révèlent au zoom, le
tout **évoluant avec `n`**.

On ne regarde que les cordes `rₙ` (renversement complet) : la seule couche
longue neuve à chaque niveau (les `r₂…rₙ₋₁` sont de courtes cordes intra-bloc,
écartées d'emblée).

## Les caustiques, précisément

Une corde `rₙ` relie la position `i` à `σₙ(i)`. En continu, on paramètre la
famille par `τ = i/n! ∈ [0,1)` : la corde joint l'angle `2πτ` à l'angle
`2π·T(τ)`, où

```
σₙ(i) = zaksRank(n, reverse(zaksUnrank(n, i)))      coût O(n²)
T(τ)  = σₙ(⌊τ·n!⌋) / n!
```

La **caustique** est l'enveloppe de cette famille de droites : le lieu des
intersections de cordes voisines. Ses **cusps** et **branches** sont le
« pattern ». Géométriquement, ce sont les **crêtes** (ridges) du champ de
densité que dessine déjà le renderer Yankelovich.

Tout vit dans le **même disque unité** quel que soit `n`, ce qui rend les
caustiques de `Pₙ` et `Pₙ₋₁` directement comparables.

## Quotienter par la symétrie dihédrale d'abord

Le layout de Zaks porte une symétrie dihédrale `Dₙ` (ordre `2n`) sur l'anneau
d'indices `ℤ/n!` :

```
ρ : i ↦ i + (n-1)!        rotation de 2π/n   (= décalage d'un bloc !)
ω : i ↦ (n!-1) - i        réflexion
```

**Point crucial : `ρ` est exactement le décalage d'un bloc.** « Frontière de
bloc » et « axe de symétrie » sont donc la même chose. Une caustique
`Dₙ`-symétrique a *forcément* un cusp sur chaque axe de réflexion (la réflexion
impose l'enveloppe ⊥ à l'axe). Conséquence : **les cusps sur les frontières de
blocs sont des artefacts de symétrie, garantis d'avance, et ne prouvent rien.**

Il faut donc travailler dans le **domaine fondamental de `Dₙ` : un coin
angulaire de `360/(2n)° = π/n`**, contenant `n!/2n = (n-1)!/2` sommets. Tout le
reste s'en déduit par les `2n` symétries. Le renderer Yankelovich le fait déjà
(`yankelovichDihedralSectorVertexCount(n) = ⌊(n-1)!/2⌋`).

Deux bords au coin, de natures différentes — cusps des deux **exclus** car
imposés par la symétrie :
- un bord = axe de rotation (frontière de bloc, `i ≡ 0 mod (n-1)!`) ;
- l'autre bord = axe de réflexion `ω`.

Seuls comptent les **cusps intérieurs** au coin.

## La question, dé-symétrisée

> Dans le coin `π/n`, la caustique de `Pₙ` contient-elle, au-delà de ce
> qu'imposent `Dₙ` et la copie renormalisée de `Pₙ₋₁`, des **cusps intérieurs
> neufs** ?

- **(a) convergence** — le pattern intérieur tend vers une limite quand `n`
  croît → **attracteur auto-similaire** (Mandelbrot atténué).
- **(b) dérive** — de nouveaux cusps/branches intérieurs apparaissent avec `n`
  → de **vrais nouveaux univers** à chaque niveau.

### Le mécanisme de nouveauté, revu

Ce n'est *pas* « les coutures de `T` » (qui coïncident avec les axes de
symétrie), mais une **brisure de symétrie** : la copie de `Pₙ₋₁` embarquée dans
un bloc possède sa propre symétrie `Dₙ₋₁`, mais elle est enroulée sur un arc de
`2π/n` au lieu d'un cercle entier → seul le `Dₙ` global survit, le `Dₙ₋₁` de la
sous-copie est **brisé**. C'est cette `Dₙ₋₁` brisée qui peut produire de la
structure génuinement neuve dans le coin fondamental.

## Critère de nouveauté (littérature)

Deux outils complémentaires donnent un critère formel.

1. **Théorie des catastrophes (Thom ; Arnold ; Berry–Upstill).** La caustique se
   classe par son **spectre de singularités stables** : pli `A₂`, cusp `A₃`,
   queue d'aronde `A₄`, `A₅`, `D₄`, `D₅`… Soit `S(n)` le multiset des types
   présents dans le coin `π/n`.
   - `S(n)` se stabilise / `S(n) = S(n-1)` + copies remises à l'échelle →
     **auto-similaire, pas de nouveauté**.
   - `S(n)` gagne un type structurellement neuf (un `Aₖ` de `k` plus grand, un
     agencement non réductible) → **bifurcation = nouvel univers**.
   - La notion-pivot est la **stabilité structurelle** : deux caustiques sont
     « la même » ssi difféomorphes ; le passage d'une classe à l'autre est la
     bifurcation. Algorithme prêt à l'emploi : le *caustic skeleton* du cosmic
     web (Hidding–van de Weygaert), qui extrait et classe `A₃,A₄,A₅,D₄,D₅`
     depuis un champ de déplacement — exactement la recette pour comparer
     `S(Pₙ)` et `S(Pₙ₋₁)`.
   - **Réserve** : cette classification vaut pour des familles lisses génériques.
     `T` est discontinue aux coutures (= axes de symétrie) ; ces cusps-là sont
     hors liste d'Arnold *et* triviaux. D'où l'importance de ne classer que
     l'**intérieur** du coin.

2. **Renormalisation (dynamique complexe : Douady–Hubbard ; Tan Lei ;
   McMullen).** C'est le vrai pendant « auto-similaire ET neuf ». Critère :
   existence d'un **point fixe de l'opérateur de renormalisation** = convergence
   de la carte locale `T` rescalée. Convergence → auto-similaire ; pas de
   convergence → nouveauté perpétuelle.

Critère composite retenu : **`S(n)`** (classification discrète) **+ convergence
du `T` rescalé** (auto-similarité vs nouveauté).

## Protocole

1. **Champ de densité, dans le coin `π/n`.** Accumuler chaque corde
   `(2πτ, 2πT(τ))` dans une grille `N×N`, en rabattant les cordes par `Dₙ` (pour
   inclure les portions entrantes des autres coins, sinon la caustique est
   tronquée au bord). Coût divisé par `2n`.
2. **Squelette de caustique.** Extraire les crêtes du champ (max le long du
   gradient, ou vallées du Hessien) → courbes propres. Classer les cusps
   intérieurs (`S(n)`).
3. **Enveloppe analytique (contrôle).** Calculer l'enveloppe de `L(τ)`
   (intersection des cordes voisines) ; recoupe les crêtes et localise les cusps.
4. **Carte `T` rescalée.** Superposer `T` de `Pₙ` et `Pₙ₋₁` ; tester la
   convergence locale (renormalisation).

## Validité de l'échantillonnage

Pour `n ≥ 12` on échantillonne `i` au lieu d'énumérer les `n!/2` cordes. Garde-fous :

- **Géométrie exacte.** `σₙ` est exact en `O(n²)` ; seul le *sous-ensemble* de
  cordes est tiré, pas leur position. Tirer `i` **uniformément sur `[0,n!)`**
  (mesure de l'enveloppe continue) → espérance non biaisée.
- **Calibration contre l'énumération exacte.** `n!/2` est énumérable jusqu'à
  `n=11` (~20 M cordes). Comparer champ exact vs échantillonné à `S, 2S, 4S` ;
  trouver le `S` où le spectre de cusps se stabilise.
- **Résidu de symétrie (jauge gratuite).** Le vrai champ est exactement
  `Dₙ`-symétrique. Mesurer `asym(S) = ‖champ_S − ρ·champ_S‖` ; il décroît en
  `1/√S` et borne le bruit **sans vérité-terrain**.
- **Multi-graines.** Une caustique réelle apparaît sur toutes les graines ; le
  bruit de tir (Poisson, `≈1/√c`), non. Retenir une feature au-dessus de
  `moyenne − quelques σ` ; appliquer un noise floor.
- **Réduction de variance.** Symétriser chaque tirage sur son orbite `Dₙ`
  (champ exactement symétrique, `asym=0`) ; stratifier / QMC sur `[0,n!)`.

**Règle de décision.** N'accepter un cusp/branche que s'il est (1) stable
`S→2S→4S`, (2) présent sur toutes les graines, (3) au-dessus du noise floor,
(4) d'amplitude `≫ asym(S)`. Une conclusion qui change avec `S` ou la graine
n'est pas réelle.

## Critère de décision (synthèse)

| Observation | Verdict |
|---|---|
| `S(n)` stable + `T` rescalé convergent + caustiques intérieures superposables | **Confirmé** (a) : auto-similarité réelle, atténuée |
| `S(n)` gagne régulièrement de nouveaux types intérieurs avec `n` ; `T` rescalé non convergent | (b) : nouveaux univers à chaque niveau |
| Champ sans crête nette dans le coin | **Infirmé** : pas de caustique structurée |

## Pronostic

`σₙ = rank ∘ reverse ∘ unrank` étant récursif en `φ`-blocs, `T` devrait tendre
vers une carte limite par morceaux → **enveloppe limite** (scénario (a)), mais
avec de fins cusps neufs imputables à la `Dₙ₋₁` brisée à chaque `n` — soit
exactement « auto-similarité + petits univers neufs ».

## Résultats empiriques (validés)

Mesures sur les champs de densité `rₙ` (scripts `scratch/`), `n = 8..10`.

**Métrique abandonnée.** Une mesure de « nouveauté » par appariement de patchs
(NCC multi-échelle) `Pₙ` vs `Pₙ₋₁` a été **invalidée par contrôle** : Sierpiński
(auto-similaire, nouveauté nulle) et Petrie y scoraient *plus haut* que Zaks.
L'appariement de patchs sur images rastérisées ne mesure pas l'auto-similarité
(aliasing au rééchantillonnage, non-invariance en rotation, plancher élevé des
images filaires). **Tout chiffre de « nouveauté par patchs » est sans valeur.**

**Mesure retenue : résidu d'IFS (collage fractal, `pifs-residual.mjs`).**
Variance non expliquée en écrivant l'objet comme union de copies de lui-même
(rééchelonnées + isométrie + affine d'intensité). **Validée par le contrôle
Sierpiński ≈ 0.**

| Objet | résidu IFS |
|---|---|
| Sierpiński (auto-affine exact) | **0.007** ← plancher |
| Zaks `P₉` / `P₁₀` | 0.21 / 0.23 |
| Bruit aléatoire | 0.56 ← plafond |
| Petrie `d`-cube | 0.63 (filaire → peu fiable) |

→ Zaks = **socle auto-similaire + composante non-auto-affine ≈ 21 %, stable en
`n`** (≪ bruit, ≫ Sierpiński) : compatible « Mandelbrot atténué », sur une
métrique qui passe enfin le contrôle.

**Réserves** : (1) « non-auto-affine » est *nécessaire mais pas suffisant* pour
« nouveaux univers » (peut n'être que de l'irrégularité) ; (2) PIFS sur-pénalise
le trait fin (Petrie > bruit), donc les valeurs absolues des objets filaires ne
valent rien — l'ancre est Sierpiński = 0, et Zaks est un champ lisse, régime où
PIFS est fiable.

**Comparaison de layout (Williams).** Mêmes arêtes, ordre différent : la couche
`rₙ` de Williams est *courte* (anneau de bord), pas la couche longue. La
caustique `rₙ` riche est propre au **layout de Zaks**.

### Spectre de catastrophes (mesure validée, `catastrophe-spectrum.mjs`)

Représentation duale exacte : chaque corde → point `(ψ, p)` (ψ = normale,
p = distance au centre) = fonction de support de la famille (`catastrophe-linespace.mjs`).
La caustique = enveloppe ; cusps (A₃) où le rayon de courbure `ρ = H + H'' = 0`
change de signe ; A₄ = zéro double de `ρ`. **Validée** : Williams → 0 cusp
(couche `rₙ` dégénérée, `H ≈ const`).

À **sampling égal** (3M cordes, `n=10` et `n=12` comparables) :

| | feuillet sup (bord) | feuillet inf (centre) |
|---|---|---|
| Williams n8 | 0 cusp | 0 cusp |
| Zaks n10 | ~29 cusps/coin | ~37 cusps/coin |
| Zaks n12 | ~29 cusps/coin | ~38 cusps/coin |

(`n=8` ≈ 54/58 : gonflé par la sparsité, non comparable.)

**Résultat :** le nombre de cusps **par coin fondamental est invariant avec `n`**
(les deux feuillets) → la caustique **tuile** plus de copies sans enrichir un
coin = signature d'**auto-similarité**, pas de nouveauté. **A₄ : aucun signal
robuste** (candidats dispersés 0/1/2, incohérents entre feuillets = bruit).

### Sonde elliptique (`elliptic-probe.mjs`)

Question testée : les branches de caustique dans le coin fondamental `π/n`
ressemblent-elles à des **cubiques lisses** stables, donc à de vraies candidates
elliptiques, plutôt qu'à une simple analogie ?

Méthode : reconstruire la caustique depuis la fonction de support
`H(ψ)` (`x=H cosψ-H' sinψ`, `y=H sinψ+H' cosψ`), découper par coins `π/n`,
puis fitter des courbes implicites de degrés 2, 3 et 4 avec validation croisée
pair/impair. Une piste elliptique demanderait :

- gros gain degré 2 → 3 ;
- faible gain degré 3 → 4 ;
- stabilité entre `n=10` et `n=12` ;
- échec du témoin Williams.

Résultat (`NB=1440`, `3M` cordes, lissage `21`) :

| Objet | feuillet | verdict |
|---|---|---|
| Williams `n=8` | bord / centre | degré 2 suffit → témoin rationnel/dégénéré |
| Zaks `n=8` | bord / centre | degré 4 améliore fortement → structure > cubique |
| Zaks `n=10` | bord | seul signal cubique possible |
| Zaks `n=10` | centre | degré 4 améliore fortement → structure > cubique |
| Zaks `n=12` | bord / centre | degré 4 améliore fortement → structure > cubique |

**Conclusion elliptique provisoire :** pas de signal elliptique robuste. Le seul
cas compatible avec une cubique (`n=10`, feuillet bord) ne survit pas au passage
à `n=12`. Les courbes Zaks semblent plutôt relever d'une enveloppe
auto-similaire à structure supérieure à la cubique, tandis que Williams valide le
témoin rationnel/dégénéré attendu.

## Conclusion de l'enquête

- **Auto-similarité** : confirmée, forte, et **propre au layout de Zaks**
  (Williams, mêmes arêtes, donne une caustique `rₙ` *gelée/dégénérée*).
- **Nouveaux univers façon Mandelbrot** : **NON confirmé** par les mesures qui
  passent leur contrôle. Catastrophes : spectre par coin invariant en `n`, pas
  d'A₄ émergent. IFS : résidu modeste (~0.21) explicable par l'irrégularité
  lisse entre cusps, pas par de nouveaux types structurels.
- Bilan : Zaks = **auto-similaire riche** (bien plus que Sierpiński, à l'opposé
  du gelé Williams), mais **du côté « auto-similaire sans univers neufs »**.
- Méthodes **invalides** écartées : nouveauté par patchs d'image (échoue le
  contrôle Sierpiński). Toute future mesure doit passer Williams=0 et/ou
  Sierpiński≈0.

## Littérature

- **Enveloppes de cordes / string art** (le cas le plus proche) :
  *Curve Stitching and Dancing Planets* (arXiv:2511.14828, *Math. Intelligencer*
  2025) ; *Circles, chords and epicycloids* (*Math. Gazette*) ; E. H. Lockwood,
  *A Book of Curves* (1961). Pour une carte affine `i↦a·i+b mod m`, l'enveloppe
  est un **épi/hypocycloïde unique** → modèle nul (novelty = 0).
- **Caustiques = catastrophes** : M. V. Berry & C. Upstill, *Catastrophe optics*
  (*Progress in Optics* 18, 1980) ; V. I. Arnold, *Catastrophe Theory* et
  Arnold–Gusein-Zade–Varchenko, *Singularities of Differentiable Maps* ;
  R. Thom (1972). Classification `Aₖ, Dₖ, Eₖ`.
- **Extraction algorithmique** : Hidding, van de Weygaert et al., *caustic
  skeleton* du cosmic web (arXiv:1703.09598). Symbolique : *Caustics by
  refraction of circles and lines* (Springer 2025, via CAS).
- **Renormalisation / auto-similarité** : Douady–Hubbard ; Tan Lei (similarité
  Mandelbrot/Julia aux points de Misiurewicz) ; McMullen, *Complexity of
  Self-Similar Sets*.

## Références dans le code

- `zaksUnrank(n, i)` / `zaksRank(n, q)` — position ↔ permutation en `O(n²)`
  (`src/lib/pancake.ts`).
- `drawYankelovichToCanvas` — champ de densité / caustiques `rₙ`
  (`src/lib/pancake-render.ts`).
- `scratch/elliptic-probe.mjs` — sonde cubique/elliptique sur les coins
  fondamentaux via fits implicites de degrés 2/3/4.
- `buildZaksSamplingGraph(n)` — échantillonnage `O(n²)` des cordes `rₙ`.
- `forEachZaksFundamentalEdge`, `computeZaksOrbits` — secteur fondamental
  (orbites `Cₙ`) ; replier en plus par `ω` pour le coin `π/n`.
- `yankelovichDihedralSectorVertexCount(n)` — `⌊(n-1)!/2⌋` sommets du coin `π/n`.
