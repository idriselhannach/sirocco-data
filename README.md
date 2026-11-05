# Sirocco · la partie données

**Sirocco** est une application mobile née d'un constat : dans une nouvelle ville, il est
difficile de trouver sa communauté, et plus encore de la rencontrer. Chaque ville y a la sienne,
qui se retrouve autour d'événements : un café, un match, une soirée de révisions. Elle est en
ligne depuis l'été 2026, sur l'App Store, le Play Store et le web, avec près de 90 membres
répartis entre Marrakech, Paris, Londres, Barcelone, Berlin, Poissy et l'ESSEC.

Ce dépôt rassemble **trois extraits du vrai code de l'application**, ceux qui touchent aux
données, avec leurs tests. Le reste de l'application (écrans, messagerie, appels…) reste privé :
je peux le montrer sur demande.

<p align="center">
  <img src="captures/01-concept.png" width="190" alt="Le fil d'une ville">
  <img src="captures/03-evenements.png" width="190" alt="Les événements">
  <img src="captures/08-multivilles.png" width="190" alt="Plusieurs villes">
</p>

---

## 1. Recommandation : montrer à chacun ce qui l'intéresse d'abord

📁 [`recommandation/`](recommandation)

**Le problème.** Quand une ville publie plus que ce qu'on peut lire d'un coup, l'ordre des
dates ne suffit plus : on rate le post de son ami au milieu de vingt autres.

**La solution.** Chaque post reçoit une note, différente pour chaque membre :

- **la fraîcheur** : un post perd la moitié de sa note toutes les 30 heures. Une question posée
  il y a une heure passe devant un post d'ami vieux de cinq jours ;
- **la proximité** : la note monte si l'auteur est un ami, quelqu'un croisé à un événement, ou
  quelqu'un dont on aime souvent les posts, et si le post parle de sujets qu'on lit en entier ;
- **l'intérêt général** : les likes et les commentaires comptent un peu, et un post déjà vu
  plusieurs fois descend.

Deux garde-fous pour ne pas enfermer les gens dans ce qu'ils connaissent déjà :

- **une place sur quatre est réservée à la découverte** : le post le plus récent qu'on n'a
  jamais vu, quel que soit son auteur. Sans elle, un nouveau membre ne serait jamais lu ;
- **un même auteur ne prend jamais trois places de suite.**

Le même principe propose trois événements « pour toi » : la catégorie qu'on fréquente, un
organisateur qu'on apprécie, des amis déjà inscrits, le moment de la semaine où l'on sort.

**Deux choix assumés.** Le classement ne s'active que quand la ville publie au moins 20 posts
en 48 heures : en dessous, tout le monde voit tout et l'ordre des dates est plus clair. Et tout
se calcule **sur le téléphone** : ce que chacun lit ne quitte jamais son appareil.

Les 19 tests de [`classement.test.ts`](recommandation/classement.test.ts) vérifient chacune de
ces règles.

---

## 2. Campus : remettre chaque salle dans son bâtiment

📁 [`campus/`](campus)

**Le problème.** Pour l'ESSEC, l'application affiche le campus en 3D, construit à partir
d'OpenStreetMap, et on y place un événement dans l'une des 429 salles. Leur position vient des
plans d'étage de l'école, calés à quelques mètres près : un cinquième des salles tombaient dans
une cour ou contre un mur, dehors.

**La solution.** Pour chaque salle, le programme vérifie si elle est dans un bâtiment (test du
point dans un polygone). Sinon, il cherche le mur le plus proche, à moins de 15 mètres, et pose
la salle 1,5 mètre derrière lui, à l'intérieur. Les patios et les parvis, qui sont dehors par
nature, ne bougent pas. Les 5 tests de [`ramener.test.mjs`](campus/ramener.test.mjs) en
montrent les cas.

---

## 3. Carte des lieux : choisir quoi montrer à chaque zoom

📁 [`lieux/`](lieux)

**Le problème.** L'onglet Lieux montre, sur une vue satellite, les restaurants, stades, musées
ou parcs d'une ville, tels qu'Apple Plans les connaît. Il y en a des centaines, et un écran de
téléphone n'en porte qu'une trentaine avant de devenir illisible. Apple ne donne ni note ni
fréquentation : il faut décider soi-même ce qui mérite sa place.

**La solution.** Trois règles, dans [`choix.ts`](lieux/choix.ts) :

- **une importance pour chaque lieu**, faute de note : surtout son genre (un stade ou un musée
  pèse 10, un café 4, une boutique 2), un peu ce qu'on sait de lui (un site, un numéro) et son
  rang dans la réponse d'Apple ;
- **une importance minimale qui monte quand on recule** : de loin, seuls les lieux marquants
  paraissent ; de près, tous ;
- **un écart minimal à l'écran** : on parcourt les lieux du plus important au moins important,
  et on n'en garde un que si aucun autre n'est déjà à moins de 50 pixels (40 de très loin).
  Les grands passent toujours, les petits remplissent les trous, et en zoomant d'autres
  apparaissent entre eux sans que ceux déjà là ne bougent.

Deux exceptions : un filtre coché (« Sport ») montre toute sa famille, quelle que soit
l'importance, et les résultats d'une recherche s'affichent tous, juste sans s'empiler.

**Mesuré.** L'écart était de 62 pixels. Sur Poissy, au simulateur iPhone, le passer à 50 (et
40 de très loin) a changé le nombre de lieux à l'écran ainsi :

| Zoom | Avant | Après |
|---|---|---|
| Très loin | 17 | 22 |
| Loin | 16 | 23 |
| Mi-hauteur | 24 | 34 |
| Près | 26 | 32 |

De très loin, baisser l'importance minimale ne changeait rien : 190 lieux de la vue la
dépassaient déjà. Ce qui limitait, c'était leur tassement dans quelques centres-villes,
donc l'écart. À mi-hauteur, l'abaisser faisait surtout entrer des boutiques : il est resté.

Les 14 tests de [`choix.test.ts`](lieux/choix.test.ts) vérifient ces règles.

---

## Lancer les tests

```bash
npm install
npm test   # recommandation, campus et carte des lieux
```

## Technologies

TypeScript · Node.js · Vitest · OpenStreetMap · Apple Plans (MapKit JS).
L'application complète utilise aussi React, Firebase (Realtime Database, Cloud Functions),
Capacitor (iOS et Android), MapLibre et three.js.

---

Idris El Hannach · M1 Sciences des données (SCDI), Sorbonne Université & ISUP ·
idriselhannach@gmail.com
