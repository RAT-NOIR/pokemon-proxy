// ============================================================
// LANCEUR DÉDIÉ TPC — UN set, TROIS modes séparés : télécharger (cache DISQUE) · planche (zéro requête) · écrire (depuis le cache, zéro requête)   (coordinateur, 2026-10-18)
// ============================================================
//   node collecter-tpc-set.js --set=Traditional-Chinese-Products --telecharger --plafond=460 [--cache=<dossier>]
//   node collecter-tpc-set.js --set=Traditional-Chinese-Products --planche [--cache=<dossier>] [--sortie=<planche.png>]
//   node lot-additif.js --quoi="…" --collections=cartes,images,sets -- node collecter-tpc-set.js --set=Traditional-Chinese-Products --ecrire --attendu=<N>
//
// POURQUOI UN LANCEUR : `collecteur-images.js --boucle` prend TOUTE la file (l'alimentateur peut y enfiler d'autres sources) et télécharge ET écrit dans le même passage. La règle du testeur est
// téléchargement, planche, essai à blanc, écriture, revérification : trois modes, trois gestes, jamais ensemble. Ce lanceur ne touche NI la file NI l'alimentateur.
//
// 🔑 LISTE FERMÉE : `SETS_AUTORISES` (ce seul slug aujourd'hui), comparaison exacte ; tout autre set refuse avant toute connexion.
// 🔑 --telecharger : robots.txt, listes, fiches, images vers un CACHE DISQUE (sous couverture\S7\TAIWAN\, chemin jugé). Il n'écrit RIEN dans `cartes`, `images`, `sets`, `tpc_fiches`, `collecte_images_etat`
//   (les listes et les fiches vont dans <cache>/etat-local.json, le même mécanisme que `--plan-reel`). SEULE écriture en base : le VERROU GLOBAL tpc-asie (pris puis rendu), comme `--plan-reel` — le client
//   REFUSE toute requête sans lui. PLAFOND CODÉ : `fabriquerClientTpc({ plafond })` refuse la requête n° plafond + 1 ; le compte est CUMULÉ sur le cache (<cache>/compteur.json, mis à jour à chaque
//   requête) : une relance repart du cumul, jamais de zéro ; robots.txt compte pour une requête à chaque passage. Cadence ≥ 10 s, robots relu, règle commune `reponse-hote.js`.
// 🔑 --ecrire : depuis le cache seulement (un client « disque » qui REFUSE toute requête réseau), par `collecterSet` — la MÊME fonction que le worker : sansRemplacement, témoin du nom, retirable,
//   urlOriginal, lot neutre, garde de jointure. Les listes et les fiches se relisent du cache local : `tpc_fiches` n'est PAS écrit en base. Écrit : R2, `images`, `cartes.images`, `sets.visuelsTpc`
//   (le bilan) et le verrou de set (`collecte_images_etat`, comme le worker). `--attendu=N` est comparé AVANT toute écriture.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const T = require('./collecte-cartes/tpc');
const { ligneTpc, listesDe } = require('./collecte-cartes/tpc-sets');
const { largeurMinDe } = require('./collecte-cartes/seuils-images');
const C = require('./collecteur-images-tpc');
const RH = require('./collecte-cartes/reponse-hote');          // la règle COMMUNE de réponse : arrêt durable par hôte (arretHote), lu par garderHote avant toute requête

const SETS_AUTORISES = Object.freeze(['Traditional-Chinese-Products']);
const SITE = 'tpc-asie';
const PLAFOND_MAX = 460;                         // 444 au plus d'après le plan (1 robots + 20 listes + 390 fiches + 33 images) + réessais
const RACINE_CACHE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/TAIWAN';
const CACHE_DEFAUT = `${RACINE_CACHE}/cache-products`;
const sha = (algo, b) => crypto.createHash(algo).update(b).digest('hex');

/** Un chemin du lanceur : sous la racine autorisée et nulle part ailleurs (jamais un dossier d'apports manuels). */
function verifierChemin(chemin, racine = RACINE_CACHE) {
    const r = path.resolve(racine), c = path.resolve(chemin);
    if (c !== r && !c.startsWith(r + path.sep)) throw new Error(`chemin « ${chemin} » hors de ${racine} — refusé`);
    if (/(^|[\\/])(Logo FR|apport-manuel|LOGO)([\\/]|$)/i.test(c)) throw new Error(`chemin « ${chemin} » : dossier d'apports manuels — refusé`);
    return c;
}

/** Une vue de la base en LECTURE SEULE : find / findOne / countDocuments, rien d'autre (une écriture lève). */
function lectureSeule(reelle) {
    return { collection: n => { const c = reelle.collection(n); return { find: (...a) => c.find(...a), findOne: (...a) => c.findOne(...a), countDocuments: (...a) => c.countDocuments(...a),
        updateOne() { throw new Error(`écriture refusée sur ${n} : ce mode n'écrit pas en base`); }, insertOne() { throw new Error(`écriture refusée sur ${n}`); }, deleteOne() { throw new Error(`écriture refusée sur ${n}`); }, replaceOne() { throw new Error(`écriture refusée sur ${n}`); } }; },
    command: (...a) => reelle.command(...a) };
}

const fichiers = dossier => ({ etat: path.join(dossier, 'etat-local.json'), compteur: path.join(dossier, 'compteur.json'), index: path.join(dossier, 'images', 'index.json'), plan: path.join(dossier, 'plan.json') });
// Lecture SÛRE (correction 1 de la relecture L3b) : fichier ABSENT = la valeur par défaut (premier passage) ; fichier présent mais illisible = on ne part pas, et le message le NOMME. Un repli silencieux sur
// « 0 » remettrait le plafond de 460 à neuf après une coupure en pleine écriture.
const lireJson = (f, defaut) => {
    let texte;
    try { texte = fs.readFileSync(f, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return defaut; throw new Error(`${f} illisible (${e.message}) — on ne part pas, rien n'est demandé`); }
    try { return JSON.parse(texte); } catch (e) { throw new Error(`${f} illisible (JSON invalide : ${e.message}) — on ne part pas, rien n'est demandé ; le restaurer ou le supprimer est une décision du coordinateur`); }
};
/** Écriture ATOMIQUE : fichier temporaire voisin, puis renommage — une coupure laisse l'ancien contenu ou le nouveau, jamais un fichier tronqué. */
const ecrireJson = (f, v) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(v));
    fs.renameSync(tmp, f);
};
/** Le cumul de requêtes : absent → 0 ; présent → un objet `{ requetes: entier ≥ 0 }` ou le refus, qui nomme le fichier. */
function lireCompteur(f) {
    const j = lireJson(f, { requetes: 0 });
    if (!j || typeof j !== 'object' || Array.isArray(j) || !Number.isInteger(j.requetes) || j.requetes < 0) throw new Error(`${f} de forme inattendue (${JSON.stringify(j)}) : « requetes » doit être un entier ≥ 0 — on ne part pas, rien n'est demandé`);
    return j.requetes;
}

function cadre({ slug, cacheDir, racineAutorisee, ligneDe = ligneTpc }) {
    if (!SETS_AUTORISES.includes(slug)) throw new Error(`set « ${slug} » : hors de la liste fermée (${SETS_AUTORISES.join(', ')}) — rien n'est demandé`);
    const L = ligneDe(SITE, slug);
    if (!L) throw new Error(`${SITE} / ${slug} absent de collecte-cartes/tpc-sets.js`);
    const dossier = verifierChemin(cacheDir ?? CACHE_DEFAUT, racineAutorisee ?? RACINE_CACHE);
    return { L, dossier, f: fichiers(dossier), idEtat: `${SITE}/${slug}` };
}

/** Le plan depuis le CACHE SEUL : listes et fiches lues dans l'état local, aucun client. */
async function planDuCache({ reelle, dossier, f, L, slug, idEtat }) {
    const local = C.baseLocale(lectureSeule(reelle), f.etat);
    const fiches = [];
    const etat = await local.collection('collecte_images_etat').findOne({ _id: idEtat });
    for (const S of listesDe(L)) {
        const liste = etat?.listes?.[S.prefixe] ?? null;
        if (!liste?.ids?.length) continue;
        fiches.push(...(await C.lireFiches(local, null, SITE, L, liste.ids, { compter: () => { } })).map(x => ({ ...x, prefixe: S.prefixe, listeCode: S.code })));
    }
    const P = await C.planifier(local, slug, L, fiches);
    return { P, fiches, local };
}

const urlImage = (p) => (p.fiche.image ? new URL(p.fiche.image, T.SITES[SITE].hote).href : null);

/**
 * MODE 1 — TÉLÉCHARGER vers le cache disque. @returns {{etat: 'termine'|'plafond-atteint'|'bloque'|'pause'|'interrompu', requetes: number, plafond: number, ...}}
 */
async function telecharger({ reelle, slug, cacheDir, racineAutorisee, plafond, verrou, transport, cadenceMs = T.CADENCE_MS, pourBanc = false, dossierPauses, ligneDe = ligneTpc, log = console.log }) {
    if (!Number.isInteger(plafond) || plafond < 1 || plafond > PLAFOND_MAX) throw new Error(`--plafond=${plafond} : un entier de 1 à ${PLAFOND_MAX} est exigé — rien n'est demandé`);
    if (!pourBanc && cadenceMs < T.CADENCE_MS) throw new Error(`cadence de ${cadenceMs} ms : jamais en dessous de ${T.CADENCE_MS} ms — rien n'est demandé`);
    const { L, dossier, f, idEtat } = cadre({ slug, cacheDir, racineAutorisee, ligneDe });
    if (!verrou) throw new Error('un verrou global TPC est exigé (aucune requête sans lui)');
    const lecture = lectureSeule(reelle);
    const set = await lecture.collection('sets').findOne({ _id: slug });
    if (!set) throw new Error(`set ${slug} absent de la base`);
    if ((set.tirage ?? set.region) !== L.tirage) throw new Error(`tirage ${set.tirage ?? set.region} en base, ${L.tirage} dans la table — rien n'est demandé`);
    const bloquee = await lecture.collection('collecte_images_etat').findOne({ _id: C.idAlerteBloquee(SITE), active: true });
    if (bloquee) throw new Error(`${SITE} a bloqué (${bloquee.motif}) — aucune requête`);
    const produits = await lecture.collection('cartes_produits').countDocuments({ slugSet: slug });
    if (!produits) throw new Error(`aucun produit joint au set ${slug} — rien à demander`);
    if (!(await C.compterNumerotes(lecture, slug))) throw new Error(`aucune ligne de ${slug} ne porte de numeroFiche : écrire les numeroFiche d'abord — rien n'est demandé`);

    fs.mkdirSync(path.join(dossier, 'images'), { recursive: true });
    const local = C.baseLocale(lecture, f.etat);
    const tenuPar = verrou.prendre ? await verrou.prendre() : null;
    if (tenuPar) throw new Error(`verrou global ${SITE} tenu par pid ${tenuPar.pid} sur ${tenuPar.hote} — on s'arrête, aucune requête`);
    try {
        // le cumul se lit APRÈS la prise du verrou : un lancement qui attendait un autre ne part pas d'un cumul périmé
        const compteInitial = lireCompteur(f.compteur);
        let aEcrire = 0;
        const surRequete = n => { ecrireJson(f.compteur, { requetes: n, plafond, le: new Date().toISOString() }); if (++aEcrire % 10 === 0) local.ecrireFichier(); };
        const client = T.fabriquerClientTpc({ site: SITE, verrou, transport, cadenceMs, reessaiMs: pourBanc ? 0 : undefined, plafond, compteInitial, surRequete, ...(dossierPauses ? { dossierPauses } : {}) });
        const bilan = { etat: 'termine', plafond, compteInitial, listes: null, fiches: 0, prouves: 0, images: { telechargees: 0, enCache: 0, absentes: 0 }, restes: {}, dossierPauses: dossierPauses ?? RH.DOSSIER_PAUSES };
        const compteurs = {}, compter = k => { compteurs[k] = (compteurs[k] || 0) + 1; };
        let lu;
        try { lu = await C.lireListesEtFiches(local, client, SITE, L, idEtat, compter); }
        catch (e) { return conclure(e, bilan, client, local, f, log); }
        if (lu.refus) { bilan.etat = 'refuse-liste'; bilan.motif = lu.refus; return fin(bilan, client, local, f, log); }
        bilan.listes = { lues: lu.liste.ids.length, total: lu.liste.total, complete: lu.liste.complete }; bilan.fiches = lu.fiches.length; bilan.fiches404 = compteurs['fiche-404'] || 0;
        const P = await C.planifier(local, slug, L, lu.fiches);
        bilan.prouves = P.plan.length; for (const r of P.restes) bilan.restes[r.motif] = (bilan.restes[r.motif] || 0) + 1;
        ecrireJson(f.plan, { le: new Date().toISOString(), slug, produits: P.produits, trous: P.trous, plan: P.plan, restes: P.restes });
        const index = lireJson(f.index, {});
        for (const p of P.plan) {
            const url = urlImage(p);
            if (!url) { compter('fiche-sans-image'); continue; }
            if (index[url]) { bilan.images.enCache++; continue; }
            try {
                const buffer = await client.image(url);
                if (!buffer) { index[url] = { absente: true, le: new Date().toISOString() }; bilan.images.absentes++; }
                else {
                    const fichier = `${sha('sha256', Buffer.from(url)).slice(0, 20)}.bin`;
                    fs.writeFileSync(path.join(dossier, 'images', fichier), buffer);
                    index[url] = { fichier, sha256: sha('sha256', buffer), octets: buffer.length, le: new Date().toISOString() };
                    bilan.images.telechargees++;
                }
                ecrireJson(f.index, index);
            } catch (e) { ecrireJson(f.index, index); return conclure(e, bilan, client, local, f, log); }
        }
        return fin(bilan, client, local, f, log);
    } finally { if (verrou.rendre) await verrou.rendre(); }
}
function conclure(e, bilan, client, local, f, log) {
    if (e.plafond) bilan.etat = 'plafond-atteint';
    else if (e.bloque) {
        bilan.etat = 'bloque'; bilan.motif = e.message;
        // 401/403/410/429/défi sur une PAGE : le client LÈVE mais ne retient rien d'une relance à l'autre. On retient l'arrêt par la règle COMMUNE (reponse-hote.js `arretHote`, le fichier que
        // `garderHote` lit avant TOUTE requête, pages comme images) — pas un second mécanisme. Un arrêt déjà tenu (`arretDefinitif`) n'est pas réécrit. Si l'écriture échoue, on le dit : l'état reste « bloque ».
        if (!e.arretDefinitif) {
            try { bilan.arretEcrit = RH.arretHote(new URL(T.SITES[SITE].hote).hostname, e.message, { dossier: bilan.dossierPauses }); }
            catch (er) { bilan.arretEcrit = null; bilan.ecritureArretImpossible = er.message; process.exitCode = 1; }
        }
    }
    else if (e.pauseHote) { bilan.etat = 'pause'; bilan.motif = e.message; }
    else throw e;
    bilan.motif ??= e.message;
    return fin(bilan, client, local, f, log);
}
function fin(bilan, client, local, f, log) {
    local.ecrireFichier();
    bilan.requetes = client.compteRequetes(); bilan.statutsHttp = client.statuts();
    ecrireJson(f.compteur, { requetes: bilan.requetes, plafond: bilan.plafond, le: new Date().toISOString() });
    log(`TÉLÉCHARGEMENT : ${bilan.etat} · requêtes cumulées ${bilan.requetes}/${bilan.plafond} (avant ce passage ${bilan.compteInitial}) · listes ${JSON.stringify(bilan.listes)} · fiches ${bilan.fiches} · prouvés ${bilan.prouves} · images ${JSON.stringify(bilan.images)} · restes ${JSON.stringify(bilan.restes)}${bilan.motif ? ` · ${bilan.motif}` : ''}`);
    return bilan;
}

/** MODE 2 — la PLANCHE : toutes les images prouvées et en cache, étiquetées. Zéro requête, aucune écriture en base. */
async function planche({ reelle, slug, cacheDir, racineAutorisee, sortie, ligneDe = ligneTpc, log = console.log }) {
    const { L, dossier, f, idEtat } = cadre({ slug, cacheDir, racineAutorisee, ligneDe });
    const { P } = await planDuCache({ reelle, dossier, f, L, slug, idEtat });
    const index = lireJson(f.index, {});
    const lecture = lectureSeule(reelle);
    const prod = new Map((await lecture.collection('cartes_produits').find({ slugSet: slug }, { projection: { idProduct: 1, slug: 1, numeroFiche: 1 } }).toArray()).map(l => [l.idProduct, l]));
    const L1 = 240, H = 330, B = 66, COL = 5;
    const items = P.plan.map(p => ({ p, url: urlImage(p) })).filter(x => x.url && index[x.url]?.fichier);
    const etiquettes = items.map(({ p }) => ({ slugCardmarket: prod.get(p.idProduct)?.slug ?? '?', numeroFiche: p.numero, nomNotre: p.nomEn, nomTpc: p.fiche.nom, liste: p.fiche.prefixe ?? p.fiche.listeCode ?? '?' }));
    const echapper = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tuiles = [];
    for (let i = 0; i < items.length; i++) {
        const left = (i % COL) * L1, top = Math.floor(i / COL) * (H + B), e = etiquettes[i];
        tuiles.push({ input: await sharp(path.join(dossier, 'images', index[items[i].url].fichier)).resize(L1, H, { fit: 'fill' }).png().toBuffer(), left, top });
        const t = [`${e.slugCardmarket}`, `${e.numeroFiche} · liste ${e.liste}`, `notre fiche : ${e.nomNotre}`, `TPC : ${e.nomTpc}`];
        tuiles.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L1}" height="${B}"><rect width="${L1}" height="${B}" fill="#fff"/>${t.map((x, k) => `<text x="4" y="${13 + 15 * k}" font-family="Arial, sans-serif" font-size="12" fill="${k === 3 ? '#a00' : '#000'}">${echapper(x.slice(0, 36))}</text>`).join('')}</svg>`), left, top: top + H });
    }
    const png = path.resolve(sortie ?? path.join(dossier, 'planche.png'));
    verifierChemin(png, racineAutorisee ?? RACINE_CACHE);
    fs.mkdirSync(path.dirname(png), { recursive: true });
    if (items.length) await sharp({ create: { width: L1 * COL, height: (H + B) * Math.ceil(items.length / COL), channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite(tuiles).png().toFile(png);
    log(`PLANCHE : ${items.length} image(s) prouvées et en cache sur ${P.plan.length} prouvées → ${items.length ? png : '(aucune image : pas de fichier)'} · requêtes 0`);
    return { images: items.length, prouves: P.plan.length, sortie: items.length ? png : null, etiquettes };
}

/** Un client « disque » : AUCUNE requête réseau. Les pages et le JSON n'existent pas ici (listes et fiches viennent de l'état local) ; une image se lit dans le cache ou elle manque. */
function clientDisque(dossier, index) {
    return {
        site: SITE,
        page: async url => { throw new Error(`hors cache : ${url} — ce mode n'envoie aucune requête`); },
        json: async url => { throw new Error(`hors cache : ${url} — ce mode n'envoie aucune requête`); },
        image: async url => { const e = index[url]; if (!e) throw new Error(`hors cache : ${url} — télécharger d'abord`); if (e.absente) return null; return fs.readFileSync(path.join(dossier, 'images', e.fichier)); },
        compteRequetes: () => 0, statuts: () => ({}), bloque: () => null, pause: () => null,
        suivi: () => ({ hotes: () => [], rapport: () => ({}) })
    };
}

/**
 * MODE 3 — ÉCRIRE depuis le cache. `M` : les modèles de la base `cartes` ; `reelle` : sa base native. Rend {code, ...}: 2 = refusé AVANT toute écriture.
 */
async function ecrire({ M, reelle, slug, cacheDir, racineAutorisee, attendu, deposer, fabriquerVerrouSet, stopOctets, ligneDe = ligneTpc, log = console.log }) {
    if (!Number.isInteger(attendu)) throw new Error('--ecrire exige --attendu=<N> (le nombre d\'images prouvées lu à l\'essai) : rien n\'est écrit');
    const { L, dossier, f, idEtat } = cadre({ slug, cacheDir, racineAutorisee, ligneDe });
    const { P, local } = await planDuCache({ reelle, dossier, f, L, slug, idEtat });
    const index = lireJson(f.index, {});
    const seuil = largeurMinDe(SITE);
    const manquantes = [], aJoindre = [];
    for (const p of P.plan) {
        const url = urlImage(p);
        const e = url ? index[url] : null;
        if (!e) { manquantes.push(p.numero); continue; }
        if (e.absente) continue;
        const deja = await M.Image.findById(T.idImageTpc(SITE, slug, p.carteId, p.numero, T.SITES[SITE].langues[L.langue])).select('etat').lean();
        if (deja?.etat === 'retire') continue;
        const meta = await sharp(fs.readFileSync(path.join(dossier, 'images', e.fichier))).metadata();
        if (meta.width && meta.width >= seuil) aJoindre.push(p);
    }
    if (manquantes.length) { log(`❌ ${manquantes.length} image(s) prouvée(s) hors du cache (${manquantes.slice(0, 8).join(', ')}…) : télécharger d'abord — rien n'est écrit`); return { code: 2, etat: 'refuse-cache-incomplet', manquantes }; }
    if (attendu !== aJoindre.length) { log(`❌ --attendu=${attendu} mais ${aJoindre.length} image(s) à joindre (prouvées ${P.plan.length}) — rien n'est écrit`); return { code: 2, etat: 'refuse-attendu', attendu, reel: aJoindre.length, prouves: P.plan.length }; }
    // la base vue par `collecterSet` : `tpc_fiches` et `collecte_images_etat` restent LOCAUX (le cache disque) ; tout le reste est la vraie base
    const mixte = { collection: local.collection, command: c => reelle.command(c) };
    const Mm = { ...M, Carte: new Proxy(M.Carte, { get: (t, k) => (k === 'db' ? { db: mixte } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) }) };
    const unite = { _id: idEtat, source: SITE, slugSet: slug, code: L.code, langue: L.langue, trous: L.trous };
    const r = await C.collecterSet(unite, Mm, { verrou: { tenu: true, perdu: false }, client: clientDisque(dossier, index), deposer, ...(fabriquerVerrouSet ? { fabriquerVerrouSet } : {}), ...(stopOctets ? { stopOctets } : {}), ligneDe });
    local.ecrireFichier();
    log(`ÉCRITURE : ${r.etat} · joints ${r.joints}/${attendu} · téléchargés ${r.telecharges} · sous le seuil ${r.tropPetits} · garde ${r.garde?.ok ? '✅' : '❌'} · requêtes 0`);
    return { ...r, unite: r.code, code: r.etat === 'verifie' && r.joints === attendu ? 0 : 1 };
}

module.exports = { SETS_AUTORISES, PLAFOND_MAX, RACINE_CACHE, CACHE_DEFAUT, verifierChemin, lectureSeule, telecharger, planche, ecrire, clientDisque };

if (require.main === module) {
    const AUTORISES = [/^--set=.+$/, /^--telecharger$/, /^--planche$/, /^--ecrire$/, /^--plafond=\d+$/, /^--attendu=\d+$/, /^--cache=.+$/, /^--sortie=.+\.png$/];
    const args = process.argv.slice(2);
    const val = n => args.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const modes = ['--telecharger', '--planche', '--ecrire'].filter(m => args.includes(m));
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    const mode = modes[0];
    const erreur = inconnus.length ? `argument inconnu : ${inconnus.join(' ')}` : modes.length !== 1 ? 'un seul mode parmi --telecharger, --planche, --ecrire' : !SETS_AUTORISES.includes(val('set') ?? '') ? `--set=<${SETS_AUTORISES.join('|')}> obligatoire` :
        mode === '--telecharger' && val('plafond') === undefined ? '--telecharger exige --plafond=<N>' : mode !== '--telecharger' && val('plafond') !== undefined ? '--plafond ne va qu\'avec --telecharger' :
            mode === '--ecrire' && val('attendu') === undefined ? '--ecrire exige --attendu=<N>' : mode !== '--ecrire' && val('attendu') !== undefined ? '--attendu ne va qu\'avec --ecrire' : null;
    if (erreur) { console.error(`❌ ${erreur}. Aucune connexion, aucune requête.`); process.exit(2); }
    (async () => {
        require('dotenv').config();
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { modeles } = require('./collecte-cartes/schemas');
        const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: mode === '--ecrire' ? ['R2_BUCKET_IMAGES'] : [] });
        try {
            const slug = val('set'), cacheDir = val('cache');
            if (mode === '--telecharger') {
                const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
                const M = modeles(cx);
                const verrou = fabriquerVerrou({ Modele: M.EtatImages, id: T.SITES[SITE].verrou, dureeMs: T.VERROU_GLOBAL_MS, surInsertion: { phase: 'collecteur' }, surPerte: () => { process.exitCode = 1; }, nom: `verrou global ${SITE}` });
                const b = await telecharger({ reelle: cx.db, slug, cacheDir, plafond: Number(val('plafond')), verrou });
                process.exitCode = b.etat === 'termine' ? 0 : 1;
            } else if (mode === '--planche') await planche({ reelle: cx.db, slug, cacheDir, sortie: val('sortie') });
            else {
                const r2 = require('./collecte-cartes/r2');
                if (!process.env.R2_BUCKET_IMAGES) throw new Error('R2_BUCKET_IMAGES absent — aucune écriture');
                await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
                const r = await ecrire({ M: modeles(cx), reelle: cx.db, slug, cacheDir, attendu: Number(val('attendu')), deposer: (b, c, d, t) => r2.deposerBinaire(b, c, d, t) });
                process.exitCode = r.code;
            }
        } finally { await fermer(); }
    })().catch(e => { console.error('❌', e.message); process.exit(1); });
}
