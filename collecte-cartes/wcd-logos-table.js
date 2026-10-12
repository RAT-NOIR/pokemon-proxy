// LES LOGOS WCD, LUS DANS LA TABLE DES DECISIONS — jamais dans la presence d'un fichier (decision du testeur, 2026-10-13).
// Les 20 fichiers « Logo FR/WCD/jap_076…095.png » sont des copies de Pokecardex refusees le 2026-10-04 (`LOGOS_COPIES`) et ne sont PAS
// restaures apres la perte du 2026-10-12 : l'export et la pose des logos de decks tiennent donc sur la table (LOGOS_COPIES pour le sha1 et
// la decision, logos-manuels-lus.json pour les dimensions), sans ouvrir le moindre fichier. Une annee sans entree dans l'une des deux
// tables LEVE : une entree sans decision n'est pas une entree vide.
const path = require('path');

// l'annee LUE sur chaque logo (planche du 2026-10-07) — jamais deduite du numero du fichier
const ANNEES_WCD = [[2004, 76], [2005, 77], [2006, 78], [2007, 79], [2008, 80], [2009, 81], [2010, 82], [2011, 83], [2012, 84], [2013, 85], [2014, 86], [2015, 87], [2016, 88], [2017, 89], [2018, 90], [2019, 91], [2022, 92], [2023, 93], [2024, 94], [2025, 95]];
const fichierWcd = n => `Logo FR/WCD/jap_0${n}.png`;

/** copies : LOGOS_COPIES (sha1 → « fichier (set) ») ; lus : les lignes de logos-manuels-lus.json ; racine : sert seulement a ecrire cheminAbsolu. */
function wcdDepuisLaTable({ racine, copies, lus }) {
    return ANNEES_WCD.map(([annee, n]) => {
        const rel = fichierWcd(n);
        const e = [...copies].find(([, v]) => v.startsWith(`${rel} `) || v === rel);
        if (!e) throw new Error(`${rel} (WCD-${annee}) absent de LOGOS_COPIES : aucune decision ne l'autorise ni ne le refuse`);
        const [sha1] = e;
        const l = lus.find(x => x.dossier === 'Logo FR' && x.fichier === rel.replace(/^Logo FR\//, '') && x.sha1 === sha1);
        if (!l || !Number.isInteger(l.w) || !Number.isInteger(l.h)) throw new Error(`${rel} (WCD-${annee}) : sha1 ou dimensions absents de la table des logos lus (logos-manuels-lus.json)`);
        return { set: `WCD-${annee}`, annee, anneeLueSurLeLogo: true, fichier: rel, cheminAbsolu: path.join(racine, rel), sha1, w: l.w, h: l.h,
            copiePokecardex: true, refus: 'logo COPIÉ de Pokécardex, retiré (décision du testeur, 2026-10-04) — son emploi est une décision du testeur' };
    });
}
module.exports = { wcdDepuisLaTable, ANNEES_WCD, fichierWcd };
