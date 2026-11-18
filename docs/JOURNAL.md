# Journal de Paradise Planet

> Tenu par Claude, lot par lot. Contrat : `prompt.txt` (anglais) / `prompt.fr.txt`.
> Règles de Vincent : git local, un commit par lot, jamais de push ; il juge la sensation en fenêtre.

## À faire à la publication (pas avant)

- **Prompt public** : remplacer la mention d'OpenG par « my own engine (not public yet) », sans rien retirer
  d'autre (demande de Vincent le 18/11 : OpenG n'est pas encore publié). Garder `prompt.txt` fidèle au contrat.
- Crédit d'Abyssal Garden (MIT) dans le README, pour les fonds marins seulement (fait dans le brouillon). Pas dans le
  prompt.
- Licence, GitHub Pages, captures du README : quand Vincent décide, si c'est une réussite technique.

## Lots

| Lot | Contenu | État |
|---|---|---|
| L0 | socle : build un fichier, page, menu (taille 10–50 km, Low/Medium/High), résolution dynamique, stats, harnais headless | fait |
| L1 | planète : relief OpenG (bruit continu, crêtes), cube-sphère, LOD quadtree + morph CDLOD, patches au GPU, vol OpenG, pas de traversée du sol | fait |
| L2 | soleil, cycle jour/nuit, commande du temps, atmosphère Hillaire (LUT + irradiance du ciel), étoiles et Voie lactée | fait |
| L3 | océan FFT 3 cascades (OpenG), rivage et écume, fond vu à travers l'eau, fenêtre de Snell, brouillard sous l'eau | fait |
| L4 | nuages volumétriques sans météo (coquille, Nubis, multi-diffusion, poudre, AO), carte d'ombre de Beer | fait |
| L5 | herbe (GrassField d'OpenG), fleurs, arbres / palmiers / buissons / rochers (3 LOD), ombres en cascades, god rays, faune, pollen, lucioles | fait, à polir |
| L6 | jardin sous-marin 18–55 m : kelp d'Abyssal Garden, herbiers, coraux mous, poissons, neige marine, rayons sous l'eau | fait, à polir |
| L7 | critique visuel (3 passes), perf, README | en cours : perf validée, critique pas encore « mineur seulement » |

## Choix faits seul (à valider par Vincent)

1. **Relief** : λ0 = 1,2 R et A0 = 0,028 R (OpenG calibre 1 800 m pour 50 km de rayon ; à 5 % du rayon, une petite
   planète faisait des aiguilles). Mer à 58 % de la surface. Un plateau continental de 20 à 55 m (le jardin y vit) et
   des plaines côtières basses (plages).
2. **Atmosphère** : hauteur d'échelle de Rayleigh = 4,5 % du rayon, épaisseur optique verticale de la Terre conservée
   (`scaled_with` d'OpenG), un peu plus de diffusion (×1,5) pour des couchers plus chauds ; plus un étalonnage
   « heure dorée » en post quand le soleil est bas (la petite planète a trop peu d'air à l'horizon pour rougir seule).
3. **Nuages** : base à 4,2 % du rayon (380 à 950 m), épaisseur 7,5 % (520 à 1 500 m), cumulus de beau temps.
4. **Eau** : une mer tropicale idéalisée, très claire et cyan en profondeur (absorption verte 0,024 /m), pour que le
   jardin à 40 m reste lumineux. Sous l'eau, l'œil s'adapte complètement.
5. **Palmiers** sur les plages et juste derrière ; feuillus et conifères selon l'altitude dans les forêts.
6. **Sans asset** : tous les maillages (arbres, palmiers, rochers, poissons, oiseaux) sont générés au chargement ou
   dans les shaders.

## Mesures (RTX 5070, Chrome 157, headless, vol scripté de 60 s orbite → prairie → plongée)

| Résolution | Niveau | GPU moyen | GPU p99 | GPU max |
|---|---|---|---|---|
| 3840×2160 (4K natif, sans résolution dynamique) | High | 6,9 ms | 9,9 ms | 10,5 ms |
| 2560×1440 | High | 4,4 ms | 6,3 ms | 6,6 ms |
| 1920×1080 | High | 3,3 ms | 5,0 ms | 5,4 ms |

- Cible du prompt (RTX 5070 Ti, 1440p : ≤ 11 ms en moyenne, aucune image > 16,7 ms) : tenue sur une 5070 non Ti.
- 60 images/s verrouillées en 4K sur la 5070 : le GPU tient même sans résolution dynamique.
- Quelques pics CPU (jusqu'à ~16-18 ms par image en headless, sans vsync) : à vérifier en fenêtre.
- `index.html` minifié : 151 kB (53,5 kB gzip).

## Le critique visuel (sous-agent qui ne voit que les images)

Trois passes. Corrigé en route : un trou dans la mer (sphère de visibilité sans la surface de l'eau), une planète
décalée en orbite (base caméra dégénérée en visée verticale), des nuages en terrasses (pas trop longs), des jupes
d'eau en « codes-barres », des poses à côté de leur sujet (désormais cherchées sur la planète), un coucher sans
couleur (heure calée sur la hauteur du soleil, étalonnage heure dorée), le sous-marin vide (coraux, éponges, bancs de
poissons, clairière dans le kelp), des stries d'altitude (bruit de détail étiré en vue rasante).

Restent, selon la 3e passe (à reprendre) :
- nuages : bords encore en peigne ou en damier par endroits, plafond trop uniforme vu de dessous ;
- coraux encore trop lisses (« gelée ») et caustiques parfois dentelées sur les parois ;
- palette encore un peu froide dans l'ombre, roches à réchauffer davantage ;
- rivage triangulé au loin, sans déferlante ;
- vue d'orbite : pas de terminateur à cette heure, nuages tous de la même taille ;
- sapins lointains « en assiettes » (LOD), herbe en épines sur certaines pentes.

## Notes

- 18/11 : Chrome 157 headless (`--enable-unsafe-webgpu`) voit la RTX 5070 (Blackwell) avec `timestamp-query` :
  captures et mesures sans fenêtre.
- Outils : `tools/shoot.mjs` (poses, `--prof` = temps GPU par passe, `--clear` sans nuages, `--hour`),
  `tools/flight.mjs` (vol scripté, rapport de perf, images).
