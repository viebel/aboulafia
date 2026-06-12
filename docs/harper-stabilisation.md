# La stabilisation de Harper, expliquée simplement

Ce document explique **une seule chose** : ce qu'est l'opération de
*stabilisation* de L. H. Harper (*Global Methods for Combinatorial Isoperimetric
Problems*), et pourquoi elle résout des problèmes isopérimétriques. On illustre
tout sur le cas le plus simple — le **cycle `Zₙ`** — qui est aussi ce que dessine
la page `/stabilization` de l'app.

Pour le contexte (Coxeter, kaléidoscope, lien avec le graphe pancake), voir
`docs/harper-coxeter-kaleidoscope.md`. Ici, on reste sur la mécanique.

---

## 1. Le problème qu'on cherche à résoudre

On a un graphe. On fixe un nombre `k`. Question :

> Parmi tous les ensembles `S` de `k` sommets, lequel a le **plus petit bord** ?

Le **bord** `|∂S|`, c'est le nombre d'arêtes qui ont **un** bout dans `S` et **un**
bout dehors (les arêtes « qui sortent »). C'est le problème isopérimétrique : à
volume (`k`) fixé, minimiser le périmètre (`|∂S|`).

Sur le cycle `Zₙ` (les sommets `0,1,…,n−1` en cercle, chacun relié à ses deux
voisins), la réponse est intuitive : le meilleur `S` est un **arc contigu** (un
bloc de sommets voisins), qui n'a que **2** arêtes de bord. N'importe quel `S`
« éparpillé » a un bord plus grand.

La stabilisation est une **procédure mécanique** qui transforme un `S` quelconque
en un `S` meilleur (bord plus petit), sans changer `k`, jusqu'à tomber sur
l'optimum. Et elle le fait avec des **réflexions** — d'où le kaléidoscope.

---

## 2. Les trois ingrédients

1. **Le graphe dessiné.** On place les sommets dans le plan. Pour `Zₙ`, c'est le
   `n`-gone régulier : sommet `i` à l'angle `360·i/n`.

2. **Un miroir `R`.** Une droite passant par le centre, telle que la réflexion
   par rapport à elle **renvoie le dessin sur lui-même** (sommet sur sommet,
   arête sur arête). Pour `Zₙ`, il y a exactement `n` tels miroirs ; la réflexion
   du miroir numéro `c` envoie le sommet `i` sur le sommet `(c − i) mod n`.

3. **Un point `p` (dit de Fricke–Klein).** Un point fixé dans le plan, choisi
   **générique** : ni sur un sommet, ni sur un miroir. Il sert à désigner, pour
   chaque miroir, **quel est le « bon côté »** : le côté de `p`. C'est `p` qui
   décide *vers où* on plie.

---

## 3. L'opération `Stab` : « plier une paire vers `p` »

### a) Réfléchir un sommet

Un miroir, c'est une droite qui passe par le centre du cercle. **Réfléchir** un
sommet, c'est le rabattre de l'autre côté de cette droite — exactement comme dans
un vrai miroir. Le sommet `a` a donc une **image** : le sommet situé
symétriquement, en face, de l'autre côté de la droite. On note cette image
`R(a)`, qui se lit « le réfléchi de `a` ».

### b) Les sommets vont par deux

Comme la réflexion renvoie le dessin sur lui-même (ingrédient 2 du §2), l'image
`R(a)` est elle aussi un sommet du graphe. Les sommets se regroupent donc **par
paires** : un sommet et son image. Notons une telle paire `{a, b}`, où

- `b = R(a)` veut simplement dire « `b` est l'image de `a` dans le miroir ».

Réfléchir une seconde fois ramène au départ (`R(b) = a`) : `a` et `b` sont donc
l'image l'un de l'autre, posés de part et d'autre de la droite.

### c) Le côté de `p`

La droite du miroir coupe le plan en **deux moitiés**. Le point `p` (l'ingrédient
3) est posé dans l'une des deux. Pour une paire `{a, b}`, un des deux sommets
tombe dans **la même moitié que `p`**, l'autre dans la moitié d'en face. On
convient de nommer :

- **`a`** = le sommet qui est **du même côté que `p`** (on dira « côté `p` ») ;
- **`b`** = le sommet de l'autre côté (« côté lointain »).

C'est *juste* une convention de nommage, dictée par `p` : si `p` était de l'autre
côté de la droite, on appellerait `a` ce qu'on appelait `b`. Le seul rôle de `p`
est de désigner, pour chaque paire, lequel des deux est « `a` » (le côté vers
lequel on va pousser).

### d) La règle

Pour chaque paire `{a, b}`, la stabilisation applique **une règle unique** :

| `S` contenait… | `Stab` met… | en clair |
|---|---|---|
| `a` **et** `b` | `a` **et** `b` | inchangé |
| `a` seul | `a` | inchangé |
| `b` seul | `a` | **déplacé vers `p`** |
| ni l'un ni l'autre | rien | inchangé |

En une phrase : **on garde le même nombre d'éléments dans la paire, mais on les
pousse du côté de `p`.** Le seul cas où quelque chose bouge vraiment est « `b`
seul » : l'élément qui était sur le sommet lointain `b` saute sur le sommet `a`,
côté `p`.

(S'il existe un sommet posé *pile sur* la droite du miroir, il est sa propre
image — `R(a) = a` — et reste donc tel quel.)

On note `Stab_{R,p}(S)` le résultat de cette règle appliquée d'un coup à **toutes
les paires** du miroir `R`.

---

## 4. Un exemple complet sur `Z₆`

Sommets `0..5` sur l'hexagone (sommet `i` à `60·i` degrés). Prenons :

- l'ensemble de départ **`S = {1, 2, 4}`** ;
- le point `p` près du sommet `0` (entre `0` et `1`, vers `15°`).

Son bord ? Les arêtes qui sortent sont `(0,1)`, `(2,3)`, `(3,4)`, `(4,5)` →
**`|∂S| = 4`**. Un ensemble bien éparpillé.

Appliquons le **miroir `c = 1`** : `i ↦ (1 − i) mod 6`. Il apparie

```
{0,1}     {2,5}     {3,4}
```

(aucun sommet fixe). Où est `p` ? Du côté du sommet `0`. On en déduit le côté `p`
de chaque paire — c'est le représentant qu'on garde :

| paire | côté `p` | côté lointain |
|---|---|---|
| `{0,1}` | `0` | `1` |
| `{2,5}` | `5` | `2` |
| `{3,4}` | `4` | `3` |

On applique la règle du §3 à `S = {1,2,4}` :

- paire `{0,1}` : `S` a `1` (côté lointain) seul → on **déplace vers `0`**.
- paire `{2,5}` : `S` a `2` (côté lointain) seul → on **déplace vers `5`**.
- paire `{3,4}` : `S` a `4` (côté `p`) seul → inchangé, reste `4`.

Résultat : **`S′ = {0, 4, 5}`**.

C'est l'**arc contigu** `4–5–0` (trois sommets voisins, blottis autour de `p`).
Son bord : seules `(3,4)` et `(0,1)` sortent → **`|∂S′| = 2`**. 

En **une seule réflexion**, on est passé de bord `4` à bord `2` : l'optimum. Et
l'ensemble s'est bien **condensé du côté de `p`**.

---

## 5. Pourquoi le bord ne peut jamais augmenter

C'est le cœur de l'affaire. Plier une paire vers `p` ne fait que **rapprocher les
éléments de `S` les uns des autres** (du même côté). Or rapprocher des éléments
ne peut que **réduire ou laisser égal** le nombre d'arêtes qui sortent — jamais
l'augmenter. C'est l'analogue discret exact de la **symétrisation de Steiner** en
géométrie (pousser la matière d'un côté d'un plan rend la forme plus compacte,
donc de périmètre plus petit).

Conséquence immédiate :

> Le minimiseur du bord se trouve **forcément parmi les ensembles que `Stab` ne
> change plus** (les ensembles « stables »).

On a donc le droit de ne chercher l'optimum **que** parmi ces ensembles stables —
au lieu des `2ⁿ` sous-ensembles possibles. C'est tout l'intérêt.

---

## 6. Itérer : `Stab^(∞)` et le repli dans la chambre

Un seul miroir ne suffit pas en général (dans l'exemple ci-dessus, on a eu de la
chance). La procédure complète **enchaîne tous les miroirs**, encore et encore :

```
Stab^(∞) :  appliquer R₀, puis R₁, puis R₂, … , puis Rₙ₋₁, puis recommencer,
            jusqu'à ce qu'un tour complet ne change plus rien.
```

Harper démontre que **ça s'arrête** (le bord décroît à chaque changement et ne
peut pas descendre sous `0`). Et le point d'arrivée a une description géométrique
limpide :

> Un ensemble stable sous **tous** les miroirs à la fois, c'est un ensemble
> entièrement **rabattu dans la chambre fondamentale** du groupe de réflexions —
> le coin du kaléidoscope.

Sur `Zₙ`, cette chambre est un secteur angulaire, et l'ensemble stable y est un
**arc contigu** collé contre `p`. On retrouve la solution isopérimétrique du
cycle, obtenue **sans énumérer quoi que ce soit**, juste en pliant.

C'est ça, la « méthode globale » : remplacer une recherche exponentielle par un
**repli kaléidoscopique** vers un unique domaine fondamental.

---

## 7. Résumé en cinq lignes

1. On veut l'ensemble de `k` sommets au **plus petit bord**.
2. On choisit un point `p` ; chaque miroir a alors un « côté `p` ».
3. `Stab` **pousse chaque paire-miroir vers `p`** (même cardinal, bord qui baisse).
4. Comme le bord ne remonte jamais, l'optimum est **stable** sous `Stab`.
5. En pliant sur **tous** les miroirs, on rabat `S` dans la **chambre
   fondamentale** → la solution (un **arc** sur `Zₙ`).

---

## 8. Le voir tourner

La page **`/stabilization`** de l'app fait exactement ce document, en
interactif : un ensemble `S` sur `Zₙ`, le point `p`, les `n` miroirs, et chaque
clic sur **Next** applique un `Stab_{R,p}` (flèches = transferts vers `p`,
arêtes orange = bord). **Play** déroule `Stab^(∞)` jusqu'à l'arc.

- Code : `src/components/stabilization/stabilization-view.tsx`
- Contexte théorique : `docs/harper-coxeter-kaleidoscope.md`
- Source : L. H. Harper, *Global Methods for Combinatorial Isoperimetric
  Problems*, CUP 2004, chap. 3 (« Stabilization and compression »).
