// node test-numero-fiche-tw.js — TAIWAN : `numeroFiche` des 45 « Traditional Chinese Products » (collecte-cartes/numero-fiche-tw.js + poser-numero-fiche-tw.js).
// Base EN MÉMOIRE, aucune requête, jamais une vraie base ni un dossier du testeur (les sauvegardes vont dans un dossier temporaire).
// Ce que le banc garde : la forme « <LISTE><numéro> » lue dans le slug (les 45 slugs RÉELS, mesurés le 2026-10-18) ; les numéros 162/163/164 communs à SV-P et S-P sont SÉPARÉS ; les 11 PKMTCH<nnn> nus
// sont signalés « liste déduite » ; le 45e (« Terapagos-Friends-SV-P ») est laissé avec sa raison ; une (liste, numéro) prise par deux cartes est laissée ; l'écriture est conditionnelle, sauvegardée,
// attendue, relue ; la restauration remet l'absence ; le diff « servi » SAIT voir une perte.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du dépôt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const N = require(path.join(DIR, 'collecte-cartes', 'numero-fiche-tw.js'));
const P = require(path.join(DIR, 'poser-numero-fiche-tw.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const essayer = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`❌ ${nom}\n   EXCEPTION ${String(e.stack).split('\n').slice(0, 3).join(' | ')}`); } };

// ── les 45 lignes RÉELLES (cartes_produits du set Traditional-Chinese-Products, lues le 2026-10-18 : [idProduct, carteId, slug]) ──
const REELLES = [
    [775957, 281253, 'Fuecoco-SV-P117'], [791311, 302117, 'Pikachu-SV-P153'], [775962, 315731, 'Terapagos-Friends-SV-P'], [802838, 302117, 'Pikachu-PKMTCHSV-P-169'], [886532, 302117, 'Pikachu-PKMTCHSV-P-243'],
    [724652, -724652, 'Rowlet-PKMTCHS-P-162'], [724658, -724658, 'Cyndaquil-PKMTCHS-P-163'], [724662, -724662, 'Oshawott-S-PS-P-164'], [748473, -748473, 'Taipeis-Pikachu-SV-P057'], [775956, -775956, 'Sprigatito-SV-P116'],
    [800103, -800103, 'Zoroark-GX-PKMTCHSV-P-154'], [800104, -800104, 'Ultra-Necrozma-GX-PKMTCHSV-P-155'], [800105, -800105, 'Rayquaza-GX-PKMTCHSV-P-156'], [800106, -800106, 'Pikachu-Zekrom-GX-PKMTCHSV-P-157'],
    [800107, -800107, 'Arceus-Dialga-Palkia-GX-PKMTCHSV-P-158'], [800108, -800108, 'Eternatus-VMAX-PKMTCHSV-P-159'], [800109, -800109, 'Mew-VMAX-PKMTCHSV-P-160'], [800110, -800110, 'Arceus-VSTAR-PKMTCHSV-P-161'],
    [800111, -800111, 'Giratina-VSTAR-PKMTCHSV-P-162'], [800112, -800112, 'Lugia-VSTAR-PKMTCHSV-P-163'], [800113, -800113, 'Miraidon-ex-PKMTCHSV-P-164'], [800114, -800114, 'Chien-Pao-ex-PKMTCHSV-P-165'],
    [800115, -800115, 'Charizard-ex-PKMTCHSV-P-166'], [800116, -800116, 'Roaring-Moon-ex-PKMTCHSV-P-167'], [800117, -800117, 'Iron-Valiant-ex-PKMTCHSV-P-168'], [802839, -802839, 'Mimikyu-PKMTCHSV-P-170'],
    [802840, -802840, 'Eevee-PKMTCHSV-P-171'], [884749, -884749, 'Snorlax-PKMTCHS-P-145'], [884750, -884750, 'Charizard-ex-PKMTCHSV-P-077'], [886521, -886521, 'Rowlet-PKMTCH231'], [886522, -886522, 'Charmander-PKMTCH232'],
    [886523, -886523, 'Squirtle-PKMTCH233'], [886524, -886524, 'Wartortle-PKMTCH234'], [886525, -886525, 'Blastoise-ex-PKMTCH235'], [886526, -886526, 'Pikachu-PKMTCH236'], [886527, -886527, 'Wattrel-PKMTCH237'],
    [886528, -886528, 'Slowpoke-PKMTCH238'], [886529, -886529, 'Flamigo-PKMTCH239'], [886530, -886530, 'Togedemaru-PKMTCH240'], [886531, -886531, 'Charmander-PKMTCH242'], [886533, -886533, 'Girafarig-PKMTCHSV-P-244'],
    [886534, -886534, 'Dratini-PKMTCHSV-P-245'], [886535, -886535, 'Eevee-PKMTCHSV-P-246'], [888691, -888691, 'Pidgeot-ex-PKMTCHSV-P-188'], [888692, -888692, 'Zapdos-ex-PKMTCHSV-P-055']
];
const ligne = ([idProduct, carteId, slug], extra = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, idExpansion: 5960, slug, slugSet: N_SLUG, numeroFiche: null, preuve: 'x', ...extra });
const N_SLUG = 'Traditional-Chinese-Products';

function fausseBase() {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => Array.isArray(x) ? x.flatMap(e => e?.[p]) : x?.[p], o);
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => {
        const x = lire(d, k);
        if (v === null) return x === null || x === undefined;
        if (v && typeof v === 'object' && !Array.isArray(v)) { if ('$in' in v) return (Array.isArray(x) ? x : [x]).some(y => v.$in.includes(y)); return false; }
        return Array.isArray(x) ? x.includes(v) : x === v;
    });
    const tous = (n, f) => [...col(n).values()].filter(d => accepte(d, f));
    const writes = [];
    const collection = n => ({
        find(f) { const r = { toArray: async () => structuredClone(tous(n, f)), project() { return r; } }; return r; },
        async findOne(f) { return structuredClone(tous(n, f)[0] ?? null); },
        async updateOne(f, u) {
            const d = tous(n, f)[0]; if (!d) return { matchedCount: 0, modifiedCount: 0 };
            const avant = JSON.stringify(d);
            for (const [k, v] of Object.entries(u.$set || {})) d[k] = structuredClone(v);
            for (const k of Object.keys(u.$unset || {})) delete d[k];
            writes.push({ n, f, u });
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) === avant ? 0 : 1 };
        },
        async updateMany() { throw new Error('updateMany : interdit'); }, async insertOne() { throw new Error('insertOne : interdit'); },
        async deleteOne() { throw new Error('deleteOne : interdit'); }, async deleteMany() { throw new Error('deleteMany : interdit'); }, async replaceOne() { throw new Error('replaceOne : interdit'); }
    });
    return { db: { collection }, col, writes, instantane: () => JSON.stringify([...cols].map(([n, m]) => [n, [...m.values()]])) };
}
function monde(lignes = REELLES) {
    const B = fausseBase();
    B.col('sets').set(N_SLUG, { _id: N_SLUG, code: 'PKMTCH', tirage: 'zh-hant', idExpansion: [5960], bulba: { expansion: 'Traditional Chinese Products' } });
    for (const t of lignes) { const l = ligne(t); B.col('cartes_produits').set(l._id, l); if (!B.col('cartes').has(l.carteId)) B.col('cartes').set(l.carteId, { _id: l.carteId, nomEn: `Carte ${l.carteId}`, sets: [N_SLUG], impressions: [{ tirage: 'zh-hant', expansion: 'SV-P Promotional cards', numero: null }], images: [] }); }
    return B;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'twnum-'));
// la règle du site, ici un double : une fiche par document, tous ses produits dessus ; un double « mutant » réagit au numeroFiche posé
const regleSimple = { fichesDuDocument: imp => imp.length ? imp.map((i, rang) => ({ rang, numero: i.numero, rarete: null })) : [{ rang: 0, numero: null, rarete: null }], setParImpression: () => false, produitsDeLaFiche: prods => prods };
const regleMutante = { ...regleSimple, produitsDeLaFiche: prods => prods.filter(p => !p.numeroFiche) };

(async () => {
    await essayer('slug', () => {
        const att = {
            'Fuecoco-SV-P117': ['SV-P', '117', 'slug'], 'Pikachu-PKMTCHSV-P-169': ['SV-P', '169', 'slug'], 'Rowlet-PKMTCHS-P-162': ['S-P', '162', 'slug'], 'Oshawott-S-PS-P-164': ['S-P', '164', 'slug'],
            'Taipeis-Pikachu-SV-P057': ['SV-P', '057', 'slug'], 'Snorlax-PKMTCHS-P-145': ['S-P', '145', 'slug'], 'Rowlet-PKMTCH231': ['SV-P', '231', 'slug+liste-deduite'], 'Charmander-PKMTCH242': ['SV-P', '242', 'slug+liste-deduite']
        };
        for (const [s, [liste, numero, voie]] of Object.entries(att)) verifier(`slug « ${s} » → ${liste} ${numero} (${voie})`, N.lireSlug(s), { liste, numero, voie });
        verifier('slug sans chiffre en fin (le 45e) → laissé', N.lireSlug('Terapagos-Friends-SV-P'), { motif: 'slug-sans-numero' });
        verifier('slug vide, absent, autre forme, numéro à 4 chiffres → laissé (écrit par ce qu\'il autorise)', [N.lireSlug(''), N.lireSlug(null), N.lireSlug('Pikachu-M-PCT032'), N.lireSlug('Pikachu-SV-P1234')].map(x => x.motif ?? 'lu'), ['slug-sans-numero', 'slug-sans-numero', 'slug-sans-numero', 'slug-sans-numero']);
    });
    await essayer('plan reel', () => {
        const p = N.planDesLignes(REELLES.map(t => ligne(t)));
        verifier('les 45 lignes réelles : 33 à numéroter (29 SV-P, 4 S-P), 12 laissées (11 listes non lues + le slug sans numéro)', [p.comptes.pose, p.comptes.parListe, p.comptes.laissees, p.comptes.parMotif], [33, { 'SV-P': 29, 'S-P': 4 }, 12, { 'slug-sans-numero': 1, 'liste-non-lue-dans-le-slug': 11 }]);
        verifier('par voie : les 33 sont lus dans le slug, aucune liste déduite n\'est écrite', p.comptes.parVoie, { slug: 33 });
        verifier('le 45e (775962) et les 11 PKMTCH nus sont laissés avec leur raison', [p.laissees.filter(l => l.motif === 'slug-sans-numero').map(l => l.idProduct), p.laissees.filter(l => l.motif === 'liste-non-lue-dans-le-slug').map(l => l.idProduct).sort()], [[775962], [886521, 886522, 886523, 886524, 886525, 886526, 886527, 886528, 886529, 886530, 886531]]);
        verifier('aucun numeroFiche posé ne vient d\'une liste déduite', p.pose.some(x => /PKMTCH\d{3}$/.test(x.slug)), false);
        const par = id => p.pose.find(x => x.idProduct === id)?.numeroFiche;
        verifier('162, 163, 164 : SV-P et S-P sont SÉPARÉS (six produits, six numéros)', [800111, 800112, 800113, 724652, 724658, 724662].map(par), ['SV-P162', 'SV-P163', 'SV-P164', 'S-P162', 'S-P163', 'S-P164']);
        verifier('les numéros posés sont tous distincts sauf pour une même carte (33 numéros pour 33 lignes)', new Set(p.pose.map(x => x.numeroFiche)).size, 33);
        verifier('la preuve nomme le slug et la liste lue', /« Fuecoco-SV-P117 » : liste SV-P, numéro 117/.test(p.pose.find(x => x.idProduct === 775957).preuve), true);
        verifier('trois produits d\'une MÊME carte (Pikachu 302117) : trois numéros, aucun conflit', p.pose.filter(x => x.carteId === 302117).map(x => x.numeroFiche).sort(), ['SV-P153', 'SV-P169', 'SV-P243']);
    });
    await essayer('plan garde', () => {
        const a = ligne([1, 10, 'Aaa-SV-P100']), b = ligne([2, 11, 'Bbb-PKMTCHSV-P-100']), c = ligne([3, 12, 'Ccc-SV-P101']), d = ligne([4, 12, 'Ccc-V2-SV-P101']), e = ligne([5, 13, 'Eee-SV-P102'], { numeroFiche: 'SV-P102' }), f = ligne([6, 14, 'Fff-SV-P103'], { numeroFiche: '103' });
        const p = N.planDesLignes([a, b, c, d, e, f]);
        verifier('une (liste, numéro) réclamée par deux CARTES : les deux sont laissées ; deux produits d\'une même carte au même numéro : posés', [p.pose.map(x => x.idProduct).sort(), p.laissees.map(l => `${l.idProduct}:${l.motif}`).sort()], [[3, 4], ['1:numero-pris-par-une-autre-carte', '2:numero-pris-par-une-autre-carte', '5:deja-numerotee', '6:deja-numerotee']]);
        verifier('un numéro écrit sous une autre forme (« 103 », « 0100 ») est comparé sans zéros ni casse : « sv-p0100 » = « SV-P100 »', [N.comparable('sv-p0100'), N.comparable('SV-P100')], ['SV-P100', 'SV-P100']);
    });
    await essayer('ecriture', async () => {
        const B = monde(); const f = path.join(tmp(), 'avant.json');
        const avant = JSON.parse(B.instantane());
        const plan = N.planDesLignes((await B.db.collection('cartes_produits').find({ slugSet: N_SLUG }).toArray()));
        const sim = await P.appliquer(B.db, plan, { ecrire: false });
        verifier('à blanc : rien n\'est écrit, 33 annoncées', [B.writes.length, sim.lignes], [0, 33]);
        let m1 = null; try { await P.appliquer(B.db, plan, { ecrire: true, attendu: 45, sauvegarde: f }); } catch (e) { m1 = String(e.message); }
        verifier('--attendu=45 alors que 33 sont prouvées : refuse AVANT d\'écrire (rien d\'écrit, pas de sauvegarde)', [/45/.test(m1 || ''), B.writes.length, fs.existsSync(f)], [true, 0, false]);
        let m2 = null; try { await P.appliquer(B.db, plan, { ecrire: true, sauvegarde: f }); } catch (e) { m2 = String(e.message); }
        let m3 = null; try { await P.appliquer(B.db, plan, { ecrire: true, attendu: 33 }); } catch (e) { m3 = String(e.message); }
        verifier('--ecrire sans --attendu, ou sans sauvegarde : refuse (et dit laquelle manque)', [/attendu/.test(m2 || ''), /sauvegarde/.test(m3 || ''), B.writes.length], [true, true, 0]);
        const r = await P.appliquer(B.db, plan, { ecrire: true, attendu: 33, sauvegarde: f });
        verifier('écriture : 33 lignes, relu 33 posées / 0 nulles', [r.lignes, r.relu], [33, { poses: 33, nuls: 0 }]);
        const l = id => B.col('cartes_produits').get(id);
        verifier('écriture : numeroFiche et preuve posés ; le 45e et tous les autres champs inchangés', [l('-800111|800111').numeroFiche, typeof l('-800111|800111').numeroFichePreuve, l('315731|775962').numeroFiche, l('315731|775962').numeroFichePreuve, l('-800111|800111').slug, l('-800111|800111').preuve], ['SV-P162', 'string', null, undefined, 'Giratina-VSTAR-PKMTCHSV-P-162', 'x']);
        verifier('écriture : seul cartes_produits est écrit, une fois par ligne, sous un filtre conditionnel (numeroFiche null)', [[...new Set(B.writes.map(w => w.n))], B.writes.length, B.writes.every(w => w.f.numeroFiche === null && w.f.slugSet === N_SLUG)], [['cartes_produits'], 33, true]);
        const sauve = JSON.parse(fs.readFileSync(f, 'utf8'));
        verifier('sauvegarde : 33 lignes, valeur d\'avant null', [sauve.lignes.length, sauve.lignes.every(x => x.numeroFiche === null)], [33, true]);
        const nw = B.writes.length;
        const plan2 = N.planDesLignes(await B.db.collection('cartes_produits').find({ slugSet: N_SLUG }).toArray());
        verifier('idempotence : rejoué, le plan ne voit plus rien à poser (33 déjà numérotées)', [plan2.pose.length, plan2.comptes.parMotif['deja-numerotee'], B.writes.length - nw], [0, 33, 0]);
        let m4 = null; try { await P.restaurer(B.db, f, { ecrire: true, attendu: 43 }); } catch (e) { m4 = String(e.message); }
        verifier('restauration : --attendu faux refuse avant d\'écrire', [/43/.test(m4 || ''), B.writes.length - nw], [true, 0]);
        const rr = await P.restaurer(B.db, f, { ecrire: true, attendu: 33 });
        verifier('restauration : 33 lignes remises à null, preuve retirée, relu', [rr.lignes, rr.relu], [33, { nuls: 33 }]);
        const trie = x => Array.isArray(x) ? x.map(trie) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, trie(x[k])])) : x;
        verifier('restauration : le monde est celui d\'avant (mêmes champs, mêmes valeurs)', JSON.stringify(trie(JSON.parse(B.instantane()))) === JSON.stringify(trie(avant)), true);
        let m5 = null; try { await P.restaurer(B.db, f, { ecrire: true, attendu: 33 }); } catch (e) { m5 = String(e.message); }
        verifier('restauration rejouée : refuse (déjà restaurée)', /déjà restaurée/.test(m5 || ''), true);
    });
    await essayer('relu', async () => {
        const B = monde(); const f = path.join(tmp(), 'u.json');
        // une écriture qui « réussit » sans rien changer : le relu doit le voir
        const vraie = B.db.collection;
        const db = { collection: n => { const c = vraie(n); return n === 'cartes_produits' ? { ...c, updateOne: async (...a) => { await c.updateOne(a[0], { $set: {} }); return { matchedCount: 1, modifiedCount: 1 }; } } : c; } };
        const plan = N.planDesLignes(await db.collection('cartes_produits').find({ slugSet: N_SLUG }).toArray());
        const r = await P.appliquer(db, plan, { ecrire: true, attendu: 33, sauvegarde: f });
        verifier('le compte réel est RELU après l\'écriture : 33 lignes qui n\'ont rien reçu sont vues', r.relu, { poses: 0, nuls: 33 });
    });
    await essayer('restauration gardée', async () => {
        const B = monde(); const f = path.join(tmp(), 'r.json');
        const plan = N.planDesLignes(await B.db.collection('cartes_produits').find({ slugSet: N_SLUG }).toArray());
        await P.appliquer(B.db, plan, { ecrire: true, attendu: 33, sauvegarde: f });
        B.col('cartes_produits').get('-800111|800111').numeroFiche = 'SV-P999';   // quelqu'un a reposé une autre valeur depuis
        let m = null; try { await P.restaurer(B.db, f, { ecrire: true, attendu: 33 }); } catch (e) { m = String(e.message); }
        verifier('--restaurer n\'écrase pas une valeur reposée entre-temps (condition sur la valeur posée) : elle s\'arrête', [/introuvable ou déjà restaurée/.test(m || ''), B.col('cartes_produits').get('-800111|800111').numeroFiche], [true, 'SV-P999']);
    });
    await essayer('conditionnelle', async () => {
        const B = monde(); const f = path.join(tmp(), 'c.json');
        const plan = N.planDesLignes(await B.db.collection('cartes_produits').find({ slugSet: N_SLUG }).toArray());
        B.col('cartes_produits').get('-800111|800111').numeroFiche = 'SV-P999';   // quelqu'un l'a numérotée entre le plan et l'écriture
        let m = null; try { await P.appliquer(B.db, plan, { ecrire: true, attendu: 33, sauvegarde: f }); } catch (e) { m = String(e.message); }
        verifier('une ligne déjà numérotée entre le plan et l\'écriture : l\'update conditionnel ne la touche pas et le lot s\'arrête', [/déjà numérotée/.test(m || ''), B.col('cartes_produits').get('-800111|800111').numeroFiche], [true, 'SV-P999']);
    });
    await essayer('executeur', async () => {
        const B = monde(); const sortie = []; const f = path.join(tmp(), 'e.json');
        const base = { cartesDb: B.db, regle: regleSimple, log: s => sortie.push(s), attenduLignes: 45 };
        const r = await P.executer({ ...base });
        const txt = sortie.join('\n');
        verifier('essai à blanc de bout en bout : 33 à numéroter, le 45e et sa raison, listes déduites, garde, servi, rien d\'écrit', [B.writes.length, /33 à numéroter/.test(txt), /775962 « Terapagos-Friends-SV-P » : slug-sans-numero/.test(txt), /liste NON LUE dans le slug[^\n]*: 11/.test(txt) && (txt.match(/» : liste-non-lue-dans-le-slug/g) || []).length === 11, /aucune annonce nécessaire/.test(txt), /perdus 0 · gagnés 0 · fiche changée 0/.test(txt), /essai à blanc/.test(txt)], [0, true, true, true, true, true, true]);
        verifier('le diff « servi » : 33/33 avant, 33/33 après', [r.servi.servisAvant, r.servi.servisApres, r.servi.touches], [33, 33, 33]);
        let msg = null; try { await P.executer({ ...base, attenduLignes: 46 }); } catch (e) { msg = String(e.message); }
        verifier('un set qui ne compte pas 45 lignes arrête tout (la mesure n\'est plus celle du 18/10)', [/46/.test(msg || ''), B.writes.length], [true, 0]);
        let msg2 = null; try { await P.executer({ ...base, regle: regleMutante }); } catch (e) { msg2 = String(e.message); }
        verifier('un diff « servi » qui voit une perte arrête l\'essai : une règle réagissant au numeroFiche → 33 produits perdus', [/33 produit\(s\) perdu\(s\)/.test(msg2 || ''), B.writes.length], [true, 0]);
        sortie.length = 0;
        await P.executer({ ...base, ecrire: true, attendu: 33, sauvegarde: f });
        verifier('écriture de bout en bout : relue 33 posées / 0 nulles', /relu : 33 portent leur numeroFiche, 0 sont encore nulles/.test(sortie.join('\n')), true);
    });
    await essayer('script', () => {
        const { spawnSync } = require('child_process');
        const lancer = (...args) => spawnSync(process.execPath, [path.join(DIR, 'poser-numero-fiche-tw.js'), ...args], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: '', MONGODB_CARTES_URI: '' } });
        verifier('ligne de commande : argument inconnu → code 2 avant toute connexion', [lancer('--bidon').status, lancer('--ecrire=1').status], [2, 2]);
        verifier('ligne de commande : --ecrire sans --attendu → 2 ; sans --sauvegarde → 2', [lancer('--ecrire').status, lancer('--ecrire', '--attendu=33').status], [2, 2]);
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });
