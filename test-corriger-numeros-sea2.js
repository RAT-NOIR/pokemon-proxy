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
function monde({ avecTpc35 = false, listeIncomplete = false, ligneDejaCorrigee = false, numeroPawmi = '17', impPawmi = 'seule17', autresDix7 = false, numeroGastly = '18', impGastly36 = false } = {}) {
    // autresDix7 : la carte de Pawmi porte AUSSI d'autres impressions « 17 » (th, intl, id d'une autre source ou expansion) que le $pull ne doit pas toucher
    const autres = autresDix7 ? [IMP('17', 'th'), { ...IMP_INTL, numero: '17' }, { ...IMP('17'), source: 'tcgdex' }, { ...IMP('17'), expansion: 'Autre expansion' }] : [];
    // impPawmi : 'seule17' (état SEA-2) · 'aucune' (retirée) · '35' (corrigée par la voie a)
    const impsId = impPawmi === 'seule17' ? [IMP('17')] : impPawmi === '35' ? [IMP('35')] : [];
    const pawmi = { _id: 342068, nomEn: 'Pawmi', categorie: 'pokemon', ndex: 921, pv: 60, impressions: [IMP_INTL, IMP('017', 'th'), ...autres, ...impsId], liens: { idProduct: [850539, 860034] }, sets: ['M-P-Thai-Promos', 'M-P-Indonesian-Promos'] };
    const gastly = { _id: 339431, nomEn: 'Gastly', categorie: 'pokemon', ndex: 92, pv: 70, impressions: [IMP_INTL, IMP('018'), IMP('018', 'th'), ...(impGastly36 ? [IMP('36')] : [])], liens: { idProduct: [860035, 859982] }, sets: ['M-P-Thai-Promos', 'M-P-Indonesian-Promos'] };
    const ligne = (c, p, slug, n) => ({ _id: `${c}|${p}`, carteId: c, idProduct: p, slugSet: 'M-P-Indonesian-Promos', slug, numeroFiche: n, preuve: 'metacarte+setlist', idExpansion: 6393 });
    const autre = { _id: '1|2', carteId: 1, idProduct: 2, slugSet: 'Autre', numeroFiche: '5', preuve: 'set+numero' };
    const fiche = (id, numero, nom, dex, pv) => ({ _id: `tpc-asie/id/${id}`, site: 'tpc-asie', langue: 'id', idFiche: id, url: `https://x/${id}`, fiche: { nom, numero, denominateur: 'M-P', pv, dex, symbole: 'S' } });
    const fiches = [fiche(16630, '017', 'Squawkabilly ex', 931, 160), fiche(16631, '018', 'Sekop Pelubang', null, null), fiche(16632, '019', 'Wadah Daratan', null, null), fiche(16650, '034', 'Basic Energy', null, null)];
    if (avecTpc35) fiches.push(fiche(16651, '035', 'Pawmi', 921, 60), fiche(16652, '036', 'Gastly', 92, 70));
    return fakeDb({
        cartes_produits: [ligne(342068, 860034, 'Pawmi-M-PID035', ligneDejaCorrigee ? null : numeroPawmi), ligne(339431, 860035, 'Gastly-M-PID036', numeroGastly), autre],
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
    verifier('rejeu apres ecriture complete : rien a faire -> exit 1, rien de plus d\'ecrit', [r.code, /rien à faire/.test(r.erreurs)], [1, true]);

    // ── tour 1 (important) : le $pull ne retire que id / M-P Promotional cards / 17 / setlist, pas toute impression « 17 » ──
    db = monde({ autresDix7: true });
    r = await lancer(db, ['--ecrire']);
    verifier('$pull ciblé : la carte porte aussi th 17, intl 17, id 17 d\'une autre source et d\'une autre expansion -> seule id/M-P/17/setlist part', [r.code, carte(db, 342068).impressions.map(i => `${i.tirage}|${i.expansion}|${i.numero}|${i.source ?? ''}`)],
        [0, ['intl|Phantasmal Flames|032|', 'th|M-P Promotional cards|017|setlist', 'th|M-P Promotional cards|17|setlist', 'intl|Phantasmal Flames|17|', 'id|M-P Promotional cards|17|tcgdex', 'id|Autre expansion|17|setlist']]);

    // ── tour 1 (mineur) : un état À MOITIÉ corrigé est un état de départ valide ; le seul geste manquant s'exécute ──
    db = monde({ ligneDejaCorrigee: true });
    r = await lancer(db, ['--ecrire']);
    verifier('moitié 1 (b) : numeroFiche de Pawmi déjà retiré, impression encore là -> exit 0, l\'impression part seule, le dit', [r.code, /ÉTAT À MOITIÉ CORRIGÉ/.test(r.sorties), impsId(carte(db, 342068)), ligne(db, 860034).numeroFiche, ligne(db, 860035).numeroFiche, /écrit et relu/.test(r.sorties)], [0, true, [], null, undefined, true]);
    db = monde({ impPawmi: 'aucune' });
    r = await lancer(db, ['--ecrire']);
    verifier('moitié 2 (b) : impression déjà retirée, numeroFiche encore là -> exit 0, seul le numeroFiche part ; annonce vide (aucune baisse restante)', [r.code, /annonce de lot-additif : \{\}/.test(r.sorties), ligne(db, 860034).numeroFiche, carte(db, 342068).impressions.length, /écrit et relu/.test(r.sorties)], [0, true, undefined, 2, true]);
    db = monde({ ligneDejaCorrigee: true, impPawmi: 'aucune', numeroGastly: '18' });
    r = await lancer(db, ['--ecrire']);
    verifier('Pawmi entièrement fait, Gastly intact -> exit 0 (seul Gastly s\'écrit)', [r.code, ligne(db, 860035).numeroFiche], [0, undefined]);
    db = monde({ numeroPawmi: 'zzz' }); const avZ = etat(db);
    r = await lancer(db, ['--ecrire']);
    verifier('tout autre état refuse : numeroFiche « zzz » -> exit 1, rien d\'écrit', [r.code, /ni celui de SEA-2/.test(r.erreurs), etat(db) === avZ], [1, true, true]);
    db = monde({ autresDix7: true, ligneDejaCorrigee: true }); db.collection('cartes').updateOne({ _id: 342068 }, { $push: { impressions: IMP('17') } });
    const avD = etat(db);
    r = await lancer(db, ['--ecrire']);
    verifier('deux impressions id/17/setlist (ambigu) -> exit 1, rien d\'écrit', [r.code, etat(db) === avD], [1, true]);
    // voie a, les deux moitiés
    db = monde({ avecTpc35: true, numeroPawmi: '35' });
    r = await lancer(db, ['--ecrire']);
    verifier('moitié (a) 1 : numeroFiche déjà 35, impression encore 17 -> exit 0, impression passe à 35', [r.code, impsId(carte(db, 342068)), ligne(db, 860034).numeroFiche, ligne(db, 860035).numeroFiche], [0, ['35'], '35', '36']);
    db = monde({ avecTpc35: true, impPawmi: '35', impGastly36: true });
    r = await lancer(db, ['--ecrire']);
    verifier('moitié (a) 2 : impressions déjà à 35 et 36, numeroFiche encore 17/18 -> exit 0, les deux lignes passent', [r.code, ligne(db, 860034).numeroFiche, ligne(db, 860035).numeroFiche, impsId(carte(db, 339431))], [0, '35', '36', ['018', '36']]);

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
    db = monde({ numeroGastly: 'zzz' }); const av2 = etat(db);
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

    // ── COURTS2 : --restantes, les trois impressions « 017 »/« 018 » d'apres SEA-2 (th Pawmi 017, th Gastly 018, id Gastly 018) ──
    const THAI = 'tpc-asie/M-P-Thai-Promos', IMAGE_TH = (n, c) => ({ set: 'M-P-Thai-Promos', source: 'tpc-asie', numero: n, cleR2: `tpc-asie/M-P-Thai-Promos/${n}-${c}-th.webp`, langue: 'th' });
    function mondeR({ thGastlyDex = 92, sans017 = false, imgGastly = true, idRetiree = false, pawmiTh2 = false, thIncomplet = false } = {}) {
        const ficheTh = (id, numero, nom, dex, pv) => ({ _id: `tpc-asie/th/${id}`, site: 'tpc-asie', langue: 'th', idFiche: id, url: `https://x/th/${id}`, fiche: { nom, numero, denominateur: 'M-P', pv, dex, symbole: 'S', categorie: 'pokemon' } });
        const fth = [ficheTh(12567, '016', 'ลายเสือ', 931, 160), ficheTh(12569, '018', 'โกส', thGastlyDex, 70), ficheTh(12570, '019', 'Basic Energy', null, null)];
        if (!sans017) fth.push(ficheTh(12568, '017', 'พาโม', 921, 60));
        const b = mondeBrut();
        const impsGastly = b.cartes.find(c => c._id === 339431).impressions;
        if (idRetiree) b.cartes.find(c => c._id === 339431).impressions = impsGastly.filter(i => !(i.tirage === 'id'));
        b.cartes.find(c => c._id === 342068).impressions = b.cartes.find(c => c._id === 342068).impressions.filter(i => i.tirage !== 'id');
        if (pawmiTh2) b.cartes.find(c => c._id === 342068).impressions.push(IMP('17', 'th'));
        b.cartes.find(c => c._id === 342068).images = [IMAGE_TH('017', 342068), { set: 'Phantasmal-Flames', source: 'tcgdex', numero: '032' }];
        b.cartes.find(c => c._id === 339431).images = imgGastly ? [IMAGE_TH('018', 339431)] : [];
        return fakeDb({ cartes_produits: b.cartes_produits, cartes: b.cartes, tpc_fiches: [...b.tpc_fiches, ...fth],
            collecte_images_etat: [...b.collecte_images_etat, { _id: THAI, liste: { code: 'M-P', langue: 'th', ids: fth.map(f => f.idFiche).concat(thIncomplet ? [99999] : []), total: fth.length + (thIncomplet ? 1 : 0), complete: true, luLe: new Date('2026-10-08') } }] });
    }
    function mondeBrut() { const w = monde({ ligneDejaCorrigee: true, impPawmi: 'aucune', numeroGastly: null }); return { cartes_produits: w.brut('cartes_produits'), cartes: w.brut('cartes'), tpc_fiches: w.brut('tpc_fiches'), collecte_images_etat: w.brut('collecte_images_etat') }; }
    const impsDe = (db, id) => carte(db, id).impressions.map(i => `${i.tirage}|${i.numero}`);

    db = mondeR(); let avR = etat(db);
    r = await lancer(db, ['--restantes']);
    verifier('restantes, simulation : exit 0, rien d\'ecrit', [r.code, etat(db) === avR], [0, true]);
    verifier('   la fiche TPC lue est imprimee pour chacune des 3 impressions (th 017 Pawmi, th 018 Gastly, id 018 Sekop Pelubang)', [/Pawmi.*th.*017.*PROUVÉE.*fiche 12568.*Pokédex 921/.test(r.sorties.replace(/\n/g, ' ')), /Gastly.*th.*018.*PROUVÉE.*fiche 12569/.test(r.sorties.replace(/\n/g, ' ')), /Gastly id « 018 » : fiche TPC 16631 « Sekop Pelubang ».*RETIRER/.test(r.sorties.replace(/\n/g, ' '))], [true, true, true]);
    verifier('   l\'annonce de lot-additif : une seule baisse, id', /annonce de lot-additif : \{"impressions imp:id\|M-P Promotional cards":1\}/.test(r.sorties), true);
    r = await lancer(db, ['--restantes', '--ecrire']);
    verifier('restantes, ecriture : exit 0, relue', [r.code, /écrit et relu/.test(r.sorties)], [0, true]);
    verifier('   seule l\'impression id 018 de Gastly part (sa th 018 et l\'intl restent) ; Pawmi inchangee', [impsDe(db, 339431), impsDe(db, 342068)], [['intl|032', 'th|018'], ['intl|032', 'th|017']]);
    verifier('   Gastly : plus aucune impression id ; la th 018 est la', [impsDe(db, 339431).filter(x => x.startsWith('id|')), impsDe(db, 339431).includes('th|018')], [[], true]);
    verifier('   les images (dont celles jointes aux n° th 017/018 par la preuve TPC), liens, sets et lignes : intacts', [carte(db, 342068).images.length, carte(db, 339431).images.length, carte(db, 339431).images[0].numero, carte(db, 339431).liens.idProduct, carte(db, 339431).sets, ligne(db, 860035).numeroFiche], [2, 1, '018', [860035, 859982], ['M-P-Thai-Promos', 'M-P-Indonesian-Promos'], undefined]);
    r = await lancer(db, ['--restantes', '--ecrire']);
    verifier('restantes, rejeu apres ecriture : rien a faire -> exit 1', [r.code, /rien à faire/.test(r.erreurs)], [1, true]);
    db = mondeR({ idRetiree: true }); r = await lancer(db, ['--restantes']);
    verifier('restantes : l\'impression id deja retiree se reconnait, rien a faire -> exit 1', [r.code, /rien à faire/.test(r.erreurs), /DÉJÀ retirée/.test(r.sorties)], [1, true, true]);

    // th Gastly : la fiche th 018 ne designe plus Gastly (Pokedex 999) -> la preuve manque ; une image y est JOINTE : on ne retire jamais une image juste, l'outil s'arrete
    db = mondeR({ thGastlyDex: 999 }); avR = etat(db);
    r = await lancer(db, ['--restantes', '--ecrire']);
    verifier('image jointe au n° d\'une impression sans preuve : exit 1, rien d\'ecrit, l\'image est nommee', [r.code, etat(db) === avR, /image.*018.*jointe/i.test(r.erreurs)], [1, true, true]);
    // sans image jointe, la meme absence de preuve RETIRE l'impression th (la fiche reste), annonce th
    db = mondeR({ thGastlyDex: 999, imgGastly: false }); r = await lancer(db, ['--restantes']);
    const annonceDe = s => { const m = /annonce de lot-additif : (\{.*\})/.exec(s); return m ? JSON.parse(m[1]) : null; };
    verifier('absence de preuve sans image : th 018 est a retirer, annonce id ET th', [r.code, annonceDe(r.sorties)], [0, { 'impressions imp:th|M-P Promotional cards': 1, 'impressions imp:id|M-P Promotional cards': 1 }]);
    r = await lancer(db, ['--restantes', '--ecrire']);
    verifier('   ecrit : les impressions id et th 018 de Gastly partent, l\'intl reste', [r.code, impsDe(db, 339431)], [0, ['intl|032']]);
    // Pawmi th 017 : aucune fiche au n° 017 et une image jointe -> arret ; sans image -> retrait
    db = mondeR({ sans017: true }); avR = etat(db);
    r = await lancer(db, ['--restantes', '--ecrire']);
    verifier('Pawmi th 017 sans fiche ET image jointe : exit 1, rien d\'ecrit', [r.code, etat(db) === avR], [1, true]);
    // garde : cache TPC incomplet / doublon d'impression / argument inconnu / ancien mode intact
    db = mondeR({ thIncomplet: true }); avR = etat(db);
    r = await lancer(db, ['--restantes', '--ecrire']);
    verifier('cache th incomplet : exit 1, rien d\'ecrit', [r.code, etat(db) === avR, /pas complète|fiches en cache/.test(r.erreurs)], [1, true, true]);
    db = mondeR({ pawmiTh2: true }); avR = etat(db);
    r = await lancer(db, ['--restantes', '--ecrire']);
    verifier('deux impressions th/setlist/017 (ambigu) : exit 1, rien d\'ecrit', [r.code, etat(db) === avR], [1, true]);
    r = await lancer(mondeR(), ['--restantes', '--produits=1']);
    verifier('arguments : --restantes accepte seulement --ecrire a ses cotes -> exit 2', r.code, 2);
    db = mondeR(); r = await lancer(db, ['--ecrire']);
    verifier('sans --restantes, le mode SEA-2 ne se declenche pas sur l\'etat d\'apres (lignes deja corrigees) : exit 1, rien d\'ecrit', [r.code], [1]);
    // la relecture voit un $pull qui ne fait rien sans erreur
    const wR = mondeR(); const dbPerdR = fakeDb({ cartes_produits: wR.brut('cartes_produits'), cartes: wR.brut('cartes'), collecte_images_etat: wR.brut('collecte_images_etat'), tpc_fiches: wR.brut('tpc_fiches') }, { perdre: (nom, u) => nom === 'cartes' && !!u.$pull });
    r = await lancer(dbPerdR, ['--restantes', '--ecrire']);
    verifier('restantes : un $pull qui ne fait rien sans erreur -> exit 1, la relecture le dit', [r.code, /encore là/.test(r.sorties), /relecture ne retrouve pas/.test(r.erreurs)], [1, true, true]);

    console.log(`\n${ok} passes, ${ko} en echec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
