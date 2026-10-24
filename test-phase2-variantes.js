// BANC — PHASE 2 v2, volet 2 : MESURE — la `variante` de la LIGNE (vocabulaire de l'API : marques-tampon.js) sépare-t-elle un produit non-holo / oversized / tamponné / reverse d'un produit juste qui partage l'entrée ?
// Documents FABRIQUÉS, la VRAIE décision de l'API (decider). Aucune base.   node test-phase2-variantes.js   (NODE_PATH = node_modules du dépôt principal)
const V = require('./collecte-cartes/phase2-variantes');
const P = require('./collecte-cartes/phase2-visuels');
const G = require('./collecte-cartes/garde-contrat-api');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${nom}`); } else { ko++; console.log(`  ❌ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};

(async () => {
    const api = await G.chargerApi();
    const im = (set, numero, n) => ({ set, numero, cleR2: `g/${n}.webp`, w: 600, h: 838, vignette: { cleR2: `v/${n}.webp`, w: 200, h: 279 }, langue: 'en', source: 'tcgdex' });
    const monde = () => ({
        sets: [{ _id: 'Set-A', idExpansion: 100, code: 'SA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } }],
        cartes: [{ _id: 1, nomEn: 'Trio', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '001', total: '100', rarete: 'Rare' }], images: [im('Set-A', '001', 'trio')] },
            { _id: 2, nomEn: 'Seule', sets: ['Set-A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '002', total: '100', rarete: 'Rare' }], images: [im('Set-A', '002', 'seule')] }],
        cartesProduits: [10, 11, 12].map(id => ({ _id: `1|${id}`, carteId: 1, idProduct: id, idExpansion: 100, numeroFiche: '001', slug: `P${id}`, slugSet: 'Set-A' })).concat([{ _id: '2|20', carteId: 2, idProduct: 20, idExpansion: 100, numeroFiche: '002', slug: 'P20', slugSet: 'Set-A' }])
    });
    const decide = async m => api.decider({ sets: m.sets, docs: m.cartes, lignes: m.cartesProduits, metacarte: new Map([[-1, 1]]), regle: api.regle, cederLaMain: false });
    const groupe = { carteId: 1, set: 'Set-A', numero: '001', cleR2: 'g/trio.webp', justes: [10], cibles: [{ idProduct: 11, jeton: null }, { idProduct: 12, jeton: 'jumbo' }] };
    const m0 = monde(), r0 = await decide(m0);
    const servis = r => [...new Set(r.entrees.map(e => e.idProduct))].sort((a, b) => a - b);
    const entree = (r, id) => r.entrees.find(e => e.idProduct === id);

    console.log('1. le vocabulaire de l\'API (marques-tampon.js, lu — jamais recopié)');
    verifier('« jumbo », « toys-r-us » et « normale » sont des jetons de l\'API', [api.estVariante('jumbo'), api.estVariante('toys-r-us'), api.estVariante('normale')], [true, true, true]);
    verifier('« non-holo », « reverse », « holo », « oversized », « 20th-anniversary » n\'en sont PAS', ['non-holo', 'reverse', 'holo', 'oversized', '20th-anniversary', 'celebrations'].map(j => api.estVariante(j)), [false, false, false, false, false, false]);
    verifier('jetonDe : le jeton exact d\'une marque lue, ou « aucun jeton » (null) — jamais deviné', [V.jetonDe('toys-r-us', api), V.jetonDe('jumbo', api), V.jetonDe('non-holo', api), V.jetonDe(null, api)], ['toys-r-us', 'jumbo', null, null]);

    console.log('2. avant : les trois produits du trio sont servis par la MÊME entrée, sans variante');
    verifier('servis avant', servis(r0), [10, 11, 12, 20]);
    verifier('aucune variante, aucun marquage de partage', r0.entrees.filter(e => e.idProduct < 20).map(e => [e.variante, e.partageeTamponNonSepare]), [[null, null], [null, null], [null, null]]);

    console.log('3. scénario « exclusion » : le juste prend « normale », l\'entrée se déclare séparée par la variante, la cible n\'a AUCUN jeton');
    const s2 = V.simulerSeparation(m0, [groupe], 'exclusion');
    const r2 = await decide({ ...m0, ...s2 });
    verifier('la cible sans jeton (11) n\'est PLUS servie (partageIncoherent, fail-closed)', servis(r2).includes(11), false);
    verifier('la cible à jeton « jumbo » (12) n\'a pas le jeton dans ce scénario : plus servie non plus', servis(r2).includes(12), false);
    verifier('le produit juste (10) reste servi, MÊME visuel, avec la variante « normale » et le marquage « séparée » (false)', [servis(r2).includes(10), entree(r2, 10)?.grande.cle, entree(r2, 10)?.variante, entree(r2, 10)?.partageeTamponNonSepare], [true, 'g/trio.webp', 'normale', false]);
    verifier('un produit d\'une AUTRE carte (20) ne bouge pas', JSON.stringify(r2.entrees.filter(e => e.idProduct === 20)) === JSON.stringify(r0.entrees.filter(e => e.idProduct === 20)), true);
    verifier('le compteur partageIncoherent de l\'API compte les deux cibles', r2.denominateurs.partageIncoherent - r0.denominateurs.partageIncoherent, 2);
    verifier('rien n\'est écrit dans l\'état d\'entrée (copie)', [m0.cartes[0].images[0].partageeTamponNonSepare, m0.cartesProduits[0].variante], [undefined, undefined]);

    console.log('4. scénario « jeton » : la cible reçoit son jeton quand il existe (jumbo) : elle reste servie, DISTINGUÉE, au lieu d\'être exclue');
    const s1 = V.simulerSeparation(m0, [groupe], 'jeton');
    const r1 = await decide({ ...m0, ...s1 });
    verifier('12 (jumbo) est servie avec sa variante ; 10 (normale) aussi ; 11 (aucun jeton) reste exclue', [servis(r1).includes(12), entree(r1, 12)?.variante, servis(r1).includes(10), entree(r1, 10)?.variante, servis(r1).includes(11)], [true, 'jumbo', true, 'normale', false]);
    verifier('les deux produits servis partagent le MÊME fichier (c\'est la paire séparée par la variante)', entree(r1, 12)?.grande.cle === entree(r1, 10)?.grande.cle, true);

    console.log('5. le contrat de l\'API : aucune entrée refusée par lireEntree dans les deux scénarios');
    for (const [nom, s, r] of [['exclusion', s2, r2], ['jeton', s1, r1]]) {
        const refus = r.entrees.map(e => G.jugerEntree(api, e)).filter(j => !j.ok);
        verifier(`${nom} : 0 entrée refusée par lireEntree`, refus.length, 0);
    }

    console.log('6. la comparaison avant/après nomme ce qui bouge (le juste « change » : variante et marquage, PAS le visuel)');
    const d = P.compareEntrees(r0.entrees, r2.entrees, [11, 12]);
    verifier('perdus = les deux cibles, le juste est « changé » (variante/marquage), personne d\'autre', [d.perdus, d.changes, d.autresPerdus, d.gagnes], [[11, 12], [10], [], []]);
    verifier('séparerSeulement ne retient une cible que si elle partage vraiment l\'entrée : une cible d\'une autre entrée lève', (() => { try { V.simulerSeparation(m0, [{ ...groupe, cibles: [{ idProduct: 20, jeton: null }] }], 'exclusion'); return 'ne lève pas'; } catch (e) { return /20/.test(e.message) ? 'lève' : e.message; } })(), 'lève');

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
