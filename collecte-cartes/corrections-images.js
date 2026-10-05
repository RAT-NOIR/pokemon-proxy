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
    },
    // 🔴 LES DEUX « PI » IRRÉDUCTIBLES DU §24 SONT DES PIDGEOT (regardés le 2026-10-05) : artofpkm titre « Pi, … » — le nom TRONQUÉ —
    // et ses fichiers ne portent aucun numéro (le « No. 018 » imprimé est le numéro de Pokédex). La carte est dans le set, sans
    // visuel : la jointure par le nom cherchait « Pi ». Instrument : le fichier R2 ouvert ; témoins : nom japonais, illustrateur
    // (celui des impressions intl de la même carte), holo pour Jungle.
    {
        cleR2: 'artofpkm/8/34.webp', carteId: 17798, nomEn: 'Pidgeot', lu: 'ピジョット LV.40 HP80, holo, Illus. Kagemaru Himeno, No. 018', le: '2026-10-05',
        cause: 'Pokémon Jungle : artofpkm titre « Pi, Pokémon Jungle » (nom tronqué), classée irréductible au §24'
    },
    {
        cleR2: 'artofpkm/27/2.webp', carteId: 23766, nomEn: 'Pidgeot', lu: 'ピジョット LV.39 HP70, Illus. Keiko Fukuyama, No. 018', le: '2026-10-05',
        cause: 'Southern Islands : artofpkm titre « Pi, Southern Islands » (nom tronqué), classée irréductible au §24'
    }
];
const PAR_CLE = new Map(CORRECTIONS.map(c => [c.cleR2, c]));

module.exports = { CORRECTIONS, correctionDe: cleR2 => PAR_CLE.get(cleR2) || null };
