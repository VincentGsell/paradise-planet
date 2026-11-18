# Journal de Paradise Planet

> Tenu par Claude, lot par lot. Contrat : `prompt.txt` (anglais) / `prompt.fr.txt`.
> Règles de Vincent : git local, un commit par lot, jamais de push ; il juge la sensation en fenêtre.

## À faire à la publication (pas avant)

- **Prompt public** : remplacer la mention d'OpenG par « my own engine (not public yet) », sans rien retirer
  d'autre (demande de Vincent le 18/11 : OpenG n'est pas encore publié). Garder `prompt.txt` fidèle au contrat.
- Crédit d'Abyssal Garden (MIT) dans le README, pour les fonds marins seulement. Pas dans le prompt.
- Licence, GitHub Pages, captures du README : quand Vincent décide, si c'est une réussite technique.

## Lots

| Lot | Contenu | État |
|---|---|---|
| L0 | socle : build un fichier, page, menu (taille 10–50 km, Low/Medium/High), résolution dynamique, stats, harnais de test headless | en cours |
| L1 | planète : relief OpenG, cube-sphère, LOD quadtree + morph, patches au GPU, vol OpenG, pas de traversée du sol | en cours |
| L2 | soleil, cycle jour/nuit, commande du temps, atmosphère (Hillaire), étoiles | |
| L3 | océan FFT, rivage, vue sous l'eau | |
| L4 | nuages volumétriques sans météo, leurs ombres | |
| L5 | biome terrestre : herbe, arbres, fleurs, rochers, faune, god rays au coucher | |
| L6 | biome sous-marin 20–50 m (jardin d'Abyssal) | |
| L7 | finition, critique visuel, perf, README | |

## Notes

- 18/11 : Chrome 157 headless (`--enable-unsafe-webgpu`) voit la RTX 5070 (Blackwell) avec `timestamp-query` :
  captures et mesures sans fenêtre.
