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
    },
    // (2026-10-07) LE NUMÉRO, quand la source ne l'écrit pas : `numero` est porté sur l'entrée de cartes.images (collecteur-images.js),
    // jamais sur le document `images` (la source, telle qu'elle est). Lu sur le fichier R2, zone agrandie ×4 : « J m6a B/RGB », Illus.
    // YOSHIROTTEN ; ⚠️ le Mew est VERT sur fond bleu — la couleur aurait dit « G », le numéro imprimé dit « B ».
    {
        cleR2: 'artofpkm/592/168.webp', carteId: 358696, nomEn: 'Mew', numero: 'B', lu: 'ミュウ HP60, J m6a B/RGB, Illus. YOSHIROTTEN', le: '2026-10-07',
        cause: '30th Celebration (JP) : artofpkm ne numérote pas ce Mew ; une image du set sans numéro faisait passer tout le set en une fiche par document chez le site (31 fiches mélangées)'
    },
    {
        cleR2: 'artofpkm/592/167.webp', carteId: 358696, nomEn: 'Mew', numero: 'G', lu: 'ミュウ, J m6a G/RGB, Illus. YOSHIROTTEN (fond vert)', le: '2026-10-07',
        cause: '30th Celebration (JP) : le second Mew sans numéro chez artofpkm (le « R » n\'y est pas)'
    },
    // (2026-10-13, lot JA-2) TROIS FICHIERS REGARDÉS (l'original ouvert, PNG réduit, un par un) : la page artofpkm nomme la carte SANS son suffixe, donc le nom seul ne les distingue pas de leur jumelle
    // (Mewtwo ×2, Gliscor ×2 dans le Battle Starter Pack Heatran vs Regigigas) ou ne les désigne pas (Milotic pour Milotic ex).
    {
        cleR2: 'artofpkm/173/15.webp', carteId: 50861, nomEn: 'Mewtwo LV.X', lu: 'ミュウツー LV.X, HP120, 「ポケボディー サイコバリア」「ギガバーン 120」, Illus. Shizurow, DPt', le: '2026-10-13',
        cause: 'Heatran vs Regigigas Deck Kit : la page artofpkm 173/15 se nomme « Mewtwo » ; le fichier est la carte LV.X (la liste 173 range les deux LV.X aux rangs 15 et 16, après les 14 Pokémon de base)'
    },
    {
        cleR2: 'artofpkm/173/16.webp', carteId: 51213, nomEn: 'Gliscor LV.X', lu: 'グライオン LV.X, HP110, 「ポケパワー スピットポイズン」「つじぎり 60」, Illus. Ryo Ueda, DPt', le: '2026-10-13',
        cause: 'Heatran vs Regigigas Deck Kit : la page artofpkm 173/16 se nomme « Gliscor » ; le fichier est la carte LV.X'
    },
    {
        cleR2: 'artofpkm/105/4.webp', carteId: 51875, nomEn: 'Milotic ex', lu: 'ミロカロスex, HP130, 「まとわりつく 30」「エネリフレクト 70」, 004/015, Illus. Ryo Ueda', le: '2026-10-13',
        cause: 'Quick Construction Pack Water : la page artofpkm 105/4 se nomme « Milotic » (sans « ex ») ; le numéro 004/015 imprimé est celui de Milotic ex chez nous'
    },
    // (2026-10-17, audit VIGN-AUDIT) HUIT FICHIERS « LV.X » REGARDÉS : la page artofpkm les nomme SANS « LV.X » (« Uxie »), donc la jointure par le nom les posait aussi sur la carte de BASE
    // (qui portait alors l'image du LV.X, et perdait la sienne au `$pull` des entrées sans numéro). Deux éléments par fichier : l'image lue (« LV.X », HP, texte de niveau) et l'illustrateur du
    // document `images` (Shizurow / Ryo Ueda) = celui de l'impression de la carte LV.X, différent de celui de la carte de base (Sugimori, Ito, Nishida, Saitou, Ueda).
    ...[
        ['artofpkm/171/43.webp', 50326, 'Mesprit LV.X', 'エムリット LV.X HP100, Illus. Shizurow'],
        ['artofpkm/171/42.webp', 50859, 'Uxie LV.X', 'ユクシー LV.X HP90, Illus. Shizurow'],
        ['artofpkm/150/23.webp', 26230, 'Magmortar LV.X', 'ブーバーン LV.X HP130, Illus. Shizurow'],
        ['artofpkm/166/38.webp', 28217, 'Gardevoir LV.X', 'サーナイト LV.X HP130, Illus. Ryo Ueda'],
        ['artofpkm/166/19.webp', 41644, 'Glaceon LV.X', 'グレイシア LV.X HP100, Illus. Ryo Ueda'],
        ['artofpkm/166/5.webp', 41758, 'Leafeon LV.X', 'リーフィア LV.X HP110, Illus. Ryo Ueda'],
        ['artofpkm/172/34.webp', 50209, 'Azelf LV.X', 'アグノム LV.X HP90, Illus. Shizurow'],
        ['artofpkm/164/39.webp', 36172, 'Cresselia LV.X', 'クレセリア LV.X HP100, Illus. Shizurow']
    ].map(([cleR2, carteId, nomEn, lu]) => ({ cleR2, carteId, nomEn, lu, le: '2026-10-17', cause: 'fichier LV.X joint aussi à la carte de base du même nom par le nom seul (audit VIGN-AUDIT)' }))
];
const PAR_CLE = new Map(CORRECTIONS.map(c => [c.cleR2, c]));

module.exports = { CORRECTIONS, correctionDe: cleR2 => PAR_CLE.get(cleR2) || null };
