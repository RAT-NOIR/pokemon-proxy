// Mutants des bancs de la RÉCOLTE : chaque mutant casse UNE garde d'un module ; le banc concerné doit ÉCHOUER. Un mutant qui survit = une garde que rien ne garde.
//   node mutants-recolte.js            (sortie : tués / survivants, par module)
// Le module est réécrit SUR PLACE, le temps d'un essai, puis RESTAURÉ (try/finally, et un contrôle final de l'identité du texte) : ne pas le lancer pendant qu'un collecteur démarre.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const GROUPES = [
    { module: 'collecte-cartes/pokipair.js', bancs: ['test-pokipair.js'], mutants: [
        ['tuile cachée acceptée comme visible', "const visibles = l.filter(t => !t.cachee);", "const visibles = l;"],
        ['variante quelconque admise', "if (!VARIANTES_BASE.includes(visibles[0].variante))", "if (false)"],
        ['nom non comparé', "if (!memeNom(t.nom, nomJoint)) {", "if (false) {"],
        ['nom du produit non comparé', "if (nomProduit && !memeNom(t.nom, nomProduit))", "if (false)"],
        ['variantes (deux produits au même numéro) acceptées', "if (effectifs.get(cle(p)) > 1) { reste(p, 'variantes'", "if (false) { reste(p, 'variantes'"],
        ['Gem Pack lu comme simple', "if (ligne.format !== 'simple') {", "if (false) {"],
        ['tuile revendiquée deux fois gardée', "const gardees = unites.filter(u => !doubles.has(u.url));", "const gardees = unites;"],
        ['adresse hors forme acceptée', "if (!urlImageValide(t.url))", "if (false)"],
        ['miniature incohérente acceptée', "if (t.miniature !== miniatureDe(t.url))", "if (false)"],
        ['garde de titre retirée', "if (!ligne.titre.test(", "if (false && !ligne.titre.test("],
        ['garde de total retirée', "if (ligne.format === 'simple' && page.totalDominant !== ligne.total)", "if (false)"],
        ['tuile illisible acceptée', "if (t.illisible || t.n == null) continue;", "if (t.n == null) continue;"],
        ['hôte quelconque pour les images', "u.hostname === HOTE_IMAGES &&", "true &&"],
        ['page hors table acceptée', "if (!TABLE.some(l => l.page === page))", "if (false)"],
        ['produit vers plusieurs cartes accepté', "if (lignesDuProduit.get(p.idProduct) > 1) {", "if (false) {"],
        ['numéro comparé sans la clé de la jointure', "const b = baseDe.get(J.cleNumero(p.numeroFiche));", "const b = baseDe.get(String(p.numeroFiche));"]
    ] },
    { module: 'collecte-cartes/recolte-commun.js', bancs: ['test-collecteur-pokipair.js', 'test-pokipair.js', 'test-tcgcsv.js'], mutants: [
        ['--attendu faux accepté', "if (attendu != null && attendu !== reel) {", "if (false) {"],
        ['mauvais tirage accepté', "if ((set.tirage ?? set.region) !== SRC.TIRAGE)", "if (false)"],
        ['trop-petit écrit', "if (st === 'trop-petit') { tropPetits++; continue; }", ""],
        ['cache altéré accepté', "if (sha('sha256', c.octets) !== ix.sha256)", "if (false)"],
        ['visuel retiré ré-écrit', "if (deja?.etat === 'retire') { retires++; continue; }", ""],
        ['unité cédée écrite', "if (u.decision.action === 'cede') { cedees++; continue; }", ""],
        ['déjà posée re-comptée', "if (u.decision.action === 'deja-posee') { dejaPosees++; continue; }", ""],
        ['forme inattendue acceptée', "if (ratio < RATIO_MIN || ratio > RATIO_MAX)", "if (false)"],
        ['robots.txt des images non lu', "await cli.initialiserRobots(hoteImages);", ""],
        ['base trop grosse acceptée', "if (st.dataSize + st.indexSize > stopOctets)", "if (false)"],
        ['source qui nomme la source acceptée', "if (new RegExp(n, 'i').test(v)) throw", "if (false) throw"],
        ['hôte des images facultatif', "if (typeof hoteImages !== 'string' || !hoteImages) throw", "if (false) throw"],
        ['remplacement de la basse définition retiré', "remplacees += await remplacerBasseDefinition(M, u.carteId, cand, { documents });", ""],
        ['D1 : la note des entrées remplacées retirée', "await M.Image.updateOne({ _id }, { $set: { remplaceEntrees: d.remplace,", "await M.Image.updateOne({ _id }, { $set: { zzNote: d.remplace,"],
        ['D4 : date d\'écriture au lieu de celle du téléchargement', "collecteLe = p.collecteLe ? new Date(p.collecteLe) : le;", "collecteLe = le;"],
        ['D5 : garde de reprise d\'avant', "apres.siennes === avant.siennes + joints;", "apres.siennes === (basseDefinition ? avant.siennes : 0) + joints;"],
        ['fausse absence définitive au premier coup', "if (connu && !(connu.statut === 'fausse-absente' && !RH.fausseAbsenceRecente(connu, now()))) continue;", "if (connu) continue;"]
    ] },
    { module: 'collecte-cartes/recolte-hote.js', bancs: ['test-recolte-hote.js'], mutants: [
        ['robots.txt jamais lu accepté', "if (!r) throw new Error(`robots.txt de ${u.hostname} pas encore lu", "if (!r) return; if (!r) throw new Error(`robots.txt de ${u.hostname} pas encore lu"],
        ['cadence libre', "const cadence = Math.max(cadenceMs, CADENCE_MIN_MS);", "const cadence = cadenceMs;"],
        ['défi sans arrêt', "if (defi) throw arreter(u, url, defi, r.status);", ""],
        ['cache ignoré', "if (!(robotsTxt && !(now() - Date.parse(c.le) <= ROBOTS_MAX_MS))) return { ...c, cache: true };", ""],
        ['D2 : robots.txt de plus de 24 h repris du cache', "if (!(robotsTxt && !(now() - Date.parse(c.le) <= ROBOTS_MAX_MS))) return", "if (true) return"],
        ['D2 : robots.txt périmé en cours de processus accepté', "if (!(now() - r.luLe <= ROBOTS_MAX_MS)) throw", "if (false) throw"],
        ['D3 : verrou tenu par un autre flux ignoré', "if (!r.ok) throw Object.assign(new Error(`verrou de l'hôte", "if (false) throw Object.assign(new Error(`verrou de l'hôte"],
        ['D3 : verrou jamais rendu', "for (const f of verrous.values()) { VP.rendre(f);", "for (const f of verrous.values()) { "],
        ['D3 : battement jamais rafraîchi', "fs.writeFileSync(f, JSON.stringify({ pid: process.pid, hote: os.hostname(), depuis: maintenant.toISOString() }));\n    }", "}"],
        ['plafond ignoré', "if (n >= plafond) throw", "if (false) throw"],
        ['chemin hors liste accepté', "if (!h.chemin.test(u.pathname)) throw", "if (false) throw"],
        ['http accepté', "if (u.protocol !== 'https:') throw", "if (false) throw"],
        ['redirection non suivie, mais acceptée en 200', "if (r.status !== 200 && r.status !== 404) throw", "if (false) throw"],
        ['Crawl-delay ignoré', "if (d && d * 1000 > cadence) throw", "if (false) throw"],
        // (le garde-fou « arrêt déjà écrit » de `garde()` est doublé par celui de `requete()` — défense en profondeur : retirer l'un ne change rien, retirer les DEUX est testé)
        ['arrêt déjà écrit ignoré (les deux gardes)', "RH.garderHote(racineDe(u.hostname), dossierPauses, suivi);\n        if (robotsTxt) return;", "if (robotsTxt) return;", ["RH.garderHote(racineDe(u.hostname), dossierPauses, suivi);       // un arrêt écrit PENDANT l'attente (autre client) bloque aussi", ""]]
    ] },
    { module: 'retirer-visuels-recolte.js', bancs: ['test-collecteur-pokipair.js'], mutants: [
        ['D1 : aucune entrée remise', "nRemises += (await C.updateOne(", "nRemises += 0 * (await C.updateOne("],
        ['D1 : document rendu « ok » par défaut', "const set = { etat: r.avant.etat }, unset = {};", "const set = { etat: 'ok' }, unset = {};"],
        ['D1 : l\'entrée déjà présente est doublée', "images: { $not: { $elemMatch: { source: e.source, set: e.set, cleR2: e.cleR2 } } } }, { $push", "}, { $push"],
        ['D1 : les remises oubliées de l\'annonce (fausses baisses)', "const ajout = remises.filter(", "const ajout = [].filter("]
    ] },
    { module: 'collecte-cartes/tcgcsv.js', bancs: ['test-tcgcsv.js'], mutants: [
        ['/prices accepté', "tcgplayer\\/3\\/\\d{1,6}\\/products)$/;", "tcgplayer\\/3\\/\\d{1,6}\\/(products|prices))$/;"],
        ['plusieurs séries acceptées', "if (lignesO.length > 1) {", "if (false) {"],
        ['total non confirmé accepté', "if (!impressionConfirme(l.carte, num, p.total)) {", "if (false) {"],
        ['finitions multiples acceptées', "if (memeCle.length > 1) {", "if (false) {"],
        ['seule finition cosmos acceptée', "if (p.cosmos) {", "if (false) {"],
        ['variantes acceptées (Prize Pack)', "if (s.variante) { reste(l, 'variantes-non-lues'", "if (false) { reste(l, 'variantes-non-lues'"],
        ['copies multiples acceptées (kit)', "if (effectif.get(`${J.normaliserNom(s.nom)}|${s.numero}`) > 1 || s.variante) {", "if (false) {"],
        ['groupe renommé accepté', "if (manque.length) throw", "if (false) throw"],
        ['taille d\'image devinée', "_in_1000x1000.jpg` : null; };", "_in_1000x1000.jpg` : url; };"]
    ] }
];
let tues = 0, total = 0;
const survivants = [];
for (const G of GROUPES) {
    const fichier = path.join(__dirname, G.module);
    const original = fs.readFileSync(fichier, 'utf8');
    try {
        for (const [nom, de, vers, ...autres] of G.mutants) {
            total++;
            if (![de, ...autres.map(a => a[0])].every(x => original.includes(x))) { console.log(`❌ motif introuvable pour « ${nom} » (${G.module})`); process.exitCode = 2; continue; }
            let muté = original.replace(de, vers);
            for (const [de2, vers2] of autres) muté = muté.replace(de2, vers2);
            fs.writeFileSync(fichier, muté);
            let tue = false;
            for (const banc of G.bancs) {
                const r = spawnSync(process.execPath, [banc], { cwd: __dirname, encoding: 'utf8', timeout: 120000, env: { ...process.env, ARRETS_HOTES_DOSSIER: path.join(require('os').tmpdir(), 'arrets-mutants') } });
                if (r.status !== 0) { tue = true; break; }
            }
            if (tue) tues++; else survivants.push(`${G.module} : ${nom}`);
        }
    } finally { fs.writeFileSync(fichier, original); }
    if (fs.readFileSync(fichier, 'utf8') !== original) { console.error(`🔴 ${G.module} n'est PAS restauré`); process.exitCode = 3; }
}
console.log(`mutants : ${tues} tués sur ${total}${survivants.length ? ` · SURVIVANTS :\n   ${survivants.join('\n   ')}` : ''}`);
if (survivants.length && !process.exitCode) process.exitCode = 1;
