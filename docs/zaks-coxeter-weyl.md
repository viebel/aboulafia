# Zaks, Coxeter et les chambres de Weyl

Cette note essaie de formuler lentement le lien mathématique entre le graphe
pancake dessiné dans l'ordre hamiltonien de Zaks, les groupes de Coxeter et les
systèmes de racines de Weyl.

Le point de départ est le théorème en préparation :

```
P_n = Cay(S_n, {r_2, ..., r_n})
```

où les générateurs agissent par multiplication à droite, et le cycle hamiltonien
de Zaks `Z_n` a un stabilisateur, pour l'action régulière gauche de `S_n`,

```
Stab_{L(S_n)}(Z_n) = <L_rho, L_{r_n}> ≅ D_n,
rho = r_{n-1} r_n.
```

La question est : ce `D_n` est-il seulement une symétrie combinatoire de Zaks, ou
vient-il d'une structure de Coxeter plus profonde ?

La réponse proposée ici est :

> Le `D_n` de Zaks est le sous-groupe dihédral canonique de type `A_{n-1}`,
> engendré par un élément de Coxeter et par le plus long élément de Weyl.

Autrement dit, la symétrie dihédrale de Zaks n'est pas une coïncidence visuelle.
Elle est exactement le couple classique :

```
élément de Coxeter c
+
plus long élément w_0.
```

---

## 1. Le groupe de Coxeter de type `A_{n-1}`

Le groupe de Coxeter de type `A_{n-1}` est simplement le groupe symétrique :

```
W = S_n.
```

Ses générateurs de Coxeter simples sont les transpositions adjacentes :

```
s_1 = (1 2)
s_2 = (2 3)
...
s_{n-1} = (n-1 n).
```

Sur une permutation écrite en ligne,

```
[a_1 a_2 ... a_n],
```

multiplier à droite par `s_i` revient à échanger les positions `i` et `i+1`.

Par exemple :

```
[a_1 a_2 a_3 a_4] · s_2 = [a_1 a_3 a_2 a_4].
```

Donc le groupe `S_n` apparaît ici sous deux noms :

```
S_n                 nom combinatoire
A_{n-1}             nom Coxeter / Weyl
```

Ce sont les mêmes éléments, mais pas le même regard.

---

## 2. Les chambres de Weyl

Le système de racines de type `A_{n-1}` vit dans l'hyperplan

```
x_1 + x_2 + ... + x_n = 0
```

à l'intérieur de `R^n`.

Ses miroirs sont les hyperplans

```
x_i = x_j.
```

Ces miroirs découpent l'espace en régions. Chaque région correspond à un ordre
strict des coordonnées.

Par exemple :

```
x_1 < x_2 < x_3 < ... < x_n
```

est une chambre.

Une autre chambre est :

```
x_3 < x_1 < x_2 < ... < x_n.
```

Le groupe `S_n` agit en renommant les coordonnées. Par exemple, la permutation
qui échange `1` et `2` envoie la chambre

```
x_1 < x_2 < x_3
```

sur

```
x_2 < x_1 < x_3.
```

Ainsi, les `n!` permutations de `S_n` peuvent être vues comme les `n!` chambres
de Weyl de type `A_{n-1}`.

Donc le cycle de Zaks n'est pas un cycle sur les racines. C'est un cycle sur les
chambres :

```
Zaks visite toutes les permutations
= Zaks visite toutes les chambres de Weyl de A_{n-1}.
```

---

## 3. Le plus long élément `w_0`

Dans `S_n`, la longueur Coxeter d'une permutation est le nombre minimal de
transpositions adjacentes nécessaires pour l'obtenir.

Elle est aussi égale au nombre d'inversions :

```
i < j mais w(i) > w(j).
```

La permutation la plus longue est celle qui inverse toutes les paires :

```
w_0 = [n n-1 ... 2 1].
```

Exemple pour `n = 5` :

```
identité = [1 2 3 4 5]
w_0      = [5 4 3 2 1]
```

Sa longueur est maximale :

```
ell(w_0) = n(n-1)/2.
```

Géométriquement, `w_0` envoie la chambre fondamentale sur la chambre opposée.

Si la chambre fondamentale est

```
x_1 < x_2 < ... < x_n,
```

alors la chambre opposée est

```
x_n < x_{n-1} < ... < x_1.
```

Donc `w_0` est l'opération qui retourne complètement l'ordre.

---

## 4. Les générateurs pancake comme plus longs éléments paraboliques

Le générateur pancake `r_k` retourne les `k` premières positions :

```
[a_1 a_2 ... a_k a_{k+1} ... a_n]
    |
    v
[a_k ... a_2 a_1 a_{k+1} ... a_n].
```

Dans le groupe de Coxeter `A_{n-1}`, on regarde le sous-groupe engendré par

```
<s_1, ..., s_{k-1}> ≅ S_k.
```

Ce sous-groupe est un sous-groupe parabolique de type `A_{k-1}`.

Son plus long élément est :

```
w_0(A_{k-1}) = [k k-1 ... 1 k+1 ... n].
```

Mais c'est exactement `r_k`.

Donc :

```
r_k = w_0(A_{k-1}).
```

En particulier :

```
r_n = w_0(A_{n-1}).
```

C'est le premier lien précis.

Les générateurs pancake ne sont pas les réflexions simples `s_i`. Ils sont plus
gros : chacun est le plus long élément d'un sous-système de racines initial.

On peut résumer :


| Objet pancake | Objet Coxeter                              |
| ------------- | ------------------------------------------ |
| `S_n`         | groupe de Weyl `A_{n-1}`                   |
| permutation   | chambre de Weyl                            |
| `r_k`         | plus long élément du parabolique `A_{k-1}` |
| `r_n`         | plus long élément global `w_0`             |


---

## 5. Le produit `rho = r_{n-1} r_n`

Le théorème de Zaks utilise

```
rho = r_{n-1} r_n.
```

Regardons ce produit.

On a :

```
r_n     = [n n-1 ... 2 1]
r_{n-1} = [n-1 n-2 ... 2 1 n].
```

Le produit `r_{n-1} r_n` est un `n`-cycle. Selon la convention de composition, il
s'écrit comme l'un des deux cycles inverses :

```
(1 2 3 ... n)
```

ou

```
(1 n n-1 ... 2).
```

Ces deux choix ne changent pas la structure : dans les deux cas, `rho` est un
élément de Coxeter de type `A_{n-1}`.

En générateurs simples, cela revient à un produit contenant chaque générateur
simple exactement une fois :

```
rho = s_1 s_2 ... s_{n-1}
```

ou l'inverse

```
rho = s_{n-1} ... s_2 s_1.
```

Donc :

```
rho = r_{n-1} r_n
```

est l'élément de Coxeter caché dans la récursion de Zaks.

C'est le deuxième lien précis.

---

## 6. Le sous-groupe dihédral canonique `<rho, r_n>`

Dans tout groupe de Coxeter fini, le plus long élément `w_0` interagit très
fortement avec les éléments de Coxeter.

Dans le type `A_{n-1}`, avec

```
 = r_{n-1} r_n,
r_n = w_0,
```

on a les relations :

```
rho^n = 1
r_n^2 = 1
r_n rho r_n = rho^{-1}.
```

Ces trois relations sont exactement celles du groupe dihédral :

```
D_n = <rotation, réflexion>.
```

Donc :

```
<rho, r_n> ≅ D_n.
```

C'est le même `D_n` que celui qui apparaît dans le théorème du stabilisateur de
Zaks :

```
Stab_{L(S_n)}(Z_n) = <L_rho, L_{r_n}> ≅ D_n.
```

La nouveauté du théorème n'est donc pas seulement que le cycle de Zaks a une
symétrie dihédrale.

La nouveauté est plus précise :

> Le cycle hamiltonien de Zaks est stabilisé exactement par le sous-groupe
> dihédral naturel `D_n = <c, w_0>` du groupe de Weyl `A_{n-1}`.

Ici :

```
c = rho        élément de Coxeter
w_0 = r_n      plus long élément
```

---

## 7. Lien avec le plan de Coxeter

Le plan de Coxeter est un plan spécial associé à un élément de Coxeter `c`.

Dans le type `A_{n-1}`, l'élément de Coxeter `c` a ordre `n`.

Sur le plan de Coxeter, il agit comme une rotation :

```
c : rotation de 2π/n.
```

Le plus long élément `w_0` conjugue cette rotation en son inverse :

```
w_0 c w_0 = c^{-1}.
```

Sur le plan de Coxeter, cela se voit comme une réflexion :

```
w_0 : réflexion du plan
c   : rotation du plan.
```

Donc le couple

```
<c, w_0>
```

devient visuellement un groupe dihédral dans le plan de Coxeter.

C'est exactement la forme abstraite du dessin :

```
rotation + réflexion = kaléidoscope dihédral.
```

Le lien avec Zaks est alors :

```
rho = c
r_n = w_0
<rho, r_n> = <c, w_0> ≅ D_n.
```

Le dessin circulaire de Zaks n'est pas la projection du système de racines
`A_{n-1}` sur son plan de Coxeter. Mais il rend visible le même sous-groupe
dihédrale que le plan de Coxeter rend visible.

La phrase prudente serait :

> Zaks ne projette pas les racines de `A_{n-1}`. Il ordonne les chambres de Weyl
> de `A_{n-1}` le long d'un cycle hamiltonien, et ce cycle est stabilisé par le
> sous-groupe dihédral canonique engendré par l'élément de Coxeter et le plus
> long élément.

---

## 8. Ce qui est pareil, ce qui est différent

### Ce qui est pareil

Dans les deux histoires, on retrouve :

```
A_{n-1}
S_n
c = élément de Coxeter
w_0 = plus long élément
<c, w_0> ≅ D_n
rotation d'ordre n
réflexion qui inverse cette rotation
```

Donc la symétrie dihédrale de Zaks a une explication Coxeter naturelle.

### Ce qui est différent

Dans le plan de Coxeter classique, on projette les racines :

```
racines de A_{n-1} -> plan 2D.
```

Chez Zaks, on place les chambres sur un cycle :

```
chambres de A_{n-1} = permutations de S_n -> cycle hamiltonien.
```

Les objets dessinés ne sont donc pas les mêmes.

Mais le sous-groupe qui agit est le même :

```
<c, w_0> ≅ D_n.
```

---

## 9. Formulation possible pour l'article

Voici une formulation compacte, utilisable comme remarque ou paragraphe
conceptuel.

> Recall that the pancake graph `P_n` is the Cayley graph of the Coxeter group
> `S_n` of type `A_{n-1}`. The pancake generator `r_k` is the longest element of
> the standard parabolic subgroup `<s_1, ..., s_{k-1}> ≅ S_k`; in particular
> `r_n` is the longest element `w_0` of `S_n`. Moreover
> `rho = r_{n-1} r_n` is a Coxeter element of type `A_{n-1}`. Hence
> `<rho, r_n> = <c, w_0>` is the canonical dihedral subgroup of the Weyl group,
> with relations `rho^n = r_n^2 = 1` and `r_n rho r_n = rho^{-1}`. The theorem
> therefore identifies the left-regular stabilizer of the Zaks Hamiltonian cycle
> with this Coxeter-theoretic dihedral subgroup.

En français :

> Le graphe pancake `P_n` est le graphe de Cayley du groupe de Coxeter `S_n` de
> type `A_{n-1}`. Le générateur pancake `r_k` est le plus long élément du
> sous-groupe parabolique standard `<s_1, ..., s_{k-1}> ≅ S_k`; en particulier
> `r_n` est le plus long élément `w_0` de `S_n`. De plus,
> `rho = r_{n-1} r_n` est un élément de Coxeter. Ainsi
> `<rho, r_n> = <c, w_0>` est le sous-groupe dihédral canonique du groupe de
> Weyl, défini par `rho^n = r_n^2 = 1` et `r_n rho r_n = rho^{-1}`. Le théorème
> identifie donc le stabilisateur gauche du cycle hamiltonien de Zaks avec ce
> sous-groupe dihédral de nature Coxeter.

---

## 10. Prudence terminologique

Il faut éviter de dire :

> Le dessin de Zaks est le plan de Coxeter de `A_{n-1}`.

Ce serait trop fort.

Mieux :

> Le dessin de Zaks est un modèle circulaire des chambres de Weyl de `A_{n-1}`.
> Sa symétrie gauche `D_n` est le même sous-groupe `<c,w_0>` que celui qui agit
> dihédralement sur le plan de Coxeter.

Ou encore :

> Le plan de Coxeter explique quelle symétrie dihédrale doit apparaître; le
> théorème de Zaks montre que le cycle hamiltonien la réalise exactement, et
> qu'il n'en réalise pas davantage dans l'action régulière gauche.

