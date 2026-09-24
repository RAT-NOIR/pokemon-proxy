// ============================================================
// LE NOM AFFICHÉ D'UN SET — `sets.nomAffichage`, la condition de publication du site (CONTRAT-SITE)
// ============================================================
// Sortie de rapatrier-noms-sets.js le 2026-09-24 : une définition, pour l'outil qui nomme et pour les contrôles qui
// vérifient qu'aucun set ne reste sans nom (§21 bis).
//
// 🔴 POURQUOI 151 SETS N'AVAIENT PAS DE NOM (mesuré le 2026-09-24) : `nomAffichage` n'était écrit QUE par
// rapatrier-noms-sets.js, lancé le 2026-09-19 sur les 439 sets de l'époque. Le collecteur crée des sets et ne les nomme
// jamais. 590 − 439 = 151, exactement. Un set sans nom n'existe pas sur le site — ni page, ni fiche, ni sitemap — et rien
// ne le disait. La garde est désormais double : collecteur-texte.js imprime le verdict à la création, mesure-catalogue.js
// compte les sets sans nom qui portent des cartes.
//
// LA RÈGLE, celle du 2026-09-19 :
//   · set OCCIDENTAL : nomEn — il désigne le set lui-même —, puis le nom Cardmarket ;
//   · set NON occidental : le nom Cardmarket, puis nomJaTraduit. 🔴 JAMAIS `nomEn` : sur une page partagée,
//     c'est le jumeau international (« Base Set » pour Expansion Pack, « Shining Fates » pour Shiny Star V) ;
//   🔴 ET JAMAIS `nomFr` : LA CONVENTION DU NOM AFFICHÉ EST L'ANGLAIS. Mesuré le 2026-09-24 sur les 439 noms posés le 19/09 :
//     426 identiques à une source anglaise, 13 identiques dans les deux langues, 0 en français seul — et 116 d'entre eux ont
//     un nomFr qu'ils n'affichent pas. La version du matin mettait nomFr en tête en se disant « inchangée » : elle aurait
//     publié « Set de Base » et « Lumière Interdite » au milieu de 125 noms Cardmarket anglais. Le nom français est un
//     AUTRE champ (`nomFr`, TCGdex) : c'est au site de choisir de l'afficher, pas à ce nom de mélanger les langues ;
//   · dernier recours : le `_id` du set rendu lisible — c'est le slug Cardmarket de l'expansion. Jamais le code.
//   · DEUX SETS NE PORTENT PAS LE MÊME NOM À L'ÉCRAN : une collision se départage par le nom Cardmarket, puis par le
//     slug ; sinon le set RESTE SANS NOM, avec sa raison.
const lisible = s => String(s || '').replace(/-/g, ' ').trim();

// 🔑 DEUX NOMS SONT LE MÊME À L'ÉCRAN s'ils ne diffèrent que par la casse, les accents ou la ponctuation (2026-09-24, condition
// du feu vert des 151 noms) : « Gold, Silver » et « Gold Silver », « Pokémon » et « pokemon ». L'égalité brute des chaînes
// les séparait, donc la garde d'ensemble et le départage répondaient à une question plus étroite que « le lecteur les
// distingue-t-il ? ». Une clé, lue par le départage (proposerNoms), par l'outil qui écrit et par mesure-catalogue.js (§21 bis).
const cleAffichage = n => String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9぀-ヿ㐀-鿿]+/g, ' ').trim();

/** Les noms affichés portés par PLUSIEURS sets, à la clé d'écran près. Un set sans nom (non-chaîne ou vide) ne compte pas. */
function doublonsDAffichage(sets) {
    const parCle = new Map();
    for (const s of sets) {
        if (typeof s.nomAffichage !== 'string' || !cleAffichage(s.nomAffichage)) continue;
        const k = cleAffichage(s.nomAffichage);
        (parCle.get(k) || parCle.set(k, []).get(k)).push(s);
    }
    return [...parCle].filter(([, g]) => g.length > 1).map(([cle, g]) => ({ cle, noms: g.map(s => s.nomAffichage), sets: g.map(s => s._id) }));
}

function choisirAffichage(s, nomCardmarket, occidental) {
    const essais = occidental
        ? [['nomEn', s.nomEn], ['cardmarket', nomCardmarket], ['nomJaTraduit', s.nomJaTraduit]]
        : [['cardmarket', nomCardmarket], ['nomJaTraduit', s.nomJaTraduit]];
    for (const [source, v] of essais) if (v && String(v).trim()) return { nom: String(v).trim(), source };
    const duSlug = lisible(s._id);
    if (duSlug) return { nom: duSlug, source: 'slug du set' };
    return { nom: s.code || s._id, source: 'code' };
}

/** La région VRAIE d'un set et sa preuve : la ligne de table la porte (« chinois », « idth ») ; `sets.region` ne dit que jp/intl. */
function regionDe(s, L) {
    if (L?.region) return { region: L.region, preuve: `ligne de table ${L.code} : région « ${L.region} »${L.bulba?.tirage ? `, tirage ${L.bulba.tirage}` : ''}` };
    return { region: s.region === 'intl' ? 'occidental' : 'japonais', preuve: `sets.region « ${s.region} » (aucune ligne de table)` };
}

/**
 * Propose un nom aux sets qui n'en ont PAS, sans jamais toucher un nom posé. Les collisions se vérifient contre TOUS les
 * noms : ceux déjà affichés ET ceux proposés ici.
 * @param {object[]} tousLesSets     documents `sets` (avec nomAffichage, nomFr, nomEn, nomJaTraduit, region, code, bulba)
 * @param {Map<string, object>} parSlug   ligne de table par slugSet
 * @param {Map<number, string>} slugMajoritaire   idExpansion -> slugSet Cardmarket majoritaire (numeros_cartes)
 * @returns {{ proposes: object[], refuses: object[] }}
 */
function proposerNoms(tousLesSets, parSlug, slugMajoritaire) {
    const pris = new Map();   // CLÉ d'écran du nom affiché -> slug qui le porte déjà
    for (const s of tousLesSets) if (typeof s.nomAffichage === 'string') pris.set(cleAffichage(s.nomAffichage), s._id);
    const candidats = [];
    for (const s of tousLesSets.filter(x => typeof x.nomAffichage !== 'string')) {
        const L = parSlug.get(s._id);
        const exp = L?.exp ?? s.idExpansion?.[0];
        const nomCardmarket = lisible(exp != null && slugMajoritaire.get(exp) ? slugMajoritaire.get(exp) : s._id) || null;
        const R = regionDe(s, L);
        candidats.push({ s, L, nomCardmarket, ...R, a: choisirAffichage(s, nomCardmarket, R.region === 'occidental') });
    }
    // collisions : entre candidats, et avec un nom déjà affiché
    const proposes = [], refuses = [];
    const parNom = new Map();
    for (const c of candidats) { const k = cleAffichage(c.a.nom); (parNom.get(k) || parNom.set(k, []).get(k)).push(c); }
    const libres = n => !pris.has(cleAffichage(n));
    // d'abord les noms sans collision — ils se RÉSERVENT, pour qu'un départage ne tombe pas dessus
    const enCollision = [];
    for (const [k, groupe] of parNom) {
        if (groupe.length === 1 && libres(groupe[0].a.nom)) { proposes.push(groupe[0]); pris.set(k, groupe[0].s._id); }
        else enCollision.push([groupe[0].a.nom, groupe, pris.get(k)]);
    }
    for (const [nom, groupe, occupe] of enCollision) {
        for (const c of groupe) {
            const essais = [[c.nomCardmarket, 'cardmarket (départage de collision)'], [lisible(c.s._id), 'slug du set (départage de collision)']];
            const autres = new Set(groupe.filter(x => x !== c).flatMap(x => [x.nomCardmarket, lisible(x.s._id)]).map(cleAffichage));
            const ok = essais.find(([n]) => n && libres(n) && !autres.has(cleAffichage(n)));
            if (ok) { proposes.push({ ...c, a: { nom: ok[0], source: ok[1] }, collision: `« ${nom} » ${occupe ? `déjà affiché par ${occupe}` : `porté par ${groupe.map(x => x.s._id).join(', ')}`}` }); pris.set(cleAffichage(ok[0]), c.s._id); }
            else refuses.push({ ...c, raison: `« ${nom} » ${occupe ? `déjà affiché par ${occupe}` : `porté par ${groupe.length} sets`}, et ni le nom Cardmarket ni le slug ne les séparent` });
        }
    }
    return { proposes, refuses };
}

module.exports = { lisible, cleAffichage, doublonsDAffichage, choisirAffichage, regionDe, proposerNoms };
