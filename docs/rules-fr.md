# Règles du jeu Busters

Les Busters peuvent désormais expulser le fantôme qu'ils ont capturé en utilisant **EJECT**.
Consultez l'énoncé mis à jour pour plus de détails.

## Objectif
Capturer plus de fantômes que l'équipe adverse.

## Règles

Le jeu se déroule sur une carte de largeur 16001 et de hauteur 9001. Les coordonnées `X=0, Y=0` représentent le coin supérieur gauche.

Chaque joueur contrôle une équipe de plusieurs busters. Chaque équipe commence à un coin opposé de la carte, près de sa base. Les fantômes sont répartis sur la carte et doivent être capturés et ramenés à la base. Chaque fantôme capturé par un buster ou ramené à la base vaut un point. Cependant, vous pouvez perdre un point si un de vos busters relâche son fantôme ailleurs que dans votre base.

### Fonctionnement de la carte

- Il y a toujours 2 équipes en jeu.
- Au début du jeu, chaque joueur reçoit un identifiant d'équipe. Il indique à quelle base son équipe démarre. Le coin supérieur gauche (`X=0, Y=0`) est pour l'équipe 0. Le coin inférieur droit (`X=16000, Y=9000`) est pour l'équipe 1.
- Le brouillard empêche de connaître les positions des fantômes ou des busters adverses, sauf s'ils sont dans un rayon de 2200 unités d'un de vos propres busters.
- Chaque buster a un identifiant unique. Chaque fantôme a un identifiant unique. Un fantôme et un buster ayant le même identifiant ne sont pas reliés.

### Les Busters

- À chaque tour, un buster peut effectuer l'une des actions suivantes : `MOVE`, `BUST`, `RELEASE`, `STUN`, `RADAR` ou `EJECT`.
- `MOVE` suivi par des coordonnées fera avancer le buster de 800 unités vers le point choisi. La position sera arrondie au plus proche entier.
- `BUST` suivi d'un identifiant de fantôme permettra au buster de viser un fantôme avec son pistolet à proton et lui faire perdre 1 point d'endurance. Si le fantôme a 0 points d'endurance, le buster aspirera le fantôme dans son piège. Cette action fonctionne si le fantôme se trouve dans un rayon inférieur à 1760 unités mais supérieur à 900 unités du buster. Les fantômes capturés ne sont plus visibles sur la carte.
- Un buster peut transporter au plus 1 fantôme simultanément.
- `RELEASE` ordonne au buster de relâcher le fantôme qu'il est en train de porter. Si un fantôme est relâché à moins de 1600 unités d'un coin de la map étant une base, le fantôme est retiré du jeu et le possesseur de la base marque un point.
- `STUN` suivi par l'id d'un buster produit un éclair qui assomme le buster cible. Un buster assommé ne peut pas effectuer d'actions pendant 10 tours. Un buster doit recharger son arme pendant 20 tours avant de pouvoir de nouveau assommer. Un buster assommé ainsi que le buster qui l'a assommé vont relâcher tout fantôme qu'ils transportent.
- Un buster peut assommer un adversaire dans un rayon de 1760 unités.
- `RADAR` permet au buster de gagner en vision à travers le brouillard et ainsi être capable de voir toutes les entités dans un rayon de 4400 unités autour de lui pour le prochain tour. Un buster peut utiliser le radar en transportant un fantôme. Chaque buster peut utiliser cette action une fois par partie.
- `EJECT` suivi par des coordonnées propulsera le fantôme que transporte le buster sur une distance maximum de 1760 unités vers le point choisi.
- Les busters font leurs actions en même temps mais les effets liés aux actions, y compris les déplacements, sont appliqués à la fin du tour.

### Les Fantômes

- Les fantômes sont immobiles sauf si des busters se trouvent dans un rayon de 2200 unités. Dans ce cas, le fantôme se déplace de 400 unités à l'opposé du buster le plus proche. En cas d'égalité, il va fuir le point au barycentre des busters proches.
- Si plusieurs busters tentent de capturer un fantôme, l'équipe ayant le plus de busters aura la priorité. Dans cette équipe, le buster le plus près de la cible récupérera le fantôme. Si les deux équipes ont le même nombre de busters en train de tenter la capture, le fantôme ne sera pas capturé lors de ce tour.
- Un fantôme transporté par un buster s'échappe si ce buster tente de capturer un autre fantôme.
- L'endurance ne se régénère pas.

Le jeu s'arrête quand tous les fantômes ont été capturés ou après une limite de 250 tours.

### État du jeu

L'état du jeu lors d'un tour vous est donné en une liste d'entités, chacune possédant un `id`, une `position`, un `type`, un `state` et une `value`.

La valeur de `type` sera :

- `0` pour un buster de l'équipe 0.
- `1` pour un buster de l'équipe 1.
- `-1` pour un fantôme.

La valeur de `state` sera :

Pour les busters :

- `0`: buster ne transportant pas de fantôme.
- `1`: buster transportant un fantôme.
- `2`: buster assommé.
- `3`: buster en train de viser un fantôme.

Pour les fantômes, cette valeur est leur taux d'endurance.

La `value` pourra être :

Pour un buster :

- si ce buster transporte un fantôme, l'id de ce fantôme.
- si ce buster est assommé, le nombre de tours avant qu'il puisse à nouveau bouger.

Pour un fantôme, c'est le nombre de busters ayant tenté de le capturer.

## Conditions de Victoire
Avoir capturé plus de fantômes que l'équipe adverse à la fin du jeu.

## Conditions de Défaite

- Votre programme produit une sortie invalide.
- Votre programme dépasse la limite de temps.
- Vous avez moins de fantômes que votre adversaire à la fin du jeu.

## Règles pour les experts

- Les positions de départ des busters et des fantômes sont symétriques.
- Les déplacements des fantômes se font 1 tour après vous avoir repéré.
- Si un fantôme sort de la carte après un déplacement, ses nouvelles coordonnées sont bornées avec celles de la carte.
- Utiliser `STUN` sur un buster déjà assommé l'assommera pour 10 nouveaux tours.
- Si un buster transportant un fantôme est assommé dans une base, le fantôme est retiré du jeu et le possesseur de la base marque un point.
- Il n'est pas possible d'utiliser `EJECT` pour propulser un fantôme dans une base pour marquer des points à distance. Le fantôme propulsé reste en jeu.

## Note
Votre programme doit d'abord lire les données d'initialisation depuis l'entrée standard, puis, dans une boucle infinie, lire les données contextuelles de la partie et écrire sur la sortie standard les actions pour vos busters.

## Entrées du jeu

### Entrées d'initialisation
- Ligne 1 : un entier `bustersPerPlayer` pour le nombre de busters contrôlés par l'équipe.
- Ligne 2 : un entier `ghostCount` pour le nombre de fantômes sur la carte.
- Ligne 3 : un entier `myTeamId` l'identifiant de votre équipe.

### Entrées pour un tour de jeu
- Ligne 1 : un entier `entities` le nombre d'entités visibles par vous pour ce tour.
- Les `entities` lignes suivantes : 6 entiers séparés par des espaces, `entityId`, `x`, `y`, `entityType`, `state` et `value`. Représentent un buster ou un fantôme.

### Sortie pour un tour de jeu
Une ligne pour chacun de vos busters : une des actions suivantes :

- `MOVE` suivi de deux entiers `x` et `y`
- `BUST` suivi d'un entier `ghostId`
- `RELEASE`
- `STUN` suivi par un entier `busterId`
- `RADAR`
- `EJECT` suivi de deux entiers `x` et `y`

Vous pouvez ajouter du texte après vos instructions, il sera montré dans le player (un message par buster).

## Contraintes
- `2 ≤ bustersPerPlayer < 5`
- `8 ≤ ghostCount ≤ 28`
- `endurance ∈ {3, 15, 40}`

Temps de réponse par tour ≤ 100 ms

