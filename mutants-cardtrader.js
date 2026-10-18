// Mutants de collecte-cartes/cardtrader.js ET de collecteur-images-cardtrader.js : chaque mutation est appliquée à une COPIE (*.mut.js, effacée ensuite) ; les bancs doivent ÉCHOUER.
// Un mutant qui survit = un banc qui ne garde rien.
//   node mutants-cardtrader.js
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MODULE = {
    src: path.join(__dirname, 'collecte-cartes', 'cardtrader.js'), mut: path.join(__dirname, 'collecte-cartes', 'cardtrader.mut.js'),
    env: { CTR_MODULE: './collecte-cartes/cardtrader.mut.js' }, bancs: ['test-cardtrader.js', 'test-cardtrader-lot.js', 'test-collecteur-cardtrader.js'],
};
const COLLECTEUR = {
    src: path.join(__dirname, 'collecteur-images-cardtrader.js'), mut: path.join(__dirname, 'collecteur-images-cardtrader.mut.js'),
    env: { CTR_COLLECTEUR: './collecteur-images-cardtrader.mut.js' }, bancs: ['test-collecteur-cardtrader.js'],
};

const MUTANTS_MODULE = [
    ['supprimer le seuil de largeur', 'return w >= largeurMinDe(SOURCE) ?', 'return true ?'],
    ['abaisser le seuil à un plancher de 200 px', 'return w >= largeurMinDe(SOURCE) ?', 'return w >= 200 ?'],
    ['accepter une vignette en og:image', "if (v === '') return { url: u, via: 'og' };", "if (v === '' || v) return { url: u, via: 'og' };"],
    ['accepter une vignette dans la page (variante quelconque)', "const show = trouvees.find(u => classer(u) === 'show');", 'const show = trouvees.find(u => classer(u) !== null);'],
    ['accepter le dos de la carte (deux endroits)', ['blueprints/image/${id}/([^/?#]+)', '(/uploads/blueprints/image/${id}/[^"'], ['blueprints/(?:back_)?image/${id}/([^/?#]+)', '(/uploads/blueprints/(?:back_)?image/${id}/[^"']],
    ['accepter un ambigu', "if (p.statut === 'apparie') {", "if (p.statut === 'apparie' || p.statut === 'ambigu') {"],
    ['accepter un « à réserve »', "if (p.reserve) raison = 'a-reserve';", "if (false) raison = 'a-reserve';"],
    ['accepter un apparié sans carte', "else if (!Number.isInteger(p.carteId)) raison = 'sans-carte';", ''],
    ['écrire un conflit (deux blueprints pour une carte)', 'if (new Set(g.map(x => x.p.blueprint)).size > 1) {', 'if (false) {'],
    ['nommer la source dans la clé R2', 'const cleR2 = (slugSet, numero, carteId) => `${SOURCE}/', 'const cleR2 = (slugSet, numero, carteId) => `cardtrader/'],
    ['nommer la source dans le lot', "const LOT = 'ctr-2026-10';", "const LOT = 'cardtrader-2026-10';"],
    ['suivre une redirection (le client ne la juge plus)', 'const x = RH.lireImage(r, { suivi, hote: SOURCE_RACINE, url, dossierPauses });', "const x = r.octets ? { octets: r.octets } : { absente: true, issue: 'absente' };"],
    ['suivre une redirection (fetch)', "redirect: 'manual'", "redirect: 'follow'"],
    ['remplacer une image correcte au-dessus du seuil', "if (restantes.some(e => e.set === cand.set && e.langue !== 'ja' && memeNumero(e, cand.numero))) return {", 'if (false) return {'],
    ['ignorer le plafond de requêtes', 'if (n >= plafond) throw Object.assign(new Error(`plafond de requêtes atteint (${plafond})`), { plafond: true });\n        if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }\n        dernier = now(); n++;\n        const r = await transport.get(url, { binaire: true });', 'if (dernier != null) { const attente = dernier + cadence - now(); if (attente > 0) await pause(attente); }\n        dernier = now(); n++;\n        const r = await transport.get(url, { binaire: true });'],
    ['cadence sous 5 s', 'const cadence = Math.max(cadenceMs, CADENCE_MIN_MS);', 'const cadence = cadenceMs;'],
    ['image hors de /uploads/blueprints/image/', '!CHEMIN_IMAGE.test(new URL(url).pathname)', 'false'],
    ['planche sans « clé seule » obligatoire', 'tirer(toutes.filter(estCleSeule), Math.min(cleSeuleMin, n));', 'tirer(toutes.filter(estCleSeule), 0);'],
    // ── correction 1 : l'appariement, le témoin du total, le tri par année/série, les gardes du lot (I1, I2), la levée par le joueur ──
    ['apparier : le témoin du total ne contredit plus jamais', "return { b, t: imps.some(i => entier(i.numero) === b.numero && entier(i.total) === b.total) ? 'confirme' : 'contredit' };", "return { b, t: 'confirme' };"],
    ['apparier : le pool ignore l\'année (toutes les années candidates)', "const pool = pr.famille === 'pp' ? parPP : (parFam.get(`${pr.famille}|${pr.annee ?? ''}`) || []);", 'const pool = pr.famille === \'pp\' ? parPP : [...parFam.values()].flat();'],
    ['apparier : le code d\'origine PP ne contredit plus', 'cands = cands.filter(b => !(s.code && b.code) || s.code === b.code);', 'cands = cands;'],
    ['apparier : le nom seul accepté avec plusieurs origines', 'if (multiples) return {', 'if (false) return {'],
    ['apparier : le numéro d\'origine n\'est plus exigé', 'cands = memeNom.filter(b => s.numero != null && b.numero === s.numero);', 'cands = memeNom.filter(b => s.numero != null);'],
    ['lot (I2) : une unité à plusieurs produits acceptée', 'if (g.length > 1) {', 'if (false) {'],
    ['lot (I1) : un désaccord de nom accepté', 'if (!clesDeNom(carteNom).some(c => clesDeNom(nomBlueprint).includes(c))) {', 'if (false) {'],
    ['lot (I1) : une « clé seule » sans témoin acceptée', "if (cleSeule && nomFiche !== 'concordant') {", 'if (false) {'],
    ['joueur : levée par inclusion de chaîne', 'const memeJoueur = bs.filter(b => b.joueur === j);', 'const memeJoueur = bs.filter(b => b.joueur.includes(j) || j.includes(b.joueur));'],
    ['joueur : levée sans joueur sur la fiche (le premier candidat)', 'const j = pr.joueurFiche ? norm(pr.joueurFiche) : null;', 'const j = pr.joueurFiche ? norm(pr.joueurFiche) : bs[0].joueur;'],
    ['joueur : la calibration ne coupe plus la règle', 'active: evaluables > 0 && faux === 0', 'active: true'],
];
const MUTANTS_COLLECTEUR = [
    ['juger : accepter toute largeur', 'return { statut: c.statut, w: meta.width, h: meta.height, format: meta.format };', "return { statut: 'ok', w: meta.width, h: meta.height, format: meta.format };"],
    ['juger : ne pas contrôler la forme de carte', 'if (ratio < RATIO_MIN || ratio > RATIO_MAX)', 'if (false)'],
    ['juger : accepter des octets illisibles', "catch { return { statut: 'illisible' }; }", "catch { return { statut: 'ok', w: 500, h: 698, format: 'jpeg' }; }"],
    ['--ecrire hors de lot-additif.js', "require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid);\n    const { ouvrirConnexions } = require('./collecte-cartes/garde');\n    const { modeles }", "const { ouvrirConnexions } = require('./collecte-cartes/garde');\n    const { modeles }"],
    ['relevé : continuer après un arrêt définitif', 'catch (e) { etat = arretDe(e); motif = e.message; }\n    ecrireJson(fichier, rel);', "catch (e) { etat = 'termine'; motif = e.message; }\n    ecrireJson(fichier, rel);"],
    ['planche : échantillon sans garantie de « clé seule »', ': CT.choisirEchantillon(dispo, n);', ': dispo.slice(0, n);'],
    ['planche --cle-seule : un échantillon au lieu de TOUTES', 'const choix = cleSeuleSeulement ? dispo.filter(CT.estCleSeule)', 'const choix = false ? dispo.filter(CT.estCleSeule)'],
    ['--attendu compte aussi les unités déjà posées', "if (u.decision.action === 'deja-posee') { dejaPosees++; continue; }", ''],
    ['un objet R2 orphelin n\'est plus listé', 'orphelins.push(enCours); console.error(`🔴 objet R2 ORPHELIN', 'console.error(`🔴 objet R2 ORPHELIN'],
    ['téléchargement : deux 5xx de suite n\'arrêtent plus', "if (++consecutifs >= 2) { etat = 'serveur-indisponible'; motif = `deux erreurs serveur de suite (${e.message})`; break; }       // un 5xx", "if (++consecutifs >= 99999) { etat = 'serveur-indisponible'; motif = `deux erreurs serveur de suite (${e.message})`; break; }       // un 5xx"],
    ['une fausse absence devient définitive au premier coup', "statut: r.meta?.statut === 'fausse-absente' ? 'fausse-absente' : 'absent'", "statut: 'absent'"],
    ['une image écartée compte comme une erreur (hors cache)', 'if (rel && !url) { ecartees++; continue; }', 'if (rel && !url) { horsCache++; continue; }'],
    ['écriture : plus de décision de cession (écrase tout)', "if (u.decision.action === 'cede') { cedees++; continue; }", ''],
    ['chemin du testeur accepté', "if (/Logo FR|apport-manuel|\\\\LOGO(\\\\|$)/i.test(path.resolve(p)))", 'if (false)'],
    ['--ecrire sans --attendu', "else if (modes[0] === '--ecrire' && !val('attendu')) erreurArgs = '--ecrire exige --attendu=<N>';", ''],
];

function lancer(M, table) {
    const original = fs.readFileSync(M.src, 'utf8');
    let tues = 0, survivants = 0;
    try {
        for (const [nom, de, vers] of table) {
            const des = Array.isArray(de) ? de : [de], verss = Array.isArray(vers) ? vers : [vers];
            let ecrit = original, applicable = true;
            des.forEach((d, i) => { const n = ecrit.split(d).length - 1; if (n !== 1) { console.log(`❌ ${nom} : le motif « ${d.slice(0, 50)} » apparaît ${n} fois (1 attendu) — mutant non applicable`); applicable = false; } else ecrit = ecrit.replace(d, () => verss[i]); });
            if (!applicable) { survivants++; continue; }
            fs.writeFileSync(M.mut, ecrit);
            const verdicts = M.bancs.map(b => spawnSync(process.execPath, [path.join(__dirname, b)], { env: { ...process.env, ...M.env }, encoding: 'utf8', timeout: 120000 }));
            const tue = verdicts.some(v => v.status !== 0);
            console.log(`${tue ? '✅ tué  ' : '🔴 SURVIT'} : ${nom}${tue ? ` (${M.bancs.filter((b, i) => verdicts[i].status !== 0).join(', ')})` : ''}`);
            if (tue) tues++; else survivants++;
        }
    } finally { try { fs.unlinkSync(M.mut); } catch { /* absent */ } }
    return { tues, survivants, total: table.length };
}

const a = lancer(MODULE, MUTANTS_MODULE), b = lancer(COLLECTEUR, MUTANTS_COLLECTEUR);
console.log(`module : ${a.tues} tués, ${a.survivants} survivants sur ${a.total} · collecteur : ${b.tues} tués, ${b.survivants} survivants sur ${b.total}`);
process.exitCode = a.survivants + b.survivants ? 1 : 0;
