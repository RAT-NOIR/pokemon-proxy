'use strict';
// COLLECTION-COMPACTE — le STOCKAGE compact de « Ma collection » (CONTRAT-API-V2.md §1.8) : un registre de positions par set (ajout seulement), un bitmap par (compte, set), les clés HORS registre,
// la quantité des doubles, les bornes et le budget en OCTETS. Base EN MÉMOIRE (INT2), niveau SERVICE (les routes sont dans test-collection.js).
// Chaque garde est éprouvée DEUX fois : sur le code réel et sur une COPIE MUTÉE compilée EN MÉMOIRE (le fragment est retiré du TEXTE du module, jamais du fichier) : la même scène doit alors donner
// un AUTRE résultat — une garde qui ne sait pas dire non n'a pas été vérifiée, elle a été supposée.
const H = require('./_harnais');
const fs = require('fs'), path = require('path'), Module = require('module');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const VB = require('./_visuels-banc');
const { Long, ObjectId } = mongoose.mongo;
const NOM = 'collection_fiches', REG = 'collection_registre', CPT = 'compteurs', CLE_CPT = 'collection-octets';
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const variante = o => ({ ...cfg, collection: { ...cfg.collection, ...(o || {}) } });

function charger(rel, remplacements) {
    const f = path.join(__dirname, '..', 'collection', rel); let src = fs.readFileSync(f, 'utf8');
    for (const [a, b] of remplacements) { if (!src.includes(a)) throw new Error(`mutant : fragment absent de ${rel} : ${a}`); src = src.split(a).join(b); }
    const m = new Module(f, module); m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f)); m._compile(src, f); return m.exports;
}
const dbReelle = () => mongoose.connection.db;
const dbInjecte = surcharges => {
    if (!surcharges) return db.brancher(dbReelle());
    const faux = Object.create(dbReelle()); Object.assign(faux, surcharges.racine || {});
    faux.collection = (n, o) => { const c = dbReelle().collection(n, o); return surcharges[n] ? surcharges[n](c) : c; };
    return db.brancher(faux);
};
/** Le catalogue chargé : { 'Set': ['id|num', …] } (un produit bidon par fiche) ; sans argument : AUCUN catalogue (l'état « sans visuel »). */
const catalogue = liens => { if (!liens) return VB.vider(); VB.installer([VB.doc(1)], Object.entries(liens).flatMap(([set, cles]) => cles.map(c => [set, c, [1]]))); };
const bitsDe = d => Object.entries(d.mots || {}).reduce((n, [, w]) => n + [...(BigInt.asUintN(64, w.toBigInt ? w.toBigInt() : BigInt(w))).toString(2)].filter(x => x === '1').length, 0);
const docsDe = id => raw(NOM).find({ compteId: id }, { promoteLongs: false }).toArray();
const registreDe = slug => raw(REG).findOne({ _id: slug });
const compteur = async () => (await raw(CPT).findOne({ cle: CLE_CPT })).n;

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-collection-compacte.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const svc = require('../collection/service');
    const co = (extra = {}, s = svc) => s.cocher({ cfg, ...extra });

    // ═══════════════ 1. POSITION STABLE : une clé cochée garde son sens quand le catalogue suivant ajoute des fiches DEVANT elle ou en retire une ═══════════════
    {
        const scene = async s => {
            const A = new ObjectId(), B = new ObjectId();
            catalogue({ 'S-Stable': ['10|001', '11|002', '12|003'] });
            for (const k of ['12|003', '10|001', '11|002']) await co({ compteId: A, slug: 'S-Stable', cle: k, possedee: true }, s);
            const regAvant = (await registreDe('S-Stable')).cles.slice();
            // le catalogue SUIVANT : deux fiches neuves DEVANT, et la fiche 11|002 retirée (détachée)
            catalogue({ 'S-Stable': ['90|001', '91|002', '10|001', '12|003', '13|004'] });
            const lu = await s.lireSet(A, 'S-Stable');
            await co({ compteId: B, slug: 'S-Stable', cle: '90|001', possedee: true }, s);        // un autre compte coche une fiche neuve, placée DEVANT dans le catalogue
            await co({ compteId: A, slug: 'S-Stable', cle: '13|004', possedee: true }, s);
            const regApres = (await registreDe('S-Stable')).cles.slice();
            const luA = await s.lireSet(A, 'S-Stable'), luB = await s.lireSet(B, 'S-Stable');
            return [regAvant, lu.cles, regApres.slice(0, 3), regApres.length, luA.cles, luB.cles];
        };
        const attendu = [['12|003', '10|001', '11|002'], ['10|001', '11|002', '12|003'], ['12|003', '10|001', '11|002'], 5, ['10|001', '11|002', '12|003', '13|004'], ['90|001']];
        H.v('1. position STABLE : deux versions de catalogue l\'une après l\'autre (fiches ajoutées devant, une retirée) — la lecture rend exactement les mêmes clés, aucune case ne bouge', await scene(svc), attendu);
        // mutant : la position vient de l'ORDRE DU CATALOGUE (indice dans fichesDuSet) au lieu du registre
        const mut = charger('service.js', [['const p = await positionDuRegistre(slug, cle);\n    if (p.pos < 0) throw', 'const p = { pos: (require(\'../chargeur/etat\').version().fichesDuSet(slug).findIndex(f => f.cle === cle)) };\n    if (p.pos < 0) throw']]);
        let vu; try { vu = await scene(mut); } catch (e) { vu = `exception ${(e && e.name) || 'erreur'}`; }
        H.vrai('   ↳ copie mutée (la position vient de l\'ordre du catalogue) : la même scène donne un AUTRE résultat — la garde sait dire NON', JSON.stringify(vu) !== JSON.stringify(attendu));
    }

    // ═══════════════ 2. LE REGISTRE : ajout seulement, atomique et unique ; aucune clé inventée n'y entre ═══════════════
    {
        let nScene = 0;
        const scene = async s => {
            const slug = nScene++ ? 'S-Reg-Mutant' : 'S-Reg';                      // un set NEUF à chaque passage : la scène rejouée sur un registre qui porte déjà la clé ne prouverait rien
            catalogue({ [slug]: ['1|001', '2|002'] });
            const comptes = Array.from({ length: 50 }, () => new ObjectId());
            await Promise.all(comptes.map(id => co({ compteId: id, slug, cle: '1|001', possedee: true }, s)));
            const reg = await registreDe(slug);
            const lus = await Promise.all(comptes.map(id => s.lireSet(id, slug)));
            return [reg.cles, lus.every(l => JSON.stringify(l.cles) === JSON.stringify(['1|001']))];
        };
        const attendu = [['1|001'], true];
        H.v('2. registre : 50 ajouts SIMULTANÉS de la même clé (50 comptes) donnent UNE position, lue par les 50', await scene(svc), attendu);
        const mut = charger('service.js', [['{ _id: slug, cles: { $ne: cle } }', '{ _id: slug }']]);
        let vu; try { vu = await scene(mut); } catch (e) { vu = `exception ${(e && e.name) || 'erreur'}`; }
        H.vrai('   ↳ copie mutée (le filtre $ne retiré) : plusieurs positions pour la même clé — la garde sait dire NON', JSON.stringify(vu) !== JSON.stringify(attendu));

        // 50 clés DISTINCTES du même set par le même compte, en même temps : exactement 50 bits, 50 positions distinctes
        const A = new ObjectId(); const cles = Array.from({ length: 50 }, (_, i) => `${1000 + i}|001`);
        catalogue({ 'S-Bits': cles });
        const r = await Promise.all(cles.map(k => co({ compteId: A, slug: 'S-Bits', cle: k, possedee: true })));
        const d = await docsDe(A);
        H.v('   50 cochages simultanés de clés distinctes du même set : exactement 50 bits, 50 clés relues, aucun refus', [d.length, bitsDe(d[0]), (await svc.lireSet(A, 'S-Bits')).cles.length, r.filter(x => x.refus).length, new Set((await registreDe('S-Bits')).cles).size], [1, 50, 50, 0, 50]);

        // la CRÉATION simultanée du registre d'un set neuf par des clés DISTINCTES (l'upsert perdant d'une course ne doit pas être pris pour « la clé est déjà là ») : 40 sets neufs × 20 clés en même temps
        {
            let erreurs = 0, incomplets = 0;
            for (let i = 0; i < 40; i++) {
                const slug = `S-Creation-${i}`, cles = Array.from({ length: 20 }, (_, j) => `${3000 + j}|001`);
                catalogue({ [slug]: cles });
                const r = await Promise.allSettled(cles.map(k => co({ compteId: new ObjectId(), slug, cle: k, possedee: true })));
                erreurs += r.filter(x => x.status === 'rejected').length;
                const reg = await registreDe(slug);
                if (!reg || new Set(reg.cles).size !== 20 || reg.cles.length !== 20) incomplets++;
            }
            H.v('   création simultanée du registre d\'un set neuf par 20 clés distinctes (40 sets) : aucune écriture en erreur, 20 positions distinctes à chaque fois', [erreurs, incomplets], [0, 0]);
        }
        // une clé que le catalogue ne connaît pas n'entre JAMAIS au registre ; sans catalogue chargé, rien n'entre
        const B = new ObjectId();
        catalogue({ 'S-Inconnue': ['5|001'] });
        await co({ compteId: B, slug: 'S-Inconnue', cle: '666|999', possedee: true });        // clé inventée, set connu
        await co({ compteId: B, slug: 'S-Absent-Du-Catalogue', cle: '5|001', possedee: true });  // set absent du catalogue
        H.v('   une clé inconnue du catalogue (ou d\'un set inconnu) n\'entre JAMAIS au registre : elle va dans `hors`', [await registreDe('S-Inconnue'), await registreDe('S-Absent-Du-Catalogue'), (await docsDe(B)).map(x => [x.set, x.hors, bitsDe(x)]).sort()], [null, null, [['S-Absent-Du-Catalogue', ['5|001'], 0], ['S-Inconnue', ['666|999'], 0]]]);
        catalogue(null);
        const Cc = new ObjectId();
        await co({ compteId: Cc, slug: 'S-Reg', cle: '2|002', possedee: true });             // connu du catalogue d'avant, mais AUCUN catalogue n'est chargé
        const reg = await registreDe('S-Reg');
        H.v('   sans catalogue chargé (démarrage, échec) : rien n\'entre au registre, tout va dans `hors`', [reg.cles, (await docsDe(Cc))[0].hors], [['1|001'], ['2|002']]);
        const mutAppartenance = charger('service.js', [['function connue(slug, cle) {', 'function connue(slug, cle) { return true;']]);
        const D = new ObjectId(); catalogue({ 'S-Inconnue': ['5|001'] });
        await co({ compteId: D, slug: 'S-Inconnue', cle: '777|888', possedee: true }, mutAppartenance);
        H.vrai('   ↳ copie mutée (le contrôle d\'appartenance au catalogue retiré) : une clé inventée ENTRE au registre — la garde sait dire NON', (await registreDe('S-Inconnue')).cles.includes('777|888'));
        // le registre ne porte que { _id, cles }
        H.v('   le registre ne porte que `_id` et `cles` (aucun compte, aucune date, aucune IP)', Object.keys(await registreDe('S-Reg')).sort(), ['_id', 'cles']);
    }

    // ═══════════════ 3. L'UNION : une clé ne vit qu'à UN endroit pour un compte ═══════════════
    {
        const A = new ObjectId();
        catalogue(null);
        await co({ compteId: A, slug: 'S-Union', cle: '30|001', possedee: true });            // sans catalogue : `hors`
        catalogue({ 'S-Union': ['30|001', '31|002'] });                                           // le catalogue la connaît désormais
        const r = await co({ compteId: A, slug: 'S-Union', cle: '30|001', possedee: true });    // cochée à nouveau : reste dans `hors`, ne migre pas
        let d = (await docsDe(A))[0];
        H.v('3. une clé rangée dans `hors` puis apprise par le catalogue RESTE dans `hors` (pas de migration), n\'est comptée qu\'une fois', [d.hors, bitsDe(d), r.possedees, (await registreDe('S-Union'))], [['30|001'], 0, 1, null]);
        // mutant : la priorité de `hors` retirée (la clé rangée en `hors` est aussi posée au registre) → elle existerait à DEUX endroits
        // (le bit repris par la course hors/registre masquerait ce mutant seul : les deux gardes sont retirées ensemble)
        const mutPrio = charger('service.js', [['const h = doc ? indexHors(doc.hors, cle) : -1;', 'const h = -1;'], ['if (avant && indexHors(avant.hors, cle) >= 0) {', 'if (false) {']]);
        const Dp = new ObjectId(); catalogue(null); await co({ compteId: Dp, slug: 'S-Union', cle: '30|001', possedee: true }); catalogue({ 'S-Union': ['30|001', '31|002'] });
        await co({ compteId: Dp, slug: 'S-Union', cle: '30|001', possedee: true }, mutPrio);
        const dDp = (await docsDe(Dp))[0];
        H.vrai('   ↳ copie mutée (la priorité de `hors` retirée) : la clé existe à DEUX endroits (bit ET hors) — la garde sait dire NON', bitsDe(dDp) === 1 && dDp.hors.length === 1);
        await co({ compteId: A, slug: 'S-Union', cle: '31|002', possedee: true });
        const lu = await svc.lireSet(A, 'S-Union'), ls = await svc.lireSets(A);
        d = (await docsDe(A))[0];
        H.v('   la lecture rend l\'union triée sans doublon ; `possedees` = bits + longueur de hors', [lu.cles, ls.map(s => s.possedees), bitsDe(d) + d.hors.length], [['30|001', '31|002'], [2], 2]);
        const mutCompte = charger('service.js', [['nbBits(doc.mots) + (doc.hors ? doc.hors.length : 0)', 'nbBits(doc.mots) + (doc.hors ? doc.hors.length : 0) + nbBits(doc.mots)']]);
        const E2 = new ObjectId(); catalogue({ 'S-Union': ['30|001', '31|002'] }); await co({ compteId: E2, slug: 'S-Union', cle: '31|002', possedee: true });
        H.vrai('   ↳ copie mutée (le compte de l\'union compte les bits deux fois) : `possedees` est faux — la garde sait dire NON', (await mutCompte.lireSets(E2))[0].possedees !== (await svc.lireSets(E2))[0].possedees);
        // décocher retire des DEUX endroits (état construit : la même clé en bit ET en hors)
        const reg = await registreDe('S-Union'); const pos = reg.cles.indexOf('31|002');
        await raw(NOM).updateOne({ compteId: A, set: 'S-Union' }, { $addToSet: { hors: '31|002' } });
        d = (await docsDe(A))[0];
        const apres = await co({ compteId: A, slug: 'S-Union', cle: '31|002', possedee: false });
        d = (await docsDe(A))[0];
        H.v('   décocher la retire des deux endroits (bit ET hors)', [pos, apres.possedees, d.hors, bitsDe(d)], [1, 1, ['30|001'], 0]);
        const mutAnd = charger('service.js', [['{ and: inverse(b) }', '{ or: masque(0) }']]);
        const B = new ObjectId(); catalogue({ 'S-Union': ['30|001', '31|002'] });
        await co({ compteId: B, slug: 'S-Union', cle: '31|002', possedee: true }); await co({ compteId: B, slug: 'S-Union', cle: '30|001', possedee: true });
        await co({ compteId: B, slug: 'S-Union', cle: '31|002', possedee: false }, mutAnd);
        H.vrai('   ↳ copie mutée (le `and` du décochage devient un `or`) : la clé reste cochée — la garde sait dire NON', (await svc.lireSet(B, 'S-Union')).cles.includes('31|002'));
        // jamais deux fois : hors puis registre → la même clé cochée deux fois par deux chemins ne compte qu'une fois
        const C = new ObjectId(); catalogue(null);
        await co({ compteId: C, slug: 'S-Union2', cle: '40|001', possedee: true }); catalogue({ 'S-Union2': ['40|001', '41|001'] });
        await co({ compteId: C, slug: 'S-Union2', cle: '41|001', possedee: true }); await co({ compteId: C, slug: 'S-Union2', cle: '40|001', possedee: true });
        H.v('   `possedees` ne compte jamais deux fois (une clé en hors, une au registre, la première recochée)', [(await svc.lireSets(C)).map(s => s.possedees), (await svc.lireSet(C, 'S-Union2')).cles], [[2], ['40|001', '41|001']]);
        // la course hors → registre : la clé est posée en hors PENDANT que l'autre chemin pose le bit → le bit est repris
        const sceneCourse = async s => {
            const E = new ObjectId(); catalogue({ 'S-Course': ['50|001'] });
            let injecte = false;
            dbInjecte({ [NOM]: c => { const w = Object.create(c); w.findOneAndUpdate = async (...a) => { if (!injecte && a[1] && a[1].$bit) { injecte = true; await raw(NOM).updateOne({ compteId: E, set: 'S-Course' }, { $set: { hors: ['50|001'] } }, { upsert: true }); } return c.findOneAndUpdate(...a); }; return w; } });
            try { await co({ compteId: E, slug: 'S-Course', cle: '50|001', possedee: true }, s); } finally { dbInjecte(null); }
            const dE = (await docsDe(E))[0];
            return [dE.hors, bitsDe(dE), (await svc.lireSet(E, 'S-Course')).cles];
        };
        const attenduCourse = [['50|001'], 0, ['50|001']];
        H.v('   course hors/registre (la clé arrive en `hors` entre la lecture et l\'écriture du bit) : le bit est repris, la clé n\'existe qu\'à UN endroit', await sceneCourse(svc), attenduCourse);
        H.vrai('   ↳ copie mutée (le bit n\'est plus repris) : la clé existe à DEUX endroits — la garde sait dire NON', JSON.stringify(await sceneCourse(charger('service.js', [['if (avant && indexHors(avant.hors, cle) >= 0) {', 'if (false) {']]))) !== JSON.stringify(attenduCourse));
    }

    // ═══════════════ 4. LE DOCUMENT D'UN COMPTE POUR UN SET : sa forme, les bits aux frontières de mot, la suppression du set vide ═══════════════
    {
        const A = new ObjectId(); const cles = Array.from({ length: 200 }, (_, i) => `${2000 + i}|${String(i).padStart(3, '0')}`);
        catalogue({ 'S-Mots': cles });
        for (const k of cles) await co({ compteId: A, slug: 'S-Mots', cle: k, possedee: true });       // positions 0…199 dans l'ordre
        const reg = (await registreDe('S-Mots')).cles;
        const d0 = (await docsDe(A))[0];
        H.v('4. le document porte exactement { _id, compteId, set, mots, hors, majLe } (ni adresse, ni nom, ni IP) ; 200 clés → 4 mots de 64 bits', [Object.keys(d0).sort(), Object.keys(d0.mots).sort(), bitsDe(d0), reg.length], [['_id', 'compteId', 'hors', 'majLe', 'mots', 'set'], ['0', '1', '2', '3'], 200, 200]);
        H.vrai('   les mots sont des entiers de 64 bits (Long)', Object.values(d0.mots).every(w => w instanceof Long));
        const lus = (await svc.lireSet(A, 'S-Mots')).cles;
        H.v('   les 200 clés relues, y compris aux frontières de mot (positions 63, 64, 127, 128, 191, 192)', [lus.length, [63, 64, 127, 128, 191, 192].every(p => lus.includes(reg[p]))], [200, true]);
        // décocher les bits de frontière un à un
        for (const p of [63, 64, 127, 128]) await co({ compteId: A, slug: 'S-Mots', cle: reg[p], possedee: false });
        const d1 = (await docsDe(A))[0];
        H.v('   décocher aux frontières retire exactement ces bits, aucun autre', [bitsDe(d1), (await svc.lireSet(A, 'S-Mots')).cles.filter(k => [63, 64, 127, 128].map(p => reg[p]).includes(k))], [196, []]);
        // un set qui n'a plus rien est SUPPRIMÉ (bits à zéro ET hors vide) ; avec un seul des deux vide il reste
        const B = new ObjectId(); catalogue({ 'S-Vide': ['60|001', '61|001'] });
        await co({ compteId: B, slug: 'S-Vide', cle: '60|001', possedee: true }); await co({ compteId: B, slug: 'S-Vide', cle: '999|9', possedee: true });   // un bit + une clé hors
        await co({ compteId: B, slug: 'S-Vide', cle: '60|001', possedee: false });
        const reste1 = (await docsDe(B)).length;
        await co({ compteId: B, slug: 'S-Vide', cle: '999|9', possedee: false });
        H.v('   un set sans bit mais avec une clé `hors` RESTE ; sans bit ni `hors` il est SUPPRIMÉ', [reste1, (await docsDe(B)).length], [1, 0]);
        const mutVide = charger('service.js', [['$ne: [\'$$this.v\', 0]', '$ne: [\'$$this.v\', 7]']]);
        const Cn = new ObjectId(); catalogue({ 'S-Vide': ['60|001', '61|001'] });
        await co({ compteId: Cn, slug: 'S-Vide', cle: '60|001', possedee: true }, mutVide); await co({ compteId: Cn, slug: 'S-Vide', cle: '60|001', possedee: false }, mutVide);
        H.vrai('   ↳ copie mutée (le test « tous les mots sont nuls » faussé) : le set vide n\'est pas supprimé — la garde sait dire NON', (await docsDe(Cn)).length === 1);
        // l'index unique (compteId, set)
        let leve = false; try { await raw(NOM).insertOne({ compteId: A, set: 'S-Mots', mots: {}, hors: [], majLe: new Date() }); } catch (e) { leve = e.code === 11000; }
        H.vrai('   l\'index unique (compteId, set) refuse un second document', leve);
    }

    // ═══════════════ 5. LA QUANTITÉ DES DOUBLES (extension facultative) ═══════════════
    {
        const A = new ObjectId(); catalogue({ 'S-Qte': ['70|001', '71|001'] });
        await co({ compteId: A, slug: 'S-Qte', cle: '70|001', possedee: true, quantite: 3 });
        await co({ compteId: A, slug: 'S-Qte', cle: '888|1', possedee: true, quantite: 99 });          // une clé `hors`, quantité portée à côté de la clé
        await co({ compteId: A, slug: 'S-Qte', cle: '71|001', possedee: true });
        let l = await svc.lireSet(A, 'S-Qte');
        H.v('5. quantité : `quantites` ne porte que les clés à n ≥ 2 (registre ET hors) ; une clé sans quantité vaut 1', [l.cles, l.quantites], [['70|001', '71|001', '888|1'], { '70|001': 3, '888|1': 99 }]);
        const d = (await docsDe(A))[0];
        H.v('   stockage : `qte` { position: n } pour le registre ; la quantité d\'une clé `hors` est portée dans `hors` ; une clé sans quantité n\'écrit rien', [d.qte, d.hors, bitsDe(d)], [{ 0: 3 }, ['888|1\n99'], 2]);
        const avant = (await docsDe(A))[0].majLe.getTime(); await attendre(15);
        const idem = await co({ compteId: A, slug: 'S-Qte', cle: '70|001', possedee: true, quantite: 3 });
        H.v('   cocher à nouveau avec la MÊME quantité : idempotent, majLe INCHANGÉ', [idem.possedees, (await docsDe(A))[0].majLe.getTime() === avant], [3, true]);
        await attendre(15);
        await co({ compteId: A, slug: 'S-Qte', cle: '70|001', possedee: true, quantite: 5 });
        await co({ compteId: A, slug: 'S-Qte', cle: '888|1', possedee: true, quantite: 2 });
        l = await svc.lireSet(A, 'S-Qte'); const d2 = (await docsDe(A))[0];
        H.v('   changer la quantité d\'une clé déjà cochée la change, sans changer le nombre de fiches ; majLe avance', [l.quantites, l.cles.length, d2.majLe.getTime() > avant], [{ '70|001': 5, '888|1': 2 }, 3, true]);
        await co({ compteId: A, slug: 'S-Qte', cle: '70|001', possedee: true });                     // quantité absente = 1
        l = await svc.lireSet(A, 'S-Qte');
        H.v('   `quantite` absente vaut 1 : elle remet la clé à 1 (l\'entrée `qte` disparaît)', [l.quantites, (await docsDe(A))[0].qte], [{ '888|1': 2 }, {}]);
        await co({ compteId: A, slug: 'S-Qte', cle: '888|1', possedee: false });
        H.v('   décocher efface la quantité (hors comme registre) et la clé', [(await svc.lireSet(A, 'S-Qte')).cles, (await svc.lireSet(A, 'S-Qte')).quantites, (await docsDe(A))[0].hors], [['70|001', '71|001'], {}, []]);
        const B = new ObjectId(); await co({ compteId: B, slug: 'S-Qte', cle: '70|001', possedee: true, quantite: 4 }); await co({ compteId: B, slug: 'S-Qte', cle: '70|001', possedee: false });
        H.v('   décocher une clé à quantité efface son entrée `qte` (le set vide disparaît avec)', (await docsDe(B)).length, 0);
        const leve = async q => { try { await co({ compteId: B, slug: 'S-Qte', cle: '71|001', possedee: true, quantite: q }); return false; } catch (e) { return true; } };
        H.v('   le service refuse une quantité hors 1…99 (0, 100, 1,5, chaîne) — les routes la refusaient déjà en 400', [await leve(0), await leve(100), await leve(1.5), await leve('3')], [true, true, true, true]);
    }

    // ═══════════════ 6. UNE FICHE SIMPLE (idInterne NÉGATIF) se coche, se relit, se décoche, et le registre la reconnaît ═══════════════
    {
        const A = new ObjectId(); catalogue({ 'S-Simple': ['-12|-', '-286142|001', '9|001'] });
        await co({ compteId: A, slug: 'S-Simple', cle: '-286142|001', possedee: true }); await co({ compteId: A, slug: 'S-Simple', cle: '-12|-', possedee: true });
        const lu = await svc.lireSet(A, 'S-Simple');
        H.v('6. fiches simples (idInterne négatif) : cochées, relues (triées), entrées AU REGISTRE (le chargeur les porte en Int32 négatif)', [lu.cles, (await registreDe('S-Simple')).cles, bitsDe((await docsDe(A))[0])], [['-12|-', '-286142|001'], ['-286142|001', '-12|-'], 2]);
        await co({ compteId: A, slug: 'S-Simple', cle: '-286142|001', possedee: false }); await co({ compteId: A, slug: 'S-Simple', cle: '-12|-', possedee: false });
        H.v('   ... puis décochées : le set disparaît', (await docsDe(A)).length, 0);
    }

    // ═══════════════ 7. LES BORNES : écrites par ce qu'elles protègent ═══════════════
    {
        const pas = async (c, extra) => co({ cfg: variante(c), ...extra });
        // par compte : bits + hors
        const A = new ObjectId(); catalogue({ 'S1': ['1|1', '2|1', '3|1'], 'S2': ['4|1', '5|1'] });
        const C1 = { clesParCompte: 3, horsCatalogueParCompte: 10, setsParCompte: 10 };
        for (const [s, k] of [['S1', '1|1'], ['S1', '2|1'], ['S2', '999|1']]) await pas(C1, { compteId: A, slug: s, cle: k, possedee: true });   // 2 bits + 1 hors = 3
        const plein = await pas(C1, { compteId: A, slug: 'S2', cle: '4|1', possedee: true });
        const idem = await pas(C1, { compteId: A, slug: 'S1', cle: '1|1', possedee: true }), idemHors = await pas(C1, { compteId: A, slug: 'S2', cle: '999|1', possedee: true });
        await pas(C1, { compteId: A, slug: 'S1', cle: '2|1', possedee: false });
        const re = await pas(C1, { compteId: A, slug: 'S2', cle: '4|1', possedee: true });
        H.v('7. borne PAR COMPTE (bits + hors, tous sets) : refusée « borne-compte », jamais pour un cochage déjà fait ni un décochage, qui libère', [[plein.refus, plein.borne], idem.possedees, idemHors.possedees, re.refus], [['borne-compte', 3], 2, 1, undefined]);
        const mutC = charger('service.js', [['if (total >= cfg.collection.clesParCompte)', 'if (false)']]);
        const A2 = new ObjectId(); for (const k of ['1|1', '2|1', '3|1']) await co({ cfg: variante(C1), compteId: A2, slug: 'S1', cle: k, possedee: true }, mutC);
        const pm = await co({ cfg: variante(C1), compteId: A2, slug: 'S2', cle: '4|1', possedee: true }, mutC);
        H.vrai('   ↳ copie mutée (la borne par compte retirée) : un cochage de trop PASSE — la garde sait dire NON', !pm.refus);
        // hors du catalogue : plafond par compte, tous sets confondus
        const B = new ObjectId(); catalogue({ 'S1': ['1|1'] });
        const C2 = { clesParCompte: 100, horsCatalogueParCompte: 2, setsParCompte: 10 };
        await pas(C2, { compteId: B, slug: 'SX', cle: '1|1', possedee: true }); await pas(C2, { compteId: B, slug: 'SY', cle: '2|1', possedee: true });
        const horsPlein = await pas(C2, { compteId: B, slug: 'SZ', cle: '3|1', possedee: true });
        const registreOk = await pas(C2, { compteId: B, slug: 'S1', cle: '1|1', possedee: true });    // une clé CONNUE du catalogue n'est pas comptée dans `hors`
        const idemH = await pas(C2, { compteId: B, slug: 'SX', cle: '1|1', possedee: true });
        H.v('   borne des clés HORS catalogue par compte : refusée « borne-hors », une clé connue du catalogue passe, un cochage déjà fait aussi', [[horsPlein.refus, horsPlein.borne], registreOk.refus, idemH.refus], [['borne-hors', 2], undefined, undefined]);
        const mutH = charger('service.js', [['cfg.collection.horsCatalogueParCompte', '1e9']]);
        const B2 = new ObjectId(); for (const k of ['1|1', '2|1', '3|1']) await co({ cfg: variante(C2), compteId: B2, slug: `SQ${k[0]}`, cle: k, possedee: true }, mutH);
        H.vrai('   ↳ copie mutée (la borne `hors` retirée) : trois clés hors passent — la garde sait dire NON', (await svc.totalDuCompte(B2)) === 3);
        // sets par compte
        const Cc = new ObjectId(); const C3 = { setsParCompte: 2 };
        await pas(C3, { compteId: Cc, slug: 'T1', cle: '1|1', possedee: true }); await pas(C3, { compteId: Cc, slug: 'T2', cle: '2|1', possedee: true });
        const sets = await pas(C3, { compteId: Cc, slug: 'T3', cle: '3|1', possedee: true }), dans = await pas(C3, { compteId: Cc, slug: 'T1', cle: '4|1', possedee: true });
        await pas(C3, { compteId: Cc, slug: 'T2', cle: '2|1', possedee: false });
        const libre = await pas(C3, { compteId: Cc, slug: 'T3', cle: '3|1', possedee: true });
        H.v('   borne de SETS par compte : un 3e set refusé « borne-sets », un set existant reste ouvert, en vider un libère la place', [[sets.refus, sets.borne], dans.possedees, libre.refus], [['borne-sets', 2], 2, undefined]);
        // le plafond par compte au pire : hors plein ET sets plein ET compte plein à la fois — le premier refus nommé est celui du compte
        const D = new ObjectId(); const C4 = { clesParCompte: 2, horsCatalogueParCompte: 2, setsParCompte: 2 };
        await pas(C4, { compteId: D, slug: 'U1', cle: '1|1', possedee: true }); await pas(C4, { compteId: D, slug: 'U2', cle: '2|1', possedee: true });
        const tout = await pas(C4, { compteId: D, slug: 'U3', cle: '3|1', possedee: true });
        H.v('   compte plein, sets plein et hors plein à la fois : rien d\'écrit, un refus nommé (« borne-compte »)', [tout.refus, (await docsDe(D)).length], ['borne-compte', 2]);
        H.v('   `clesParSet` n\'existe plus (le registre est borné par le catalogue, `hors` par son plafond)', ['clesParSet' in cfg.collection, 'clesService' in cfg.collection, 'forfaitDocument' in cfg.collection], [false, false, false]);
        // LES DÉFAUTS contre ce qui a été MESURÉ (sauvegarde locale du 2026-10-10, mesurer-collection.js ; dénominateurs : 761 sets, 17 096 cartes, 69 515 lignes, catalogue de 70 975 produits)
        const MESURE = { plusGrandCompte: 68792, fichesDeLArchive: 64858, hors: 3934, clesDuSite: 39648 };
        H.vrai(`le plafond par compte (${cfg.collection.clesParCompte}) couvre le plus grand compte mesuré (${MESURE.plusGrandCompte} = max(règle du site, archive ${MESURE.fichesDeLArchive}, données du site ${MESURE.clesDuSite}))`, cfg.collection.clesParCompte >= Math.max(MESURE.plusGrandCompte, MESURE.fichesDeLArchive, MESURE.clesDuSite));
        H.vrai(`le plafond hors catalogue (${cfg.collection.horsCatalogueParCompte}) couvre le nombre mesuré (${MESURE.hors}) avec une marge`, cfg.collection.horsCatalogueParCompte > MESURE.hors && cfg.collection.horsCatalogueParCompte <= 10000);
        H.v('   budget provisoire de 10 Mo, quantité maximale 99, 1 000 sets par compte, 1 000 écritures par heure', [cfg.collection.octetsService, cfg.collection.quantiteMax, cfg.collection.setsParCompte, cfg.limites.collectionEcrituresParCompteHeure], [10485760, 99, 1000, 1000]);
        const FICHIER = 'C:\\Users\\Yung\\rat-market-travail\\api\\_mesures\\collection\\mesure.json';
        if (fs.existsSync(FICHIER)) {
            const m = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
            H.v('   la mesure sur disque (si elle est là) est celle que ce banc cite', [m.plusGrandCompte, m.horsRegistre.total, m.archive.fiches], [MESURE.plusGrandCompte, MESURE.hors, MESURE.fichesDeLArchive]);
        } else console.log(`   SAUT DIT : ${FICHIER} absent de cette machine — les constantes de ce banc ne sont pas confrontées au fichier de mesure`);
    }

    // ═══════════════ 8. LE BUDGET EN OCTETS : réservation atomique, recompte par collStats, compteur absent, suppression de compte ═══════════════
    {
        const C = require('../collection/couts');
        const fsync = async () => { await mongoose.connection.db.admin().command({ fsync: 1 }); await attendre(1200); };
        // 8.1 réservation ATOMIQUE au bord du plafond
        catalogue(null);
        const base = await svc.recompter(cfg);
        const cle = i => `${100000 + i}|1`;
        const cout1 = C.document('S-Bord') + C.hors(cle(0), 1), K = 5;
        const cfgX = variante({ octetsService: base + K * cout1 });
        const comptes = Array.from({ length: 50 }, () => new ObjectId());
        const scene81 = async s => {
            await svc.recompter(cfg);
            const b = await compteur(); const plafond = b + K * cout1; const cx = variante({ octetsService: plafond });
            const r = await Promise.all(comptes.map((id, i) => s.cocher({ cfg: cx, compteId: id, slug: 'S-Bord', cle: cle(i), possedee: true })));
            const ok = r.filter(x => !x.refus).length, refus = r.filter(x => x.refus);
            const n = await compteur(); const docs = await raw(NOM).countDocuments({ set: 'S-Bord' });
            await Promise.all(comptes.map(id => svc.supprimerDuCompte(id, cfg)));
            return [ok, refus.length, [...new Set(refus.map(x => x.refus))], n - b, n <= plafond, docs];
        };
        const attendu81 = [K, 50 - K, ['borne-service'], K * cout1, true, K];
        H.v('8.1 réservation ATOMIQUE : 50 écritures concurrentes (50 comptes) au bord du plafond en laissent passer exactement 5, jamais au-dessus, rien d\'écrit pour les refusées', await scene81(svc), attendu81);
        const mutInc = charger('service.js', [['n: { $lte: cfg.collection.octetsService - cout }', 'n: { $gte: 0 }']]);
        let vu; try { vu = await scene81(mutInc); } catch (e) { vu = `exception ${(e && e.name) || 'erreur'}`; }
        H.vrai('   ↳ copie mutée (la condition du `$inc` retirée) : le plafond est dépassé — la garde sait dire NON', JSON.stringify(vu) !== JSON.stringify(attendu81));

        // 8.2 une écriture refusée par le budget n'écrit RIEN (ni compte, ni registre)
        catalogue({ 'S-Rien': ['5|1'] });
        const R = new ObjectId(); const b0 = await svc.recompter(cfg);
        const refus = await svc.cocher({ cfg: variante({ octetsService: b0 }), compteId: R, slug: 'S-Rien', cle: '5|1', possedee: true });
        H.v('8.2 plafond atteint : « borne-service », ni document de compte ni entrée de registre écrits, compteur inchangé', [refus.refus, (await docsDe(R)).length, await registreDe('S-Rien'), (await compteur()) === b0], ['borne-service', 0, null, true]);

        // 8.3 idempotence au plafond : un cochage déjà fait ne consomme rien, un décochage rend
        catalogue(null);
        const I = new ObjectId(); await svc.cocher({ cfg, compteId: I, slug: 'S-Id', cle: '1|1', possedee: true });
        const bI = await svc.recompter(cfg); const cfgI = variante({ octetsService: bI });
        const rep = await svc.cocher({ cfg: cfgI, compteId: I, slug: 'S-Id', cle: '1|1', possedee: true });
        const nv = await svc.cocher({ cfg: cfgI, compteId: I, slug: 'S-Id', cle: '2|1', possedee: true });
        const dec = await svc.cocher({ cfg: cfgI, compteId: I, slug: 'S-Id', cle: '1|1', possedee: false });
        H.v('8.3 au plafond : une clé déjà cochée ne consomme rien (pas de refus), une nouvelle est refusée, un décochage est accepté et RENDRE', [rep.possedees, nv.refus, dec.possedees, (await compteur()) < bI], [1, 'borne-service', 0, true]);

        // 8.4 recompte au montage par collStats des DEUX collections
        await fsync();
        const octets = async nom => { try { const st = await mongoose.connection.db.command({ collStats: nom }); return st.size + st.totalIndexSize; } catch (e) { return 0; } };
        await raw(CPT).updateOne({ cle: CLE_CPT }, { $set: { n: 987654 } });
        const { default: _ } = { default: 0 }; void _;
        const express = require('express'); const monter = require('../collection/monter');
        const monte = async mod => { await raw(CPT).updateOne({ cle: CLE_CPT }, { $set: { n: 987654 } }); mod.routes(express.Router(), cfg, {}); for (let i = 0; i < 60 && (await compteur()) === 987654; i++) await attendre(50); return compteur(); };
        const n84 = await monte(monter), reel84 = (await octets(NOM)) + (await octets(REG));
        H.v('8.4 montage du lot : le compteur faux (987 654) est recompté depuis `collStats` (données + index) des DEUX collections', [n84 === reel84, n84 > 0, (await octets(REG)) > 0], [true, true, true]);
        const mutM = charger('monter.js', [['service.initialiser(cfg)', 'Promise.resolve()']]);
        H.vrai('   ↳ copie mutée de monter.js (sans recompte au montage) : le compteur reste faux — la garde sait dire NON', (await monte(mutM)) === 987654);
        const mutRec = charger('service.js', [['+ (await octetsDe(REGISTRE))', '']]);
        await mutRec.recompter(cfg); const sansReg = await compteur(); await svc.recompter(cfg);
        H.vrai('   ↳ copie mutée (le registre non compté) : le recompte sous-estime — la garde sait dire NON', sansReg < (await compteur()));

        // 8.5 un recompte en échec FERME les écritures (rien d'écrit, l'erreur remonte), la panne passée l'écriture suivante le rejoue
        const s85 = charger('service.js', []); const P = new ObjectId(); const avant85 = await raw(NOM).countDocuments({});
        dbInjecte({ racine: { command: async () => { throw new Error('panne simulée'); } } });
        let leve = false; try { await s85.cocher({ cfg, compteId: P, slug: 'S-Panne', cle: '1|1', possedee: true }); } catch (e) { leve = true; } finally { dbInjecte(null); }
        const ecrits = (await raw(NOM).countDocuments({})) - avant85;
        const apres = await s85.cocher({ cfg, compteId: P, slug: 'S-Panne', cle: '1|1', possedee: true }).catch(() => ({}));
        H.v('8.5 un recompte en échec FERME les écritures (rien d\'écrit, l\'erreur remonte : 503) ; la panne passée, l\'écriture suivante rejoue le recompte', [leve, ecrits, apres.possedees], [true, 0, 1]);
        const mutPanne = charger('service.js', [['.catch(e => { initialisation = null; throw e; })', '.catch(() => 0)']]);
        const s85m = mutPanne; dbInjecte({ racine: { command: async () => { throw new Error('panne simulée'); } } });
        let leveM = false; try { await s85m.cocher({ cfg, compteId: new ObjectId(), slug: 'S-Panne', cle: '1|1', possedee: true }); } catch (e) { leveM = true; } finally { dbInjecte(null); }
        H.vrai('   ↳ copie mutée (l\'échec du recompte avalé) : l\'écriture passe malgré la panne — la garde sait dire NON', !leveM);

        // 8.6 compteur ABSENT : les écritures ferment (503), l'incrément conditionnel ne le crée jamais, seul le recompte le crée
        await svc.recompter(cfg); await raw(CPT).deleteMany({}); const av86 = await raw(NOM).countDocuments({}); const Q = new ObjectId();
        let leve86 = false; try { await svc.cocher({ cfg, compteId: Q, slug: 'S-Absent', cle: '1|1', possedee: true }); } catch (e) { leve86 = true; }
        const etat86 = [leve86, (await raw(NOM).countDocuments({})) - av86, await raw(CPT).countDocuments({})];
        await svc.recompter(cfg); const ok86 = await svc.cocher({ cfg, compteId: Q, slug: 'S-Absent', cle: '1|1', possedee: true });
        H.v('8.6 compteur ABSENT : les écritures ferment (rien d\'écrit, le compteur n\'est PAS recréé par l\'incrément) jusqu\'au recompte, qui le recrée', [...etat86, ok86.possedees], [true, 0, 0, 1]);

        // 8.7 le compteur ne passe jamais sous 0
        await raw(CPT).updateOne({ cle: CLE_CPT }, { $set: { n: 0 } });
        await svc.cocher({ cfg, compteId: Q, slug: 'S-Absent', cle: '1|1', possedee: false });
        H.v('8.7 le compteur ne passe jamais sous 0 (plancher de `rendre`)', (await compteur()) >= 0, true);
        const mutPlancher = charger('service.js', [['{ $max: [0, { $subtract: [\'$n\', k] }] }', '{ $subtract: [\'$n\', k] }']]);
        await svc.recompter(cfg); await svc.cocher({ cfg, compteId: Q, slug: 'S-Plancher', cle: '1|1', possedee: true });
        await raw(CPT).updateOne({ cle: CLE_CPT }, { $set: { n: 0 } });
        await mutPlancher.cocher({ cfg, compteId: Q, slug: 'S-Plancher', cle: '1|1', possedee: false });
        H.vrai('   ↳ copie mutée (le plancher retiré) : le compteur passe sous 0 — la garde sait dire NON', (await compteur()) < 0);

        // 8.8 la suppression d'un compte rend ses octets (hors registre : il est partagé et ne se rend jamais)
        catalogue({ 'S-Del': ['1|1', '2|1'] }); await svc.recompter(cfg);
        const X = new ObjectId(); const bX = await compteur();
        await svc.cocher({ cfg, compteId: X, slug: 'S-Del', cle: '1|1', possedee: true, quantite: 4 }); await svc.cocher({ cfg, compteId: X, slug: 'S-Del', cle: '2|1', possedee: true });
        await svc.cocher({ cfg, compteId: X, slug: 'S-Del2', cle: '9|9', possedee: true, quantite: 2 }); await svc.cocher({ cfg, compteId: X, slug: 'S-Del2', cle: '8|8', possedee: true });
        const pris = (await compteur()) - bX; const reg = await registreDe('S-Del');
        const regCout = C.registreDocument('S-Del') + reg.cles.reduce((n, k) => n + C.registreEntree(k), 0);
        await svc.supprimerDuCompte(X, cfg);
        H.v('8.8 suppression de compte : le compteur retrouve sa valeur d\'avant, au registre près (partagé, jamais rendu)', [(await compteur()) - bX === regCout, pris > regCout, (await docsDe(X)).length], [true, true, 0]);
        const mutSup = charger('service.js', [['rendu += C.coutDuDocument(d);', 'rendu += 0;']]);
        const Y = new ObjectId(); await svc.cocher({ cfg, compteId: Y, slug: 'S-Del3', cle: '9|9', possedee: true }); const bY = await compteur();
        await mutSup.supprimerDuCompte(Y, cfg);
        H.vrai('   ↳ copie mutée (la suppression ne rend rien) : le compteur reste haut — la garde sait dire NON', (await compteur()) === bY);

        // 8.9 le compteur = le MODÈLE de ce qui est stocké (aucune dérive, scénario sans concurrence) : documents + registre
        catalogue({ 'S-Mod': ['1|1', '2|1', '3|1', '4|1'] }); await svc.recompter(cfg);
        const Z = new ObjectId(); const bZ = await compteur();
        const regAvant = (await registreDe('S-Mod')) ? 1 : 0; void regAvant;
        for (const [k, q] of [['1|1', 1], ['2|1', 3], ['777|7', 1], ['778|7', 5]]) await svc.cocher({ cfg, compteId: Z, slug: 'S-Mod', cle: k, possedee: true, quantite: q });
        await svc.cocher({ cfg, compteId: Z, slug: 'S-Mod', cle: '2|1', possedee: true, quantite: 1 });   // la quantité retombe
        await svc.cocher({ cfg, compteId: Z, slug: 'S-Mod', cle: '778|7', possedee: false });
        const docsZ = await docsDe(Z), regZ = await registreDe('S-Mod');
        const modele = docsZ.reduce((n, d) => n + C.coutDuDocument(d), 0) + C.registreDocument('S-Mod') + regZ.cles.reduce((n, k) => n + C.registreEntree(k), 0);
        H.v('8.9 le compteur égale le MODÈLE de ce qui est stocké (documents + registre) — aucune dérive, ni dans un sens ni dans l\'autre', (await compteur()) - bZ, modele);
        const mutSurplus = charger('service.js', [['if (delta > 0) await rendre(delta);', '']]);
        const W = new ObjectId(); catalogue({ 'S-Mod': ['1|1', '2|1', '3|1', '4|1'] }); const bW = await compteur();
        await Promise.all([mutSurplus.cocher({ cfg, compteId: W, slug: 'S-Mod', cle: '3|1', possedee: true }), mutSurplus.cocher({ cfg, compteId: W, slug: 'S-Mod', cle: '3|1', possedee: true })]);
        const dW = await docsDe(W);
        H.vrai('   ↳ copie mutée (le surplus d\'une écriture qui n\'a rien ajouté n\'est pas rendu) : la même clé posée deux fois en même temps coûte deux fois — la garde sait dire NON', (await compteur()) - bW > dW.reduce((n, d) => n + C.coutDuDocument(d), 0));
        const W3 = new ObjectId(); const bW3 = await compteur();      // '1|1' est déjà au registre : le coût d'un compte neuf est exactement celui de son document
        await Promise.all([svc.cocher({ cfg, compteId: W3, slug: 'S-Mod', cle: '1|1', possedee: true }), svc.cocher({ cfg, compteId: W3, slug: 'S-Mod', cle: '1|1', possedee: true })]);
        H.v('   la même clé posée deux fois en même temps (set neuf) ne coûte qu\'une fois : le perdant de la création rend son surplus', (await compteur()) - bW3, (await docsDe(W3)).reduce((n, d) => n + C.coutDuDocument(d), 0));
    }

    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌ banc en échec :', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
