// ============================================================
// LES LOGOS OFFICIELS « BULBAPEDIA SEULE » — deux routes, une seule définition de chaque garde
// ============================================================
// Route A (ZÉRO requête) : le candidat Bulbapedia est octet pour octet le `sets.logo` que NOUS avons déjà collecté de Bulbagarden
//   (collecter-logos-sets.js, sous la règle de langue collecte-cartes/langue-logo.js). On le COPIE de notre R2 vers notre R2 sous `logos-officiels/`
//   (jamais l'objet de `sets.logo` lui-même : le retrait du lot supprime les objets qu'il nomme et refuse tout autre préfixe).
// Route B (prête, INERTE) : le téléchargement des autres, par le client existant (collecte-cartes/bulba.js : file à 5 s, verrou global) — et SEULEMENT
//   si la sonde (sonde-bulba.js --je-confirme-une-seule-requete --noter) a écrit `SERVI` dans `alerte/source-bloquee/bulbapedia` APRÈS le 2026-10-15 19:29 UTC.
// LA LANGUE (§66) : la règle de langue-logo.js (le NOM du fichier porte la langue, ou la page est celle du set), rejouée AU MOMENT d'écrire — jamais l'adresse.
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (§51) : `feuVertSonde` n'a qu'un chemin vers « ok » ; `executerB` n'a qu'un chemin vers « une requête part ».
const crypto = require('crypto');
const M = require('../collecter-logos-officiels');
const E = require('./bulba-espacement');
const { deciderLangue, refusDuCouple, refusGenerique } = require('./langue-logo');
const { autoriseParRobots, delaiDesRobots } = require('./tpc');

const LOT_BULBA = 'logos-officiels-bulba-2026-10';
// L'instant avant lequel aucune requête vers Bulbapedia ne part (suspension du 2026-10-04 + 7 jours après le dernier essai : relevé du testeur).
const SONDE_APRES_MS = Date.parse('2026-10-15T19:29:00Z');
const FRAICHEUR_MS = 24 * 3600 * 1000;   // un SERVI de plus de 24 h ne dit plus rien de l'état du site
const DELAI_FILE_S = 5;                  // la file de bulba.js : une requête toutes les 5 s (DELAI_MS) — un Crawl-delay plus long ne se tient pas : arrêt
// Les deux collecteurs qui posent un `sets.logo` depuis Bulbagarden Archives, tous deux sous langue-logo.js : collecter-logos-sets.js (paramètre `setlogo`)
// et collecter-logos-demande.js (fichiers trouvés par l'agent du site). Liste fermée : toute autre source (« manuel »…) n'a pas cette provenance.
const SOURCES_BULBAGARDEN = new Set(['bulbapedia:setlogo', 'bulbagarden:demande-site']);
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

/** L'instant d'un champ Mongo (nombre ou Date), ou null. Une chaîne ne passe pas. */
const instant = v => (typeof v === 'number' && Number.isFinite(v)) ? v : (v instanceof Date && Number.isFinite(v.getTime()) ? v.getTime() : null);

/**
 * LE FEU VERT DE LA ROUTE B. Un seul chemin vers ok:true : l'état de la sonde est un objet de CETTE source, `active` vaut false, le verdict est SERVI,
 * constaté APRÈS le 2026-10-15 19:29 UTC, pas dans le futur, il y a moins de 24 h. Tout le reste — état absent, illisible, DEFI, AUTRE, suspension — bloque.
 */
function feuVertSonde(doc, now = Date.now()) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, raison: 'aucun état de sonde lisible : la sonde n\'a pas rendu SERVI (je ne sais pas)' };
    if (doc._id !== E.ID_ETAT) return { ok: false, raison: `état d'un autre objet (${doc._id}) : refusé` };
    if (doc.active !== false) return { ok: false, raison: 'suspension en cours ou état incomplet (active n\'est pas false)' };
    if (doc.verdict !== 'SERVI') return { ok: false, raison: `dernier verdict ${doc.verdict ?? 'absent'} (SERVI exigé)` };
    const c = instant(doc.constateLe);
    if (c === null) return { ok: false, raison: 'date du verdict illisible (constateLe)' };
    if (c < SONDE_APRES_MS) return { ok: false, raison: `SERVI constaté avant ${new Date(SONDE_APRES_MS).toISOString()} : il faut une sonde faite après` };
    if (c > now) return { ok: false, raison: 'verdict daté dans le futur : horloge incohérente' };
    if (now - c > FRAICHEUR_MS) return { ok: false, raison: 'SERVI de plus de 24 h : relancer la sonde' };
    return { ok: true, constateLe: c };
}

/** Écrit le verdict de la sonde dans l'état que la garde lit (même machine d'état que le worker : POLITIQUE_BULBA). Rend le retour de la politique. */
async function noterVerdict(collection, verdict, now = Date.now()) {
    const magasin = E.magasinMongo(collection);
    const etat = await magasin.lire();
    const suite = E.POLITIQUE_BULBA.apres(verdict, etat, now);
    await magasin.ecrire(suite.doc);
    return suite.retour;
}

/** L'adresse DIRECTE d'un fichier de Bulbagarden Archives, ou null : celle de la ligne si elle est directe, celle que porte une copie archive.org sinon. */
function urlDirecte(url) {
    if (typeof url !== 'string') return null;
    let u; try { u = new URL(url); } catch { return null; }
    const propre = x => x.protocol === 'https:' && !x.username && !x.password && !x.port && !x.search && !x.hash;
    if (!propre(u)) return null;
    let cible = u;
    if (u.hostname === 'web.archive.org') {
        const m = /^\/web\/[^/]+\/(https:\/\/.+)$/.exec(u.pathname);
        if (!m) return null;
        try { cible = new URL(m[1]); } catch { return null; }
        if (!propre(cible)) return null;
    }
    if (cible.hostname !== 'archives.bulbagarden.net') return null;
    if (!/^\/media\/upload\/[0-9a-f]\/[0-9a-f]{2}\/[^/]+$/.test(cible.pathname)) return null;
    return cible.href;
}
/** Le nom de fichier tel que l'infobox l'écrit (titre MediaWiki : espaces, pas de tirets bas) — c'est lui que langue-logo.js juge. */
function nomFichier(url) {
    const dernier = new URL(url).pathname.split('/').pop();
    let nom = dernier; try { nom = decodeURIComponent(dernier); } catch { /* garde la forme brute */ }
    return nom.replace(/_/g, ' ');
}

const estBulba = l => !!(l?.bulbapediaSeule || l?.source === 'bulbapedia');

/** La liste FERMÉE des lignes à instruire, calculée à l'exécution : OFFICIEL Bulbapedia + À REGARDER Bulbapedia promus par la liste fermée de M.promouvoir. */
function candidats(table, setsParId, { tcgdexJa = null } = {}) {
    const lignes = [], nonPromues = [];
    for (const l of table.lignes) {
        if (l.verdict === 'OFFICIEL' && estBulba(l)) lignes.push(l);
        else if (l.verdict === 'À REGARDER' && l.source === 'bulbapedia') {
            const p = M.promouvoir(l, setsParId, { tcgdexJa });
            if (p.ligne) lignes.push(p.ligne); else nonPromues.push({ ligne: l, raison: p.raison });
        }
    }
    return { lignes, nonPromues };
}

/** Le plan d'UNE ligne, avant tout octet : eligible / ecartee / refus. `setsParId` : Map slug → document du set (tirage, region, code, nom*, bulba…). */
function planifierBulba(ligne, setsParId) {
    if (ligne.verdict !== 'OFFICIEL') return { action: 'refus', raison: `verdict ${ligne.verdict} : seuls les OFFICIEL se collectent` };
    if (!estBulba(ligne)) return { action: 'refus', raison: 'ligne non Bulbapedia : ce n\'est pas la route de ces fichiers' };
    if (ligne.cible !== 'ja') return { action: 'ecartee', raison: `cible « ${ligne.cible} » : un logo Bulbapedia est celui du tirage du set (japonais ici) ; il ne prouve pas le français` };
    const rS = M.refusSetIdentifie(ligne) ?? M.refusSetBase(ligne, setsParId);
    if (rS) return rS;
    if (!Array.isArray(ligne.urls) || ligne.urls.length !== 1) return { action: 'refus', raison: `${ligne.urls?.length ?? 0} adresse(s) sur la ligne : une seule est attendue (on ne devine pas laquelle)` };
    const url = urlDirecte(ligne.urls[0]);
    if (!url) return { action: 'refus', raison: 'adresse ni directe (archives.bulbagarden.net/media/upload/…) ni copie archive.org d\'une adresse directe' };
    const nom = nomFichier(url);
    const couple = refusDuCouple(nom);
    if (couple) return { action: 'ecartee', raison: couple };
    const d = deciderLangue(setsParId.get(ligne.set), nom);
    if (!d.ok) return { action: 'ecartee', raison: d.motif };
    return { action: 'eligible', url, nom, preuve: d.preuve };
}

// ───────────────────────── ROUTE A
const refusDeLangueDe = (setDoc, nom) => ligne => {
    if (ligne.cible !== 'ja') return `cible « ${ligne.cible} » : un logo Bulbapedia ne prouve pas cette langue`;
    const c = refusDuCouple(nom); if (c) return c;
    const d = deciderLangue(setDoc, nom);
    return d.ok ? null : d.motif;
};

/**
 * Trie les lignes entre la route A (octets déjà chez nous), la route B (à télécharger), les refus. `lireOctets(cleR2)` lit NOTRE R2.
 * Rend { parRoute: { A: [items], B: [{ligne, plan, raison}] }, refus, deja, doublons, ecrits, copiesR2 }. N'écrit que si `ecrire`.
 */
async function collecterA({ lignes, setsParId, lireOctets, S, r2, bucket, ecrire = false, le = new Date() }) {
    const sortie = { parRoute: { A: [], B: [] }, refus: [], deja: [], doublons: [], ecrits: [], copiesR2: 0 };
    const items = [];
    for (const ligne of lignes) {
        const nomLigne = `${ligne.cible} ${ligne.set ?? '∅'} (${ligne.fichier})`;
        const refuser = (action, raison) => sortie.refus.push({ ligne, action, raison });
        const p = planifierBulba(ligne, setsParId);
        if (p.action !== 'eligible') { refuser(p.action, p.raison); continue; }
        const setDoc = setsParId.get(ligne.set);
        const pose = setDoc.logoOfficiel?.[ligne.cible];
        if (pose) {
            if (pose.sha256 === ligne.cache?.sha256) sortie.deja.push({ ligne }); else refuser('refus', `${nomLigne} : le set porte déjà un logoOfficiel.${ligne.cible} différent (${pose.lot}) : rien n'est remplacé`);
            continue;
        }
        const logo = setDoc.logo;
        if (!logo?.cleR2) { sortie.parRoute.B.push({ ligne, plan: p, raison: 'le set n\'a pas de sets.logo : à télécharger' }); continue; }
        if (!SOURCES_BULBAGARDEN.has(logo.source)) { sortie.parRoute.B.push({ ligne, plan: p, raison: `sets.logo de source « ${logo.source ?? '∅'} » : pas de provenance Bulbagarden, à télécharger` }); continue; }
        let buf; try { buf = await lireOctets(logo.cleR2); } catch (e) { refuser('refus', `objet R2 de sets.logo illisible (${e.message}) : je ne sais pas`); continue; }
        if (!Buffer.isBuffer(buf) || !buf.length) { refuser('refus', 'objet R2 de sets.logo vide'); continue; }
        if (sha256(buf) !== ligne.cache?.sha256) { sortie.parRoute.B.push({ ligne, plan: p, raison: 'sets.logo n\'est pas le même fichier que le candidat (sha256) : à télécharger' }); continue; }
        // la collecte d'origine, rejugée par les règles d'AUJOURD'HUI, sur le nom de fichier de NOTRE sets.logo
        const urlOrigine = urlDirecte(logo.urlOriginal);
        if (!urlOrigine) { refuser('refus', 'provenance de sets.logo illisible (urlOriginal absent ou hors Bulbagarden Archives)'); continue; }
        const nomLogo = String(logo.fichier ?? '');
        const rL = refusDeLangueDe(setDoc, nomLogo)(ligne);
        if (rL) { refuser('refus', `sets.logo « ${nomLogo} » : ${rL}`); continue; }
        const gen = refusGenerique(logo.sha1) ?? refusGenerique(sha1(buf));
        if (gen) { refuser('refus', gen); continue; }
        const j = await M.juger(ligne, buf, { pokecardexBuf: null });
        if (!j.ok) { refuser('refus', j.raison); continue; }
        items.push({ ligne, set: ligne.set, setDoc, logo, nomLogo, d: deciderLangue(setDoc, nomLogo), sha256: j.sha256, fichier: { buf, sha256: j.sha256, ext: j.format === 'jpeg' ? 'jpg' : j.format, url: urlOrigine, via: 'identique-sets.logo', corr: null } });
    }
    const dd = M.reduireDoublons(items);
    items.forEach((it, i) => {
        if (dd[i].action === 'ecrire') sortie.parRoute.A.push(it);
        else if (dd[i].action === 'doublon') sortie.doublons.push({ ligne: it.ligne, meme: dd[i].meme });
        else sortie.refus.push({ ligne: it.ligne, action: 'refus', raison: dd[i].raison });
    });
    if (ecrire) {
        for (const it of sortie.parRoute.A) {
            const e = await ecrireA({ S, r2, bucket, item: it, le });
            if (e.action === 'ecrit') { sortie.ecrits.push({ ligne: it.ligne, ...e }); sortie.copiesR2 += 2; }
            else if (e.action === 'deja') sortie.deja.push({ ligne: it.ligne });
            else sortie.refus.push({ ligne: it.ligne, action: 'refus', raison: e.raison });
        }
    }
    return sortie;
}

async function ecrireA({ S, r2, bucket, item, le = new Date() }) {
    const { ligne, setDoc, logo, nomLogo, d } = item;
    return M.ecrireLigne({
        S, r2, bucket, ligne, set: ligne.set, fichier: item.fichier, le, lot: LOT_BULBA, refusDeLangue: refusDeLangueDe(setDoc, nomLogo),
        ajout: {
            entree: { copieR2: true, origine: { route: 'A', cleR2Source: logo.cleR2, fichier: logo.fichier, source: logo.source, urlOriginal: logo.urlOriginal, collecteLe: logo.le ?? null, preuveLangueCollecte: logo.preuve ?? null } },
            preuve: { route: 'A', langueLogo: d.preuve, fichierLangue: nomLogo, regleLangue: 'collecte-cartes/langue-logo.js deciderLangue' }
        }
    });
}

// ───────────────────────── ROUTE B
/**
 * Télécharge les fichiers du plan — SI ET SEULEMENT SI le feu vert de la sonde est ok. Un seul chemin mène à une requête : feuVert.ok === true, puis
 * robots.txt lu (200, un vrai robots.txt, le chemin permis, pas de Crawl-delay plus lent que la file), puis fichier par fichier. Le premier 403/429/5xx/réseau/
 * page HTML/erreur inconnue ARRÊTE tout (jamais de reprise après un défi) ; seul un 404 est propre à un fichier. `noterArret(message)` écrit la suspension.
 * `plan` : [{ ligne, set, url, nom }]. Rend { fichiers, refus, requetes, arret }.
 */
async function executerB({ plan, feuVert, lireRobots, telecharger, noterArret = null, juger = M.juger, pokecardexDe = async () => null }) {
    const sortie = { fichiers: [], refus: [], requetes: 0, arret: null };
    if (!feuVert || feuVert.ok !== true) { sortie.arret = `feu vert de la sonde absent : ${feuVert?.raison ?? 'non fourni'} — aucune requête`; return sortie; }
    const arreter = async raison => { sortie.arret = raison; if (noterArret) await noterArret(raison); return sortie; };
    let rob;
    try { sortie.requetes++; rob = await lireRobots(); } catch (e) { return arreter(`robots.txt illisible (${e.code || e.message}) : je ne sais pas, je ne demande rien`); }
    if (!rob || rob.status !== 200) return arreter(`robots.txt : HTTP ${rob?.status ?? '∅'} (défi ou panne) : arrêt`);
    if (typeof rob.texte !== 'string' || !/^\s*user-agent\s*:/im.test(rob.texte)) return arreter('robots.txt : réponse qui n\'est pas un robots.txt lisible : arrêt');
    const delai = delaiDesRobots(rob.texte, E.UA);
    if (delai && delai > DELAI_FILE_S) return arreter(`robots.txt demande un Crawl-delay de ${delai} s, plus lent que notre file (${DELAI_FILE_S} s) : arrêt`);
    for (const p of plan) if (!autoriseParRobots(rob.texte, new URL(p.url).pathname, E.UA)) return arreter(`robots.txt interdit ${new URL(p.url).pathname} : arrêt`);
    for (const p of plan) {
        let rep;
        try { sortie.requetes++; rep = await telecharger(p.url); }
        catch (e) {
            const st = /^Bulbagarden (\d{3})\b/.exec(e?.message ?? '')?.[1];
            if (st === '404') { sortie.refus.push({ ligne: p.ligne, action: 'refus', raison: 'fichier absent chez la source (404)' }); continue; }
            return arreter(`${p.url} : ${e?.message ?? e} — arrêt, plus aucune requête`);
        }
        if (!rep || !Buffer.isBuffer(rep.buffer) || !/^image\//i.test(rep.type ?? '')) {
            sortie.refus.push({ ligne: p.ligne, action: 'refus', raison: `réponse qui n'est pas une image (${rep?.type ?? '∅'})` });
            return arreter(`${p.url} : réponse non image (page de défi possible) — arrêt, plus aucune requête`);
        }
        const j = await juger(p.ligne, rep.buffer, { pokecardexBuf: await pokecardexDe(p.ligne) });
        if (!j.ok) { sortie.refus.push({ ligne: p.ligne, action: 'refus', raison: j.raison }); continue; }
        const gen = refusGenerique(j.sha1);
        if (gen) { sortie.refus.push({ ligne: p.ligne, action: 'refus', raison: gen }); continue; }
        sortie.fichiers.push({ ligne: p.ligne, set: p.set, url: p.url, nom: p.nom, buf: rep.buffer, sha256: j.sha256, ext: j.format === 'jpeg' ? 'jpg' : j.format, via: j.via, corr: j.corr ?? null });
    }
    return sortie;
}

/** Écrit un fichier de la route B : la langue est rejugée par langue-logo.js au moment d'écrire (le set est relu par l'appelant). */
async function ecrireB({ S, r2, bucket, item, setDoc, le = new Date() }) {
    const d = deciderLangue(setDoc, item.nom);
    return M.ecrireLigne({
        S, r2, bucket, ligne: item.ligne, set: item.set, fichier: { buf: item.buf, sha256: item.sha256, ext: item.ext, url: item.url, via: item.via, corr: item.corr }, le, lot: LOT_BULBA,
        refusDeLangue: refusDeLangueDe(setDoc, item.nom),
        ajout: { preuve: { route: 'B', langueLogo: d.ok ? d.preuve : null, fichierLangue: item.nom, regleLangue: 'collecte-cartes/langue-logo.js deciderLangue' } }
    });
}

module.exports = { LOT_BULBA, SONDE_APRES_MS, FRAICHEUR_MS, feuVertSonde, noterVerdict, urlDirecte, nomFichier, candidats, planifierBulba, collecterA, ecrireA, executerB, ecrireB };
