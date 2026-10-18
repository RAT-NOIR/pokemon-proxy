// node test-variantes-releve.js — TAMPONS-RELEVE B : variantes des V2 tamponnés du relevé du testeur (collecte-cartes/variantes-releve.js).
// Faux objets seulement (base en mémoire, CSV en chaîne) : aucune base réelle, aucun dossier du testeur, aucune requête réseau. Ce que le banc garde :
//   · le vocabulaire est FERMÉ (ni « autre » ni « enseigne », ordre de la liste) ; la table des 13 est confrontée au CSV (colonne, mots de l'URL) ;
//   · V1 « normale » seulement si le plus ancien STRICTEMENT, sans étiquette, non désigné par le relevé ; l'entrée d'image n'est écrite que si la séparation est prouvée ET qu'aucun autre produit ne partage la fiche ;
//   · jamais de produitsPartages ; sauvegarde AVANT la première écriture ; restauration champ par champ ; idempotence ; `--attendu` refuse AVANT d'écrire.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du dépôt.
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const R = require(path.join(DIR, 'collecte-cartes', 'variantes-releve.js'));
const P = require(path.join(DIR, 'collecte-cartes', 'pokumon.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const essayer = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`❌ ${nom}\n   EXCEPTION ${String(e.message).split('\n')[0]}`); } };
const leve = async f => { try { await f(); return null; } catch (e) { return String(e.message); } };

// ── une base en mémoire : seulement les formes de requête de l'outil ──
const lire = (d, cle) => { const [t, ...r] = cle.split('.'); const v = d[t]; return r.length ? (Array.isArray(v) ? v.map(x => x?.[r.join('.')]) : [v?.[r.join('.')]]) : [v]; };
const correspond = (d, f) => Object.entries(f).every(([k, c]) => lire(d, k).some(x => (c && typeof c === 'object' && '$in' in c) ? c.$in.includes(x) : x === c));
function fausseBase({ produits, cartes, images }) {
    const col = { cartes_produits: new Map(produits.map(l => [l._id, structuredClone(l)])), cartes: new Map(cartes.map(c => [c._id, structuredClone(c)])), images: new Map(images.map(d => [d._id, structuredClone(d)])) };
    const journal = [];
    const collection = n => ({
        find(f = {}) { const r = { toArray: async () => structuredClone([...col[n].values()].filter(d => correspond(d, f))), project() { return r; } }; return r; },
        async updateOne(f, u, o) {
            const d = col[n].get(f._id); if (!d) return { matchedCount: 0, modifiedCount: 0 };
            const avant = JSON.stringify(d); journal.push({ n, f, u });
            const cible = (k) => {
                const m = /^images\.\$\[e\]\.(.+)$/.exec(k);
                if (!m) return [d, k];
                const af = o.arrayFilters[0], e = d.images.find(x => x['e.set'] === undefined && x.set === af['e.set'] && x.cleR2 === af['e.cleR2']);
                return [e, m[1]];
            };
            for (const [k, v] of Object.entries(u.$set || {})) { const [t, c] = cible(k); t[c] = structuredClone(v); }
            for (const k of Object.keys(u.$unset || {})) { const [t, c] = cible(k); delete t[c]; }
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) === avant ? 0 : 1 };
        }
    });
    return { db: { collection }, col, journal, instantane: () => JSON.stringify([...col.cartes_produits.values(), ...col.cartes.values(), ...col.images.values()]) };
}

// ── le monde : la carte 1 (set S, n° 8) a V1 99 (2019) et V2 100 (2020) ; la carte 2 a trois produits ──
const LP = (idProduct, carteId, slugSet, numeroFiche, extra = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, slugSet, numeroFiche, ...extra });
const ENTREE = (set, numero, cleR2, extra = {}) => ({ set, numero, cleR2, source: 'tcgdex', ...extra });
const monde = (o = {}) => ({
    produits: [LP(100, 1, 'S', '8'), LP(99, 1, 'S', '8'), LP(98, 1, 'S', '25'), ...(o.plus || [])],
    cartes: [{ _id: 1, images: [ENTREE('S', '8', 'k8', o.entree), ENTREE('S', '25', 'k25')] }, ...(o.cartes || [])],
    images: [{ _id: 'd8', cleR2: 'k8', carteId: 1, set: 'S' }, { _id: 'd25', cleR2: 'k25', carteId: 1, set: 'S' }, ...(o.docs || [])]
});
const DATES = new Map([[99, '2019-01-01'], [100, '2020-02-02'], [98, '2019-05-05'], [97, '2021-01-01']]);
const F = (o = {}) => ({ idProduct: 100, jetons: ['prerelease'], variante: 'prerelease', colonne: 'Prerelease', url: 'https://x/prerelease', reserve: null, ...o });
const plan = (w, { fiches = [F()], dates = DATES, idsReleve = new Set([100]), etiquettes = new Map() } = {}) => R.construirePlan({ cartesDb: w.db, fiches, dates, idsReleve, etiquettes });

(async () => {
    // ── le vocabulaire fermé ──
    await essayer('vocabulaire', () => {
        for (const v of ['staff', 'staff+prerelease', 'league+place-2', 'toys-r-us+cosmo', 'normale', 'jumbo', 'staff+championship', 'prerelease+cosmo', 'gamestop', 'kfc', 'indomilk', 'professor']) verifier(`valide : ${v}`, R.varianteValide(v), true);
        for (const v of ['autre', 'enseigne', 'prerelease+staff', 'staff+staff', 'staff+', '', 'Staff', 'normale+staff', 'place-5', 'staff-prerelease', null]) verifier(`refusée : ${v}`, R.varianteValide(v), false);
    });
    await essayer('libellés', () => verifier('libellés', [R.libelleTampon('staff+prerelease'), R.libelleTampon('league+place-2'), R.libelleTampon('toys-r-us+cosmo'), R.libelleTampon('gamestop')], ['Staff + Prerelease', 'League + 2e place', 'Toys "R" Us + Cosmo', 'GameStop']));
    await essayer('libellé d\'une variante non tamponnée', async () => verifier('normale refusée', /pas une variante tamponnée/.test(await leve(() => R.libelleTampon('normale')) || ''), true));
    await essayer('étiquettes lues', () => verifier('motifs', [R.jetonsDeEtiquette('Stamp rerel lease'), R.jetonsDeEtiquette('GameStop Promo'), R.jetonsDeEtiquette('Snowflake Stamp Countdown Calendar Promo'), R.jetonsDeEtiquette('Staff Version'), R.jetonsDeEtiquette('rien')], [['prerelease'], ['gamestop'], ['cosmo'], ['staff'], []]));

    // ── la table des 13 face au CSV ──
    const CSV_URL = f => `https://v/${f.id}-${[...f.corrobore, ...f.ajouts.map(a => a.mot)].join('-')}`;
    const lignesCsv = (mod = x => x) => R.FICHES.map(f => mod({ url: CSV_URL(f), idProduct: f.id, stamp: f.colonne, propre: 'oui' }));
    await essayer('table : 13 fiches, variantes attendues', () => {
        const l = R.listeDesFiches(lignesCsv());
        verifier('13 variantes', l.map(f => f.variante), ['staff+prerelease', 'staff+prerelease', 'staff+championship', 'prerelease', 'prerelease', 'prerelease', 'cosmo', 'championship', 'league', 'toys-r-us', 'gamestop', 'toys-r-us+cosmo', 'league+place-2']);
        verifier('toutes valides', l.every(f => R.varianteValide(f.variante)), true);
        verifier('les réserves sont nommées', l.filter(f => f.reserve).map(f => f.idProduct), [882210, 449653]);
    });
    await essayer('table : colonne différente', async () => verifier('refus', /la colonne du relevé est « Staff »/.test(await leve(() => R.listeDesFiches(lignesCsv(x => x.idProduct === 275574 ? { ...x, stamp: 'Staff' } : x))) || ''), true));
    await essayer('table : mot absent de l\'URL', async () => verifier('refus', /ne figure pas dans l'URL/.test(await leve(() => R.listeDesFiches(lignesCsv(x => x.idProduct === 771356 ? { ...x, url: 'https://v/rien' } : x))) || ''), true));
    await essayer('table : fiche propre non', async () => verifier('refus', /ne traite que les « oui »/.test(await leve(() => R.listeDesFiches(lignesCsv(x => x.idProduct === 882210 ? { ...x, propre: 'non' } : x))) || ''), true));
    await essayer('table : fiche absente du relevé', async () => verifier('refus', /absente du relevé/.test(await leve(() => R.listeDesFiches(lignesCsv().slice(1))) || ''), true));
    await essayer('table : « Autre » sans titre qui précise', async () => verifier('un doute est un trou', /un doute est un trou/.test(await leve(() => R.listeDesFiches(lignesCsv(), [{ id: 708073, colonne: 'Autre', corrobore: [], ajouts: [] }])) || ''), true));
    await essayer('CSV', () => {
        const l = R.lireCsv('annonce_vinted;idProduct;stamp;fiche_cardmarket_propre\n"https://a/1";12;"Staff + Prerelease";oui\n');
        verifier('lecture', l, [{ url: 'https://a/1', idProduct: 12, stamp: 'Staff + Prerelease', propre: 'oui' }]);
    });

    // ── le plan ──
    await essayer('plan nominal', async () => {
        const p = await plan(fausseBase(monde()));
        const i = p.items[0];
        verifier('V2 prerelease, V1 normale, entrée et document', [i.v2.variante, i.v1?.idProduct, i.entree?.cible, i.doc?._id, p.refus.length, i.freres], ['prerelease', 99, 'Prerelease', 'd8', 0, [99]]);
        verifier('la preuve nomme le relevé et la date', /relevé du testeur, 2026-10-18 \(annonce https:\/\/x\/prerelease, colonne « Prerelease »\)/.test(i.v2.preuve), true);
        verifier('la preuve du V1 nomme les trois conditions', /produit le plus ancien.*aucune étiquette.*non désigné par le relevé/.test(i.v1.preuve), true);
        verifier('le frère d\'un autre numéro n\'est pas un frère', i.freres.includes(98), false);
    });
    await essayer('V1 désigné par le relevé', async () => {
        const p = await plan(fausseBase(monde()), { idsReleve: new Set([100, 99]) });
        verifier('pas de normale, pas d\'entrée', [p.items[0].v1, p.items[0].v1Motif, p.items[0].entree], [null, 'designe-par-le-releve', null]);
    });
    await essayer('étiquette sur la vignette du V1', async () => {
        const p = await plan(fausseBase(monde()), { etiquettes: new Map([[99, 'Staff Version']]) });
        verifier('pas de normale', [p.items[0].v1, /^etiquette-lue/.test(p.items[0].v1Motif)], [null, true]);
    });
    await essayer('V1 plus récent que le V2', async () => {
        const p = await plan(fausseBase(monde()), { dates: new Map([[99, '2021-01-01'], [100, '2020-02-02']]) });
        verifier('le produit du testeur est le plus ancien : pas de normale', [p.items[0].v1, p.items[0].v1Motif], [null, 'le-produit-du-testeur-est-le-plus-ancien']);
    });
    await essayer('dates égales', async () => {
        const p = await plan(fausseBase(monde()), { dates: new Map([[99, '2020-02-02'], [100, '2020-02-02']]) });
        verifier('égalité : pas strict, pas de normale', [p.items[0].v1, p.items[0].v1Motif], [null, 'plus-ancien-pas-strict']);
    });
    await essayer('date d\'un frère absente', async () => {
        const p = await plan(fausseBase(monde()), { dates: new Map([[100, '2020-02-02']]) });
        verifier('on ne devine pas l\'ancienneté', [p.items[0].v1, p.items[0].v1Motif], [null, 'date-d-un-frere-absente']);
    });
    await essayer('autre produit sur la fiche (V3)', async () => {
        const p = await plan(fausseBase(monde({ plus: [LP(97, 1, 'S', '8')] })));
        const i = p.items[0];
        verifier('V1 normale oui, entrée NON (un produit non séparé la partage), V3 ne reçoit rien', [i.v1?.idProduct, i.entree, /autres-produits-sur-la-fiche : 97/.test(i.entreeMotif), R.operations(p).lignes.map(l => l.idProduct)], [99, null, true, [100, 99]]);
    });
    await essayer('aucun frère', async () => {
        const w = monde(); w.produits = w.produits.filter(l => l.idProduct !== 99);
        const p = await plan(fausseBase(w));
        verifier('V2 seul : variante posée, ni V1 ni entrée', [p.items[0].v2.variante, p.items[0].v1, p.items[0].v1Motif, p.items[0].entree], ['prerelease', null, 'aucun-frere', null]);
    });
    await essayer('étiquette Cardmarket contredit le relevé', async () => {
        const p = await plan(fausseBase(monde()), { etiquettes: new Map([[100, 'GameStop Promo']]) });
        verifier('refusée', [p.items.length, /^etiquette-contredit/.test(p.refus[0]?.motif)], [0, true]);
    });
    await essayer('étiquette Cardmarket qui confirme', async () => {
        const p = await plan(fausseBase(monde()), { etiquettes: new Map([[100, 'Stamp rerel lease']]) });
        verifier('acceptée, citée dans la preuve', [p.items.length, /étiquette Cardmarket lue : « Stamp rerel lease »/.test(p.items[0].v2.preuve)], [1, true]);
    });
    await essayer('variante contraire', async () => {
        const w = monde(); w.produits[0].variante = 'staff';
        const p = await plan(fausseBase(w));
        verifier('V2 déjà marqué autrement : refusé', [p.items.length, /^variante-contraire/.test(p.refus[0].motif)], [0, true]);
        const w2 = monde(); w2.produits[1].variante = 'staff';
        const q = await plan(fausseBase(w2));
        verifier('V1 déjà marqué autrement : pas de normale', [q.items[0].v1, /^variante-contraire/.test(q.items[0].v1Motif)], [null, true]);
    });
    await essayer('produit sans ligne', async () => { const w = monde(); w.produits = w.produits.filter(l => l.idProduct !== 100); const p = await plan(fausseBase(w)); verifier('refus nommé', p.refus.map(r => r.motif), ['produit-sans-ligne']); });
    await essayer('entrée déjà marquée / ambiguë / tampon inattendu', async () => {
        const a = await plan(fausseBase(monde({ entree: { partageeTamponNonSepare: true } })));
        verifier('déjà marquée', [a.items[0].entree, a.items[0].entreeMotif], [null, 'entree-deja-marquee']);
        const b = await plan(fausseBase(monde({ entree: { produitsPartages: [99, 100] } })));
        verifier('produitsPartages présent : jamais touchée', [b.items[0].entree, b.items[0].entreeMotif], [null, 'entree-deja-marquee']);
        const w = monde(); w.cartes[0].images.push(ENTREE('S', '8', 'k8bis'));
        const c = await plan(fausseBase(w));
        verifier('deux entrées pour le numéro', [c.items[0].entree, c.items[0].entreeMotif], [null, 'entree-ambigue']);
        const d = await plan(fausseBase(monde({ entree: { tamponNonRepresente: 'Staff' } })));
        verifier('libellé différent présent', [d.items[0].entree, /^tampon-inattendu/.test(d.items[0].entreeMotif)], [null, true]);
    });
    await essayer('document partagé', async () => {
        const p = await plan(fausseBase(monde({ cartes: [{ _id: 5, images: [ENTREE('T', '1', 'k8')] }] })));
        verifier('le document sert aussi une autre carte : entrée seule', [!!p.items[0].entree, p.items[0].doc, p.items[0].docMotif], [true, null, 'document-partage']);
    });

    // ── l'écriture ──
    const prochaine = async (o = {}) => { const w = fausseBase(monde(o)); return { w, p: await plan(w) }; };
    await essayer('à blanc n\'écrit rien', async () => {
        const { w, p } = await prochaine(); const avant = w.instantane();
        const r = await R.appliquer(w.db, p, { ecrire: false });
        verifier('rien écrit, comptes', [w.journal.length, w.instantane() === avant, r.lignes, r.entrees, r.documents, r.dejaFait], [0, true, 2, 1, 1, false]);
    });
    await essayer('--ecrire exige --attendu et une sauvegarde', async () => {
        const { w, p } = await prochaine();
        verifier('sans attendu', [/attendu/.test(await leve(() => R.appliquer(w.db, p, { ecrire: true, sauvegarder: async () => {} })) || ''), w.journal.length], [true, 0]);
        verifier('attendu faux', [/attendu=3/.test(await leve(() => R.appliquer(w.db, p, { ecrire: true, attendu: 3, sauvegarder: async () => {} })) || ''), w.journal.length], [true, 0]);
        verifier('sans sauvegarde', [/sauvegarde/.test(await leve(() => R.appliquer(w.db, p, { ecrire: true, attendu: 1 })) || ''), w.journal.length], [true, 0]);
    });
    await essayer('écriture : champs exacts, sauvegarde AVANT', async () => {
        const { w, p } = await prochaine(); let sauvee = null, ecritesAvant = null;
        await R.appliquer(w.db, p, { ecrire: true, attendu: 1, sauvegarder: async o => { sauvee = o; ecritesAvant = w.journal.length; } });
        verifier('la sauvegarde est faite avant la première écriture', [ecritesAvant, sauvee.lignes.length, sauvee.entrees.length, sauvee.docs.length], [0, 2, 1, 1]);
        const l2 = w.col.cartes_produits.get('1|100'), l1 = w.col.cartes_produits.get('1|99'), e = w.col.cartes.get(1).images.find(x => x.cleR2 === 'k8'), d = w.col.images.get('d8');
        verifier('V2 et V1', [l2.variante, l1.variante, !!l2.variantePreuve, !!l1.variantePreuve], ['prerelease', 'normale', true, true]);
        verifier('entrée et document : séparé, libellé, jamais produitsPartages', [e.partageeTamponNonSepare, e.tamponNonRepresente, 'produitsPartages' in e, d.partageeTamponNonSepare, d.tamponNonRepresente, 'produitsPartages' in d], [false, 'Prerelease', false, false, 'Prerelease', false]);
        verifier('l\'autre numéro et la ligne voisine intacts', [w.col.cartes_produits.get('1|98').variante ?? null, w.col.cartes.get(1).images.find(x => x.cleR2 === 'k25').tamponNonRepresente ?? null, w.col.images.get('d25').partageeTamponNonSepare ?? null], [null, null, null]);
    });
    await essayer('idempotence', async () => {
        const { w, p } = await prochaine();
        await R.appliquer(w.db, p, { ecrire: true, attendu: 1, sauvegarder: async () => {} });
        const n = w.journal.length, snap = w.instantane();
        const p2 = await plan(w);
        let appels = 0;
        const r = await R.appliquer(w.db, p2, { ecrire: true, attendu: 1, sauvegarder: async () => { appels++; } });
        verifier('deuxième passe : rien réécrit, rien sauvegardé', [w.journal.length, w.instantane() === snap, r.dejaFait, appels], [n, true, true, 0]);
    });
    await essayer('écriture sans effet', async () => {
        const { w, p } = await prochaine(); const vraie = w.db.collection;
        w.db.collection = n => ({ ...vraie(n), async updateOne() { return { matchedCount: 1, modifiedCount: 0 }; } });
        verifier('arrêt', /inchang/.test(await leve(() => R.appliquer(w.db, p, { ecrire: true, attendu: 1, sauvegarder: async () => {} })) || ''), true);
    });
    await essayer('restauration', async () => {
        const { w, p } = await prochaine(); const avant = w.instantane(); let sv = null;
        await R.appliquer(w.db, p, { ecrire: true, attendu: 1, sauvegarder: async o => { sv = JSON.parse(JSON.stringify(o)); } });
        const blanc = await R.restaurer(w.db, sv, { ecrire: false });
        verifier('à blanc : compte', [blanc.total, blanc.restaurees, blanc.changeesDepuis.length], [4, 4, 0]);
        verifier('sans attendu : refus', /attendu/.test(await leve(() => R.restaurer(w.db, sv, { ecrire: true })) || ''), true);
        const r = await R.restaurer(w.db, sv, { ecrire: true, attendu: 4 });
        verifier('tout restauré, état identique à l\'état d\'avant', [r.restaurees, w.instantane() === avant], [4, true]);
    });
    await essayer('restauration : un champ changé depuis est laissé', async () => {
        const { w, p } = await prochaine(); let sv = null;
        await R.appliquer(w.db, p, { ecrire: true, attendu: 1, sauvegarder: async o => { sv = JSON.parse(JSON.stringify(o)); } });
        w.col.cartes_produits.get('1|100').variante = 'staff';   // quelqu'un l'a changée depuis
        const r = await R.restaurer(w.db, sv, { ecrire: true, attendu: 4 });
        verifier('3 restaurées, 1 laissée et nommée', [r.restaurees, r.changeesDepuis], [3, ['ligne 1|100']]);
        verifier('la valeur d\'un tiers est intacte', w.col.cartes_produits.get('1|100').variante, 'staff');
    });

    // ── la garde « variante posée » du marquage des paires tampon ──
    await essayer('partage-tampon : aucune de ces fiches n\'est une promo Black Star', () => {
        const bsp = new Set(P.LIGNES_AUTRES.filter(l => l.famille === 'bsp').flatMap(l => l.slugs));
        const sets = ['Team-Rocket', 'Secret-Wonders', 'Plasma-Blast', 'Stormfront', 'EX-Power-Keepers', 'Gym-Heroes', 'Mysterious-Treasures', 'Noble-Victories', 'Black-White', 'Crimson-Invasion', 'Twilight-Masquerade', 'Burning-Shadows', 'Sword-Shield'];
        verifier('le groupage des paires tampon ne les voit pas', [bsp.size > 0, sets.filter(s => bsp.has(s))], [true, []]);
    });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
