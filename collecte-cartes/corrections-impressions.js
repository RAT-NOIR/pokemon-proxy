// ============================================================
// CORRECTIONS DE NUMÉRO D'IMPRESSION — une table LUE, appliquée par le PARSEUR (faitsDeCarte), 2026-09-24
// ============================================================
// 🔴 QUATRE PAGES BULBAPEDIA DONNENT LE NUMÉRO DE LA CARTE VOISINE dans `jpcardno` : Alomomola 011 (= Wailord), Kingler 026
// (= Krabby), Ribombee 043 (= Kangaskhan), Shroodle 291 (= Sableye). Le numéro désignait donc DEUX cartes du set : ni la
// fiche ni l'image ne se joignaient (le produit Cardmarket de la carte restait « produit-sans-carte », et l'image de la
// voisine « jointe à aucune carte »), et trois de ces impressions portaient l'ILLUSTRATEUR de la voisine, lu par
// l'identifiant TCGdex du mauvais numéro (§58).
// 🔑 POURQUOI DANS LE PARSEUR : une correction posée en base après coup, la recollecte suivante la défait (§52). Posée ici,
// toute lecture de la page — collecte, `--reparser`, rejouer-impressions.js — rend le bon numéro. La correction ne vaut que
// tant que la page porte le numéro contredit : corrigée à la source, elle devient INERTE, et le dit.
// Chaque ligne porte DEUX preuves indépendantes de la page, au moins. L'illustrateur de la ligne est posé avec elle :
// construire-illustrateurs.js ne recalcule pas une impression corrigée (la table fait foi).
const CORRECTIONS = [
    {
        titre: 'Alomomola (Guardians Rising 36)', tirage: 'jp', expansion: 'Alolan Moonlight', numeroPage: '011', numero: '012', illustrateur: 'Aya Kusube', le: '2026-09-24',
        preuves: ['Cardmarket 561416 « Alomomola » n°012 (exp 3951)', 'artofpkm Alolan-Moonlight n°012 « ママンボウ », illus. Aya Kusube', 'TCGdex data-asia SM/SM2L/012.ts', 'la page elle-même : caption « Illus. [[Aya Kusube]] »'],
        voisine: 'Wailord (ホエルオー), n°011, illus. OOYAMA'
    },
    {
        titre: 'Kingler (Unbroken Bonds 47)', tirage: 'jp', expansion: 'Double Blaze', numeroPage: '026', numero: '027', illustrateur: 'Shigenori Negishi', le: '2026-09-24',
        preuves: ['Cardmarket 557382 « Kingler » n°027 (exp 3836)', 'artofpkm Double-Blaze n°027 « キングラー », illus. Shigenori Negishi', 'TCGdex data-asia SM/SM10/027.ts', 'la page elle-même : caption « Illus. [[Shigenori Negishi]] »'],
        voisine: 'Krabby (クラブ), n°026, illus. Sekio'
    },
    {
        titre: 'Ribombee (Sun & Moon 93)', tirage: 'jp', expansion: 'Collection Sun', numeroPage: '043', numero: '042', illustrateur: 'Shin Nagasawa', le: '2026-09-24',
        preuves: ['Cardmarket 561719 « Ribombee » n°042 (exp 3971)', 'artofpkm Collection-Sun n°042 « アブリボン », illus. Shin Nagasawa', 'TCGdex data-asia SM/SM1S/042.ts', 'la page elle-même : caption « Illus. [[Shin Nagasawa]] »'],
        voisine: 'Kangaskhan (ガルーラ), n°043, illus. TOKIYA'
    },
    {
        titre: 'Shroodle (Paldea Evolved 144)', tirage: 'jp', expansion: 'Shiny Treasure ex', numeroPage: '291', numero: '297', illustrateur: 'otumami', le: '2026-09-24',
        preuves: ['Cardmarket 747651 « Shroodle » n°297 (exp 5519)', 'artofpkm Shiny-Treasure-ex n°297 « シルシュルー », illus. otumami', 'TCGdex data-asia SV/SV4a/297.ts', 'la page elle-même : illus2 = otumami (réimpression Paldean Fates / Shiny Treasure ex)'],
        voisine: 'Sableye (ヤミラミ), n°291, illus. nagimiso'
    }
];
const PAR_TITRE = new Map();
for (const c of CORRECTIONS) (PAR_TITRE.get(c.titre) || PAR_TITRE.set(c.titre, []).get(c.titre)).push(c);

/**
 * Applique la table aux impressions qu'une page vient de rendre. Pure : le tableau d'entrée n'est pas modifié.
 * @returns {{ impressions: object[], appliquees: object[], inertes: object[] }}  `inertes` : lignes de la table pour cette
 *          page dont l'impression contredite n'existe plus (la page a été corrigée, ou a changé)
 */
function corrigerImpressions(titre, impressions) {
    const lignes = PAR_TITRE.get(titre) || [];
    if (!lignes.length) return { impressions, appliquees: [], inertes: [] };
    const appliquees = [], inertes = [];
    let sortie = impressions;
    for (const c of lignes) {
        const i = sortie.findIndex(x => x.tirage === c.tirage && x.expansion === c.expansion && x.numero === c.numeroPage);
        if (i < 0) { inertes.push(c); continue; }
        sortie = sortie.map((x, k) => k !== i ? x : {
            ...x, numero: c.numero, illustrateur: c.illustrateur,
            illustrateurPreuve: `corrections-impressions.js (${c.le}) : ${c.preuves.slice(0, 2).join(' ; ')}`,
            correction: { numeroPage: c.numeroPage, preuves: c.preuves, le: c.le }
        });
        appliquees.push(c);
    }
    return { impressions: sortie, appliquees, inertes };
}

module.exports = { CORRECTIONS, corrigerImpressions };
