// ============================================================
// LES LOGOS OFFICIELS (phase 2) — collecte depuis l'ADRESSE EXACTE écrite sur chaque ligne de LISTE-LOGOS-A-CHERCHER.md
// ============================================================
//   node collecter-logos-officiels.js --cache=<dossier>                       (SIMULATION : télécharge à la cadence, compare, n'écrit NI base NI R2)
//   node lot-additif.js --quoi="logos officiels 2026-10" --collections=sets -- node collecter-logos-officiels.js --cache=<dossier> --ecrire
// Décision du testeur (2026-10-08) : « 181 OFFICIEL : collecte depuis l'adresse exacte écrite sur chaque ligne (jamais depuis un fichier Pokécardex,
// jamais d'après un nom de fichier). Cadence lente, source enregistrée, retirable en un lot. » Les OFFICIELS dont la seule source est Bulbapedia (copie
// archive.org) ne se collectent PAS maintenant : ils sont REPORTÉS.
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (§51) : une ligne OFFICIEL ; un set SÛR (jamais « ? » ni « non identifié » : le set vient de la LIGNE, c'est-à-dire
// du fichier Pokécardex, jamais du nom de fichier du candidat — Bill's nomme mal certains fichiers) ; une URL qui est EXACTEMENT sur la ligne ; un hôte de la
// liste FERMÉE ci-dessous (https, sans identifiants) ; robots.txt relu par hôte ; une requête toutes les 10 s au plus ; redirections suivies seulement dans
// l'hôte ; arrêt au premier défi anti-robot ; le MÊME fichier que celui que la phase 1 a comparé (sha256) ou, sinon, la re-mesure par la MÊME fonction
// (collecte-cartes/mesure-logos.js) au seuil de la phase 1. Tout le reste refuse.
// ÉCRITURE ADDITIVE ET RETIRABLE : l'image dans R2 sous `logos-officiels/<langue>/…` (+ sa vignette), et un champ NEUF `sets.logoOfficiel.<fr|ja>`.
// AUCUN champ existant (`logo`, `logoFr`, `logoCompose`…) n'est lu pour être remplacé ni écrit. `retirer-logos-officiels.js` retire ce lot d'un geste.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const LOT = 'logos-officiels-2026-10';
const MENTION = '© Pokémon / The Pokémon Company';
// La liste FERMÉE, lue sur les lignes OFFICIEL de la phase 1 : 65 lignes TCGdex (assets.tcgdex.net), 84 lignes Bill's Archive (billsarchive.com) ; les
// autres (web.archive.org, archives.bulbagarden.net : Bulbapedia) sont reportées. raw.githubusercontent.com (ptcg-assets) : aucune ligne ne porte d'URL
// de ce dépôt (« clone local »), donc il n'est pas dans la liste.
const HOTES_COLLECTE = ['assets.tcgdex.net', 'billsarchive.com'];
const SOURCES = { 'assets.tcgdex.net': 'tcgdex', 'billsarchive.com': 'billsarchive', 'web.archive.org': 'bulbapedia', 'archives.bulbagarden.net': 'bulbapedia' };
const CADENCE_MS = 10000;
const TAILLE_MAX = 5 * 1024 * 1024;
const AGENT = 'rat-market-logos/1.0';
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
const hoteDe = u => { try { return new URL(u).hostname; } catch { return null; } };
const sourceDe = u => SOURCES[hoteDe(u)] ?? null;

/** L'URL qu'on s'apprête à demander : sur la ligne, https, sans identifiants, sans requête, hôte de la liste. Rend la RAISON du refus, ou null. */
function verifierUrl(ligne, url) {
    if (typeof url !== 'string' || !url) return 'aucune URL';
    if (!Array.isArray(ligne?.urls) || !ligne.urls.includes(url)) return 'cette URL n\'est pas écrite sur la ligne';
    let u; try { u = new URL(url); } catch { return 'URL illisible'; }
    if (u.protocol !== 'https:') return `protocole ${u.protocol} (https seulement)`;
    if (u.username || u.password) return 'identifiants dans l\'URL';
    if (u.port) return `port ${u.port}`;
    if (u.search || u.hash) return 'paramètres ou ancre dans l\'URL';
    if (!HOTES_COLLECTE.includes(u.hostname)) return `hôte ${u.hostname} hors de la liste fermée (${HOTES_COLLECTE.join(', ')})`;
    return null;
}

/** Le plan d'UNE ligne, avant tout téléchargement : collecter / reportee / ecartee / refus. `setsParId` : Map slug → { tirage, region }. */
function planifier(ligne, setsParId) {
    if (ligne.verdict !== 'OFFICIEL') return { action: 'refus', raison: `verdict ${ligne.verdict} : seuls les OFFICIEL se collectent` };
    if (ligne.bulbapediaSeule) return { action: 'reportee', raison: 'Bulbapedia seule (copie archive.org) : reportée, décision du testeur' };
    if (!ligne.set || !ligne.setSur) return { action: 'ecartee', raison: ligne.set ? `set « ${ligne.set} » identifié par le code seulement, non confirmé` : 'set non identifié' };
    if (!ligne.urlChoisie) return { action: 'refus', raison: 'aucune URL de la liste fermée sur la ligne' };
    const rU = verifierUrl(ligne, ligne.urlChoisie);
    if (rU) return { action: 'refus', raison: rU };
    const s = setsParId.get(ligne.set);
    if (!s) return { action: 'ecartee', raison: `set « ${ligne.set} » absent de la base` };
    const tirage = s.tirage ?? s.region;
    const attendu = ligne.cible === 'fr' ? 'intl' : ligne.cible === 'ja' ? 'jp' : null;
    if (tirage !== attendu) return { action: 'ecartee', raison: `set de tirage ${tirage}, logo ${ligne.cible} (attendu ${attendu})` };
    return { action: 'collecter' };
}

/**
 * Le fichier téléchargé est-il celui de la ligne ? Une image PNG/WebP/JPEG lisible, pas une copie connue de Pokécardex, puis : le MÊME fichier que celui que
 * la phase 1 a comparé (sha256), sinon la re-mesure contre le fichier Pokécardex par la fonction de la phase 1, au seuil de la phase 1.
 */
async function juger(ligne, buf, { pokecardexBuf = null, mesurer = require('./collecte-cartes/mesure-logos').mesurer, sha1Force = null } = {}) {
    if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, raison: 'réponse vide' };
    if (buf.length > TAILLE_MAX) return { ok: false, raison: `fichier de ${buf.length} octets (max ${TAILLE_MAX})` };
    let meta; try { meta = await sharp(buf).metadata(); } catch { return { ok: false, raison: 'ce n\'est pas une image lisible' }; }
    if (!['png', 'webp', 'jpeg'].includes(meta.format)) return { ok: false, raison: `format ${meta.format} (png, webp, jpeg seulement)` };
    if (!(meta.width >= 100 && meta.height >= 20)) return { ok: false, raison: `image de ${meta.width}×${meta.height}, trop petite pour un logo` };
    const base = { w: meta.width, h: meta.height, format: meta.format, octets: buf.length, sha256: sha256(buf), sha1: sha1Force ?? sha1(buf) };
    const { refusCopie } = require('./collecte-cartes/langue-logo');
    const copie = refusCopie(base.sha1, null);
    if (copie) return { ok: false, raison: copie, ...base };
    if (ligne.cache?.sha256 && ligne.cache.sha256 === base.sha256) return { ok: true, via: 'identique-phase-1', corr: null, ...base };
    if (!pokecardexBuf) return { ok: false, raison: 'fichier différent de celui comparé en phase 1 et fichier Pokécardex illisible : pas de re-mesure possible (je ne sais pas)', ...base };
    let m; try { m = await mesurer(ligne.part, buf, pokecardexBuf); } catch (e) { return { ok: false, raison: `re-mesure impossible : ${e.message}`, ...base }; }
    return m.ok ? { ok: true, via: 're-mesure', corr: m.corr, detail: m.detail, ...base } : { ok: false, raison: `re-mesure sous le seuil : ${m.detail}`, corr: m.corr, ...base };
}

/** Deux lignes pour un même (langue, set) : le même fichier ne s'écrit qu'une fois ; deux fichiers différents ne se départagent pas (refus des deux). */
function reduireDoublons(items) {
    const groupes = new Map();
    items.forEach((it, i) => { const k = `${it.ligne.cible}:${it.ligne.set}`; (groupes.get(k) || groupes.set(k, []).get(k)).push(i); });
    const out = items.map(() => ({ action: 'ecrire' }));
    for (const idx of groupes.values()) {
        if (idx.length < 2) continue;
        const premier = items[idx[0]].sha256;
        if (idx.every(i => items[i].sha256 === premier)) idx.slice(1).forEach(i => { out[i] = { action: 'doublon', meme: items[idx[0]].ligne.fichier }; });
        else idx.forEach(i => { out[i] = { action: 'refus', raison: `deux fichiers différents pour ${items[i].ligne.set} (${idx.map(j => items[j].ligne.fichier).join(', ')})` }; });
    }
    return out;
}

// ── robots.txt : les règles du groupe « * » (ou de notre agent), la plus longue règle gagne, Allow à égalité
function regleRobots(texte) {
    const groupes = []; let cur = null, enTete = false;
    for (const brut of String(texte).split(/\r?\n/)) {
        const l = brut.replace(/#.*$/, '').trim(); if (!l) continue;
        const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(l); if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === 'user-agent') { if (!cur || !enTete) { cur = { agents: [], regles: [] }; groupes.push(cur); } cur.agents.push(v.toLowerCase()); enTete = true; }
        else if ((k === 'allow' || k === 'disallow') && cur) { cur.regles.push({ allow: k === 'allow', chemin: v }); enTete = false; }
        else enTete = false;
    }
    const nous = groupes.filter(g => g.agents.some(a => a !== '*' && AGENT.toLowerCase().startsWith(a)));
    const utiles = nous.length ? nous : groupes.filter(g => g.agents.includes('*'));
    return utiles.flatMap(g => g.regles);
}
function autorise(regles, chemin) {
    let meilleure = null;
    for (const r of regles) {
        if (r.chemin === '') continue;
        const re = new RegExp('^' + r.chemin.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
        if (!re.test(chemin)) continue;
        if (!meilleure || r.chemin.length > meilleure.chemin.length || (r.chemin.length === meilleure.chemin.length && r.allow)) meilleure = r;
    }
    return !meilleure || meilleure.allow;
}
const defi = r => {
    const h = k => (r.headers?.get ? r.headers.get(k) : null) ?? '';
    return !!h('cf-mitigated') || /imperva/i.test(h('x-cdn')) || [403, 429].includes(r.status);
};
class ArretDefi extends Error { constructor(m) { super(m); this.arret = true; } }

/**
 * Le client : UNE requête à la fois et au moins `cadenceMs` entre deux (tous hôtes confondus : plus lent que nécessaire, jamais plus rapide),
 * hôte de la liste fermée, robots.txt lu une fois par hôte AVANT la première image, redirections `manual` suivies seulement dans l'hôte (3 sauts),
 * et au premier défi anti-robot (403, 429, cf-mitigated, Imperva) ARRÊT : plus aucune requête ne part.
 */
function creerClient({ fetch = globalThis.fetch, attendre = ms => new Promise(r => setTimeout(r, ms)), maintenant = Date.now, cadenceMs = CADENCE_MS } = {}) {
    let derniere = null, arret = null;
    const robots = new Map();
    const compte = {};
    async function requete(url) {
        if (derniere !== null) { const reste = cadenceMs - (maintenant() - derniere); if (reste > 0) await attendre(reste); }
        derniere = maintenant();
        const h = hoteDe(url); compte[h] = (compte[h] || 0) + 1;
        const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': AGENT, Accept: 'image/*,*/*;q=0.5' } });
        if (defi(r)) { arret = new ArretDefi(`ARRÊT : ${url} a répondu ${r.status} (défi anti-robot ou limite) — plus aucune requête`); throw arret; }
        return r;
    }
    async function regles(hote) {
        if (robots.has(hote)) return robots.get(hote);
        const r = await requete(`https://${hote}/robots.txt`);
        let reg;
        if (r.status === 404 || r.status === 410) reg = [];
        else if (r.status === 200) reg = regleRobots(await r.text());
        else throw new Error(`robots.txt de ${hote} illisible (HTTP ${r.status}) : je ne sais pas, je ne demande rien`);
        robots.set(hote, reg); return reg;
    }
    async function get(url) {
        if (arret) throw arret;
        let courant = url;
        for (let saut = 0; saut <= 3; saut++) {
            const u = new URL(courant);
            if (u.protocol !== 'https:' || !HOTES_COLLECTE.includes(u.hostname)) throw new Error(`hôte ${u.hostname} hors de la liste fermée`);
            if (!autorise(await regles(u.hostname), u.pathname)) throw new Error(`robots.txt de ${u.hostname} interdit ${u.pathname}`);
            const r = await requete(courant);
            if ([301, 302, 303, 307, 308].includes(r.status)) {
                const loc = r.headers.get('location'); if (!loc) throw new Error('redirection sans destination');
                const cible = new URL(loc, courant);
                if (cible.protocol !== 'https:' || cible.hostname !== u.hostname) throw new Error(`redirection hors de l'hôte vers ${cible.hostname} : refusée`);
                courant = cible.href; continue;
            }
            const buf = r.status === 200 ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
            return { status: r.status, buf, type: r.headers.get('content-type'), url: courant };
        }
        throw new Error('trop de redirections');
    }
    return { get, compte, arrete: () => arret };
}

const contentType = ext => ({ png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg', jpg: 'image/jpeg' })[ext] ?? 'application/octet-stream';
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/**
 * L'écriture d'UNE ligne : l'image et sa vignette dans R2, puis `sets.logoOfficiel.<cible>` — un champ NEUF, posé seulement s'il est absent (filtre
 * `$exists: false`). Un logoOfficiel déjà posé n'est jamais remplacé : même fichier → « deja », autre fichier → « refus ». Rien d'autre n'est écrit.
 */
async function ecrireLigne({ S, r2, bucket, ligne, set, fichier, le = new Date() }) {
    const { fabriquerVignette, cleVignette, LARGEUR_VIGNETTE_LOGO } = require('./collecte-cartes/vignette');
    if (!SLUG.test(set)) return { action: 'refus', raison: `identifiant de set « ${set} » non sûr pour une clé R2` };
    if (!['fr', 'ja'].includes(ligne.cible)) return { action: 'refus', raison: `cible « ${ligne.cible} » inconnue` };
    const champ = `logoOfficiel.${ligne.cible}`;
    const doc = await S.findOne({ _id: set }, { projection: { logoOfficiel: 1 } });
    if (!doc) return { action: 'refus', raison: `set ${set} absent` };
    const deja = doc.logoOfficiel?.[ligne.cible];
    if (deja) return deja.sha256 === fichier.sha256 ? { action: 'deja' } : { action: 'refus', raison: `${set} porte déjà un logoOfficiel.${ligne.cible} différent (${deja.lot}) : rien n'est remplacé` };
    const cleR2 = `logos-officiels/${ligne.cible}/${set}-${fichier.sha256.slice(0, 10)}.${fichier.ext}`;
    const cv = cleVignette(cleR2);
    const vg = await fabriquerVignette(fichier.buf, { largeur: LARGEUR_VIGNETTE_LOGO, qualite: 85 });
    const meta = await sharp(fichier.buf).metadata();
    await r2.deposerBinaire(bucket, cleR2, fichier.buf, contentType(fichier.ext));
    await r2.deposerBinaire(bucket, cv, vg.buffer, 'image/webp');
    const entree = {
        cleR2, w: meta.width, h: meta.height, octets: fichier.buf.length, sha256: fichier.sha256, format: meta.format, langue: ligne.langue,
        source: ligne.source, urlSource: fichier.url, lot: LOT, mention: MENTION, le, vignette: { cleR2: cv, w: vg.w, h: vg.h },
        preuve: { urlSource: fichier.url, verifie: fichier.via, corr: fichier.corr ?? null, comparePhase1: ligne.cache?.sha256 === fichier.sha256, fichierPokecardex: ligne.fichier, pokecardexSha256: ligne.pokecardexSha256, setDeLaLigne: ligne.set, scorePhase1: ligne.score ?? null }
    };
    const u = await S.updateOne({ _id: set, [champ]: { $exists: false } }, { $set: { [champ]: entree } });
    return u.modifiedCount === 1 ? { action: 'ecrit', cleR2, vignette: cv } : { action: 'refus', raison: `${set} : le champ est apparu entre-temps` };
}

/** Le retrait du lot (voir retirer-logos-officiels.js) : exactement les entrées `logoOfficiel.*` de CE lot, et leurs objets R2. */
async function retirerLot({ S, r2, bucket, lot, ecrire = false }) {
    if (!lot) throw new Error('retirerLot : lot obligatoire');
    const docs = await S.find({ $or: [{ 'logoOfficiel.fr.lot': lot }, { 'logoOfficiel.ja.lot': lot }] }, { projection: { logoOfficiel: 1 } }).toArray();
    const sets = [], cles = [], parSet = new Map();
    for (const d of docs) {
        const ks = Object.keys(d.logoOfficiel || {}).filter(k => d.logoOfficiel[k]?.lot === lot);
        if (!ks.length) continue;
        sets.push(d._id); parSet.set(d._id, ks);
        for (const k of ks) for (const c of [d.logoOfficiel[k].cleR2, d.logoOfficiel[k].vignette?.cleR2]) if (c) cles.push(c);
    }
    for (const c of cles) if (!/^(vignettes\/)?logos-officiels\//.test(c)) throw new Error(`retirerLot : clé « ${c} » hors du préfixe logos-officiels/ : arrêt`);
    if (!ecrire) return { sets, cles };
    for (const [id, ks] of parSet) {
        for (const k of ks) await S.updateOne({ _id: id, [`logoOfficiel.${k}.lot`]: lot }, { $unset: { [`logoOfficiel.${k}`]: '' } });
        await S.updateOne({ _id: id, logoOfficiel: {} }, { $unset: { logoOfficiel: '' } });
    }
    if (cles.length) await r2.supprimer(bucket, cles);
    return { sets, cles };
}

module.exports = { LOT, MENTION, HOTES_COLLECTE, CADENCE_MS, sourceDe, verifierUrl, planifier, juger, reduireDoublons, creerClient, regleRobots, autorise, ecrireLigne, retirerLot, ArretDefi };

// ───────────────────────── la ligne de commande
const AUTORISES = [/^--table=.+\.json$/, /^--pokecardex=.+$/, /^--cache=.+$/, /^--rapport=.+\.json$/, /^--ecrire$/];
if (require.main === module) (async () => {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --cache=<dossier> (obligatoire), --table=, --pokecardex=, --rapport=, --ecrire`); process.exit(2); }
    const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ECRIRE = process.argv.includes('--ecrire');
    const cache = arg('cache');
    if (!cache) { console.error('❌ --cache=<dossier> obligatoire : les fichiers téléchargés y sont gardés, et l\'écriture les relit au lieu de redemander'); process.exit(2); }
    const table = JSON.parse(fs.readFileSync(path.resolve(arg('table') || path.join(__dirname, 'collecte-cartes', 'logos-officiels-table.json')), 'utf8'));
    const racine = arg('pokecardex') || path.join(__dirname, '..', 'pokemon-proxy');
    fs.mkdirSync(cache, { recursive: true });
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const cx = await ouvrirConnexions({ production: false, buckets: ECRIRE ? ['R2_BUCKET_IMAGES'] : [] });
    const S = cx.cartes.db.collection('sets');
    const sets = new Map((await S.find({}, { projection: { tirage: 1, region: 1 } }).toArray()).map(s => [s._id, s]));
    if (!sets.size) throw new Error('collection sets vide : base fausse');
    const officiels = table.lignes.filter(l => l.verdict === 'OFFICIEL');
    console.log(`DÉNOMINATEUR : ${table.lignes.length} lignes dans la table · ${officiels.length} OFFICIEL · ${sets.size} sets en base · lot ${LOT}`);
    const verdicts = officiels.map(l => ({ l, ...planifier(l, sets) }));
    const compte = {}; for (const v of verdicts) compte[v.action] = (compte[v.action] || 0) + 1;
    console.log(`PLAN (avant tout téléchargement) : ${Object.entries(compte).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
    const aCollecter = verdicts.filter(v => v.action === 'collecter').map(v => v.l);
    const client = creerClient();
    const rapport = { lot: LOT, le: new Date().toISOString(), lignes: [] };
    const acceptes = [];
    let arretDefi = null;
    for (const l of aCollecter) {
        const cle = path.join(cache, sha256(Buffer.from(l.urlChoisie)));
        let buf = null, urlFinale = l.urlChoisie;
        if (fs.existsSync(`${cle}.bin`) && fs.existsSync(`${cle}.json`)) { const j = JSON.parse(fs.readFileSync(`${cle}.json`, 'utf8')); const b = fs.readFileSync(`${cle}.bin`); if (j.url === l.urlChoisie && j.sha256 === sha256(b) && Date.now() - Date.parse(j.le) < 36 * 3600 * 1000) { buf = b; urlFinale = j.urlFinale; } }
        if (!buf) {
            try {
                const r = await client.get(l.urlChoisie);
                if (r.status !== 200) { rapport.lignes.push({ fichier: l.fichier, set: l.set, source: l.source, action: 'ecartee', raison: `HTTP ${r.status}` }); console.log(`   ⚪ ${l.fichier} : HTTP ${r.status}`); continue; }
                buf = r.buf; urlFinale = r.url;
                fs.writeFileSync(`${cle}.bin`, buf); fs.writeFileSync(`${cle}.json`, JSON.stringify({ url: l.urlChoisie, urlFinale, sha256: sha256(buf), le: new Date().toISOString() }));
            } catch (e) {
                if (e.arret) { arretDefi = e.message; console.error(`🛑 ${e.message}`); break; }
                rapport.lignes.push({ fichier: l.fichier, set: l.set, source: l.source, action: 'refus', raison: e.message }); console.log(`   🔴 ${l.fichier} : ${e.message}`); continue;
            }
        }
        const pb = fs.existsSync(path.join(racine, l.fichier)) ? fs.readFileSync(path.join(racine, l.fichier)) : null;
        const pokecardexBuf = pb && sha256(pb) === l.pokecardexSha256 ? pb : null;
        const j = await juger(l, buf, { pokecardexBuf });
        if (!j.ok) { rapport.lignes.push({ fichier: l.fichier, set: l.set, source: l.source, action: 'refus', raison: j.raison }); console.log(`   🔴 ${l.fichier} → ${l.set} : ${j.raison}`); continue; }
        acceptes.push({ ligne: l, sha256: j.sha256, fichier: { buf, sha256: j.sha256, ext: j.format === 'jpeg' ? 'jpg' : j.format, url: urlFinale, via: j.via, corr: j.corr } });
    }
    const dd = reduireDoublons(acceptes);
    acceptes.forEach((a, i) => { a.action = dd[i].action; if (dd[i].raison) a.raison = dd[i].raison; if (dd[i].action !== 'ecrire') rapport.lignes.push({ fichier: a.ligne.fichier, set: a.ligne.set, source: a.ligne.source, action: dd[i].action, raison: dd[i].raison ?? `même fichier que ${dd[i].meme}` }); });
    for (const v of verdicts.filter(v => v.action !== 'collecter')) rapport.lignes.push({ fichier: v.l.fichier, set: v.l.set, source: v.l.source, action: v.action, raison: v.raison });
    const aEcrire = acceptes.filter(a => a.action === 'ecrire');
    for (const a of aEcrire) rapport.lignes.push({ fichier: a.ligne.fichier, set: a.ligne.set, source: a.ligne.source, action: 'collectable', via: a.fichier.via, url: a.fichier.url });
    const parSource = {}; for (const a of aEcrire) parSource[a.ligne.source] = (parSource[a.ligne.source] || 0) + 1;
    const ecartees = {}; for (const r of rapport.lignes.filter(r => r.action !== 'collectable')) { const k = `${r.action}: ${String(r.raison).replace(/« [^»]*»/g, '«…»').replace(/\d+/g, 'N').slice(0, 90)}`; ecartees[k] = (ecartees[k] || 0) + 1; }
    rapport.collectables = aEcrire.length; rapport.parSource = parSource; rapport.requetes = client.compte; rapport.arret = arretDefi;
    console.log(`\nSIMULATION : ${aEcrire.length} collectables sur ${officiels.length} OFFICIEL · par source ${JSON.stringify(parSource)} · via ${JSON.stringify(aEcrire.reduce((o, a) => (o[a.fichier.via] = (o[a.fichier.via] || 0) + 1, o), {}))}`);
    console.log('ÉCARTÉES / REPORTÉES / REFUSÉES :'); for (const [k, n] of Object.entries(ecartees).sort((a, b) => b[1] - a[1])) console.log(`   ${n} × ${k}`);
    console.log(`REQUÊTES : ${JSON.stringify(client.compte)}${arretDefi ? ` · ARRÊT : ${arretDefi}` : ''}`);
    if (arg('rapport')) fs.writeFileSync(arg('rapport'), JSON.stringify(rapport, null, 1));
    if (arretDefi) { await cx.fermer(); process.exit(1); }
    if (!ECRIRE) { console.log('(simulation seule — --ecrire sous lot-additif.js ; rien n\'est écrit en base ni sur R2)'); await cx.fermer(); return; }
    const r2 = require('./collecte-cartes/r2'), bucket = process.env.R2_BUCKET_IMAGES;
    await r2.verifierBucket(bucket);
    const bilan = {};
    for (const a of aEcrire) { const e = await ecrireLigne({ S, r2, bucket, ligne: a.ligne, set: a.ligne.set, fichier: a.fichier }); bilan[e.action] = (bilan[e.action] || 0) + 1; if (e.action === 'refus') console.log(`   🔴 ${a.ligne.fichier} → ${a.ligne.set} : ${e.raison}`); }
    const relus = await S.countDocuments({ $or: [{ 'logoOfficiel.fr.lot': LOT }, { 'logoOfficiel.ja.lot': LOT }] });
    console.log(`\nÉCRIT : ${JSON.stringify(bilan)} · RELU : ${relus} sets portent un logoOfficiel du lot ${LOT}`);
    await cx.fermer();
    if ((bilan.refus || 0) > 0) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
