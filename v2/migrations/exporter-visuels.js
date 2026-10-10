'use strict';
// B1b.4b — l'EXPORT des visuels pour l'API v2 : lit la base `cartes` (et le catalogue Cardmarket de la production) en LECTURE SEULE et écrit le
// fichier au CONTRAT de v2/migrations/importer-visuels.js (en-tête, l. 9-27). Il n'importe rien : l'import est un autre geste, avec ses gardes.
//   node v2/migrations/exporter-visuels.js --vers=<fichier JSON>
// ── D'où vient chaque champ ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   vignette   cartes.images[].vignette = { cleR2, w, h } : les dimensions sont STOCKÉES (collecte-cartes/vignette.js) — rien n'est mesuré ni deviné ;
//              une vignette absente laisse le champ absent (l'importeur refuse, « vignette absente »)
//   grande     l'ORIGINAL : cartes.images[].cleR2, w, h ; null si une dimension manque (jamais devinée)
//   visuel/mention  la logique du SITE, IMPORTÉE (rat-market-site/lib/*.ts : fichesDuDocument, setParImpression, produitsDeLaFiche,
//              visuelAdmisPourLaRegion, normaliserNumero, cardmarketUrl) + UNE fonction de exporter-donnees-logos-site.js, partagée avec l'export des
//              logos : choisirVisuel (du set, puis substitut, puis autre tirage) — politique v2 : substitut sans mention = 'refus' (jamais inventée)
//   numero     cartes_produits.numeroFiche ; rarete/total : les impressions de la carte (tirage et expansion du set) AU numéro de la fiche ;
//              deux impressions au même numéro qui se CONTREDISENT → null (la règle du site garde la première : ici, aucune des deux n'est crue)
//   idMetacard catalogue_produits (production, lecture) ; null si le produit n'y est pas
//   setNom     sets.nomAffichage ; lien : cardmarketUrl du site, SEULEMENT si numéro ET rareté sont connus ; variante : null (V1/V2 n'a pas de sémantique)
// Une règle du site introuvable LÈVE : jamais un repli sur une règle vide ou recopiée (§76).
const path = require('path');

const REGLE_REQUISE = ['fichesDuDocument', 'setParImpression', 'produitsDeLaFiche', 'visuelAdmisPourLaRegion', 'normaliserNumero', 'cardmarketUrl'];
const LOGOS = () => require('../../exporter-donnees-logos-site');     // paresseux : ce module charge dotenv à l'import

const SITE_LIB = path.join(__dirname, '..', '..', '..', 'rat-market-site', 'lib');
/** La règle du site : celle que exporter-donnees-logos-site.js charge déjà (regleDuSite, laissée intacte) + `cardmarketUrl` (lib/cardmarket.ts). `importer` est injectable pour le banc. */
async function chargerRegle({ importer = f => import(require('url').pathToFileURL(path.join(SITE_LIB, f)).href) } = {}) {
    const base = await LOGOS().regleDuSite();
    const C = await importer('cardmarket.ts');
    if (typeof C?.cardmarketUrl !== 'function') throw new Error(`cardmarketUrl absent de ${SITE_LIB} — l'export s'arrête (jamais un repli)`);
    return { ...base, cardmarketUrl: C.cardmarketUrl };
}
function verifierRegle(regle) {
    for (const k of REGLE_REQUISE) if (!regle || typeof regle[k] !== 'function') throw new Error(`règle du site absente : ${k} — l'export s'arrête (jamais un repli)`);
}

const entier = x => Number.isInteger(x) && x > 0;
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
const fichierDe = (cle, w, h) => (typeof cle === 'string' && cle ? { cle, w, h } : null);
async function lireTout(col, filtre, projection) { return col.find(filtre, { projection }).toArray(); }

/**
 * @param cartes  base `cartes` (façade de lecture ou db) ; @param prod  base de production (catalogue_produits) ; @param regle  chargerRegle()
 * @returns { entrees, denominateurs } — n'écrit rien nulle part.
 */
async function exporter({ cartes, prod, regle, journal = () => { } }) {
    verifierRegle(regle);
    const L = LOGOS();
    const sets = await lireTout(cartes.collection('sets'), {}, { idExpansion: 1, nomAffichage: 1, tirage: 1, region: 1, code: 1, 'bulba.expansion': 1 });
    if (!sets.length) throw new Error('aucun document dans `sets` : base fausse (un vide parfait n\'est pas « zéro visuel »)');
    const setsBase = new Map(sets.map(s => [s._id, s]));
    journal(`sets : ${sets.length}`);
    const docs = await lireTout(cartes.collection('cartes'), {}, { nomEn: 1, sets: 1, impressions: 1, images: 1 });
    if (!docs.length) throw new Error('aucun document dans `cartes` : base fausse');
    const carteDe = new Map(docs.map(d => [d._id, d]));
    // un substitut (cartes_produits.visuelSubstitut) nomme son fichier mais ne porte pas de vignette (mesuré : 3 219 sur 3 219) : la vignette est celle
    // de l'entrée cartes.images qui porte CE MÊME fichier (même cleR2 = même objet R2) ; aucune entrée ne le porte → pas de vignette, jamais devinée
    const vignetteDuFichier = new Map();
    for (const d of docs) for (const m of d.images || []) if (m?.cleR2 && m.vignette?.cleR2 && !vignetteDuFichier.has(m.cleR2)) vignetteDuFichier.set(m.cleR2, m.vignette);
    const parSet = new Map();
    for (const d of docs) for (const s of d.sets || []) { if (!parSet.has(s)) parSet.set(s, []); parSet.get(s).push(d); }
    journal(`cartes : ${docs.length}`);
    const lignes = await lireTout(cartes.collection('cartes_produits'), {}, { carteId: 1, idProduct: 1, idExpansion: 1, numeroFiche: 1, slug: 1, slugSet: 1, visuelSubstitut: 1 });
    if (!lignes.length) throw new Error('aucune ligne dans `cartes_produits` : base fausse');
    journal(`cartes_produits : ${lignes.length}`);
    const catalogue = await lireTout(prod.collection('catalogue_produits'), {}, { idProduct: 1, idMetacard: 1 });
    if (!catalogue.length) throw new Error('catalogue_produits vide : base fausse');
    const metacarte = new Map(catalogue.map(c => [c.idProduct, c.idMetacard]));
    journal(`catalogue : ${catalogue.length}`);

    // les candidats de chaque ligne : les sets dont elle porte le slugSet ou l'expansion (comme exporter-donnees-logos-site.js)
    const parExp = new Map(), parSlugSet = new Map();
    const exps = s => [].concat(s.idExpansion ?? []);
    for (const s of sets) for (const e of exps(s)) { if (!parExp.has(e)) parExp.set(e, []); parExp.get(e).push(s); }
    for (const s of sets) parSlugSet.set(s._id, s);
    const candidats = l => { const u = new Map(); for (const s of parExp.get(l.idExpansion) || []) u.set(s._id, s); if (l.slugSet && parSlugSet.has(l.slugSet)) u.set(l.slugSet, parSlugSet.get(l.slugSet)); return [...u.values()]; };

    // la fiche du site de chaque produit, set par set : sur TOUS les documents du set (la fiche par impression se décide sur le set entier)
    const lignesParSet = new Map();
    for (const l of lignes) for (const s of candidats(l)) { if (!lignesParSet.has(s._id)) lignesParSet.set(s._id, []); lignesParSet.get(s._id).push(l); }
    const fiches = new Map();
    for (const [id, ls] of lignesParSet) {
        const s = setsBase.get(id), membres = (parSet.get(id) || []).filter(d => typeof d.nomEn === 'string' && d.nomEn !== '');
        const ids = new Set(membres.map(d => d._id));
        fiches.set(id, L.fichesDesProduits(regle, s, membres, ls.filter(l => ids.has(l.carteId) && exps(s).includes(l.idExpansion))).fiche);
    }
    const choisir = l => {
        const cs = candidats(l).map(s => ({ s, f: fiches.get(s._id)?.get(l.idProduct) }));
        const avec = cs.filter(x => x.f && x.f.carteId === l.carteId);
        return { ...(avec[0] || cs.find(x => exps(x.s).includes(l.idExpansion)) || cs[0] || {}), plusieurs: cs.length > 1 };
    };

    const d = { catalogue: catalogue.length, avecLigne: lignes.length, sansLigne: 0, duSet: 0, substitut: 0, autreTirage: 0, aucun: 0,
        aucunDetail: { 'carte absente': 0, 'aucun set candidat': 0, 'aucun visuel': 0 }, ecrites: 0, sansFicheDuSite: 0, rareteContredite: 0, idMetacardAbsent: 0, plusieursSets: 0 };
    const vus = new Set(lignes.map(l => l.idProduct));
    d.sansLigne = catalogue.filter(c => !vus.has(c.idProduct)).length;
    const entrees = [];
    for (const l of lignes) {
        const { s, f, plusieurs } = choisir(l), c = carteDe.get(l.carteId);
        if (plusieurs) d.plusieursSets++;
        if (!c) { d.aucun++; d.aucunDetail['carte absente']++; continue; }
        if (!s) { d.aucun++; d.aucunDetail['aucun set candidat']++; continue; }
        const tirage = s.tirage ?? s.region, noms = [].concat(s.bulba?.expansion ?? []);
        // LE choix du visuel : la fonction des logos (un seul exemplaire). Politiques : un produit sans fiche du site est écarté, comme chez les logos
        // (le site ne le montre sur aucune fiche : aucun visuel « du set » à lui désigner) ; un substitut sans mention reste sans mention et
        // l'importeur le refuse (il exige une mention non vide), alors que les logos posent un repli.
        const choix = L.choisirVisuel({ ligne: l, carte: c, set: s, fiche: f, regle, setsBase, substitutSansMention: 'refus' });
        if (choix.sansFiche) { d.sansFicheDuSite++; continue; }
        const { im, visuel, mention } = choix;
        if (!im) { d.aucun++; d.aucunDetail['aucun visuel']++; continue; }
        if (visuel === 'du-set') d.duSet++; else if (visuel === 'substitut') d.substitut++; else d.autreTirage++;

        // rareté et total : les impressions de la carte, dans le tirage et l'expansion du set, AU numéro de la fiche
        const cle = n => regle.normaliserNumero(n) ?? '';
        const voulu = l.numeroFiche == null ? '' : cle(l.numeroFiche);
        const au = voulu ? (c.impressions || []).filter(i => i && i.tirage === tirage && noms.includes(i.expansion) && cle(i.numero) === voulu) : [];
        const valeur = champ => { const vs = [...new Set(au.map(i => texte(i[champ])).filter(Boolean))]; return vs.length === 1 ? vs[0] : null; };
        const distincts = champ => new Set(au.map(i => texte(i[champ])).filter(Boolean)).size;
        const rarete = valeur('rarete'), total = valeur('total');
        if (distincts('rarete') > 1 || distincts('total') > 1) d.rareteContredite++;
        const numero = l.numeroFiche == null ? null : String(l.numeroFiche);
        const idMetacard = entier(metacarte.get(l.idProduct)) ? metacarte.get(l.idProduct) : null;
        if (idMetacard === null) d.idMetacardAbsent++;
        const e = { idProduct: l.idProduct, visuel, mention, idMetacard, numero, rarete, total, variante: null, setNom: texte(s.nomAffichage),
            lien: numero && rarete ? regle.cardmarketUrl({ slug: l.slug, slugSet: l.slugSet }) : null,
            grande: entier(im.w) && entier(im.h) ? fichierDe(im.cleR2, im.w, im.h) : null };
        const vs = im.vignette ?? vignetteDuFichier.get(im.cleR2);
        const v = vs && fichierDe(vs.cleR2, vs.w, vs.h);
        if (v) e.vignette = v;
        entrees.push(e);
    }
    d.ecrites = entrees.length;
    entrees.sort((a, b) => a.idProduct - b.idProduct);
    return { entrees, denominateurs: d };
}

/** Le compte rendu : les dénominateurs de l'export, puis le résumé que l'IMPORTEUR donnerait du fichier (même fonction que la simulation). */
function resumer({ entrees, denominateurs: d }, Imp = require('./importer-visuels')) {
    const p = Imp.preparer(Imp.entreesDuFichier(JSON.parse(JSON.stringify(entrees))));
    return [`catalogue ${d.catalogue} produits dont ${d.sansLigne} sans ligne cartes_produits ; ${d.avecLigne} lignes cartes_produits`,
        `visuel du set ${d.duSet} · substitut ${d.substitut} · autre tirage ${d.autreTirage} · aucun ${d.aucun} (${Object.entries(d.aucunDetail).map(([k, n]) => `${k} ${n}`).join(' ; ')}) — sans fiche du site (écartés, comme les logos) ${d.sansFicheDuSite} — somme ${d.duSet + d.substitut + d.autreTirage + d.aucun + d.sansFicheDuSite} sur ${d.avecLigne}`,
        `entrées écrites ${d.ecrites} ; rareté/total contredits (mis à null) ${d.rareteContredite} ; idMetacard absent du catalogue ${d.idMetacardAbsent} ; lignes à plusieurs sets candidats ${d.plusieursSets}`,
        `l'importeur (preparer) : ${Imp.resume(p)}`].join('\n');
}

module.exports = { exporter, chargerRegle, verifierRegle, resumer, REGLE_REQUISE };

if (require.main === module) {
    (async () => {
        require('dotenv').config();
        const stop = m => { console.error(`❌ ARRÊT : ${m}`); process.exit(1); };
        const a = process.argv.find(x => x.startsWith('--vers='));
        if (!a) stop('--vers=<fichier JSON> est requis');
        const sortie = a.slice(7);
        const mongoose = require('mongoose');
        const { facadeLecture } = require('../../collecte-cartes/base-banc');
        // LECTURE SEULE : l'URI de lecture d'abord, la connexion habituelle des outils ensuite ; chaque base passe par la façade à liste fermée
        async function ouvrir(dbName, variables, collection) {
            for (const nom of variables) {
                const uri = process.env[nom]; if (!uri) { console.log(`ℹ️ ${nom} : absente`); continue; }
                let cx;
                try {
                    cx = await mongoose.createConnection(uri, { dbName, serverSelectionTimeoutMS: 20000 }).asPromise();
                    await cx.db.collection(collection).findOne({}, { projection: { _id: 1 } });
                    console.log(`🗄️ base "${dbName}" lue par ${nom} (lecture seule, façade à liste fermée)`);
                    return facadeLecture(cx.db, () => cx.close());
                } catch (e) { console.log(`ℹ️ ${nom} : refusée (${e.codeName || e.message.split('\n')[0]})`); try { if (cx) await cx.close(); } catch { /* fermée */ } }
            }
            return stop(`aucune connexion de lecture n'a répondu pour "${dbName}" (${variables.join(', ')})`);
        }
        const cartes = await ouvrir('cartes', ['MONGODB_CARTES_LECTURE_URI', 'MONGODB_CARTES_URI'], 'sets');
        const prod = await ouvrir('test', ['MONGODB_LECTURE_URI', 'MONGODB_URI'], 'catalogue_produits');
        const regle = await chargerRegle();
        const r = await exporter({ cartes, prod, regle, journal: m => console.log(`   ${m}`) });
        await cartes.close(); await prod.close();
        require('fs').mkdirSync(path.dirname(path.resolve(sortie)), { recursive: true });
        require('fs').writeFileSync(sortie, JSON.stringify(r.entrees));
        console.log(resumer(r));
        console.log(`→ ${sortie}`);
        process.exit(0);
    })().catch(e => { console.error('❌', e.message); process.exit(1); });
}
