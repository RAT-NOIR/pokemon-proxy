// ============================================================
// LE CONTRÔLE DE PUBLICATION — « un set publié ne contient aucune fiche sans nom, et aucun set à cartes n'est sans nom »
// ============================================================
// Décision du testeur (2026-10-08, EX-TRAINER-KIT-2) : « un set ne doit JAMAIS être publié à moitié créé ». Ce module dit, POUR LE SITE, ce que
// « publié » et « fiche » veulent dire, puis compte ce qui les contredit. Une seule fonction, lue par le banc (base en mémoire) ET par la commande de
// contrôle sur la vraie base (controler-publication.js) : jamais deux copies (§21 bis).
//
// 🔑 CE QUE LE SITE ENTEND (lu dans rat-market-site, 2026-10-08 — on IMPORTE, on ne recopie pas, §76) :
//   · UN SET EST PUBLIÉ si `sets.nomAffichage` est une chaîne (`FILTRE_SET_PUBLIABLE`, lib/cartes.ts:429 — NON exportée : ce fichier importe Next et
//     ne se charge pas sous Node ; sa ligne est donc LUE EN TEXTE et doit avoir EXACTEMENT la forme attendue, sinon on LÈVE : un doute est un refus) ;
//   · UNE FICHE est une carte `cartes` dont `sets` contient le slug ET qui passe `FILTRE_CARTE_AFFICHABLE` (lib/entreesDuSet.ts, exporté, IMPORTÉ) :
//     `nomEn` chaîne non vide. Une carte qui ne le passe pas est écartée SANS UN MOT de la page du set — c'est la « fiche sans nom » ;
//   · UN PRODUIT est servi par sa ligne `cartes_produits` (slugSet + carteId) : une ligne vers une carte absente ou sans nom dans un set publié
//     est un produit annoncé sans fiche affichable.
// Les filtres sont envoyés TELS QUELS à Mongo (aucun évaluateur écrit à la main : le prédicat du site, pas une copie).
//
// 🔑 ÉCRIT PAR CE QU'IL AUTORISE : `ok` n'est vrai que si quatre listes sont vides ET que le contrôle a pu lire (au moins un set publié, au moins une
// fiche) — un contrôle qui ne lit rien ne conclut pas (§41), il LÈVE.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SITE_LIB = path.join(__dirname, '..', '..', 'rat-market-site', 'lib');
const FORME_SET_PUBLIABLE = /^\{\s*nomAffichage:\s*\{\s*\$type:\s*"string"(?:\s+as const)?\s*\}\s*\}$/;

/** Les deux prédicats du site. LÈVE si l'un a changé de forme ou de place. */
async function chargerSite(siteLib = SITE_LIB) {
    const e = await import(pathToFileURL(path.join(siteLib, 'entreesDuSet.ts')).href);
    const filtreCarte = e.FILTRE_CARTE_AFFICHABLE;
    if (!filtreCarte || typeof filtreCarte !== 'object' || !filtreCarte.nomEn) throw new Error(`FILTRE_CARTE_AFFICHABLE absent ou changé dans ${siteLib}/entreesDuSet.ts : je ne sais plus ce qu'est une fiche affichable, refusé.`);
    const texte = fs.readFileSync(path.join(siteLib, 'cartes.ts'), 'utf8');
    const m = /const FILTRE_SET_PUBLIABLE = (\{[^;]*\});/.exec(texte);
    if (!m || !FORME_SET_PUBLIABLE.test(m[1].trim())) throw new Error(`FILTRE_SET_PUBLIABLE absent ou changé de forme dans ${siteLib}/cartes.ts (attendu : { nomAffichage: { $type: "string" } }) : je ne sais plus ce qu'est un set publié, refusé.`);
    return { filtreCarte, filtreSet: { nomAffichage: { $type: 'string' } } };
}

/**
 * @param db   une base Mongo (natif) : find / aggregate seulement (lecture)
 * @returns {{ ok, denominateurs, setsSansNomAvecCartes, fichesSansNom, lignesSansFiche }}
 */
async function controlerPublication(db, site) {
    const { filtreCarte, filtreSet } = site;
    const S = db.collection('sets'), C = db.collection('cartes'), CP = db.collection('cartes_produits');
    const sets = await S.find({}, { projection: { _id: 1, nomAffichage: 1 } }).toArray();
    const publies = new Set((await S.find(filtreSet, { projection: { _id: 1 } }).toArray()).map(s => s._id));
    if (!sets.length) throw new Error('contrôle de publication : aucun set lu — je ne peux pas conclure (jamais « 0 problème » sur 0 set).');
    if (!publies.size) throw new Error(`contrôle de publication : ${sets.length} sets lus et AUCUN publié — soit la base est vide de noms, soit le prédicat de publication ne mord sur rien : je ne conclus pas.`);

    // les cartes : id, nom affichable ou non, sets. Une seule lecture, en projection mince.
    const cartes = await C.find({}, { projection: { _id: 1, sets: 1 } }).toArray();
    const affichables = new Set((await C.find(filtreCarte, { projection: { _id: 1 } }).toArray()).map(c => c._id));
    // les fiches d'un set publié : (set, carte) avec la carte affichable
    let fiches = 0; const sansNom = []; const cartesParSet = new Map();
    for (const c of cartes) for (const s of c.sets ?? []) {
        (cartesParSet.get(s) || cartesParSet.set(s, new Set()).get(s)).add(c._id);
        if (!publies.has(s)) continue;
        if (affichables.has(c._id)) fiches++; else sansNom.push({ set: s, carteId: c._id });
    }
    if (!fiches) throw new Error('contrôle de publication : aucune fiche affichable dans un set publié — je ne conclus pas.');

    // les lignes de jointure : les produits que la base annonce dans un set
    const lignes = await CP.find({}, { projection: { _id: 1, carteId: 1, slugSet: 1 } }).toArray();
    const existe = new Set(cartes.map(c => c._id));
    const lignesSansFiche = []; const lignesParSet = new Map(); let lignesPubliees = 0;
    for (const l of lignes) {
        if (l.slugSet == null) continue;
        lignesParSet.set(l.slugSet, (lignesParSet.get(l.slugSet) ?? 0) + 1);
        if (!publies.has(l.slugSet)) continue;
        lignesPubliees++;
        if (!affichables.has(l.carteId)) lignesSansFiche.push({ set: l.slugSet, ligne: l._id, carteId: l.carteId, raison: existe.has(l.carteId) ? 'carte sans nom' : 'carte absente' });
    }

    // les sets SANS nom qui portent déjà des cartes ou des produits : non publiés alors que la collecte les a remplis
    const setsSansNomAvecCartes = sets.filter(s => !publies.has(s._id) && ((cartesParSet.get(s._id)?.size ?? 0) > 0 || (lignesParSet.get(s._id) ?? 0) > 0))
        .map(s => ({ set: s._id, cartes: cartesParSet.get(s._id)?.size ?? 0, lignes: lignesParSet.get(s._id) ?? 0 }));
    const ok = !sansNom.length && !lignesSansFiche.length && !setsSansNomAvecCartes.length;
    return { ok, denominateurs: { sets: sets.length, setsPublies: publies.size, setsSansNom: sets.length - publies.size, cartes: cartes.length, fichesDansSetsPublies: fiches, lignes: lignes.length, lignesDansSetsPublies: lignesPubliees },
        setsSansNomAvecCartes, fichesSansNom: sansNom, lignesSansFiche };
}

module.exports = { chargerSite, controlerPublication, SITE_LIB };
