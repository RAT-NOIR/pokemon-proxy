// ============================================================
// LISTES DE SETS CHINOIS « ppr » (récolte RECOLTE, 2026-10-24) — les pages de listes d'une boutique, une vignette ET un original par carte
// ============================================================
// Ordre du testeur (24/10) : « Récolte lente de pokipair et tcgcsv : OUI, selon la doctrine. Images seulement (aucun prix), robots.txt lu, 5 s ou plus par hôte, arrêt définitif au premier
// 401, 403, 410, 429 ou défi. Planche, essai à blanc, écriture, revérification. »
//
// CE QUE LA PAGE DONNE (relevé du 2026-10-24, 9 pages) : une liste de tuiles `<li class="pp-card" data-id data-number data-variant [data-hide-variant]>` qui porte, par bouton `pp-card-open`,
// l'adresse de l'ORIGINAL (`data-full`), la légende « numéro/total · nom · rareté » (`data-caption`) et la miniature (`img src`, suffixe `-218x300`). Aucune page de carte à lire :
// une page de liste = une requête = toutes les cartes du set.
//   · Les sets « simples » (CSV9, CSV10, 30thC) : un numéro « 001/208 » par carte ; plusieurs tuiles au même numéro sont des FINITIONS (reverse Poké Ball / Master Ball), cachées
//     (`data-hide-variant`) sauf une — la tuile VISIBLE est la carte imprimée. Une carte qui n'a que la finition holo ou plein cadre n'a qu'une tuile.
//   · Les Gem Packs : « 01 01/07 » = groupe, rang, total ; sept finitions par carte, et NOS produits (V1…Vn au même groupe) ne disent pas laquelle : AUCUNE n'est prouvable.
//
// LA PREUVE (doctrine TPC) : le set (table FERMÉE ci-dessous, une garde de titre et de total), le numéro ET le nom — le nom de la tuile = le nom de NOTRE fiche (jointure.js `clesNom`, la
// normalisation de production), et, s'il se lit, le nom du produit Cardmarket (son slug). Une tuile visible unique. Un doute est un trou, et son motif s'écrit. Jamais l'image d'un autre
// tirage, d'une autre langue, ni d'une finition non lue. La source ne crée AUCUNE fiche.
//
// Code neutre : `ppr` (source, lot, clé R2, mention) — le nom de la source n'apparaît jamais en public.
'use strict';
const T = require('./tpc');
const J = require('./jointure');
const RC = require('./recolte-commun');
const HOTE = require('./recolte-hote');

const SOURCE = 'ppr';
const LOT = 'ppr-2026-10';
const LANGUE = 'zh-hans';
const LANGUE_PREUVE = 'scan de la carte chinoise imprimée (sinogrammes simplifiés), sous un set au tirage zh-hans ; set, numéro et nom concordants avec la fiche';
const RACINE = 'pokipair.com';
const HOTE_PAGES = 'www.pokipair.com';
const HOTE_IMAGES = 'media.pokipair.com';
const SRC = RC.fabriquerSource({ SOURCE, LOT, LANGUE, LANGUE_PREUVE, TIRAGE: 'zh-hans', CHAMP_BILAN: 'bilanLotPpr', nomsInterdits: ['pokipair', 'poki'] });

/** LA TABLE FERMÉE des pages de listes : une ligne par set de notre base. `titre` et `total` sont des gardes de LECTURE : une page qui ne dit pas ce qu'on attend n'est pas lue. */
const TABLE = Object.freeze([
    { code: 'CSV9C', page: 'stellar-crystal-csv9-card-list', slug: 'Stellar-Crystal', format: 'simple', titre: /CSV9\b/i, total: 208 },
    { code: 'CSV10C', page: 'chasing-glory-csv10-card-list', slug: 'Chasing-Glory-Together', format: 'simple', titre: /CSV10\b/i, total: 222 },
    { code: '30thC', page: '30th-anniversary-30thc-card-list', slug: '30th-Celebration-Simplified-Chinese', format: 'simple', titre: /30thC\b/i, total: 103 },
    { code: 'CBB1C', page: 'gem-pack-volume-one-card-list', slug: 'Gem-Pack-Vol-1', format: 'groupe', titre: /Gem Pack Vol 1\b/i },
    { code: 'CBB2C', page: 'gem-pack-vol-2-card-list', slug: 'Gem-Pack-Vol-2', format: 'groupe', titre: /Gem Pack Vol 2\b/i },
    { code: 'CBB3C', page: 'gem-pack-vol-3-card-list', slug: 'Gem-Pack-Vol-3', format: 'groupe', titre: /Gem Pack Vol 3\b/i },
    { code: 'CBB4C', page: 'gem-pack-vol-4-card-list', slug: 'Gem-Pack-Vol-4', format: 'groupe', titre: /Gem Pack Vol 4\b/i },
    { code: 'CBB5C', page: 'gem-pack-vol-5-card-list', slug: 'Gem-Pack-Vol5', format: 'groupe', titre: /Gem Pack Vol 5\b/i },
    { code: 'CBB6C', page: 'gem-pack-vol-6-card-list', slug: 'Gem-Pack-Vol-6', format: 'groupe', titre: /Gem Pack Vol 6\b/i }
]);
const ligneDe = code => TABLE.find(l => l.code === code) ?? null;
const ligneDuSet = slug => TABLE.find(l => l.slug === slug) ?? null;
const urlPage = page => {
    if (!TABLE.some(l => l.page === page)) throw new Error(`ppr : page « ${page} » hors de la table fermée`);
    return `https://${HOTE_PAGES}/${page}/`;
};
/** L'hôte, le chemin et le dossier d'une image : la forme fermée qu'on a relevée (https://media…/AAAA/MM/JJHHMMSS/<fichier>.png). */
const CHEMIN_IMAGE = /^\/\d{4}\/\d{2}\/\d{6,12}\/[A-Za-z0-9_.-]+\.(png|jpe?g|webp)$/;
const urlImageValide = url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === HOTE_IMAGES && !u.search && !u.hash && !u.port && CHEMIN_IMAGE.test(u.pathname); } catch { return false; } };
const miniatureDe = url => String(url).replace(/\.(png|jpe?g|webp)$/i, '-218x300.$1');

/** La liste FERMÉE des hôtes et des chemins du client poli. */
function hotes() {
    const pages = TABLE.map(l => `/${l.page}/`);
    return {
        [HOTE_PAGES]: { chemin: new RegExp(`^(/robots\\.txt|${pages.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`) },
        [HOTE_IMAGES]: { chemin: new RegExp(`^(/robots\\.txt|${CHEMIN_IMAGE.source.replace(/^\^/, '').replace(/\$$/, '')})$`) }
    };
}
function fabriquerClient(o) { return HOTE.fabriquerClient({ racine: RACINE, hotes: hotes(), ...o }); }

// ── LA LECTURE D'UNE PAGE DE LISTE ────────────────────────────────────────────────────────────────────────────────────────────
const attr = (s, k) => { const m = new RegExp(`(?:^|\\s)${k}="([^"]*)"`).exec(s); return m ? T.entites(m[1]) : null; };
const TUILE = /<li class="pp-card"([^>]*)>([\s\S]*?)<\/li>/g;

/**
 * Les tuiles d'une page (entière ou réduite par `reduirePage`), dans l'ordre. Une tuile illisible n'est PAS écartée en silence : elle est rendue avec `illisible` (le motif), pour être comptée.
 * @returns {{id, numero, n, total, groupe, rang, variante, cachee, url, miniature, nom, rarete, illisible?}[]}
 */
function lireTuiles(html) {
    const tuiles = [];
    for (const m of String(html ?? '').matchAll(TUILE)) {
        const a = m[1], corps = m[2];
        const numero = attr(a, 'data-number'), variante = attr(a, 'data-variant'), id = attr(a, 'data-id');
        const bouton = /<button[^>]*class="pp-card-open"[^>]*>/.exec(corps)?.[0] ?? '';
        const url = attr(bouton, 'data-full'), legende = attr(bouton, 'data-caption'), alt = attr(bouton, 'data-alt');
        const miniature = /<img[^>]*\ssrc="([^"]*)"/.exec(corps)?.[1] ?? null;
        const parties = String(legende ?? '').split(' · ');
        const t = { id, numero, variante, cachee: /(?:^|\s)data-hide-variant="1"/.test(a), url, miniature, nom: parties[1] ?? null, rarete: parties[2] ?? null, n: null, total: null, groupe: null, rang: null };
        // « 001/208 » (simple) ou « 01 01/07 » (groupe, rang, total)
        let q;
        if ((q = /^(\d{1,4})\/(\d{1,4})$/.exec(numero ?? ''))) { t.n = J.cleNumero(q[1]); t.total = Number(q[2]); }
        else if ((q = /^(\d{1,3}) (\d{1,3})\/(\d{1,3})$/.exec(numero ?? ''))) { t.groupe = q[1]; t.rang = q[2]; t.total = Number(q[3]); }
        const manque = !id ? 'identifiant' : !numero ? 'numéro' : !variante ? 'variante' : !url ? 'adresse de l\'original' : !t.nom ? 'nom' : (t.n == null && t.groupe == null) ? `numéro « ${numero} » hors des deux formes` : null;
        const incoherent = !manque && (parties[0] !== numero || (alt != null && alt !== `${numero} · ${t.nom}`)) ? 'légende et alt contredisent le numéro' : null;
        if (manque || incoherent) t.illisible = manque ? `tuile sans ${manque}` : incoherent;
        tuiles.push(t);
    }
    return tuiles;
}
/** Le titre, le h1, le nombre annoncé (ld+json), le total dominant des tuiles : ce que la garde de lecture compare à la table. */
function lirePage(html) {
    const h = String(html ?? '');
    const titre = T.entites(/<title>([^<]*)<\/title>/i.exec(h)?.[1] ?? '') || null;
    const h1 = T.entites((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(h)?.[1] ?? '').replace(/<[^>]+>/g, '').trim()) || null;
    const annonce = /"numberOfItems":(\d+)/.exec(h)?.[1];
    const tuiles = lireTuiles(h);
    const compte = {};
    for (const t of tuiles) if (t.total != null) compte[t.total] = (compte[t.total] || 0) + 1;
    const dominant = Object.entries(compte).sort((a, b) => b[1] - a[1])[0];
    return { titre, h1, annonce: annonce ? Number(annonce) : null, tuiles, totalDominant: dominant ? Number(dominant[0]) : null, parTotal: compte };
}
/** La page réduite à ce qu'on lit (la page entière pèse ~1 Mo et 90 % de gabarit) : `lirePage(reduirePage(h))` donne les mêmes tuiles que `lirePage(h)`. */
function reduirePage(html) {
    const h = String(html ?? '');
    const titre = /<title>[^<]*<\/title>/i.exec(h)?.[0] ?? '<title></title>';
    const h1 = /<h1[^>]*>[\s\S]*?<\/h1>/i.exec(h)?.[0] ?? '';
    const annonce = /"numberOfItems":(\d+)/.exec(h)?.[1];
    const lis = [...h.matchAll(TUILE)].map(m => {
        const a = m[1], corps = m[2];
        const bouton = /<button[^>]*class="pp-card-open"[^>]*>/.exec(corps)?.[0] ?? '';
        const img = /<img[^>]*\ssrc="[^"]*"/.exec(corps)?.[0] ?? '';
        return `<li class="pp-card"${a}>${bouton}${img}></button></li>`;
    });
    return `<!doctype html><html><head>${titre}${annonce ? `<script type="application/ld+json">{"numberOfItems":${annonce}}</script>` : ''}</head><body>${h1}<ul class="pp-set-grid">${lis.join('')}</ul></body></html>`;
}

/** La garde de LECTURE d'une page : son titre et son total disent le set attendu. Écrite par ce qu'elle autorise ; une page de groupes (Gem Pack) ne porte pas de total de set. */
function verdictDePage(page, ligne) {
    if (!ligne) return { ok: false, motif: 'ligne de table absente' };
    if (!page.tuiles.length) return { ok: false, motif: 'aucune tuile lue (la page n\'a pas la forme attendue)' };
    const sans = page.tuiles.filter(t => t.illisible).length;
    if (sans > page.tuiles.length * 0.05) return { ok: false, motif: `${sans} tuile(s) illisible(s) sur ${page.tuiles.length} (plus de 5 %)` };
    if (!ligne.titre.test(`${page.titre ?? ''} ${page.h1 ?? ''}`)) return { ok: false, motif: `titre « ${page.h1 ?? page.titre} » : ne porte pas ${ligne.titre}` };
    if (ligne.format === 'simple' && page.totalDominant !== ligne.total) return { ok: false, motif: `total dominant ${page.totalDominant}, ${ligne.total} attendu` };
    return { ok: true, tuiles: page.tuiles.length, illisibles: sans };
}

// ── LA PREUVE ET LE PLAN : set + numéro + nom + tuile visible unique — un doute est un trou ──────────────────────────────────────
/** Les finitions qui sont LA carte imprimée quand elles sont seules visibles ; tout autre libellé (reverse, glitter, gem…) n'est pas la carte du produit. */
const VARIANTES_BASE = Object.freeze(['normal', 'holo', 'full-art']);
/** Le nom du produit Cardmarket lu sur son slug « Salandit-CSV9C024 », « Pikachu-V2-CSV10C089 » : null si le slug ne finit pas par le code du set suivi du numéro (jamais deviné). */
function nomDuProduit(slug, code) {
    const t = String(slug ?? '').split('-').filter(Boolean);
    if (!t.length || !new RegExp(`^${String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+[A-Za-z]*$`, 'i').test(t[t.length - 1])) return null;
    t.pop();
    while (t.length && /^V\d+$/i.test(t[t.length - 1])) t.pop();
    return t.length ? t.join(' ') : null;
}
const memeNom = (a, b) => { const ka = J.clesNom(a), kb = J.clesNom(b); return ka.some(k => kb.includes(k)); };

/**
 * LES EXCLUSIONS MOTIVÉES (tour 2, relecture D7) : une liste FERMÉE, écrite à la main, de couples (carte, tuile) qu'aucune preuve de nom ni de numéro ne protège d'une image DÉFORMÉE — la tuile est la bonne carte,
 * mais son original est mal cadré. Chaque ligne porte la carte, l'identifiant de la tuile (`idSource`), le motif (une phrase) et la date de la décision ; les DEUX identifiants doivent concorder pour que
 * l'exclusion vaille (une autre tuile de la même carte n'est pas exclue). Remplacer un scan correct par une image déformée est une dégradation.
 */
const EXCLUSIONS = Object.freeze([
    Object.freeze({ carteId: 208222, idSource: '30881', code: '30thC', nom: 'Greninja BREAK n° 157', le: '2026-10-24',
        motif: 'carte BREAK (horizontale) : l\'original 350×482 est la carte étirée d\'environ 1,9 en hauteur dans un cadre portrait (le badge rond « 30 » devient ovale) ; l\'ancien scan, couché, garde les bonnes proportions (relecture 2026-10-24, D7)' })
]);

/**
 * @param {{ligne: object, tuiles: object[], produits: Array<{carteId:number, idProduct:number, numeroFiche:string|null, slug:string|null, carteNom:string|null, carte?:object}>, temoin?: Function}} o
 *   `produits` : les produits JOINTS du set (cartes_produits) — la source ne crée aucune fiche. `temoin` : `temoinDuNom(cartesDuSet)` (jointure.js), pour NOMMER un désaccord de nom.
 * @returns {{unites: object[], restes: object[], parMotif: object, base: object}}
 */
function planifier({ ligne, tuiles, produits, temoin = null, exclusions = EXCLUSIONS }) {
    const restes = [], unites = [];
    const reste = (p, motif, detail) => restes.push({ carteId: p.carteId, idProduct: p.idProduct, numero: p.numeroFiche ?? null, motif, ...(detail ? { detail } : {}) });
    const parNumero = new Map();
    for (const t of tuiles || []) { if (t.illisible || t.n == null) continue; (parNumero.get(t.n) || parNumero.set(t.n, []).get(t.n)).push(t); }
    const base = { tuiles: (tuiles || []).length, illisibles: (tuiles || []).filter(t => t.illisible).length, numeros: parNumero.size, sansTuileVisible: 0, tuilesVisiblesMultiples: 0, varianteNonAdmise: 0 };
    const baseDe = new Map();
    for (const [n, l] of parNumero) {
        const visibles = l.filter(t => !t.cachee);
        if (visibles.length !== 1) { if (visibles.length) base.tuilesVisiblesMultiples++; else base.sansTuileVisible++; baseDe.set(n, { motif: visibles.length ? 'tuile-ambigue' : 'aucune-tuile-visible', detail: `${l.length} tuile(s) au numéro, ${visibles.length} visible(s)` }); continue; }
        if (!VARIANTES_BASE.includes(visibles[0].variante)) { base.varianteNonAdmise++; baseDe.set(n, { motif: 'variante-non-admise', detail: `la seule tuile visible est « ${visibles[0].variante} »` }); continue; }
        baseDe.set(n, { tuile: visibles[0] });
    }
    // les produits par (carte, numéro) : deux produits au même numéro d'une même carte sont des variantes que la source ne distingue pas
    const cle = p => `${p.carteId}|${p.numeroFiche == null ? '' : J.cleNumero(p.numeroFiche)}`;
    const effectifs = new Map();
    for (const p of produits || []) effectifs.set(cle(p), (effectifs.get(cle(p)) || 0) + 1);
    const lignesDuProduit = new Map();
    for (const p of produits || []) lignesDuProduit.set(p.idProduct, (lignesDuProduit.get(p.idProduct) || 0) + 1);
    const revendiquees = new Map();
    for (const p of produits || []) {
        if (lignesDuProduit.get(p.idProduct) > 1) { reste(p, 'produit-vers-plusieurs-cartes'); continue; }       // un produit joint à plusieurs cartes n'en désigne aucune
        if (ligne.format !== 'simple') { reste(p, 'format-groupe-variante-non-lue', effectifs.get(cle(p)) > 1 ? `${effectifs.get(cle(p))} produits au même groupe, 7 finitions à la source` : 'le groupe ne désigne pas une finition'); continue; }
        if (p.numeroFiche == null || String(p.numeroFiche).trim() === '') { reste(p, 'sans-numero'); continue; }
        if (!p.carteNom) { reste(p, 'sans-nom'); continue; }
        if (effectifs.get(cle(p)) > 1) { reste(p, 'variantes', `${effectifs.get(cle(p))} produits au même numéro de la même carte`); continue; }
        const b = baseDe.get(J.cleNumero(p.numeroFiche));
        if (!b) { reste(p, 'absente-de-la-source'); continue; }
        if (!b.tuile) { reste(p, b.motif, b.detail); continue; }
        const t = b.tuile;
        const nomJoint = p.carte ? J.nomJointDe(p.carte) : p.carteNom;
        if (!memeNom(t.nom, nomJoint)) {
            const autres = temoin && p.carte ? temoin(p.carte, { nom: t.nom, attaques: [] }) : null;
            reste(p, autres ? 'nom-designe-une-autre-carte' : 'nom-different', `« ${t.nom} » à la source, « ${p.carteNom} » chez nous${autres ? ` (désigne ${autres.map(c => c.nomEn).slice(0, 3).join(', ')})` : ''}`);
            continue;
        }
        const nomProduit = nomDuProduit(p.slug, ligne.code);
        if (nomProduit && !memeNom(t.nom, nomProduit)) { reste(p, 'nom-produit-different', `« ${t.nom} » à la source, « ${nomProduit} » sur le produit`); continue; }
        if (!urlImageValide(t.url)) { reste(p, 'adresse-hors-forme', t.url); continue; }
        if (t.miniature !== miniatureDe(t.url)) { reste(p, 'image-incoherente', `miniature ${t.miniature} pour l'original ${t.url}`); continue; }
        const exclue = exclusions.find(x => x.carteId === p.carteId && String(x.idSource) === String(t.id) && (!x.code || x.code === ligne.code));
        if (exclue) { reste(p, 'exclusion-motivee', `${exclue.nom} (${exclue.le}) : ${exclue.motif}`); continue; }
        const u = { carteId: p.carteId, slugSet: ligne.slug, numero: String(p.numeroFiche).trim(), produits: [p.idProduct], slugProduit: p.slug ?? null, url: t.url, idSource: t.id, variante: t.variante, groupe: ligne.code, famille: LANGUE,
            carteNom: p.carteNom, nomSource: t.nom, numeroSource: t.numero, rarete: t.rarete, nomProduit,
            preuve: `liste du set ${ligne.code} : n° ${t.numero} = fiche ${p.numeroFiche}, nom « ${t.nom} » = fiche « ${p.carteNom} »${nomProduit ? ` = produit « ${nomProduit} »` : ' (nom du produit non lisible sur son slug)'}, tuile visible unique (${t.variante})`,
            preuveNeutre: `set ${ligne.code}, n° ${t.numero} = fiche ${p.numeroFiche}, nom « ${t.nom} » = fiche « ${p.carteNom} »${nomProduit ? ` = produit « ${nomProduit} »` : ''}, tuile visible unique (${t.variante})` };
        (revendiquees.get(t.url) || revendiquees.set(t.url, []).get(t.url)).push(u);
        unites.push(u);
    }
    // une même image pour deux produits : aucun des deux (une tuile ne désigne qu'une carte)
    const doubles = new Set([...revendiquees].filter(([, l]) => l.length > 1).map(([url]) => url));
    const gardees = unites.filter(u => !doubles.has(u.url));
    for (const u of unites) if (doubles.has(u.url)) restes.push({ carteId: u.carteId, idProduct: u.produits[0], numero: u.numero, motif: 'tuile-revendiquee-deux-fois', detail: u.url });
    const parMotif = {};
    for (const r of restes) parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    return { unites: gardees, restes, parMotif, base };
}

module.exports = { SOURCE, LOT, LANGUE, LANGUE_PREUVE, RACINE, HOTE_PAGES, HOTE_IMAGES, SRC, TABLE, VARIANTES_BASE, EXCLUSIONS, ligneDe, ligneDuSet, urlPage, urlImageValide, miniatureDe, CHEMIN_IMAGE, hotes, fabriquerClient,
    lireTuiles, lirePage, reduirePage, verdictDePage, nomDuProduit, memeNom, planifier };
