// node test-corriger-numeros-sea2.js — corriger-numeros-sea2.js sur une FAUSSE BASE en memoire (aucun reseau, aucune vraie base).
// Monde = l'etat reel releve le 2026-10-13 : Pawmi 342068 / Gastly 339431, leurs lignes metacarte+setlist aux n° 17 et 18, la liste TPC M-P id.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTEE de l'outil (le rouge se voit en cassant le code).
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { executer, ecartsApres, LISTE } = require(path.join(DIR, 'corriger-numeros-sea2.js'));
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

function fakeDb(init, opts = {}) {
    const cols = new Map(Object.entries(init).map(([n, docs]) => [n, new Map(docs.map(d => [d._id, structuredClone(d)]))]));
    const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const elemOk = (e, cond) => Object.entries(cond).every(([k, v]) => egal(e?.[k], v));
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => {
        if (k === '_id' && v && v.$in) return v.$in.includes(d._id);
        if (v && typeof v === 'object' && v.$elemMatch) return (d[k] || []).some(e => elemOk(e, v.$elemMatch));
        if (v && typeof v === 'object' && v.$not && v.$not.$elemMatch) return !(d[k] || []).some(e => elemOk(e, v.$not.$elemMatch));
        return egal(d[k], v);
    });
    const col = nom => { const m = cols.get(nom); return {
        find: f => ({ toArray: async () => [...m.values()].filter(d => correspond(d, f || {})).map(d => structuredClone(d)) }),
        async updateOne(f, u, o = {}) {
            const d = [...m.values()].find(x => correspond(x, f)); if (!d) return { matchedCount: 0, modifiedCount: 0 };
            if (opts.perdre && opts.perdre(nom, u)) return { matchedCount: 1, modifiedCount: 1 };      // une ecriture qui ne fait RIEN sans erreur
            for (const k of Object.keys(u.$unset || {})) delete d[k];
            for (const [k, v] of Object.entries(u.$set || {})) {
                const mm = /^(\w+)\.\$\[(\w+)\]\.(\w+)$/.exec(k);
                if (mm) { const af = (o.arrayFilters || []).map(x => Object.fromEntries(Object.entries(x).map(([a, b]) => [a.replace(`${mm[2]}.`, ''), b]))); for (const e of d[mm[1]]) if (af.every(c => elemOk(e, c))) e[mm[3]] = v; }
                else d[k] = v;
            }
            for (const [k, cond] of Object.entries(u.$pull || {})) d[k] = (d[k] || []).filter(e => !elemOk(e, cond));
            for (const [k, v] of Object.entries(u.$push || {})) (d[k] = d[k] || []).push(structuredClone(v));
            return { matchedCount: 1, modifiedCount: 1 };
        } }; };
    return { collection: col, brut: nom => [...cols.get(nom).values()].map(d => structuredClone(d)) };
}

const IMP = (numero, tirage = 'id') => ({ tirage, expansion: 'M-P Promotional cards', numero, total: null, deck: null, rarete: null, source: 'setlist' });
const IMP_INTL = { tirage: 'intl', expansion: 'Phantasmal Flames', numero: '032', total: '094', rarete: 'Common', illustrateur: 'X' };
function monde({ avecTpc35 = false, listeIncomplete = false, ligneDejaCorrigee = false } = {}) {
    const pawmi = { _id: 342068, nomEn: 'Pawmi', categorie: 'pokemon', ndex: 921, pv: 60, impressions: [IMP_INTL, IMP('017', 'th'), IMP('17')], liens: { idProduct: [850539, 860034] }, sets: ['M-P-Thai-Promos', 'M-P-Indonesian-Promos'] };
    const gastly = { _id: 339431, nomEn: 'Gastly', categorie: 'pokemon', ndex: 92, pv: 70, impressions: [IMP_INTL, IMP('018'), IMP('018', 'th')], liens: { idProduct: [860035, 859982] }, sets: ['M-P-Thai-Promos', 'M-P-Indonesian-Promos'] };
    const ligne = (c, p, slug, n) => ({ _id: `${c}|${p}`, carteId: c, idProduct: p, slugSet: 'M-P-Indonesian-Promos', slug, numeroFiche: n, preuve: 'metacarte+setlist', idExpansion: 6393 });
    const autre = { _id: '1|2', carteId: 1, idProduct: 2, slugSet: 'Autre', numeroFiche: '5', preuve: 'set+numero' };
    const fiche = (id, numero, nom, dex, pv) => ({ _id: `tpc-asie/id/${id}`, site: 'tpc-asie', langue: 'id', idFiche: id, url: `https://x/${id}`, fiche: { nom, numero, denominateur: 'M-P', pv, dex, symbole: 'S' } });
    const fiches = [fiche(16630, '017', 'Squawkabilly ex', 931, 160), fiche(16631, '018', 'Sekop Pelubang', null, null), fiche(16632, '019', 'Wadah Daratan', null, null), fiche(16650, '034', 'Basic Energy', null, null)];
    if (avecTpc35) fiches.push(fiche(16651, '035', 'Pawmi', 921, 60), fiche(16652, '036', 'Gastly', 92, 70));
    return fakeDb({
        cartes_produits: [ligne(342068, 860034, 'Pawmi-M-PID035', ligneDejaCorrigee ? null : '17'), ligne(339431, 860035, 'Gastly-M-PID036', '18'), autre],
        cartes: [pawmi, gastly, { _id: 5, nomEn: 'Autre', impressions: [IMP('17')], liens: { idProduct: [] }, sets: [] }],
        collecte_images_etat: [{ _id: 'tpc-asie/M-P-Indonesian-Promos', liste: { code: 'M-P', langue: 'id', ids: fiches.map(f => f.idFiche).concat(listeIncomplete ? [99999] : []), total: fiches.length + (listeIncomplete ? 1 : 0), complete: true, luLe: new Date('2026-10-08') } }],
        tpc_fiches: fiches
    });
}
async function lancer(db, argv) {
    const sorties = [], erreurs = [];
    const code = await executer({ argv, log: s => sorties.push(s), err: s => erreurs.push(s), ouvrir: async () => ({ db, fermer: async () => { } }) }).catch(e => { erreurs.push(`EXCEPTION ${e.message}`); return 99; });
    return { code, sorties: sorties.join('\n'), erreurs: erreurs.join('\n') };
}
const etat = db => JSON.stringify([db.brut('cartes_produits'), db.brut('cartes')]);
const carte = (db, id) => db.brut('cartes').find(c => c._id === id), ligne = (db, id) => db.brut('cartes_produits').find(l => l.idProduct === id);
const impsId = c => c.impressions.filter(i => i.tirage === 'id').map(i => i.numero);

(async () => {
    // ── (b) : le cache n'a ni 035 ni 036 (l'etat reel) ──
    let db = monde(); const avant = etat(db);
    let r = await lancer(db, []);
    verifier('simulation (b) : exit 0, rien d\'ecrit, la preuve est imprimee (liste complete, n° 35/36 : AUCUNE fiche, 17 = Squawkabilly), l\'annonce du lot', [r.code, etat(db) === avant, /liste complète 4\/4/.test(r.sorties), /n° 35 : AUCUNE fiche/.test(r.sorties), /n° 17 : « Squawkabilly ex »/.test(r.sorties), /b\) RETIRER/.test(r.sorties), /\{"impressions imp:id\|M-P Promotional cards":1\}/.test(r.sorties)], [0, true, true, true, true, true, true]);
    verifier('simulation : la 018 de Gastly est nommee (anterieure a SEA-2, jamais touchee)', /AVANT SEA-2/.test(r.sorties), true);
    r = await lancer(db, ['--ecrire']);
    verifier('ecriture (b) : exit 0, relue', [r.code, /écrit et relu/.test(r.sorties)], [0, true]);
    verifier('   (b) lignes : numeroFiche retire des deux, preuve et slug gardes', [ligne(db, 860034).numeroFiche, ligne(db, 860035).numeroFiche, ligne(db, 860034).preuve, ligne(db, 860035).slug], [undefined, undefined, 'metacarte+setlist', 'Gastly-M-PID036']);
    verifier('   (b) Pawmi : seule l\'impression id « 17 » part (th 017 et intl restent) ; Gastly : impressions inchangees, sa 018 est la', [impsId(carte(db, 342068)), carte(db, 342068).impressions.length, impsId(carte(db, 339431)), carte(db, 339431).impressions.length], [[], 2, ['018'], 3]);
    verifier('   (b) liens, sets et les autres documents inchanges', [carte(db, 342068).liens.idProduct, carte(db, 342068).sets, ligne(db, 2).numeroFiche, carte(db, 5).impressions.length], [[850539, 860034], ['M-P-Thai-Promos', 'M-P-Indonesian-Promos'], '5', 1]);
    r = await lancer(db, ['--ecrire']);
    verifier('rejeu apres ecriture : la ligne n\'est plus celle de SEA-2 -> exit 1, rien de plus d\'ecrit', [r.code, /n'est plus celle de SEA-2/.test(r.erreurs)], [1, true]);

    // ── (a) : le cache porte 035 = Pawmi et 036 = Gastly ──
    db = monde({ avecTpc35: true });
    r = await lancer(db, []);
    verifier('simulation (a) : les deux produits sont prouves par la fiche officielle, annonce vide', [r.code, /a\) CORRIGER en 35/.test(r.sorties), /a\) CORRIGER en 36/.test(r.sorties), /annonce de lot-additif : \{\}/.test(r.sorties)], [0, true, true, true]);
    r = await lancer(db, ['--ecrire']);
    verifier('ecriture (a) : exit 0 ; Pawmi 17 -> 35 (positionnel), Gastly 36 ajoute, sa 018 intacte', [r.code, ligne(db, 860034).numeroFiche, ligne(db, 860035).numeroFiche, impsId(carte(db, 342068)), impsId(carte(db, 339431)), carte(db, 342068).impressions.length], [0, '35', '36', ['35'], ['018', '36'], 3]);

    // ── gardes avant toute ecriture ──
    db = monde({ listeIncomplete: true }); const av = etat(db);
    r = await lancer(db, ['--ecrire']);
    verifier('garde : cache TPC incomplet (liste annoncee > fiches lues) -> exit 1, rien d\'ecrit, dit pourquoi', [r.code, etat(db) === av, /fiches en cache|pas complète/.test(r.erreurs)], [1, true, true]);
    db = monde({ ligneDejaCorrigee: true }); const av2 = etat(db);
    r = await lancer(db, ['--ecrire']);
    verifier('garde : une ligne qui n\'est pas celle de SEA-2 -> exit 1, rien d\'ecrit', [r.code, etat(db) === av2], [1, true]);
    r = await lancer(monde(), ['--ecrire', '--produits=1']);
    verifier('arguments : tout argument hors --ecrire est refuse (liste fermee) -> exit 2', r.code, 2);

    // ── la relecture voit une ecriture qui ne fait rien (sans erreur) ──
    db = fakeDb({}); db = monde(); const dbPerd = (() => { const w = monde(); return w; })();
    const mondePerd = monde(); const dbMute = fakeDb({ cartes_produits: mondePerd.brut('cartes_produits'), cartes: mondePerd.brut('cartes'), collecte_images_etat: mondePerd.brut('collecte_images_etat'), tpc_fiches: mondePerd.brut('tpc_fiches') }, { perdre: (nom, u) => nom === 'cartes' && !!u.$pull });
    r = await lancer(dbMute, ['--ecrire']);
    verifier('relecture : un $pull qui ne fait rien sans erreur -> exit 1, la relecture le dit', [r.code, /impression id « 17 » encore là/.test(r.sorties), /relecture ne retrouve pas/.test(r.erreurs)], [1, true, true]);

    // ── la comparaison des numeros se fait par cleNumero, pas a la lettre (« 018 » = « 18 ») ──
    const gastlyB = LISTE.find(p => p.nomEn === 'Gastly'), dB = { ...gastlyB, voie: 'b' };
    const ligneB = { preuve: 'metacarte+setlist', slug: gastlyB.slug, slugSet: 'M-P-Indonesian-Promos' };
    const cG = { impressions: [IMP_INTL, IMP('018'), IMP('018', 'th')], liens: { idProduct: [1] }, sets: ['a'] };
    verifier('relecture : l\'impression « 018 » d\'avant SEA-2 EST « 18 » (cleNumero) -> aucun ecart', ecartsApres(dB, ligneB, cG, { impressions: 3, dontSetlistId: 1, liens: [1], sets: ['a'] }), []);
    verifier('relecture : si elle disparait, l\'ecart est dit', ecartsApres(dB, ligneB, { ...cG, impressions: [IMP_INTL, IMP('018', 'th')] }, { impressions: 3, dontSetlistId: 1, liens: [1], sets: ['a'] }).length > 0, true);
    const dA = { ...LISTE[0], voie: 'a' };
    verifier('relecture (a) : numeroFiche « 035 » vaut « 35 » (cleNumero)', ecartsApres(dA, { ...ligneB, slug: LISTE[0].slug, numeroFiche: '035' }, { impressions: [IMP_INTL, IMP('35')], liens: { idProduct: [1] }, sets: ['a'] }, { impressions: 2, dontSetlistId: 1, liens: [1], sets: ['a'] }), []);

    console.log(`\n${ok} passes, ${ko} en echec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
