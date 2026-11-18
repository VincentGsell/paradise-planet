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
| L7 | critique visuel, perf, README | en cours |

## Choix faits seul (à valider par Vincent)

1. **Relief** : λ0 = 1,2 R et A0 = 0,028 R (OpenG calibre 1 800 m pour 50 km de rayon ; à 5 % du rayon, une petite
   planète faisait des aiguilles). Mer à 58 % de la surface. Un plateau continental de 20 à 55 m (le jardin y vit) et
   des plaines côtières basses (plages).
2. **Atmosphère** : hauteur d'échelle de Rayleigh = 5 % du rayon, épaisseur optique verticale de la Terre conservée
   (`scaled_with` d'OpenG), un peu plus de diffusion (×1,35) pour des couchers plus chauds.
3. **Nuages** : base à 4,2 % du rayon (380 à 950 m), épaisseur 7,5 % (520 à 1 500 m), cumulus de beau temps.
4. **Eau** : une mer tropicale idéalisée, très claire et cyan en profondeur (absorption verte 0,024 /m), pour que le
   jardin à 40 m reste lumineux. Sous l'eau, l'œil s'adapte complètement.
5. **Palmiers** sur les plages et juste derrière ; feuillus et conifères selon l'altitude dans les forêts.
6. **Sans asset** : tous les maillages (arbres, palmiers, rochers, poissons, oiseaux) sont générés au chargement ou
   dans les shaders.

## Mesures (RTX 5070, Chrome 157, headless)

- Vol scripté de 60 s, 2560×1440, High, 30 km : GPU moyen 5,1 ms, p99 7,7 ms, max 8,0 ms.
- Vol scripté de 60 s, 1920×1080, High : GPU moyen 3,7 ms, p99 5,9 ms, max 6,1 ms.
- `index.html` minifié : 142,9 kB (50,5 kB gzip).

## Notes

- 18/11 : Chrome 157 headless (`--enable-unsafe-webgpu`) voit la RTX 5070 (Blackwell) avec `timestamp-query` :
  captures et mesures sans fenêtre.
- Outils : `tools/shoot.mjs` (poses, `--prof` = temps GPU par passe, `--clear` sans nuages, `--hour`),
  `tools/flight.mjs` (vol scripté, rapport de perf, images).
