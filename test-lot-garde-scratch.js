// node test-lot-garde-scratch.js — la garde de lot-additif.js DE BOUT EN BOUT, sur des effacements SIMULÉS, dans test_scratch.
// Un vrai lot : sauvegarde (backup-collections.js), commande, comparaison set par set, restauration, relecture, journal.
// La commande du lot est ce fichier lui-même, appelé avec --effacer=<cas> : il efface comme l'ont fait xASC et HSP (§59),
// et joue le worker qui écrit des images pendant ce temps. Aucune écriture hors de test_scratch ; tout est retiré en sortant
// (collections, sauvegardes, journal) : un banc qui laisse des traces n'est pas reproductible (§3).
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');

const COLLS = ['cartes', 'cartes_produits', 'sets', 'collecte_images_etat'];
const effacer = process.argv.find(a => a.startsWith('--effacer='))?.slice(10);
// `--contrat-api` : TOUS les cas (A à F) tournent aussi avec la garde du contrat de l'API (tour de correction 1, point 4). Les cas G et H, eux, l'utilisent toujours.
const AVEC_CONTRAT = process.argv.includes('--contrat-api');

async function ouvrir() {
    const cx = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
    if (cx.db.databaseName !== 'test_scratch') { await cx.close(); throw new Error(`base « ${cx.db.databaseName} » : je n'écris que dans test_scratch`); }
    return cx;
}

const JOUR = new Date('2026-09-20T10:00:00Z');
const semer = async db => {
    await db.collection('cartes').insertMany([
        { _id: 1, nomEn: 'Blastoise', sets: ['Set-A'], collecteLe: JOUR, impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '2', illustrateur: 'Ken Sugimori', illustrateurPreuve: 'tcgdex:a-2' }], images: [{ set: 'Set-A', numero: '2', cleR2: 'a/2', jointeLe: JOUR, vignette: { cleR2: 'vignettes/a/2.webp', w: 200, h: 280 } }] },
        { _id: 2, nomEn: 'Pikachu', sets: ['Set-A', 'Set-B'], collecteLe: JOUR, impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '58', illustrateur: null }, { tirage: 'jp', expansion: 'Set B', numero: '25' }], images: [{ set: 'Set-B', numero: '25', cleR2: 'b/25', jointeLe: JOUR }] }
    ]);
    await db.collection('cartes_produits').insertMany([
        { _id: '100-1', idProduct: 100, idExpansion: 11, carteId: 1, verifieLe: JOUR },
        { _id: '101-2', idProduct: 101, idExpansion: 11, carteId: 2, verifieLe: JOUR },
        { _id: '200-2', idProduct: 200, idExpansion: 12, carteId: 2, verifieLe: JOUR }
    ]);
    await db.collection('sets').insertMany([{ _id: 'Set-A', nomAffichage: 'Set A', collecteLe: JOUR }, { _id: 'Set-B', nomAffichage: 'Set B', completImages: { le: JOUR } }]);
};

// ── LE MONDE DES CAS G ET H (le contrat de l'API) : assez réel pour que la VRAIE decider serve un produit.
// X-Set n'a aucun visuel propre : le produit 777 se sert de l'image de la même carte dans Zeta-Set (même tirage que X, donc rang 0) ; la carte 600 a son image dans X-Set.
const SET = (id, exp, tirage, code) => ({ _id: id, idExpansion: [exp], nomAffichage: id, tirage, region: tirage, code, bulba: { expansion: `${id} Expansion` }, collecteLe: JOUR });
const IMG = (set, cle, extra = {}) => ({ set, cleR2: cle, w: 600, h: 840, numero: '001', source: 'tcgdex', jointeLe: JOUR, ...extra });
const semerContrat = async db => {
    await db.collection('sets').insertMany([SET('X-Set', 6100, 'jp', 'XJP'), SET('Zeta-Set', 6101, 'jp', 'ZJP'), SET('Alpha-Set', 6102, 'intl', 'AEN')]);
    await db.collection('cartes').insertMany([
        { _id: 500, nomEn: 'Testmon', sets: ['X-Set'], impressions: [{ tirage: 'jp', expansion: 'X-Set Expansion', numero: '001', total: '10', rarete: 'C' }],
            images: [IMG('Zeta-Set', 'z/img.webp', { vignette: { cleR2: 'v/z.webp', w: 200, h: 280 } }), IMG('Alpha-Set', 'a/img.webp')] },
        { _id: 600, nomEn: 'Autremon', sets: ['X-Set'], impressions: [{ tirage: 'jp', expansion: 'X-Set Expansion', numero: '002', total: '10', rarete: 'C' }],
            images: [IMG('X-Set', 'x/600.webp', { numero: '002', vignette: { cleR2: 'v/600.webp', w: 200, h: 280 } })] }]);
    await db.collection('cartes_produits').insertMany([
        { _id: '500-777', carteId: 500, idProduct: 777, idExpansion: 6100, numeroFiche: '001', slug: 'Testmon-X001', slugSet: 'X-Set' },
        { _id: '600-888', carteId: 600, idProduct: 888, idExpansion: 6100, numeroFiche: '002', slug: 'Autremon-X002', slugSet: 'X-Set' }]);
};

// ── LE MONDE DU « LOT B » (tour 2, D1) : quatre cartes, chacune dans son set, chacune avec deux produits (V1, V2) qui partagent l'image du set. Le lot écrit la `variante` des 8 lignes ET un marquage sur les 4 entrées d'image
// (« paire séparée par la variante ») ; UNE seule entrée (la carte 703) est fautive : son libellé fait 78 caractères. Restaurer le seul tableau de la carte fautive laissait les trois autres marquages en place pendant que
// les lignes redevenaient sans variante. `doublon` : la carte 703 porte deux entrées de même (set, cleR2) dans la sauvegarde — l'indécidable.
const semerLotB = async (db, { doublon = false } = {}) => {
    const n = 4;
    // (le visuel d'un set occidental doit porter sa langue, sinon la règle du site ne l'admet pas pour le set et le produit n'est pas servi : `langue: 'en'`)
    await db.collection('sets').insertMany([...Array.from({ length: n }, (_, i) => SET(`B${i}-Set`, 7000 + i, 'intl', `B${i}`)), SET('W-Set', 7100, 'intl', 'W')]);
    await db.collection('cartes').insertMany(Array.from({ length: n }, (_, i) => ({ _id: 700 + i, nomEn: `Pairemon${i}`, sets: [`B${i}-Set`], impressions: [{ tirage: 'intl', expansion: `B${i}-Set Expansion`, numero: '001', total: '10', rarete: 'C' }],
        images: [IMG(`B${i}-Set`, `b${i}/img.webp`, { langue: 'en', vignette: { cleR2: `v/b${i}.webp`, w: 200, h: 280 } }), ...(doublon && i === 3 ? [IMG('B3-Set', 'b3/img.webp', { langue: 'en', numero: '002', vignette: { cleR2: 'v/b3.webp', w: 200, h: 280 } })] : [])] })));
    await db.collection('cartes_produits').insertMany(Array.from({ length: n }, (_, i) => [1, 2].map(v => ({ _id: `${700 + i}-${7000 + 10 * i + v}`, carteId: 700 + i, idProduct: 7000 + 10 * i + v, idExpansion: 7000 + i, numeroFiche: '001', slug: `Pairemon${i}-V${v}`, slugSet: `B${i}-Set` }))).flat());
};

// ── LA COMMANDE DU LOT : ce que le lot (et le worker, en même temps) écrivent
async function jouer(cas) {
    const cx = await ouvrir(), db = cx.db;
    const C = db.collection('cartes'), P = db.collection('cartes_produits');
    const worker = async (op) => { await C.updateOne({ _id: 2 }, op); await db.collection('collecte_images_etat').updateOne({ _id: 'tcgdex/Set-B' }, { $set: { debute: new Date(), fini: new Date() } }, { upsert: true }); };
    if (cas === 'illustrateur') {                          // §59 : +1 fiche annoncée, un illustrateur effacé à côté ; le worker joint une image
        await P.insertOne({ _id: '300-1', idProduct: 300, idExpansion: 13, carteId: 1, verifieLe: new Date() });
        await C.updateOne({ _id: 1 }, { $unset: { 'impressions.0.illustrateur': 1, 'impressions.0.illustrateurPreuve': 1 } });
        await worker({ $push: { images: { set: 'Set-B', numero: '26', cleR2: 'b/26', jointeLe: new Date() } } });
    } else if (cas === 'image-lot') {                      // le lot retire une image hors des sets du worker, et un nom de set
        await C.updateOne({ _id: 1 }, { $pull: { images: { set: 'Set-A' } } });
        await db.collection('sets').updateOne({ _id: 'Set-A' }, { $unset: { nomAffichage: 1 } });
    } else if (cas === 'image-worker') {                   // le worker retire une image de SON set (il la remettra)
        await worker({ $pull: { images: { set: 'Set-B', numero: '25' } } });
    } else if (cas === 'vignette-lot') {                   // l'incident du 2026-10-08 : un rejeu réécrit l'entrée (jointeLe) et perd la vignette
        await C.updateOne({ _id: 1 }, { $unset: { 'images.0.vignette': 1 }, $set: { 'images.0.jointeLe': new Date() } });
        await P.insertOne({ _id: '500-1', idProduct: 500, idExpansion: 15, carteId: 1, verifieLe: new Date() });   // et il ajoute quelque chose (voulu)
        // pendant ce temps le worker joint une image neuve sur la MÊME carte, dans un autre set : l'arrêt ne doit pas la perdre (relecture)
        await C.updateOne({ _id: 1 }, { $push: { images: { set: 'Set-B', numero: '9', cleR2: 'b/9', jointeLe: new Date() } } });
        await db.collection('collecte_images_etat').updateOne({ _id: 'tcgdex/Set-B' }, { $set: { debute: new Date(), fini: new Date() } }, { upsert: true });
    } else if (cas === 'contrat-faute') {                  // G : le lot pose un tamponNonRepresente de 78 caractères sur l'image de Zeta (carte 500) ; le worker joint une image à la carte 600 (même set X)
        await C.updateOne({ _id: 500 }, { $set: { 'images.$[e].partageeTamponNonSepare': false, 'images.$[e].produitsPartages': [777, 778], 'images.$[e].tamponNonRepresente': 'x'.repeat(78) } }, { arrayFilters: [{ 'e.set': 'Zeta-Set' }] });
        await C.updateOne({ _id: 600 }, { $push: { images: { set: 'Y-Set', numero: '9', cleR2: 'y/9', jointeLe: new Date() } } });
        await db.collection('collecte_images_etat').updateOne({ _id: 'tcgdex/Y-Set' }, { $set: { debute: new Date(), fini: new Date() } }, { upsert: true });
    } else if (cas === 'lot-b' || cas === 'lot-b-indecidable') {   // I/J : le lot B du 19/10 — la variante de 8 lignes, un marquage sur 4 entrées d'image dont UNE fautive (78 caractères) ; le worker joint une image à la carte 700
        for (let i = 0; i < 4; i++) {
            await P.updateOne({ _id: `${700 + i}-${7000 + 10 * i + 1}` }, { $set: { variante: 'normale', variantePreuve: 'releve du testeur' } });
            await P.updateOne({ _id: `${700 + i}-${7000 + 10 * i + 2}` }, { $set: { variante: 'staff', variantePreuve: 'releve du testeur' } });
            await C.updateOne({ _id: 700 + i }, { $set: { 'images.$[e].partageeTamponNonSepare': false, 'images.$[e].tamponNonRepresente': i === 3 ? 'x'.repeat(78) : 'Staff' } }, { arrayFilters: [{ 'e.set': `B${i}-Set`, 'e.numero': '001' }] });
        }
        await C.updateOne({ _id: 700 }, { $push: { images: { set: 'W-Set', numero: '1', cleR2: 'w/0', w: 600, h: 840, source: 'tcgdex', langue: 'en', vignette: { cleR2: 'v/w0.webp', w: 200, h: 280 }, jointeLe: new Date() } } });
        await db.collection('collecte_images_etat').updateOne({ _id: 'tcgdex/W-Set' }, { $set: { debute: new Date(), fini: new Date() } }, { upsert: true });
    } else if (cas === 'contrat-propre') {                 // H : le lot change le pv d'une carte (rien que l'API lise) et ajoute une ligne neuve pour la carte 600
        await C.updateOne({ _id: 600 }, { $set: { pv: 60 } });
        await P.insertOne({ _id: '600-889', carteId: 600, idProduct: 889, idExpansion: 6100, numeroFiche: '002', slug: 'Autremon-X002-V2', slugSet: 'X-Set' });
    } else if (cas === 'additif') {
        await P.insertOne({ _id: '400-1', idProduct: 400, idExpansion: 14, carteId: 1, verifieLe: new Date() });
    } else throw new Error(`cas inconnu : ${cas}`);
    await cx.close();
}

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

async function main() {
    // BASE DE BANC (2026-10-08) : plus jamais la production — base mémoire, ou MONGODB_TEST_URI hors production, sinon REFUS (base-banc.js).
    // Seul le processus PRINCIPAL ouvre le banc ; lot-additif.js et la commande `--effacer=` (enfants) en héritent par l'environnement.
    (await ouvrirBanc()).appliquer();
    const cx = await ouvrir(), db = cx.db;
    const presentes = (await db.listCollections().toArray()).map(c => c.name).filter(n => COLLS.includes(n));
    if (presentes.length) { await cx.close(); throw new Error(`test_scratch porte déjà ${presentes.join(', ')} : je ne les écrase pas (ce ne sont pas les miennes)`); }
    const journal = path.join(os.tmpdir(), `journal-test-lot-${Date.now()}.md`);
    const annonce = path.join(os.tmpdir(), `annonce-test-lot-${Date.now()}.json`);
    fs.writeFileSync(annonce, JSON.stringify({ 'illustrateurs imp:intl|Set A': 1, 'illustrateurs-nommes imp:intl|Set A': 1 }));
    const lot = (cas, extra = []) => {
        const r = spawnSync(process.execPath, ['lot-additif.js', '--base=test_scratch', `--journal=${journal}`, '--confirmation=1', `--quoi=banc ${cas}`, '--collections=cartes', ...(AVEC_CONTRAT && !extra.includes('--contrat-api') ? ['--contrat-api'] : []), ...extra, '--', 'node', 'test-lot-garde-scratch.js', `--effacer=${cas}`], { cwd: __dirname, encoding: 'utf8' });
        const ligne = fs.readFileSync(journal, 'utf8').trim().split('\n').at(-1);
        return { code: r.status, ligne, sortie: r.stdout + r.stderr };
    };
    const remettre = async (graine = semer) => { for (const n of COLLS) await db.collection(n).drop().catch(() => { }); await graine(db); await new Promise(r => setTimeout(r, 1100)); };
    try {
        // ── A. le cas du §59, pas annoncé : ARRÊT, l'illustrateur revient, la fiche ajoutée repart, l'image du worker reste
        await remettre();
        let r = lot('illustrateur');
        let c1 = await db.collection('cartes').findOne({ _id: 1 }), c2 = await db.collection('cartes').findOne({ _id: 2 });
        verifier('A. §59 non annoncé : le lot s\'arrête (code 3)', r.code, 3);
        verifier('A. l\'illustrateur effacé revient, avec sa preuve', [c1.impressions[0].illustrateur, c1.impressions[0].illustrateurPreuve], ['Ken Sugimori', 'tcgdex:a-2']);
        verifier('A. la fiche ajoutée par le lot arrêté repart', await db.collection('cartes_produits').countDocuments({ _id: '300-1' }), 0);
        verifier('A. l\'image que le worker a jointe pendant le lot reste', c2.images.map(i => i.numero), ['25', '26']);
        verifier('A. les Date restaurées sont des Date (la sauvegarde est en Extended JSON)', [c1.collecteLe instanceof Date, c1.images[0].jointeLe instanceof Date], [true, true]);
        verifier('A. le journal dit l\'arrêt, la baisse et la relecture', [/🔴 ARRÊT/.test(r.ligne), /illustrateurs imp:intl\\\|Set A 2→1/.test(r.ligne), /relu ✅/.test(r.ligne)], [true, true, true]);
        if (r.code !== 3) console.log(r.sortie);

        // ── B. le même effacement, ANNONCÉ par la simulation : le lot passe, rien n'est restauré
        await remettre();
        r = lot('illustrateur', [`--annonce=${annonce}`]);
        c1 = await db.collection('cartes').findOne({ _id: 1 });
        verifier('B. annoncé : le lot passe (code 0) et garde son effet', [r.code, 'illustrateur' in c1.impressions[0]], [0, false]);
        verifier('B. le journal dit la baisse autorisée', /garde ✅.*\[annoncée\]/.test(r.ligne), true);

        // ── C. le lot retire une image hors des sets du worker, et un nom de set : ARRÊT, les deux reviennent
        await remettre();
        r = lot('image-lot');
        c1 = await db.collection('cartes').findOne({ _id: 1 });
        verifier('C. image et nom effacés par le lot : arrêt, et les deux reviennent', [r.code, c1.images.map(i => i.cleR2), (await db.collection('sets').findOne({ _id: 'Set-A' })).nomAffichage], [3, ['a/2'], 'Set A']);

        // ── D. le worker retire une image de SON set pendant le lot : autorisé, et dit « worker »
        await remettre();
        r = lot('image-worker');
        verifier('D. baisse d\'images dans un set du worker : le lot passe, la baisse est nommée', [r.code, /\[worker\]/.test(r.ligne)], [0, true]);

        // ── F. l'incident du 2026-10-08 : le lot ajoute une fiche et EFFACE une vignette : ARRÊT, la vignette revient
        await remettre();
        r = lot('vignette-lot');
        c1 = await db.collection('cartes').findOne({ _id: 1 });
        verifier('F. vignette effacée par le lot : arrêt (code 3), la vignette revient, la fiche du lot repart', [r.code, c1.images[0].vignette?.cleR2, await db.collection('cartes_produits').countDocuments({ _id: '500-1' })], [3, 'vignettes/a/2.webp', 0]);
        verifier('F. le journal nomme la baisse de vignettes (clé par entrée)', /vignettes-images set:Set-A\\?\|1\\?\|2\\?\|a\/2 1→0/.test(r.ligne), true);
        verifier('F. restauration CHIRURGICALE : l\'image du worker (autre set, même carte) reste, le tableau n\'est pas remplacé', c1.images.map(i => i.cleR2), ['a/2', 'b/9']);
        if (r.code !== 3) console.log(r.sortie);

        // ── E. purement additif
        await remettre();
        r = lot('additif');
        verifier('E. additif : le lot passe, la hausse est comptée', [r.code, /hausses fiches \+1/.test(r.ligne)], [0, true]);

        // ── G. LA GARDE DU CONTRAT DE L'API, de bout en bout (tour de correction 1, point 4) : la chaîne réelle de l'API (decider, lireEntree) est importée par lot-additif.js, l'état « après » est lu UNE fois
        // (projections réunies), et la restauration se fait par CARTE fautive. Un tamponNonRepresente de 78 caractères (l'incident de Frosmoth) arrête le lot et la carte fautive revient ; l'image que le worker
        // a jointe à une AUTRE carte du même set reste.
        await remettre(semerContrat);
        r = lot('contrat-faute', ['--contrat-api']);
        const c500 = await db.collection('cartes').findOne({ _id: 500 }), c600 = await db.collection('cartes').findOne({ _id: 600 });
        verifier('G. contrat : un tampon de 78 caractères arrête le lot (code 3, restauration complète)', r.code, 3);
        verifier('G. la carte fautive est restaurée : l\'image de Zeta n\'a plus ni tampon ni marquage de partage', [c500.images.find(i => i.set === 'Zeta-Set').tamponNonRepresente, c500.images.find(i => i.set === 'Zeta-Set').produitsPartages], [undefined, undefined]);
        verifier('G. restauration PAR CARTE : l\'image jointe par le worker à la carte 600 (même set X, autre carte) reste', c600.images.map(i => i.cleR2), ['x/600.webp', 'y/9']);
        verifier('G. le journal nomme le refus du contrat sur le produit 777 et l\'arrêt', [/contrat API 777/.test(r.ligne), /ARRÊT/.test(r.ligne), /refus du contrat API/.test(r.ligne)], [true, true, true]);
        verifier('G. la sortie dit les étapes du contrat : chaîne importée, et un refus nouveau', [/0 bis\. contrat API : chaîne de l'API importée/.test(r.sortie), /refus nouveaux 1/.test(r.sortie)], [true, true]);
        if (r.code !== 3) console.log(r.sortie);

        // ── I. LE LOT B DU 19/10 (tour 2, D1) : TOUTES les entrées que le lot a marquées reviennent (pas seulement celle de la carte fautive), les lignes aussi : l'état restauré passe le contrat (code 3, pas 4).
        // Ce que le worker a joint à la carte 700 pendant le lot (set W-Set) reste.
        await remettre(semerLotB);
        r = lot('lot-b', ['--contrat-api']);
        const cartesB = await db.collection('cartes').find({ _id: { $in: [700, 701, 702, 703] } }).sort({ _id: 1 }).toArray();
        const lignesB = await db.collection('cartes_produits').find({ carteId: { $gte: 700 } }).toArray();
        verifier('I. lot B : le lot s\'arrête sur le libellé de 78 caractères et la restauration est COMPLÈTE (code 3, et non 4)', r.code, 3);
        verifier('I. lot B : les QUATRE entrées marquées par le lot reviennent à leur version sauvegardée (aucun marquage ne reste, y compris sur les 3 cartes non fautives)',
            cartesB.map(c => c.images.filter(i => i.set.startsWith('B')).some(i => 'tamponNonRepresente' in i || 'partageeTamponNonSepare' in i)), [false, false, false, false]);
        verifier('I. lot B : les 8 lignes sont revenues sans variante', lignesB.some(l => 'variante' in l || 'variantePreuve' in l), false);
        verifier('I. lot B : l\'image que le worker a jointe à la carte 700 (W-Set) reste', cartesB[0].images.map(i => i.cleR2), ['b0/img.webp', 'w/0']);
        verifier('I. lot B : le journal dit les entrées restaurées par carte et celles gardées comme écrites par le worker',
            [/images entrée par entrée : 4 restaurée\(s\) sur 4 carte\(s\), 1 gardée\(s\) comme écrite\(s\) par le worker, 0 indécidable\(s\)/.test(r.ligne), /carte 703 B3-Set\|b3\/img\.webp/.test(r.sortie), /gardées \(worker\)/.test(r.sortie)], [true, true, true]);
        verifier('I. lot B : la relecture dit le contrat respecté ET aucun produit n\'a perdu son visuel (avant la correction : « sans entrée après » sur 6 produits, en information, et le lot sortait en code 3 « restauré »)', [/relu ✅ aucune baisse/.test(r.ligne), /sans entrée après/.test(r.sortie)], [true, false]);
        if (r.code !== 3) console.log(r.sortie);

        // ── J. l'INDÉCIDABLE bloque : la carte 703 porte deux entrées de même (set, cleR2) ; son état n'est pas touché, le lot sort en code 4 et le dit
        await remettre(d => semerLotB(d, { doublon: true }));
        r = lot('lot-b-indecidable', ['--contrat-api']);
        verifier('J. deux entrées de même clé : le lot sort en code 4 (RESTAURATION INCOMPLÈTE), jamais « restauré » en silence', [r.code, /RESTAURATION INCOMPLÈTE/.test(r.sortie), /INDÉCIDABLES/.test(r.sortie), /indécidable : carte 703/.test(r.sortie)], [4, true, true, true]);
        if (r.code !== 4) console.log(r.sortie);

        // ── H. un lot propre avec le contrat : il passe, et le contrat est dit respecté
        await remettre(semerContrat);
        r = lot('contrat-propre', ['--contrat-api']);
        verifier('H. contrat : un lot propre passe (code 0), le contrat est dit respecté, aucun refus nouveau', [r.code, /contrat API respecté/.test(r.sortie), /refus nouveaux 0/.test(r.sortie)], [0, true, true]);
        if (r.code !== 0) console.log(r.sortie);
    } finally {
        for (const n of COLLS) await db.collection(n).drop().catch(() => { });
        await cx.close();
        const dossiers = fs.existsSync(journal) ? [...fs.readFileSync(journal, 'utf8').matchAll(/\| (backup-\d{4}-\d\d-\d\d-lot-\d{6}) \|/g)].map(m => m[1]) : [];
        for (const d of dossiers) fs.rmSync(path.join(__dirname, d), { recursive: true, force: true });
        fs.rmSync(journal, { force: true }); fs.rmSync(annonce, { force: true });
        console.log(`   nettoyé : ${COLLS.length} collections de test_scratch, ${dossiers.length} sauvegardes, le journal du banc`);
    }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
}

(effacer ? jouer(effacer) : main()).catch(e => { console.error('❌', e.message); process.exit(1); });
