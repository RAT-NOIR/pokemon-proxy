// LE CLASSEMENT D'UNE EXPANSION EN SET PARTIEL — une seule définition, lue par creer-set-partiel.js (mesure, création, complément).
// Extraite telle quelle de creer-set-partiel.js (COURTS2) : le complément d'un set existant doit classer EXACTEMENT comme la création (§21 bis).
// `cx` et `prod` : des objets { db } (base `cartes` et base de production, en lecture) ; `conf` : une entrée de PARTIELS.
const { lireMongo } = require('./lecture-sure');
const { cleNumero } = require('./jointure');
const SP = require('./set-partiel');

async function classerExpansion({ cx, prod, EXP, conf }) {
    const cat = await lireMongo(prod.db.collection('catalogue_produits'), { idExpansion: EXP }, { nom: `catalogue_produits (${EXP})`, projection: { idProduct: 1, idExpansion: 1, idMetacard: 1, name: 1 } });
    const tousCat = new Map((await lireMongo(prod.db.collection('catalogue_produits'), {}, { nom: 'catalogue_produits', projection: { idProduct: 1, idExpansion: 1 } })).map(p => [p.idProduct, p.idExpansion]));
    const numeros = await lireMongo(prod.db.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { idProduct: 1, numero: 1, slug: 1, slugSet: 1, codeSet: 1 } });
    const numDe = new Map(numeros.map(n => [n.idProduct, n]));
    const codes = await lireMongo(prod.db.collection('codes_set'), {}, { nom: 'codes_set' });
    const expsDuCode = new Map(); for (const c of codes) (expsDuCode.get(String(c.codeSet)) || expsDuCode.set(String(c.codeSet), new Set()).get(String(c.codeSet))).add(c.idExpansion);
    const parExpNum = new Map();
    for (const p of numeros) { const n = cleNumero(p.numero), e = tousCat.get(p.idProduct); if (!n || e == null) continue; const k = `${e}|${n}`; (parExpNum.get(k) || parExpNum.set(k, []).get(k)).push(p.idProduct); }
    const cartesDe = new Map();
    for (const l of await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1 } })) (cartesDe.get(l.idProduct) || cartesDe.set(l.idProduct, new Set()).get(l.idProduct)).add(l.carteId);

    const produits = cat.map(p => { const n = numDe.get(p.idProduct); return { idProduct: p.idProduct, idExpansion: p.idExpansion, idMetacard: p.idMetacard, name: p.name, appris: !!n, slug: n?.slug ?? null, slugSet: n?.slugSet ?? null }; });
    const ctx = { expsDuCode, parExpNum, cartesDe, ...(conf.origines ? { origines: conf.origines() } : {}), ...(conf.formeCollee ? { formeCollee: true } : {}), ...(conf.verifierAttaques ? { verifierAttaques: true } : {}) };
    // 1re passe : les cartes désignées et le pool (cartes des sets d'ORIGINE) — lus en une fois
    const resolus = produits.filter(p => p.appris && !cartesDe.has(p.idProduct)).map(p => SP.resoudreProduit(p, conf.CODE, ctx)).filter(x => x.cause === 'resolu');
    const PROJ = { nomEn: 1, niveau: 1, attaques: 1, impressions: 1, sets: 1, 'bulba.titre': 1 };
    const cartesParId = new Map((await cx.db.collection('cartes').find({ _id: { $in: [...new Set(resolus.map(x => x.carteId))] } }, { projection: PROJ }).toArray()).map(c => [c._id, c]));
    const slugsOrigine = [...new Set(resolus.flatMap(x => x.cands.map(id => numDe.get(id)?.slugSet)).filter(Boolean))];
    const poolBrut = await cx.db.collection('cartes').find({ sets: { $in: slugsOrigine } }, { projection: PROJ }).toArray();
    if (resolus.length && !poolBrut.length) throw new Error(`pool des cartes d'origine VIDE pour ${slugsOrigine.length} sets d'origine : le témoin du nom se tairait sur tout — arrêt`);
    const poolDe = x => { const sl = new Set(x.cands.map(id => numDe.get(id)?.slugSet).filter(Boolean)); return poolBrut.filter(c => (c.sets || []).some(s => sl.has(s))); };
    const C = SP.classerProduits({ produits, CODE: conf.CODE, ctx, cartesParId, poolDe });
    const P = SP.partielDe(C, conf.chemin ? { chemin: conf.chemin } : undefined);
    return { cat, numeros, produits, cartesDe, cartesParId, C, P };
}

module.exports = { classerExpansion };
