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
// LA RÈGLE (inchangée, celle du 2026-09-19) :
//   · set OCCIDENTAL : nomFr, puis nomEn — il désigne le set lui-même —, puis le nom Cardmarket ;
//   · set NON occidental : nomFr, puis le nom Cardmarket, puis nomJaTraduit. 🔴 JAMAIS `nomEn` : sur une page partagée,
//     c'est le jumeau international (« Base Set » pour Expansion Pack, « Shining Fates » pour Shiny Star V) ;
//   · dernier recours : le `_id` du set rendu lisible — c'est le slug Cardmarket de l'expansion. Jamais le code.
//   · DEUX SETS NE PORTENT PAS LE MÊME NOM À L'ÉCRAN : une collision se départage par le nom Cardmarket, puis par le
//     slug ; sinon le set RESTE SANS NOM, avec sa raison.
const lisible = s => String(s || '').replace(/-/g, ' ').trim();

function choisirAffichage(s, nomCardmarket, occidental) {
    const essais = occidental
        ? [['nomFr', s.nomFr], ['nomEn', s.nomEn], ['cardmarket', nomCardmarket], ['nomJaTraduit', s.nomJaTraduit]]
        : [['nomFr', s.nomFr], ['cardmarket', nomCardmarket], ['nomJaTraduit', s.nomJaTraduit]];
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
    const pris = new Map();   // nom affiché -> slug qui le porte déjà
    for (const s of tousLesSets) if (typeof s.nomAffichage === 'string') pris.set(s.nomAffichage, s._id);
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
    for (const c of candidats) (parNom.get(c.a.nom) || parNom.set(c.a.nom, []).get(c.a.nom)).push(c);
    const libres = n => !pris.has(n);
    // d'abord les noms sans collision — ils se RÉSERVENT, pour qu'un départage ne tombe pas dessus
    const enCollision = [];
    for (const [nom, groupe] of parNom) {
        if (groupe.length === 1 && libres(nom)) { proposes.push(groupe[0]); pris.set(nom, groupe[0].s._id); }
        else enCollision.push([nom, groupe, pris.get(nom)]);
    }
    for (const [nom, groupe, occupe] of enCollision) {
        for (const c of groupe) {
            const essais = [[c.nomCardmarket, 'cardmarket (départage de collision)'], [lisible(c.s._id), 'slug du set (départage de collision)']];
            const autres = new Set(groupe.filter(x => x !== c).flatMap(x => [x.nomCardmarket, lisible(x.s._id)]));
            const ok = essais.find(([n]) => n && libres(n) && !autres.has(n));
            if (ok) { proposes.push({ ...c, a: { nom: ok[0], source: ok[1] }, collision: `« ${nom} » ${occupe ? `déjà affiché par ${occupe}` : `porté par ${groupe.map(x => x.s._id).join(', ')}`}` }); pris.set(ok[0], c.s._id); }
            else refuses.push({ ...c, raison: `« ${nom} » ${occupe ? `déjà affiché par ${occupe}` : `porté par ${groupe.length} sets`}, et ni le nom Cardmarket ni le slug ne les séparent` });
        }
    }
    return { proposes, refuses };
}

module.exports = { lisible, choisirAffichage, regionDe, proposerNoms };
