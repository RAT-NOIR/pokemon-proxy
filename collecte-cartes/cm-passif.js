// LISTE DES 64 PAIRES BLACK STAR À RELEVER PASSIVEMENT (lot CM-PASSIF, 2026-10-17) — module PUR : aucune base, aucun réseau.
// Le testeur ouvre lui-même les 128 fiches Cardmarket ; ce module ne fait que CONSTRUIRE les adresses (depuis slugSet/slug de notre base, lus ailleurs) et RECONNAÎTRE une
// adresse relevée. Forme d'adresse : https://www.cardmarket.com/<langue>/Pokemon/Products/Singles/<slugSet>/<slug> (candidats-fiche.js:35 la construit ainsi, en /fr/ ;
// la liste est en /en/ comme la décision du testeur ; la clé de reconnaissance ignore la langue).

const HOTE = 'www.cardmarket.com';
const LANGUE_LISTE = 'en';
const RACINE = '/Pokemon/Products/Singles/';

const urlFiche = (slugSet, slug) => `https://${HOTE}/${LANGUE_LISTE}${RACINE}${slugSet}/${slug}`;

/** « set/slug » d'une fiche produit Cardmarket (deux segments sous /Pokemon/Products/Singles/), ou null. La langue n'entre pas dans la clé. */
function cleDeAdresse(url) {
    let u;
    try { u = new URL(String(url)); } catch { return null; }
    if (u.protocol !== 'https:' || u.hostname !== HOTE) return null;
    const m = /^\/[a-z]{2}\/Pokemon\/Products\/Singles\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(u.pathname);
    return m ? `${m[1]}/${m[2]}` : null;
}

/** Le tampon que Pokumon donne à la 2e entrée du couple : « Staff X » → Staff ; « Holofoil Play Pokemon X » → Play! Pokémon. Jamais inventé. */
function tamponAttendu(entrees) {
    const titres = (entrees || []).map(e => String(e.titre || ''));
    if (titres.some(t => /^Staff\s/.test(t))) return 'Staff';
    if (titres.some(t => /^Holofoil Play Pokemon\s/.test(t))) return 'Play! Pokémon';
    throw new Error(`aucun tampon reconnu dans les entrées « ${titres.join(' | ').slice(0, 160)} » (ni « Staff », ni « Holofoil Play Pokemon »)`);
}

const numerique = s => { const n = parseInt(String(s).replace(/\D+/g, ''), 10); return Number.isNaN(n) ? Infinity : n; };

/** @param {object[]} exclus  clé `exclus` de sim-plan.json  @param {Map<number,{slug,slugSet}>} numeros  idProduct → ligne de numeros_cartes (lue en base) */
function construireListe(exclus, numeros) {
    const paires = exclus.map(e => {
        if (!Array.isArray(e.idProduct) || e.idProduct.length !== 2) throw new Error(`${e.set} ${e.numero} : deux idProduct attendus`);
        const [d1, d2] = e.dateAdded || [];
        if (!(Date.parse(d1) < Date.parse(d2))) throw new Error(`${e.set} ${e.numero} : la date d'ajout de V1 (${d1}) n'est pas plus ancienne que celle de V2 (${d2})`);
        const versions = e.idProduct.map((id, i) => {
            const ligne = numeros.get(id);
            if (!ligne || !ligne.slug || !ligne.slugSet) throw new Error(`${e.set} ${e.numero} : produit ${id} absent de numeros_cartes (ou sans slug/slugSet)`);
            if (ligne.slug !== e.slugs[i]) throw new Error(`${e.set} ${e.numero} : produit ${id}, slug de la base « ${ligne.slug} » ≠ slug du plan « ${e.slugs[i]} »`);
            return { v: `V${i + 1}`, idProduct: id, slug: ligne.slug, slugSet: ligne.slugSet, dateAdded: e.dateAdded[i], url: urlFiche(ligne.slugSet, ligne.slug) };
        });
        return { set: e.set, numero: e.numero, nom: e.nom, tampon: tamponAttendu(e.entrees), versions };
    });
    paires.sort((a, b) => a.set.localeCompare(b.set) || numerique(a.numero) - numerique(b.numero) || a.numero.localeCompare(b.numero));
    return paires.map((p, i) => ({ n: i + 1, ...p }));
}

/** clé « set/slug » → { n, v, tampon, set, numero, nom } */
function indexer(paires) {
    const idx = {};
    for (const p of paires) for (const v of p.versions) idx[`${v.slugSet}/${v.slug}`] = { n: p.n, v: v.v, tampon: p.tampon, set: p.set, numero: p.numero, nom: p.nom };
    return idx;
}

module.exports = { urlFiche, cleDeAdresse, tamponAttendu, construireListe, indexer, HOTE, RACINE };
