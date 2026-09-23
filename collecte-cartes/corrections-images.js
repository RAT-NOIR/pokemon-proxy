// ============================================================
// CORRECTIONS D'IMAGES LUES À L'ŒIL — appliquées par la jointure des images AVANT le numéro (2026-09-23)
// ============================================================
// 🔑 POURQUOI UNE TABLE ET PAS UNE RÈGLE : les deux témoins possibles ont été MESURÉS et refusés (§54, §22).
//   · le nom ANGLAIS d'artofpkm : 54 contradictions, 2 vraies (« カプ・テテフ » nommée « Tapu Fini », LV.X omis) ;
//   · le nom JAPONAIS d'artofpkm : 14 contradictions, 3 affichées, dont 1 FAUSSE — Thunderclap Spark n°072 est bien
//     カスタムキャッチャー à l'œil, et la page artofpkm la nomme カウンターゲイン. Câblé, il DÉPLAÇAIT une image juste.
// Un témoin ne vaut que ce que vaut la donnée qu'il lit. Il reste donc ce qui a été VU : une ligne par fichier, avec ce
// qu'on a lu dessus. Elle vit dans la jointure — un rejeu ne la défait pas, une recollecte non plus (§52 : détacher
// après coup répare les lignes, la collecte suivante les refait).
// ⚠️ La correction ne s'applique que si la carte nommée est dans le set : sinon elle ne joint rien, et le dit.
const CORRECTIONS = [
    {
        cleR2: 'artofpkm/277/85.webp', carteId: 161586, nomEn: 'White Kyurem-EX', lu: 'ホワイトキュレムEX', le: '2026-09-23',
        cause: 'EX Battle Boost : numéros croisés chez Bulbapedia (Black Kyurem-EX déclare 085) ; artofpkm et Cardmarket disent l\'inverse'
    },
    {
        cleR2: 'artofpkm/277/84.webp', carteId: 161584, nomEn: 'Black Kyurem-EX', lu: 'ブラックキュレムEX', le: '2026-09-23',
        cause: 'EX Battle Boost : numéros croisés chez Bulbapedia (White Kyurem-EX déclare 084) ; artofpkm et Cardmarket disent l\'inverse'
    }
];
const PAR_CLE = new Map(CORRECTIONS.map(c => [c.cleR2, c]));

module.exports = { CORRECTIONS, correctionDe: cleR2 => PAR_CLE.get(cleR2) || null };
