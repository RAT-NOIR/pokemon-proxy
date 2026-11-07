'use strict';
// ============================================================
// LA CHASSE NOCTURNE — règles pures et exploration d'un site (le câblage réseau et fichiers est dans comblement-nocturne.js)
// ============================================================
// Pourquoi (testeur, 07/11) : le comblement ne faisait que REJOUER les relevés de quatre fournisseurs connus -> 0 visuel depuis des nuits. Ici le lot CHERCHE :
// pour chaque site admis du registre PRIVÉ il énumère les collections (index, sitemap), les apparie aux sets troués, lit les listes, apparie les cartes aux produits,
// télécharge la meilleure définition et PRÉPARE des preuves au format PHASE4 (regle « a-lire » : le lot ne regarde pas l'image, ne valide rien, n'écrit rien en base).
// Ce que le lot NE FAIT PAS : la recherche par moteur (aucune sous-commande de la porte, un script ne lance pas WebSearch) reste aux agents ; il leur prépare les requêtes (requetesDeCarte).
// Aucun nom de site ici : les hôtes vivent dans le registre privé (code neutre « w-xxx » partout ailleurs).
const J = require('./jointure');

const ERREURS_DE_SUITE_MAX = 5;
const CADENCE_MIN_MS = 5000, CADENCE_PETIT_MS = 10000, CADENCE_DEFAUT_MS = 6000;
const LARGEUR_SERVIE = 350, LARGEUR_PLANCHER = 200, PAGE_TTL_JOURS = 7, CODES_FERMETURE = Object.freeze([401, 403, 410, 429]);

const normaliser = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const mots = s => normaliser(s).split(' ').filter(Boolean);
const egaux = (a, b) => a.length > 0 && a.length === b.length && a.every((m, i) => m === b[i]);
const prefixe = (p, a) => p.length > 0 && p.length < a.length && p.every((m, i) => m === a[i]);
const hoteDe = u => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } };
const absolue = (u, base) => { try { return new URL(u, base).toString(); } catch { return null; } };
const decoder = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const nonLatin = s => /[^\u0000-ɏ‐-‧]/.test(String(s));

// ── 1. collection <-> set : égalité de MOTS ou code en tête, jamais l'inclusion (§31) ; le tirage de l'index borne les sets possibles ─────────
// `connus` : TOUS les sets connus (troués ou non). Avec lui, un jumeau (même nom, autre tirage, même non troué) rend la collection ambiguë ; le set retenu doit ensuite être un set troué (`sets`).
function apparierCollection(coll, sets, { tirages = null, retirerMots = [], connus = null } = {}) {
    if (connus) { const m = new Map(); for (const s of [...connus, ...sets]) if (!m.has(s.set)) m.set(s.set, s); const trou = new Set(sets.map(s => s.set)); sets = [...m.values()]; return apparierDans(coll, sets, { tirages, retirerMots }, trou); }
    return apparierDans(coll, sets, { tirages, retirerMots }, null);
}
function apparierDans(coll, sets, { tirages, retirerMots }, trou) {
    const retire = new Set(retirerMots.map(normaliser));
    const sansRetires = s => mots(s).filter(m => !retire.has(m));
    const slugM = sansRetires(coll.slug), titreM = sansRetires(coll.titre), codeM = coll.code ? mots(coll.code) : null;
    const trouves = new Map();                              // set -> via
    for (const s of sets) {
        const nomM = mots(s.nom), setM = mots(s.set), codeSet = mots(s.code);
        if (codeM && egaux(codeM, codeSet)) { trouves.set(s, 'code-exact'); continue; }
        if (egaux(nomM, titreM) || egaux(nomM, slugM) || egaux(setM, slugM) || egaux(setM, titreM)) { trouves.set(s, 'nom'); continue; }
        if (egaux(codeSet, slugM)) { trouves.set(s, 'code-slug'); continue; }
        // un préfixe de code SEUL est une inclusion (§31) : il ne désigne rien ; il faut que le reste du slug soit le NOM du set (code+nom)
        if (codeSet.join('').length >= 2 && prefixe(codeSet, slugM) && egaux(nomM, slugM.slice(codeSet.length))) trouves.set(s, 'code+nom');
    }
    const tous = [...trouves.keys()];
    if (!tous.length) return { ok: false, raison: 'aucun' };
    if (trou && tous.length > 1) return { ok: false, raison: 'ambigu', candidats: tous.map(s => s.set) };      // un jumeau d'un autre tirage, même non troué, rend le nom ambigu
    if (trou && !tous.some(s => trou.has(s.set))) return { ok: false, raison: 'non-troue' };
    const admis = tous.filter(s => !tirages || tirages.includes(s.tirage));
    if (!admis.length) return { ok: false, raison: 'tirage-non-admis' };
    if (admis.length > 1) return { ok: false, raison: 'ambigu', candidats: admis.map(s => s.set) };
    return { ok: true, set: admis[0].set, objet: admis[0], via: trouves.get(admis[0]) };
}

// ── 2. carte <-> produit : le numéro désigne (clé de la jointure), le nom TÉMOIGNE sans entrer dans la clé ────────────────────────────────
const sansCrochets = n => String(n ?? '').replace(/\[[^\]]*\]/g, ' ');
const nomsDe = p => [...new Set([normaliser(p.nomEn), normaliser(sansCrochets(p.name))].filter(Boolean))];
function temoinDuNom(itemNom, produit) {
    if (!itemNom || !String(itemNom).trim()) return { nomTemoin: 'absent' };
    if (nomsDe(produit).includes(normaliser(itemNom))) return { nomTemoin: 'concordant' };
    if (nonLatin(itemNom)) return { nomTemoin: 'non-comparable' };
    return { refus: 'nom-contredit' };
}
function apparierItem(item, produits) {
    const cle = item.numero != null && String(item.numero).trim() !== '' ? J.cleNumero(item.numero) : null;
    if (cle) {
        const cands = produits.filter(p => { const n = p.numero ?? p.numeroFiche; return n != null && J.cleNumero(n) === cle; });
        const ids = new Set(cands.map(p => p.idProduct));
        if (!ids.size) return { ok: false, raison: 'numero-absent' };
        if (ids.size > 1) return { ok: false, raison: 'variantes' };
        const t = temoinDuNom(item.nom, cands[0]);
        if (t.refus) return { ok: false, raison: t.refus };
        return { ok: true, produit: cands[0], nomTemoin: t.nomTemoin, via: 'numero' };
    }
    if (!item.nom || !String(item.nom).trim()) return { ok: false, raison: 'item-illisible' };
    const n = normaliser(item.nom);
    const cands = produits.filter(p => nomsDe(p).includes(n));
    const ids = new Set(cands.map(p => p.idProduct));
    if (!ids.size) return { ok: false, raison: 'nom-absent-du-set' };
    if (ids.size > 1) return { ok: false, raison: 'variantes' };
    return { ok: true, produit: cands[0], nomTemoin: 'concordant', via: 'nom' };
}
/** Un produit revendiqué par deux items d'une même source n'est désigné par aucun (les multiplicités se COMPTENT, §34). */
function apparierItems(items, produits) {
    const retenus = [], refus = [], parProduit = new Map();
    for (const item of items) {
        const r = apparierItem(item, produits);
        if (!r.ok) { refus.push({ item, raison: r.raison }); continue; }
        const l = parProduit.get(r.produit.idProduct) || []; l.push({ item, produit: r.produit, nomTemoin: r.nomTemoin, via: r.via }); parProduit.set(r.produit.idProduct, l);
    }
    for (const l of parProduit.values()) {
        if (l.length === 1) retenus.push(l[0]);
        else for (const x of l) refus.push({ item: x.item, raison: 'partage' });
    }
    return { retenus, refus };
}

// ── 3. images ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function meilleureDefinition(images) {
    const l = images.filter(i => Number.isFinite(i.w) && i.w > 0);
    if (!l.length) return { choix: null, refus: 'aucune-image' };
    let best = l[0];
    for (const i of l) if (i.w > best.w) best = i;
    if (best.w < LARGEUR_PLANCHER) return { choix: null, refus: 'trop-petit' };
    return { choix: best, basseDefinition: best.w < LARGEUR_SERVIE };
}
const filigrane = site => site && site.filigrane === true ? { servi: false, destination: 'index-api-seulement' } : { servi: true, destination: 'servi' };

// ── 4. cadence, fermeture, reprise ───────────────────────────────────────────────────────────────────────────────────────────────────────
const cadenceDe = site => Math.max(CADENCE_MIN_MS, Number.isFinite(site?.cadenceMs) ? site.cadenceMs : (site?.petit ? CADENCE_PETIT_MS : CADENCE_DEFAUT_MS));
const hoteAFermer = e => Boolean(e && (e.arret || e.defi || CODES_FERMETURE.includes(e.status)));
const imageDejaObtenue = (reg, url) => Boolean(reg?.objets?.[url]?.sha256);
// Le cache garde les données ANALYSÉES : une page lue par une autre version de l'extraction se relit (07/11 : les pages de w-tcs étaient cachées 7 jours avec un résultat faux).
const VERSION_EXTRACTION = 2;
function pageDejaLue(reg, url, maintenant = new Date()) {
    const p = reg?.pages?.[url];
    if (!p?.le || p.v !== VERSION_EXTRACTION) return false;
    const age = maintenant.getTime() - new Date(p.le).getTime();
    return Number.isFinite(age) && age >= 0 && age <= PAGE_TTL_JOURS * 86400000;
}

// ── 5. lecture des pages ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function attributs(balise) {
    const a = {}; for (const m of balise.matchAll(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g)) a[m[1].toLowerCase()] = decoder(m[2]);
    return a;
}
function collectionsDepuis(html, cfg, base) {
    const vus = new Map();
    const ajouter = (url, extra = {}) => {
        const u = absolue(url, base); if (!u) return;
        let chemin; try { chemin = new URL(u).pathname; } catch { return; }
        if (cfg.motifLien && !new RegExp(cfg.motifLien).test(chemin)) return;
        if (vus.has(u)) return;
        const seg = chemin.split('/').filter(Boolean); vus.set(u, { url: u, slug: seg[seg.length - 1] || null, titre: null, code: null, ...extra });
    };
    if (cfg.type === 'sitemap') { for (const m of String(html).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) ajouter(decoder(m[1])); return [...vus.values()]; }
    for (const m of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
        const a = attributs(m[1]); if (!a.href) continue;
        const texte = decoder(m[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
        ajouter(a.href, { titre: (cfg.titreAttr ? a[cfg.titreAttr] : a.title) || texte || null, code: cfg.codeAttr ? (a[cfg.codeAttr] || null) : null });
    }
    return [...vus.values()];
}
function numeroDuTitre(s) {
    const t = String(s ?? '');
    const m = /\(\s*([A-Za-z]{0,4}\d+[A-Za-z]?)\s*\/\s*([A-Za-z]{0,4}\d+)\s*\)/.exec(t);
    if (m) return { numero: m[1], total: m[2] };
    const d = /#\s*([A-Za-z]{0,4}\d+[A-Za-z]?)\b/.exec(t);
    return d ? { numero: d[1], total: null } : { numero: null, total: null };
}
const nomNu = s => String(s ?? '').split(/\s\(|\s#\d|\s-\s/)[0].trim();
// 07/11 : une base de cartes écrit « Pok&eacute;mon » ; le décodage général ne connaît que les cinq entités de base.
const decoderPlus = s => decoder(s).replace(/&eacute;/g, 'é').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const compacte = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const CODE_SIMPLE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
function itemsDepuis(html, cfg, base) {
    const sortie = [];
    if (cfg.type === 'grille-cartes') {
        // w-scx : une ancre par carte ET par variante (data-id = <code>-<n>) ; l'adresse de la liste dit le code attendu : une carte d'un autre set n'est pas une entrée ; le même id lu deux fois n'est qu'une carte.
        let attendu = null; try { attendu = compacte(new URL(base).pathname.split('/').filter(Boolean).pop()); } catch { /* base illisible : aucun code attendu */ }
        const vus = new Set();
        for (const m of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
            const a = attributs(m[1]); const u = a.href ? absolue(a.href, base) : null; if (!u) continue;
            let chemin; try { chemin = new URL(u).pathname; } catch { continue; }
            if (cfg.motifLien && !new RegExp(cfg.motifLien).test(chemin)) continue;
            const id = /data-id="([^"]*)"/.exec(m[2])?.[1]; if (!id) continue;
            const sep = id.lastIndexOf('-'), codeId = sep > 0 ? id.slice(0, sep) : id, numero = sep > 0 ? id.slice(sep + 1) : '';
            if (attendu && compacte(codeId) !== attendu) continue;
            if (vus.has(id)) continue;
            vus.add(id);
            const texte = [...m[2].matchAll(/<span\b[^>]*>([^<]*)<\/span>/g)].map(x => decoderPlus(x[1]).trim()).find(t => t && !t.startsWith('$')) || '';
            const nom = nomNu(texte);
            if (!numero && !nom) continue;
            let src = attributs(/<img\b([^>]*)>/i.exec(m[2])?.[1] || '').src || null;
            if (src && cfg.pleine) src = src.replace(cfg.pleine[0], cfg.pleine[1]);
            sortie.push({ position: sortie.length + 1, nom, titre: texte, numero: numero || null, total: null, url: u, image: src ? absolue(src, base) : null });
        }
        return sortie;
    }
    if (cfg.type === 'lignes-serie') {
        // w-srb : une ligne par carte ; la 1re cellule porte « <n> / <code> » (« <code> » seul si non numérotée ; un second champ chiffré est le TOTAL) ; vignette -> scan plein par `pleine`.
        const morceaux = String(html).split(/<td class="cen"><a href="\/card\/[^"]*">/).slice(1);
        const motifVignette = cfg.pleine ? new RegExp(`src="([^"]*${cfg.pleine[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*)"`) : /src="([^"]*)"/;
        for (const [i, c] of morceaux.entries()) {
            const tete = /^[^<]*<\/a><br \/>\s*(?:([^\s/<]+)\s*\/\s*)?([^\s<]+)/.exec(c); if (!tete) continue;
            let numero = tete[1] ?? null, total = null, codeSet = null;
            if (numero != null) { if (/^\d+$/.test(tete[2])) total = tete[2]; else codeSet = tete[2]; }
            else if (/^\d+[A-Za-z]?$/.test(tete[2])) numero = tete[2]; else codeSet = tete[2];
            const nom = decoderPlus((/<font size="2">([\s\S]*?)<\/font>/.exec(c)?.[1] || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
            if (!numero && !nom) continue;
            let src = motifVignette.exec(c)?.[1] || null;
            if (src && cfg.pleine) src = src.replace(cfg.pleine[0], cfg.pleine[1]);
            const lien = /<a href="([^"]*\.shtml)"/.exec(c)?.[1] || null;
            sortie.push({ position: i + 1, nom, titre: nom, numero, total, codeSet, url: lien ? absolue(lien, base) : null, image: src ? absolue(src, base) : null });
        }
        return sortie;
    }
    if (cfg.type === 'jsonld-itemlist') {
        const t = String(html).replace(/\\"/g, '"');
        const vus = new Set();                              // 07/11 : le flux répète le JSON-LD ; une même annonce (même url) lue deux fois n'est pas deux items (sinon « partage » refuse toute carte)
        for (const m of t.matchAll(/\{"@type":"ListItem","position":(\d+),"name":"((?:[^"\\]|\\.)*)","url":"([^"]*)","image":"([^"]*)"/g)) {
            const cleItem = `${m[1]}|${m[3]}|${m[2]}`;                 // le flux répète exactement position, url et nom
            if (vus.has(cleItem)) continue;
            vus.add(cleItem);
            const nom = m[2].replace(/\\u0026/g, '&').replace(/\\"/g, '"'), img = m[4];
            const vide = !img || (cfg.placeholder && img.includes(cfg.placeholder));
            sortie.push({ position: +m[1], nom: nomNu(nom), titre: nom, ...numeroDuTitre(nom), url: absolue(m[3], base), image: vide ? null : absolue(img, base) });
        }
        return sortie;
    }
    if (cfg.type === 'vignettes-plaque') {
        const morceaux = String(html).split(/<div class="card(?:\s[^"]*)?">/).slice(1);
        for (const [i, c] of morceaux.entries()) {
            const lien = /<a\b([^>]*)>/i.exec(c), img = /<img\b([^>]*)>/i.exec(c), pl = /class="plaque"[^>]*>\s*#([^\s<]+)\s*-\s*([^<]+?)\s*</.exec(c);
            if (!lien || !img || !pl) continue;
            const ai = attributs(img[1]); let src = ai['data-src'] || ai.src || null;
            if (src && cfg.pleine) src = src.replace(cfg.pleine[0], cfg.pleine[1]);
            sortie.push({ position: i + 1, nom: decoder(pl[2]), titre: attributs(lien[1]).title || null, numero: decoder(pl[1]), total: null, url: absolue(attributs(lien[1]).href, base), image: src ? absolue(src, base) : null });
        }
    }
    return sortie;
}
// 07/11 : le « & » d'un nextUrl lu dans un flux JSON s'écrit & (et « &amp; » dans un lien) : sans ce décodage la page suivante n'était JAMAIS vue (w-tcs : 60 items sur 187).
const pageSuivante = (html, param, n) => new RegExp(`[?&;]${param}=${n + 1}(?!\\d)`).test(String(html).replace(/\\u0026/gi, '&').replace(/&amp;/g, '&'));

// ── 6. les requêtes du protocole des agents (BRIEF-B) : préparées, jamais lancées par un script ─────────────────────────────────────────────
function requetesDeCarte(p, set) {
    const en = p.nomEn || p.name, num = p.numero ?? '', code = set.code, nom = set.nom;
    const R = [];
    const q = (langue, texte) => { const t = texte.replace(/\s+/g, ' ').trim(); if (t && !R.some(r => r.q === t)) R.push({ langue, q: t }); };
    q('en', `${en} ${code} ${num}`); q('en', `${en} ${nom} scan`); q('en', `${en} ${code} card`); q('en', `card list ${nom}`); q('en', `${en} ${nom} ${num}`);
    q('fr', `${p.nomFr || en} ${nom} ${num} carte`); q('fr', `${p.nomFr || en} ${code} ${num} Pokémon`);
    q('ja', `${p.nomJa || en} ${code} ${num} ポケモンカード`); q('ja', `${nom} 一覧 ${code}`);
    q('zh', `${p.nomZh || en} ${code} 宝可梦卡牌`);
    if (['id', 'idth', 'th'].includes(set.tirage)) q(set.tirage === 'th' ? 'th' : 'id', `${en} ${code} ${num} kartu Pokémon`);
    return R;
}

// ── 7. l'entrée de preuve (format PHASE4), regle « a-lire » : le lot ne lit pas l'image ───────────────────────────────────────────────────────
const LANGUE_DU_TIRAGE = { jp: 'ja', intl: 'en', 'zh-hans': 'zh', 'zh-hant': 'zh', id: 'id', th: 'th' };
function construireEntree({ site, set, produit, item, image, collection, pageUrl, nomTemoin, via = null, definition, maintenant = new Date() }) {
    const f = filigrane(site);
    return {
        idProduct: produit.idProduct, regle: 'a-lire', url: image.url, hote: hoteDe(image.url), fichier: image.fichier, sha256: image.sha256, largeur: image.w, hauteur: image.h, page: pageUrl, seconde: null,
        attendu: { nom: produit.nomEn ?? produit.name, numero: produit.numero ?? null, langue: LANGUE_DU_TIRAGE[set.tirage] ?? null, tampon: null, variante: null },
        lu: null, varianteNommee: null, contradictions: [], sourcesConsultees: [site.code], luLe: null,
        preparation: { par: 'chasse-nocturne', le: maintenant.toISOString(), set: set.set, collection, itemNom: item.nom, itemNumero: item.numero, nomTemoin, ...(via === 'nom' ? { appariement: 'nom-seul' } : {}), basseDefinition: Boolean(definition?.basseDefinition), filigrane: !f.servi, destination: f.destination }
    };
}

// ── 8. l'exploration d'UN site : index -> collections -> listes -> cartes -> images (tout le réseau est INJECTÉ) ─────────────────────────────
async function explorerSite({ site, sets, registre, lirePage, lireImage, fermerHote, maintenant = () => new Date(), pause = ms => new Promise(r => setTimeout(r, ms)), budget = 500, dejaCouverts = new Set(), setsConnus = null }) {
    registre.objets ||= {}; registre.pages ||= {};
    const cadence = cadenceDe(site), dernier = new Map();
    const stats = { code: site.code, actif: true, requetes: 0, collectionsEnumerees: 0, collectionsAppariees: 0, collectionsLues: 0, itemsLus: 0, surNumeroSeul: 0, surNomSeul: 0, produitsCouverts: 0, refus: {}, ferme: null, arretBudget: false, arretErreurs: false };
    const refuser = cle => { stats.refus[cle] = (stats.refus[cle] || 0) + 1; };
    const hotesPages = new Set(site.hotes), hotesImages = new Set([...(site.hotesImages || []), ...site.hotes]);
    let refusDeSuite = 0, erreursDeSuite = 0;
    const entrees = [], parProduit = new Map();
    class Stop extends Error {}
    async function requete(url, type, faire) {
        if (stats.requetes >= budget) { stats.arretBudget = true; throw new Stop('budget'); }
        const hote = hoteDe(url), t = dernier.get(hote);
        if (t != null) { const attente = cadence - (maintenant().getTime() - t); if (attente > 0) await pause(attente); }
        dernier.set(hote, maintenant().getTime()); stats.requetes++;
        try { const r = await faire(url); refusDeSuite = 0; erreursDeSuite = 0; return r; }
        catch (e) {
            if (hoteAFermer(e)) { const motif = e.arret ? `arrêt ${e.message}` : `HTTP ${e.status}`; try { fermerHote?.(hote, `chasse nocturne ${site.code} : ${motif}`); } catch { /* l'arrêt est dit au journal */ } stats.ferme = e.arret ? 'arrêt de la porte' : motif; throw new Stop(motif); }
            if (e.refus) { refusDeSuite++; refuser(`${type}:refus-porte`); if (refusDeSuite >= 3) { stats.ferme = 'trois refus de la porte de suite'; throw new Stop('refus'); } return null; }
            refuser(`${type}:${e.status ? `HTTP ${e.status}` : 'erreur'}`);
            // 5xx, réseau, délai : cinq de suite = le site est en panne pour cette nuit (l'hôte N'est PAS fermé dans la porte : une panne n'est pas un refus)
            if (!e.status || e.status >= 500) { erreursDeSuite++; if (erreursDeSuite >= ERREURS_DE_SUITE_MAX) { stats.ferme = `${ERREURS_DE_SUITE_MAX} erreurs de suite (5xx, réseau ou délai) : site arrêté pour la nuit`; stats.arretErreurs = true; throw new Stop('erreurs'); } }
            return null;
        }
    }
    async function page(url, analyser) {
        if (pageDejaLue(registre, url, maintenant())) return registre.pages[url].donnees;
        const html = await requete(url, 'page', lirePage);
        if (html == null) return null;
        const donnees = analyser(html);
        registre.pages[url] = { le: maintenant().toISOString(), v: VERSION_EXTRACTION, donnees };
        return donnees;
    }
    try {
        // a. énumérer les collections de chaque index (pagination seulement si la page la déclare)
        const collections = new Map();
        for (const idx of site.index || []) {
            const param = idx.pages?.param || 'page', max = idx.pages?.max || 1;
            for (let n = 1; n <= max; n++) {
                const url = n === 1 ? idx.url : `${idx.url}${idx.url.includes('?') ? '&' : '?'}${param}=${n}`;
                if (!hotesPages.has(hoteDe(url))) { refuser('index:hote-non-declare'); break; }
                const d = await page(url, html => ({ collections: collectionsDepuis(html, idx.extracteur, url), suivante: pageSuivante(html, param, n) }));
                if (!d) break;
                for (const c of d.collections) if (!collections.has(c.url)) collections.set(c.url, { ...c, idx });
                if (!d.suivante) break;
            }
        }
        // a'. énumération PAR CODE (w-scx) : l'adresse d'un set se construit du code du set troué (le modèle du registre ; le site ignore le segment de nom). Aucun index lu, donc aucune requête d'énumération.
        let parCodes = 0;
        if (site.parCodes?.url) {
            const tiragesAdmis = site.tirages || null;
            for (const s of sets) {
                parCodes++;
                if (tiragesAdmis && !tiragesAdmis.includes(s.tirage)) { refuser('collection:tirage-non-admis'); continue; }
                if (!CODE_SIMPLE.test(String(s.code ?? ''))) { refuser('collection:code-composite'); continue; }
                const url = site.parCodes.url.replace('{code}', compacte(s.code));
                if (!hotesPages.has(hoteDe(url))) { refuser('index:hote-non-declare'); continue; }
                if (!collections.has(url)) collections.set(url, { url, slug: compacte(s.code), titre: null, code: s.code, parCode: true, set: s });
            }
        }
        stats.collectionsEnumerees = collections.size + (parCodes - [...collections.values()].filter(c => c.parCode).length);
        // b. apparier aux sets troués
        const aLire = [];
        for (const c of collections.values()) {
            if (c.parCode) { aLire.push({ c, set: c.set }); continue; }
            const a = apparierCollection(c, sets.map(s => ({ set: s.set, code: s.code, nom: s.nom, tirage: s.tirage, _s: s })), { tirages: c.idx.tirages || site.tirages, retirerMots: c.idx.retirerMots || site.retirerMots || [], connus: setsConnus || sets });
            if (!a.ok) { refuser(`collection:${a.raison}`); continue; }
            aLire.push({ c, set: sets.find(s => s.set === a.set) });
        }
        stats.collectionsAppariees = aLire.length;
        // c. lire les listes, apparier les cartes, télécharger
        for (const { c, set } of aLire) {
            const max = site.pages?.max || 1, items = [];
            for (let n = 1; n <= max; n++) {
                const url = n === 1 ? c.url : `${c.url}${c.url.includes('?') ? '&' : '?'}${site.pages?.param || 'page'}=${n}`;
                const d = await page(url, html => ({ items: itemsDepuis(html, site.items, url), suivante: pageSuivante(html, site.pages?.param || 'page', n) }));
                if (!d) break;
                if (n === 1) stats.collectionsLues++;
                items.push(...d.items);
                if (!d.suivante) break;
            }
            stats.itemsLus += items.length;
            // le code lu sur la ligne (w-srb) doit être celui du set : une page d'un autre set de même nom n'attribue rien (07/11)
            const memeSet = items.filter(i => i.codeSet == null || compacte(i.codeSet) === compacte(set.code));
            for (let k = items.length - memeSet.length; k > 0; k--) refuser('item:code-autre-set');
            const { retenus, refus } = apparierItems(memeSet, set.produits);
            for (const r of refus) refuser(`item:${r.raison}`);
            for (const { item, produit, nomTemoin, via } of retenus) {
                if (!item.image) { refuser('item:sans-image'); continue; }
                if (nomTemoin !== 'concordant') stats.surNumeroSeul++;                    // apparié sur le seul numéro : le nom n'a rien confirmé
                if (via === 'nom') stats.surNomSeul++;                                    // apparié sur le seul nom : aucun numéro des deux côtés, la validation à l'œil le sait
                if (dejaCouverts.has(produit.idProduct)) { refuser('item:deja-couvert'); continue; }
                const h = hoteDe(item.image);
                if (/cardmarket/i.test(h || '')) { refuser('image:cardmarket'); continue; }      // jamais une image Cardmarket (règle du chantier)
                if (!hotesImages.has(h)) { refuser('image:hote-non-declare'); continue; }
                let obj = registre.objets[item.image];
                if (!imageDejaObtenue(registre, item.image)) {
                    const r = await requete(item.image, 'image', lireImage);
                    if (!r) continue;
                    obj = registre.objets[item.image] = { fichier: r.fichier, sha256: r.sha256, w: r.w, h: r.h, le: maintenant().toISOString() };
                }
                const def = meilleureDefinition([{ url: item.image, w: obj.w, h: obj.h }]);
                if (!def.choix) { refuser(`image:${def.refus}`); continue; }
                if (site.largeurMin && obj.w < site.largeurMin) { refuser('image:trop-petit'); continue; }      // plancher propre au site (registre) : 255 px pour w-scx et w-srb
                const e = construireEntree({ site, set, produit, item, image: { url: item.image, fichier: obj.fichier, sha256: obj.sha256, w: obj.w, h: obj.h }, collection: c.url, pageUrl: c.url, nomTemoin, via, definition: def, maintenant: maintenant() });
                const deja = parProduit.get(produit.idProduct);
                if (deja) { if (e.largeur > deja.largeur) entrees[entrees.indexOf(deja)] = e, parProduit.set(produit.idProduct, e); continue; }
                parProduit.set(produit.idProduct, e); entrees.push(e);
            }
        }
    } catch (e) { if (!(e instanceof Stop)) throw e; }
    stats.produitsCouverts = parProduit.size;
    return { entrees, stats, registre };
}

/** Un plan de plus de 24 h (ou sans date lisible) ne dit plus ce qui manque : la chasse seule le refuse. */
function planTropVieux(plan, maintenant = new Date(), heures = 24) {
    const t = new Date(plan?.le).getTime();
    return !Number.isFinite(t) || maintenant.getTime() - t > heures * 3600000;
}

// ── 9. la famille PHASE4 et le journal du matin ───────────────────────────────────────────────────────────────────────────────────────────────
function construireFamille(nom, entrees, maintenant = new Date()) {
    const hotes = new Map();
    for (const e of entrees) { const s = hotes.get(e.idProduct) || new Set(); s.add(e.hote); hotes.set(e.idProduct, s); }
    return { famille: nom, le: maintenant.toISOString(), entrees: entrees.map(e => ({ ...e, candidatDeuxSources: hotes.get(e.idProduct).size >= 2 })), trous: [] };
}
function redigerJournal({ date, sites, population, entrees, famille, avertissements = [] }) {
    const L = [`# Chasse nocturne — ${date}`, ''];
    L.push(`- population : ${population.fichier} produits « aucun-visuel » du FILE, dont ${population.encoreManquants} encore MANQUANTS au plan du jour`);
    L.push(`- entrées préparées (à LIRE, rien n'est validé ni écrit en base) : ${entrees} · famille ${famille ?? '—'}`);
    L.push('', '| site | requêtes | collections énumérées | appariées | lues | cartes lues | produits couverts | fermé | refus par raison |', '|---|---|---|---|---|---|---|---|---|');
    for (const s of sites) {
        if (s.actif === false) { L.push(`| ${s.code} | — | non exploré : ${s.raison ?? 'raison non écrite'} | | | | | | |`); continue; }
        L.push(`| ${s.code} | ${s.requetes} | ${s.collectionsEnumerees} énumérées | ${s.collectionsAppariees} appariées | ${s.collectionsLues} lues | ${s.itemsLus} (dont ${s.surNumeroSeul ?? 0} appariées sur le seul numéro${s.surNomSeul ? ` ; ${s.surNomSeul} appariées sur le nom seul : aucun numéro des deux côtés` : ''}) | ${s.produitsCouverts} couverts | ${s.ferme ?? 'non'}${s.arretBudget ? ' (plafond atteint)' : ''} | ${Object.entries(s.refus || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' ; ') || 'aucun'} |`);
    }
    L.push('', '## Ce que ce lot ne peut pas faire',
        '- La recherche par moteur (WebSearch, requêtes nom + code + numéro en 3 langues) : la porte réseau n\'offre que « verifier », « lire », « fermer », « lever » ; un script ne peut pas lancer une recherche. Elle reste aux agents ; les requêtes du protocole sont préparées dans a-chasser-par-agents-*.json.',
        '- Regarder une image : toutes les entrées sont « a-lire » ; la lecture (numéro, langue, tampon) et la validation restent à l\'agent et au coordinateur.');
    if (avertissements.length) L.push('', '## Avertissements', ...avertissements.map(a => `- ${a}`));
    return L.join('\n') + '\n';
}

module.exports = { normaliser, apparierCollection, apparierItem, apparierItems, meilleureDefinition, filigrane, cadenceDe, hoteAFermer, imageDejaObtenue, pageDejaLue,
    collectionsDepuis, itemsDepuis, numeroDuTitre, pageSuivante, requetesDeCarte, construireEntree, explorerSite, construireFamille, redigerJournal, hoteDe, planTropVieux, ERREURS_DE_SUITE_MAX,
    VERSION_EXTRACTION, CADENCE_MIN_MS, LARGEUR_SERVIE, LARGEUR_PLANCHER, PAGE_TTL_JOURS, CODES_FERMETURE };
