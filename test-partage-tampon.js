// node test-partage-tampon.js — BS-STAFF : « tampon non séparable » sur l'image servie aux paires Black Star V1/V2 (collecte-cartes/partage-tampon.js + marquer-partage-tampon.js).
// Une base EN MÉMOIRE, aucune requête, rien sur R2. La règle du site (fiche servie, image de l'impression) est IMPORTÉE, jamais recopiée.
// Ce que le banc garde :
//   · une paire n'est marquée que si TOUT est prouvé (liste fermée de mots de tampon, rien d'autre de différent, fiche = ces deux produits, même image) ; le reste est un refus NOMMÉ ;
//   · les trois champs (produitsPartages, partageeTamponNonSepare, tamponNonRepresente) sur l'entrée servie, et sur le document `images` sauf s'il sert une autre entrée ;
//   · idempotence, simulation sans écriture, --attendu qui refuse avant d'écrire, retrait qui ne retire que ces champs ; Prize Packs et autres familles inchangés.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du dépôt.
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const P = require(path.join(DIR, 'collecte-cartes', 'pokumon.js'));
const T = require(path.join(DIR, 'collecte-cartes', 'partage-tampon.js'));
const X = require(path.join(DIR, 'exporter-donnees-logos-site.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const essayer = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`❌ ${nom}\n   EXCEPTION ${String(e.message).split('\n')[0]}`); } };

// ── une base en mémoire (les seules formes de requête de l'outil) ─────────────────────────────────────────────────────────────────────────────────
function fausseBase() {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => Array.isArray(x) ? x.flatMap(e => e?.[p]) : x?.[p], o);
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => {
        const x = lire(d, k);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            if ('$in' in v) return (Array.isArray(x) ? x : [x]).some(y => v.$in.includes(y));
            if ('$exists' in v) return (x !== undefined) === v.$exists;
            return false;
        }
        return Array.isArray(x) ? x.includes(v) : x === v;
    });
    const tous = (n, f) => [...col(n).values()].filter(d => accepte(d, f));
    const elements = (d, chemin, filtres, nomVar) => (d[chemin] || []).filter(e => e && (filtres || []).some(fl => Object.entries(fl).every(([k, v]) => k.startsWith(`${nomVar}.`) ? e[k.slice(nomVar.length + 1)] === v : false)));
    function appliquer(d, u, o) {
        // comme MongoDB : les éléments visés par `arrayFilters` se décident UNE fois, avant toute modification de l'update
        const cibles = new Map();
        for (const k of [...Object.keys(u.$set || {}), ...Object.keys(u.$unset || {})]) { const m = /^([^.]+)\.\$\[(\w+)\]\./.exec(k); if (m && !cibles.has(`${m[1]}.${m[2]}`)) cibles.set(`${m[1]}.${m[2]}`, elements(d, m[1], o.arrayFilters, m[2])); }
        for (const [mode, champs] of [['$set', u.$set || {}], ['$unset', u.$unset || {}]]) {
            for (const [k, v] of Object.entries(champs)) {
                const m = /^([^.]+)\.\$\[(\w+)\]\.(.+)$/.exec(k);
                if (m) { for (const e of cibles.get(`${m[1]}.${m[2]}`)) { if (mode === '$set') e[m[3]] = structuredClone(v); else delete e[m[3]]; } }
                else if (mode === '$set') d[k] = structuredClone(v); else delete d[k];
            }
        }
    }
    const collection = n => ({
        find(f) { const r = { toArray: async () => structuredClone(tous(n, f)), project() { return r; } }; return r; },
        async findOne(f) { return structuredClone(tous(n, f)[0] ?? null); },
        async countDocuments(f) { return tous(n, f).length; },
        async updateOne(f, u, o = {}) {
            const d = tous(n, f)[0]; if (!d) return { matchedCount: 0, modifiedCount: 0 };
            const avant = JSON.stringify(d); appliquer(d, u, o);
            writes.push({ n, f, u, o });
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) === avant ? 0 : 1 };
        },
        async updateMany() { throw new Error('updateMany : interdit à cet outil'); },
        async insertOne() { throw new Error('insertOne : interdit à cet outil'); },
        async deleteOne() { throw new Error('deleteOne : interdit à cet outil'); },
        async deleteMany() { throw new Error('deleteMany : interdit à cet outil'); },
        async replaceOne() { throw new Error('replaceOne : interdit à cet outil'); }
    });
    const writes = [];
    return { db: { collection }, col, cols, writes, instantane: () => JSON.stringify([...cols].map(([n, m]) => [n, [...m.values()]])) };
}

// ── le monde ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SET = 'SV-Black-Star-Promos', EXPANSION = 'SVP Black Star Promos', IDEXP = 5241, SET_PP3 = 'Play-Pokemon-Prize-Pack-Series-Three';
const brute = (id, titre, ev, w = 700) => ({ id, title: { rendered: titre }, link: `https://pokumon.com/card/${id}/`, release_event: ev, language: [1260], _embedded: { 'wp:featuredmedia': [{ source_url: `https://cdn6966.templcdn.com/${id}.jpg`, media_details: { width: w, height: 900 } }] } });
const entree = (id, titre, ev) => P.lireEntree(brute(id, titre, ev));
const PAIRES = [
    // [carteId, numero, nom Cardmarket, [idV1, idV2], titre simple, titre tamponné, évts simple, évts tamponné, image servie ?]
    { c: 278879, n: '004', nom: 'Mimikyu ex', ids: [701130, 701131], simple: 'Mimikyu ex (SVP004 English Promo)', stamp: 'Holofoil Play Pokemon Mimikyu ex (SVP004 English Promo)', ev: [7836], evS: [7838], cle: 'tcgdex/SV-Black-Star-Promos/004-278879.webp' },
    { c: 300001, n: '010', nom: 'Pikachu', ids: [800002, 800001], simple: 'Pikachu (SVP010 English Promo)', stamp: 'Staff Pikachu (SVP010 English Promo)', ev: [5000], evS: [5000], cle: 'tcgdex/SV-Black-Star-Promos/010-300001.webp' },
    { c: 300002, n: '011', nom: 'Charmander', ids: [800003, 800004], simple: 'Charmander (SVP011 English Promo)', stamp: 'Prerelease Charmander (SVP011 English Promo)', ev: [5000], evS: [5000], cle: 'tcgdex/SV-Black-Star-Promos/011-300002.webp' },
    { c: 300003, n: '012', nom: 'Squirtle', ids: [800005, 800006], simple: 'Squirtle (SVP012 English Promo)', stamp: 'Reverse Holo Squirtle (SVP012 English Promo)', ev: [5000], evS: [5000], cle: 'tcgdex/SV-Black-Star-Promos/012-300003.webp' },
    { c: 300004, n: '013', nom: 'Bulbasaur', ids: [800009, 800010], simple: 'Bulbasaur (SVP013 English Promo)', stamp: 'Staff Bulbasaur (SVP013 English Promo)', ev: [5000], evS: [5000], cle: 'bulbapedia/partage-013.webp' },
    { c: 300007, n: '016', nom: 'Snorlax', ids: [800014, 800015], simple: 'Snorlax (SVP016 English Promo)', stamp: 'Staff Snorlax (SVP016 English Promo)', ev: [5000], evS: [5000], cle: 'tcgdex/SV-Black-Star-Promos/016-300007.webp', troisieme: 800020 },
    { c: 300006, n: '015', nom: 'Gengar', ids: [800016, 800017], simple: 'Gengar (SVP015 English Promo)', stamp: 'Staff Gengar (SVP015 English Promo)', ev: [5000], evS: [5000], cle: null },
    { c: 300008, n: '017', nom: 'Eevee', ids: [800030, 800031], simple: 'Eevee (SVP017 English Promo)', stamp: 'Staff Eevee (SVP017 English Promo)', ev: [5000], evS: [6000], cle: 'tcgdex/SV-Black-Star-Promos/017-300008.webp' },   // événements différents : refus
    // V1 plus RÉCENT que V2 chez Cardmarket : refus
    { c: 300009, n: '018', nom: 'Ditto', ids: [800040, 800041], simple: 'Ditto (SVP018 English Promo)', stamp: 'Staff Ditto (SVP018 English Promo)', ev: [5000], evS: [5000], cle: 'tcgdex/SV-Black-Star-Promos/018-300009.webp', inverse: true },
    // le document `images` de l'image servie dit une AUTRE carte : entrée marquée, document non
    { c: 300010, n: '019', nom: 'Machop', ids: [800050, 800051], simple: 'Machop (SVP019 English Promo)', stamp: 'Staff Machop (SVP019 English Promo)', ev: [5000], evS: [5000], cle: 'tcgdex/SV-Black-Star-Promos/019-300010.webp', docAutreCarte: 999999 },
    // la carte ne porte aucune impression de ce set : le site ne lui donne aucune fiche, rien n'est prouvé
    { c: 300011, n: '020', nom: 'Abra', ids: [800060, 800061], simple: 'Abra (SVP020 English Promo)', stamp: 'Staff Abra (SVP020 English Promo)', ev: [5000], evS: [5000], cle: 'tcgdex/SV-Black-Star-Promos/020-300011.webp', sansImpression: true },
    // le numeroFiche écrit par le serveur place V2 sur une AUTRE fiche : le site ne sert pas V2 sur celle-ci
    { c: 300014, n: '022', nom: 'Meowth', ids: [800080, 800081], simple: 'Meowth (SVP022 English Promo)', stamp: 'Staff Meowth (SVP022 English Promo)', ev: [5000], evS: [5000], cle: 'tcgdex/SV-Black-Star-Promos/022-300014.webp', numeroFicheV2: '099' }
];
const TROIS = { c: 300005, n: '014', nom: 'Eevee', ids: [800011, 800012, 800013] };   // trois produits sur une fiche : jamais une paire
function monde() {
    const B = fausseBase(), PR = fausseBase(), index = [];
    const set = (b, n, d) => b.col(n).set(d._id, d);
    set(B, 'sets', { _id: SET, code: 'SVP', tirage: 'intl', region: 'intl', idExpansion: [IDEXP], bulba: { expansion: EXPANSION } });
    let t = 0;
    const ajouterProduit = (c, n, nom, id, v, slug, numeroFiche = n) => {
        set(B, 'cartes_produits', { _id: `${c}|${id}`, carteId: c, idProduct: id, idExpansion: IDEXP, slugSet: SET, numeroFiche, slug });
        set(PR, 'numeros_cartes', { _id: `nc${id}`, idProduct: id, slug, slugSet: SET, numero: n, variante: v });
        set(PR, 'catalogue_produits', { _id: `cp${id}`, idProduct: id, name: `${nom} [Attaque | Autre]`, idMetacard: c, idExpansion: IDEXP, dateAdded: new Date(Date.UTC(2023, 2, 3, 12, 0, t++)).toISOString() });
    };
    const carte = (c, n, nom, images, sansImpression = false) => set(B, 'cartes', { _id: c, nomEn: nom, sets: [SET], impressions: sansImpression ? [] : [{ tirage: 'intl', expansion: EXPANSION, numero: n, total: null }], images });
    const entreeImg = (c, n, cle) => ({ set: SET, source: 'tcgdex', cleR2: cle, numero: n, w: 600, h: 825, langue: 'en', vignette: { cleR2: `vignettes/${cle}`, w: 200, h: 275 } });
    const docImg = (c, n, cle) => set(B, 'images', { _id: cle.replace(/\.webp$/, ''), source: 'tcgdex', set: SET, carteId: c, numero: n, cleR2: cle, etat: 'ok' });
    for (const p of PAIRES) {
        // V1 est le plus ancien : le premier de `ids` est créé d'abord
        const v1 = () => ajouterProduit(p.c, p.n, p.nom, p.ids[0], 'V1', `${p.nom.replace(/ /g, '-')}-V1-SVPen${p.n}`), v2 = () => ajouterProduit(p.c, p.n, p.nom, p.ids[1], 'V2', `${p.nom.replace(/ /g, '-')}-V2-SVPen${p.n}`, p.numeroFicheV2 ?? p.n);
        if (p.inverse) { v2(); v1(); } else { v1(); v2(); }
        if (p.troisieme) ajouterProduit(p.c, p.n, 'Autre nom', p.troisieme, 'V1', `Autre-nom-V1-SVPen${p.n}`);
        const imgs = p.cle ? [entreeImg(p.c, p.n, p.cle)] : [];
        if (p.c === 278879) imgs.push({ set: SET_PP3, source: 'pokumon', lot: 'pokumon-2026-10', cleR2: 'pokumon/pp3-056.webp', numero: '056', partageeHoloNonHolo: true, produitsPartages: [9, 10] });
        // une AUTRE entrée du même set (autre numéro, autre fichier) : le marquage ne doit viser que l'entrée servie
        if (p.c === 300001) imgs.push({ set: SET, source: 'bulbapedia', cleR2: 'bulbapedia/SV-Black-Star-Promos/777-300001.webp', numero: '777', w: 600, h: 825, langue: 'en' });
        carte(p.c, p.n, p.nom, imgs, p.sansImpression);
        if (p.cle) docImg(p.c, p.n, p.cle);
        if (p.docAutreCarte) set(B, 'images', { _id: p.cle.replace(/\.webp$/, ''), source: 'tcgdex', set: SET, carteId: p.docAutreCarte, numero: p.n, cleR2: p.cle, etat: 'ok' });
        index.push(entree(p.c * 10 + 1, p.simple, p.ev), entree(p.c * 10 + 2, p.stamp, p.evS));
    }
    // un document `images` qui sert AUSSI une entrée d'un autre set et d'une autre carte
    set(B, 'cartes', { _id: 300099, nomEn: 'Bulbasaur', sets: ['Autre-Set'], impressions: [], images: [{ set: 'Autre-Set', source: 'bulbapedia', cleR2: 'bulbapedia/partage-013.webp', numero: '1' }] });
    // deux produits de même nom et de même numéro sur deux CARTES différentes : deux groupes d'un produit, jamais une paire
    for (const [c, id, v] of [[300012, 800070, 'V1'], [300013, 800071, 'V2']]) {
        ajouterProduit(c, '021', 'Zorua', id, v, `Zorua-${v}-SVPen021`);
        set(B, 'cartes', { _id: c, nomEn: 'Zorua', sets: [SET], impressions: [{ tirage: 'intl', expansion: EXPANSION, numero: '021', total: null }], images: [entreeImg(c, '021', `tcgdex/SV-Black-Star-Promos/021-${c}.webp`)] });
        set(B, 'images', { _id: `tcgdex/SV-Black-Star-Promos/021-${c}`, source: 'tcgdex', set: SET, carteId: c, numero: '021', cleR2: `tcgdex/SV-Black-Star-Promos/021-${c}.webp`, etat: 'ok' });
    }
    index.push(entree(3000121, 'Zorua (SVP021 English Promo)', [5000]), entree(3000122, 'Staff Zorua (SVP021 English Promo)', [5000]));
    // trois produits sur une fiche
    for (const [i, id] of TROIS.ids.entries()) ajouterProduit(TROIS.c, TROIS.n, TROIS.nom, id, `V${i + 1}`, `Eevee-V${i + 1}-SVPen${TROIS.n}`);
    carte(TROIS.c, TROIS.n, TROIS.nom, [entreeImg(TROIS.c, TROIS.n, 'tcgdex/SV-Black-Star-Promos/014-300005.webp')]);
    docImg(TROIS.c, TROIS.n, 'tcgdex/SV-Black-Star-Promos/014-300005.webp');
    index.push(entree(3000051, 'Eevee (SVP014 English Promo)', [5000]), entree(3000052, 'Staff Eevee (SVP014 English Promo)', [5000]));
    return { B, PR, index };
}
const CHAMPS = ['produitsPartages', 'partageeTamponNonSepare', 'tamponNonRepresente'];
const entreeDe = (B, c, cle) => B.col('cartes').get(c).images.find(e => e.cleR2 === cle);

(async () => {
    const RACINE = process.env.RACINE_SITE || 'C:/Users/Yung/Desktop/pokemon-proxy';
    const regle = await X.regleDuSite(RACINE), site = await P.chargerRegleDuSite(RACINE);
    const plan = async (m) => T.construirePlan({ cartesDb: m.B.db, prodDb: m.PR.db, regle, site, index: m.index });

    // ── 1. LE COUPLE D'ENTRÉES POKUMON : une liste fermée de mots, rien d'autre de différent ──
    const E = (id, titre, ev = [5000]) => entree(id, titre, ev);
    await essayer('couple Staff', () => {
        const r = T.coupleTampon([E(1, 'Slowbro (MEP083 English Promo)', [9698]), E(2, 'Staff Slowbro (MEP083 English Promo)', [9698])]);
        verifier('couple « Staff » : prouvé, tampon « Staff », l\'entrée tamponnée est la seconde', [r.tampon, r.entreeTamponnee?.id, r.entreeSimple?.id, r.motif ?? null], ['Staff', 2, 1, null]);
        const r2 = T.coupleTampon([E(2, 'Staff Slowbro (MEP083 English Promo)', [9698]), E(1, 'Slowbro (MEP083 English Promo)', [9698])]);
        verifier('couple « Staff » : indépendant de l\'ordre des entrées', [r2.tampon, r2.entreeTamponnee?.id], ['Staff', 2]);
    });
    await essayer('couple Play', () => {
        const r = T.coupleTampon([E(1, 'Cyclizar ex (SVP018 English Promo)', [7854]), E(2, 'Holofoil Play Pokemon Cyclizar ex (SVP018 English Promo)', [7838])]);
        verifier('couple « Holofoil Play Pokemon » : prouvé, libellé « Play! Pokémon » (l\'événement du tampon est un Prize Pack)', [r.tampon, r.entreeTamponnee?.id, r.motif ?? null], ['Play! Pokémon', 2, null]);
        const r2 = T.coupleTampon([E(1, 'Cyclizar ex (SVP018 English Promo)', [7854]), E(2, 'Holofoil Play Pokemon Cyclizar ex (SVP018 English Promo)', [5000])]);
        verifier('couple « Play! » dont l\'événement n\'est pas celui d\'un Prize Pack : refusé', [r2.tampon ?? null, typeof r2.motif], [null, 'string']);
    });
    await essayer('couple autres mots', () => {
        for (const mot of ['Prerelease', 'Reverse Holo', 'Cosmos', 'Holofoil', 'Winner', 'Staff Cosmos']) {
            const r = T.coupleTampon([E(1, 'Slowbro (MEP083 English Promo)'), E(2, `${mot} Slowbro (MEP083 English Promo)`)]);
            verifier(`couple avec le mot « ${mot} » : hors liste fermée, refusé avec un motif`, [r.tampon ?? null, typeof r.motif], [null, 'string']);
        }
    });
    await essayer('couple structure', () => {
        const a = E(1, 'Slowbro (MEP083 English Promo)'), b = E(2, 'Staff Slowbro (MEP083 English Promo)'), c = E(3, 'Staff Slowbro (MEP083 Autre Promo)');
        verifier('trois entrées : refusé', [T.coupleTampon([a, b, c]).tampon ?? null], [null]);
        verifier('trois entrées dont UNE seule tamponnée (deux simples identiques) : refusé', [T.coupleTampon([a, b, E(8, 'Slowbro (MEP083 English Promo)')]).tampon ?? null], [null]);
        verifier('une seule entrée : refusé', [T.coupleTampon([a]).tampon ?? null], [null]);
        verifier('deux entrées tamponnées (Staff et Staff) : refusé', [T.coupleTampon([b, E(4, 'Staff Slowbro (MEP083 English Promo)')]).tampon ?? null], [null]);
        verifier('deux entrées sans mot : refusé', [T.coupleTampon([a, E(5, 'Slowbro (MEP083 English Promo)')]).tampon ?? null], [null]);
        verifier('un autre texte de set (parenthèse) : refusé', [T.coupleTampon([a, c]).tampon ?? null], [null]);
        verifier('un autre numéro : refusé', [T.coupleTampon([a, E(6, 'Staff Slowbro (MEP084 English Promo)')]).tampon ?? null], [null]);
        verifier('Staff avec des événements différents : refusé', [T.coupleTampon([E(1, 'Slowbro (MEP083 English Promo)', [1]), E(2, 'Staff Slowbro (MEP083 English Promo)', [2])]).tampon ?? null], [null]);
        verifier('Staff sans aucun événement : refusé (rien ne prouve que c\'est la même impression)', [T.coupleTampon([E(1, 'Slowbro (MEP083 English Promo)', []), E(2, 'Staff Slowbro (MEP083 English Promo)', [])]).tampon ?? null], [null]);
        verifier('Staff contre une entrée Holofoil : le brillant diffère aussi, refusé', [T.coupleTampon([E(1, 'Holofoil Slowbro (MEP083 English Promo)'), E(2, 'Staff Holofoil Slowbro (MEP083 English Promo)')]).tampon ?? null], [null]);
        const horsAnglais = P.lireEntree({ ...brute(7, 'Staff Slowbro (MEP083 English Promo)', [5000]), language: [9999] });
        verifier('une entrée qui n\'est pas anglaise : refusé', [T.coupleTampon([E(1, 'Slowbro (MEP083 English Promo)'), horsAnglais]).tampon ?? null], [null]);
    });
    await essayer('rangV', () => {
        verifier('rangV : variante V2 → 2, slug sans jeton → 1, jeton du slug quand la variante manque (Galarian-Rapidash-V-V2 → 2)', [T.rangV({ variante: 'V2', slugProduit: 'X-V2-SVP001' }), T.rangV({ variante: 'V1', slugProduit: 'Slowbro-MEP083' }), T.rangV({ variante: null, slugProduit: 'Galarian-Rapidash-V-V2' }), T.rangV({ variante: null, slugProduit: 'Galarian-Rapidash-V-V1' })], [2, 1, 2, 1]);
        verifier('rangV : variante absente et slug sans jeton → 1 ; deux jetons → null', [T.rangV({ variante: null, slugProduit: 'Slowbro-MEP083' }), T.rangV({ variante: null, slugProduit: 'X-V1-V2-SVP001' })], [1, null]);
    });

    // ── 2. LE PLAN : chaque paire prouvée, ou refusée avec son motif ──
    let m = monde();
    await essayer('plan', async () => {
        const p = await plan(m);
        const par = c => p.paires.find(x => x.carteId === c);
        verifier('plan : exactement les quatre paires prouvées (Play! Mimikyu, Staff Pikachu, Staff Bulbasaur à document partagé, Staff Machop à document d\'une autre carte)', p.paires.map(x => x.carteId).sort(), [278879, 300001, 300004, 300010]);
        verifier('plan : le libellé suit le mot (Play! Pokémon / Staff)', [par(278879).tampon, par(300001).tampon, par(300004).tampon], ['Play! Pokémon', 'Staff', 'Staff']);
        verifier('plan : produitsPartages = [V1, V2], V1 le plus ancien — même quand son idProduct est le plus grand (Pikachu : 800002 puis 800001)', [par(300001).produits, par(278879).produits], [[800002, 800001], [701130, 701131]]);
        verifier('plan : l\'entrée visée est celle que la fiche SERT (set, cleR2, numéro de la fiche)', [par(278879).entree.set, par(278879).entree.cleR2, par(278879).entree.numero], [SET, 'tcgdex/SV-Black-Star-Promos/004-278879.webp', '004']);
        verifier('plan : le document images de l\'entrée servie est marqué, sauf quand il sert aussi une entrée d\'un AUTRE set ou d\'une autre carte (compté)', [par(278879).doc, par(300001).doc, par(300004).doc, par(300010).doc, p.comptes.documentsPartages], [{ _id: 'tcgdex/SV-Black-Star-Promos/004-278879' }, { _id: 'tcgdex/SV-Black-Star-Promos/010-300001' }, null, null, 2]);
        const refus = c => p.refus.find(x => x.carteId === c)?.motif ?? null;
        verifier('plan : « Prerelease » → refusée, motif nommé', typeof refus(300002), 'string');
        verifier('plan : « Reverse Holo » → refusée, motif nommé', typeof refus(300003), 'string');
        verifier('plan : trois produits sur une fiche → jamais une paire', typeof refus(300005), 'string');
        verifier('plan : paire dont la fiche sert un 3e produit (autre nom, même carte et même numéro) → refusée', typeof refus(300007), 'string');
        verifier('plan : aucune image servie → refusée', typeof refus(300006), 'string');
        verifier('plan : événements Staff différents → refusée', typeof refus(300008), 'string');
        verifier('plan : V1 plus récent que V2 chez Cardmarket → refusée', refus(300009), 'v1-pas-le-plus-ancien');
        verifier('plan : carte sans impression dans le set (le site la sert sur une fiche SANS numéro) → refusée, motif nommé', refus(300011), 'fiche-sans-le-numero-du-produit');
        verifier('plan : V2 placé sur une autre fiche par le serveur (le site ne le sert pas ici) → refusée', refus(300014), 'fiche-differente');
        verifier('plan : deux produits de même nom et numéro sur deux cartes différentes → deux groupes d\'un produit, ni paire ni refus', [p.paires.some(x => [300012, 300013].includes(x.carteId)), p.refus.some(x => [300012, 300013].includes(x.carteId))], [false, false]);
        verifier('plan : toute paire est marquée OU refusée avec un motif (pas de silence) : 4 + 9 candidats', [p.paires.length, p.refus.length], [4, 9]);
        verifier('plan : rien n\'est écrit par le plan (aucun updateOne)', [m.B.writes.length, m.PR.writes.length], [0, 0]);
    });

    // ── 3. L'ÉCRITURE ──
    m = monde();
    await essayer('ecriture', async () => {
        const avant = JSON.parse(m.B.instantane());
        const p = await plan(m);
        const sim = await T.appliquer(m.B.db, p, { ecrire: false });
        verifier('simulation : rien n\'est écrit et le compte est rendu', [m.B.writes.length, sim.entrees, sim.documents], [0, 4, 2]);
        await T.appliquer(m.B.db, p, { ecrire: true, attendu: 4 }).then(r => {
            verifier('écriture : 4 entrées, 2 documents (deux documents servent autre chose : entrée seule)', [r.entrees, r.documents, r.documentsPartages], [4, 2, 2]);
        });
        const e = entreeDe(m.B, 278879, 'tcgdex/SV-Black-Star-Promos/004-278879.webp');
        verifier('écriture : l\'entrée Play! porte les trois champs avec les valeurs exactes', [e.produitsPartages, e.partageeTamponNonSepare, e.tamponNonRepresente], [[701130, 701131], true, 'Play! Pokémon']);
        const s = entreeDe(m.B, 300001, 'tcgdex/SV-Black-Star-Promos/010-300001.webp');
        verifier('écriture : l\'entrée Staff porte « Staff » et ses produits dans l\'ordre V1, V2', [s.produitsPartages, s.tamponNonRepresente], [[800002, 800001], 'Staff']);
        const dP = m.B.col('images').get('tcgdex/SV-Black-Star-Promos/004-278879'), dS = m.B.col('images').get('bulbapedia/partage-013'), dB = m.B.col('images').get('tcgdex/SV-Black-Star-Promos/010-300001');
        verifier('écriture : le document images non partagé porte les trois champs ; celui qui sert une autre entrée n\'en porte AUCUN', [CHAMPS.map(c => c in (dP || {})), CHAMPS.map(c => c in (dS || {})), dB?.partageeTamponNonSepare], [[true, true, true], [false, false, false], true]);
        verifier('écriture : l\'entrée dont le document est partagé est marquée quand même', [entreeDe(m.B, 300004, 'bulbapedia/partage-013.webp').partageeTamponNonSepare], [true]);
        verifier('écriture : le document qui nomme une AUTRE carte n\'est pas marqué, son entrée l\'est', [m.B.col('images').get('tcgdex/SV-Black-Star-Promos/019-300010').partageeTamponNonSepare ?? null, entreeDe(m.B, 300010, 'tcgdex/SV-Black-Star-Promos/019-300010.webp').partageeTamponNonSepare], [null, true]);
        verifier('écriture : une AUTRE entrée du même set (autre fichier, autre numéro) n\'est pas marquée', [CHAMPS.map(c => c in entreeDe(m.B, 300001, 'bulbapedia/SV-Black-Star-Promos/777-300001.webp'))], [[false, false, false]]);
        verifier('écriture : l\'entrée du set Prize Pack de la même carte n\'a pas bougé', [entreeDe(m.B, 278879, 'pokumon/pp3-056.webp')], [{ set: SET_PP3, source: 'pokumon', lot: 'pokumon-2026-10', cleR2: 'pokumon/pp3-056.webp', numero: '056', partageeHoloNonHolo: true, produitsPartages: [9, 10] }]);
        verifier('écriture : l\'entrée de l\'autre set qui partage le fichier n\'a pas bougé', [m.B.col('cartes').get(300099).images], [[{ set: 'Autre-Set', source: 'bulbapedia', cleR2: 'bulbapedia/partage-013.webp', numero: '1' }]]);
        // aucun autre champ touché : on retire les trois champs du monde écrit et on retrouve le monde d'avant
        const apres = JSON.parse(m.B.instantane());
        for (const [, docs] of apres) for (const d of docs) { for (const c of CHAMPS) delete d[c]; for (const im of d.images || []) if (im.partageeTamponNonSepare !== undefined || im.tamponNonRepresente !== undefined) for (const c of CHAMPS) delete im[c]; }
        // l'entrée Prize Pack garde son produitsPartages : on le remet pour la comparaison
        const pp = apres.find(([n]) => n === 'cartes')[1].find(d => d._id === 278879).images.find(x => x.set === SET_PP3); pp.produitsPartages = [9, 10];
        verifier('écriture : AUCUN autre champ n\'a bougé (monde moins les trois champs = monde d\'avant)', JSON.stringify(apres), JSON.stringify(avant));
        verifier('écriture : seules les collections `cartes` et `images` sont écrites', [...new Set(m.B.writes.map(w => w.n))].sort(), ['cartes', 'images']);
        // idempotence
        const nw = m.B.writes.length;
        const p2 = await plan(m);
        verifier('idempotence : le plan rejoué dit « déjà marquées » pour les 4 entrées et les 2 documents', [p2.comptes.entreesDeja, p2.comptes.documentsDeja, p2.paires.length], [4, 2, 4]);
        const r2 = await T.appliquer(m.B.db, p2, { ecrire: true, attendu: 4 });
        verifier('idempotence : un second passage n\'écrit rien et le dit', [m.B.writes.length - nw, r2.entrees, r2.documents, r2.dejaFait], [0, 0, 0, true]);
    });
    m = monde();
    await essayer('attendu', async () => {
        const p = await plan(m); const s = m.B.instantane();
        let msg = null; try { await T.appliquer(m.B.db, p, { ecrire: true, attendu: 64 }); } catch (e) { msg = String(e.message); }
        verifier('--attendu=64 alors que 4 paires sont prouvées : refuse AVANT d\'écrire (rien n\'a bougé)', [/64/.test(msg || ''), m.B.writes.length, m.B.instantane() === s], [true, 0, true]);
        let msg2 = null; try { await T.appliquer(m.B.db, p, { ecrire: true }); } catch (e) { msg2 = String(e.message); }
        verifier('--ecrire sans --attendu : refuse (le compte attendu est obligatoire à l\'écriture)', [typeof msg2, m.B.writes.length], ['string', 0]);
    });
    await essayer('holo', async () => {
        const m2 = monde();
        entreeDe(m2.B, 300001, 'tcgdex/SV-Black-Star-Promos/010-300001.webp').partageeHoloNonHolo = true;
        const p = await plan(m2);
        verifier('une entrée déjà marquée « holo / non-holo » n\'est jamais écrasée : paire refusée, motif nommé', [p.paires.some(x => x.carteId === 300001), typeof p.refus.find(x => x.carteId === 300001)?.motif], [false, 'string']);
    });

    // ── 4. LE RETRAIT : ces trois champs, et seulement eux ──
    m = monde();
    await essayer('retrait', async () => {
        const avant = m.B.instantane();
        const p = await plan(m); await T.appliquer(m.B.db, p, { ecrire: true, attendu: 4 });
        const sim = await T.retirer(m.B.db, { ecrire: false });
        verifier('retrait en simulation : rien n\'est écrit, le compte est rendu', [sim.entrees, sim.documents], [4, 2]);
        const r = await T.retirer(m.B.db, { ecrire: true, attendu: 4 });
        verifier('retrait : 4 entrées et 2 documents rendus', [r.entrees, r.documents], [4, 2]);
        const pp = m.B.col('cartes').get(278879).images.find(x => x.set === SET_PP3);
        verifier('retrait : l\'entrée Prize Pack garde son produitsPartages et son partageeHoloNonHolo', [pp.produitsPartages, pp.partageeHoloNonHolo], [[9, 10], true]);
        verifier('retrait : le monde est identique à celui d\'avant le marquage', m.B.instantane() === avant, true);
        const r2 = await T.retirer(m.B.db, { ecrire: true });
        verifier('retrait : un second passage ne retire rien et le dit', [r2.entrees, r2.documents, r2.dejaFait], [0, 0, true]);
        let msg = null; try { await T.retirer(m.B.db, { ecrire: true, attendu: 9 }); } catch (e) { msg = String(e.message); }
        verifier('retrait : --attendu qui diffère refuse', typeof msg, 'string');
    });

    // ── 5. L'INDEX EN CACHE : plus de 12 h, on s'arrête ──
    await essayer('index', () => {
        const fs = require('fs'), os = require('os');
        const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'bsst-'));
        const f = path.join(dossier, 'index-familles.json');
        fs.writeFileSync(f, JSON.stringify({ le: '2026-10-17T10:00:00.000Z', entrees: [{ id: 1 }] }));
        verifier('index : 2 h → lu', T.lireIndexFamilles(f, { maintenant: Date.parse('2026-10-17T12:00:00.000Z') }).entrees.length, 1);
        let msg = null; try { T.lireIndexFamilles(f, { maintenant: Date.parse('2026-10-17T22:30:00.000Z') }); } catch (e) { msg = String(e.message); }
        verifier('index : 12 h 30 → refusé, l\'âge est dit', /12/.test(msg || ''), true);
        fs.writeFileSync(f, JSON.stringify({ le: '2026-10-17T10:00:00.000Z', entrees: [] }));
        let vide = null; try { T.lireIndexFamilles(f, { maintenant: Date.parse('2026-10-17T12:00:00.000Z') }); } catch (e) { vide = String(e.message); }
        verifier('index : vide → refusé (un index vide ne prouve rien)', typeof vide, 'string');
        fs.rmSync(dossier, { recursive: true, force: true });
    });

    // ── 6. LE SCRIPT : l'exécuteur de bout en bout, et la ligne de commande écrite par ce qu'elle autorise ──
    await essayer('script', async () => {
        const { executer } = require(path.join(DIR, 'marquer-partage-tampon.js'));
        const m3 = monde(), sortie = [];
        const base = { cartesDb: m3.B.db, prodDb: m3.PR.db, regle, site, index: m3.index, log: s => sortie.push(s) };
        await executer({ ...base });
        verifier('script : la simulation n\'écrit rien et imprime le dénominateur, les paires et les refus par motif', [m3.B.writes.length, /PAIRES PROUVÉES : 4/.test(sortie.join('\n')), /REFUSÉES : 9/.test(sortie.join('\n')), /simulation/.test(sortie.join('\n'))], [0, true, true, true]);
        sortie.length = 0; await executer({ ...base, ecrire: true, attendu: 4 });
        verifier('script : l\'écriture relit et le dit (4/4 entrées, 2 documents)', /relu : 4\/4 entrées et 2 documents/.test(sortie.join('\n')), true);
        sortie.length = 0; const nw = m3.B.writes.length; await executer({ ...base, ecrire: true, attendu: 4 });
        verifier('script : un second passage ne réécrit rien et le dit', [m3.B.writes.length - nw, /déjà marqué|idempotent/.test(sortie.join('\n'))], [0, true]);
        sortie.length = 0; await executer({ ...base, retirer: true, ecrire: true, attendu: 4 });
        verifier('script : --retirer --ecrire retire et relit', [/relu : 0 entrée/.test(sortie.join('\n')), m3.B.col('cartes').get(300001).images[0].partageeTamponNonSepare], [true, undefined]);
        const { spawnSync } = require('child_process');
        const lancer = (...args) => spawnSync(process.execPath, [path.join(DIR, 'marquer-partage-tampon.js'), ...args], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: '', MONGODB_CARTES_URI: '' } });
        verifier('ligne de commande : un argument inconnu refuse avant toute connexion (code 2)', [lancer('--bidon').status, lancer('--ecrire=1').status], [2, 2]);
        verifier('ligne de commande : --ecrire sans --attendu refuse avant toute connexion (code 2)', lancer('--ecrire').status, 2);
    });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });
