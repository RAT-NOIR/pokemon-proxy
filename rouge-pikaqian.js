// node rouge-pikaqian.js — LE ROUGE, VU POUR CHAQUE BANC PIKAQIAN (§41 : « le test n'est pas ‹ refuse-t-elle quand il faut ? › mais ‹ SAIT-ELLE refuser ? › »).
// Chaque MUTANT casse UNE garde du code de production (un texte exact est remplacé, le fichier est restauré dans tous les cas) et le banc concerné DOIT passer au
// rouge : au moins une ligne ❌ ET un code de sortie 1 (un plantage — syntaxe, exception — ne compte pas comme « tué »). Un mutant dont le point d'attache n'existe
// plus ABAT le script : un mutant qui ne mord sur rien ne prouve rien (§41, le prédicat qui laisse tout passer). Aucune requête, aucune base : les bancs sont ceux du dépôt.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const C = 'collecte-cartes/pikaqian.js', COL = 'collecteur-images-pikaqian.js', RET = 'retirer-visuels-pikaqian.js', ENF = 'enfiler-pikaqian.js', SEUIL = 'collecte-cartes/seuils-images.js', LANG = 'collecte-cartes/langue-visuel.js';
const BC = 'test-pikaqian.js', BCOL = 'test-collecteur-pikaqian.js', BENF = 'test-enfiler-pikaqian.js', BSEUIL = 'test-seuils-images.js', REE = 'collecte-cartes/reessai-pikaqian.js', BREE = 'test-reessai-pikaqian.js';
const M = (nom, fichier, de, vers, banc) => ({ nom, fichier, de, vers, banc });
const MUTANTS = [
    // ── le client ──
    // (chaque garde est doublée par la suivante — un verrou nul fait lever la ligne d'après, un hôte inconnu fait lever la table des chemins — : le mutant les retire TOUTES DEUX)
    M('client : plus de verrou exigé (absent, perdu ou non tenu)', C, ["if (!lie) throw new Error(`${SOURCE} : aucun verrou global lié", 'if (lie.perdu || !lie.tenu) throw'], ["if (false) throw new Error(`${SOURCE} : aucun verrou global lié", 'if (false) throw'], BC),
    M('client : verrou perdu ou non tenu toléré', C, 'if (lie.perdu || !lie.tenu) throw', 'if (false) throw', BC),
    M('client : n\'importe quel hôte accepté', C, ['|| !CHEMINS[u.hostname]) throw', 'if (!CHEMINS[u.hostname].test(u.pathname)) throw'], ['|| false) throw', 'if (false) throw'], BC),
    M('client : http en clair accepté', C, "u.protocol !== 'https:' ||", 'false ||', BC),
    M('client : la requête (query) acceptée', C, '|| u.search ||', '|| false ||', BC),
    M('client : plus de liste d\'interdits NI de chemins énumérés (/api/ passe)', C, 'if (!CHEMINS[u.hostname].test(u.pathname)) throw', 'if (false) throw', BC),
    M('client : la liste d\'interdits neutralisée (/api/ ne tient plus que par la liste énumérée)', C, 'if (INTERDITS.test(u.pathname)) throw', 'if (false) throw', BC),
    M('client : interdits neutralisés ET /api/.* permis par les chemins (robots.txt ouvert : /api/ passerait)', C, ['if (INTERDITS.test(u.pathname)) throw', '[HOTE_PAGES]: /^\\/(robots\\.txt|sets\\/'], ['if (false) throw', '[HOTE_PAGES]: /^\\/(robots\\.txt|api\\/.*|sets\\/'], BC),
    M('client : plus de plafond de requêtes', C, 'if (compte >= plafond) throw', 'if (false) throw', BC),
    M('client : le fichier illisible n\'est plus un échec', C, 'if (o?.verifier) {', 'if (false) {', BC),
    M('client : la lecture du corps n\'est plus bornée', C, 'if (total > max) {', 'if (false) {', BC),
    M('client : un content-length démesuré toléré', C, "if (Number(reponse.headers?.get?.('content-length')) > max) throw depasse();", '', BC),
    M('client : un serveur Cloudflare derrière CloudFront toléré sur robots.txt', C, "!/cloudflare/i.test(`${r.server ?? ''} ${r.via ?? ''}`) && ", '', BC),
    M('client : le compteur d\'échecs ne peut plus être relu', C, 'fixerSuite(n) { suite = Math.max(0, Number(n) || 0); },', 'fixerSuite(n) { },', BC),
    M('plan : un suffixe inconnu n\'est pas compté', C, 'for (const t of c) if (prolonge(t) && !estFoil(t.nom)) suffixesInconnus.set(t.id, t.nom);', '', BC),
    M('plan : une tuile qui prolonge notre nom n\'est jamais « à suffixe »', C, 'return n.length > nomNotre.length && n.startsWith(nomNotre);', 'return false;', BC),
    M('plan : la première tuile du numéro gagne (plus de tuile de base exacte)', C, 'const exactes = c.filter(t => T.nomCompare(t.nom) === nomNotre);', 'const exactes = c.slice(0, 1);', BC),
    M('provenance par défaut : redevient une affirmation de copie officielle', C, "const PROVENANCE_PAR_DEFAUT = 'origine non déclarée par la page (la mesure du 2026-10-10 relève que pikaqian reprend le canal officiel chinois)';", "const PROVENANCE_PAR_DEFAUT = 'copie du visuel officiel chinois (pokemon.cn)';", BCOL),
    M('client : les chemins énumérés retirés (une page de carte passe)', C, 'if (!CHEMINS[u.hostname].test(u.pathname)) throw', 'if (false) throw', BC),
    M('client : robots.txt ignoré', C, 'if (!T.autoriseParRobots(robots.get(courant.hote), courant.chemin, agent)) throw', 'if (false) throw', BC),
    M('client : robots.txt illisible toléré', C, "if (r.status !== 200) { try { echec(", "if (false) { try { echec(", BC),
    M('client : pas de cadence', C, 'if (attente > 0) await pause(attente);', '', BC),
    M('client : cadence demandée plus basse acceptée', C, 'let cadenceEff = Math.max(CADENCE_MS, Number(cadenceMs) || 0);', 'let cadenceEff = Number(cadenceMs) || 0;', BC),
    M('client : le Crawl-delay ne relève pas la cadence', C, 'if (d) cadenceEff = Math.max(cadenceEff, d * 1000);', '', BC),
    M('client : un Crawl-delay de 90 s toléré', C, 'if (d && d > CRAWL_DELAY_MAX_S) {', 'if (false) {', BC),
    M('client : le 403 n\'est plus un défi', C, 'r.status === 403 || r.status === 429 ||', 'r.status === 429 ||', BC),
    M('client : le 429 n\'est plus un défi', C, 'r.status === 403 || r.status === 429 ||', 'r.status === 403 ||', BC),
    M('client : cf-mitigated ignoré', C, '!!r.cfMitigated ||', 'false ||', BC),
    M('client : la page de défi (corps) ignorée', C, "(typeof r.texte === 'string' && DEFI.test(r.texte.slice(0, 5000)))", 'false', BC),
    M('client : un défi ne ferme pas le client', C, 'bloque = arret = Object.assign(new Error(`${SOURCE} BLOQUÉ', 'bloque = Object.assign(new Error(`${SOURCE} BLOQUÉ', BC),
    M('client : l\'erreur répétée n\'arrête jamais', C, 'const ECHECS_DE_SUITE_MAX = 2;', 'const ECHECS_DE_SUITE_MAX = 999;', BC),
    M('client : l\'erreur répétée s\'arrête dès la première', C, 'const ECHECS_DE_SUITE_MAX = 2;', 'const ECHECS_DE_SUITE_MAX = 1;', BC),
    M('client : un succès ne remet pas le compteur d\'échecs à zéro', C, '                suite = 0;\n                return r;', '                return r;', BC),
    M('client : redirection suivie hors de l\'hôte de départ', C, 'courant = cible(new URL(r.location, courant.url).href, c.hote);', 'courant = cible(new URL(r.location, courant.url).href);', BC),
    M('client : redirections sans limite', C, 'if (saut >= 3) throw', 'if (saut >= 999) throw', BC),
    M('client : AccessDenied S3 jamais toléré (robots d\'images)', C, "const robotsAbsentS3 = r => r.status === 403", "const robotsAbsentS3 = r => false && r.status === 403", BC),
    M('client : tout 403 sur robots.txt toléré', C, "const robotsAbsentS3 = r => r.status === 403 && !r.cfMitigated && !/cloudflare/i.test(`${r.server ?? ''} ${r.via ?? ''}`) && /AmazonS3|CloudFront/i.test(`${r.server ?? ''} ${r.via ?? ''}`) &&", "const robotsAbsentS3 = r => r.status === 403 &&", BC),
    // ── la lecture, la preuve, le plan ──
    M('preuve : aucune tuile n\'est un foil', C, "const estFoil = nom => /\\sHolo$/i.test(String(nom ?? '').trim());", 'const estFoil = nom => false;', BC),
    M('preuve : deux tuiles exactes — la première gagne', C, 'if (exactes.length > 1) {', 'if (false) {', BC),
    M('preuve : la cohérence de l\'adresse d\'image n\'est pas vérifiée', C, 'if (!imageAcceptee(code, t, table)) {', 'if (false) {', BC),
    M('plan : un trou déjà servi n\'est pas écarté (le visuel existant serait remplacé)', C, 'if (T.dejaServi(x.carte, slug, numero)) continue;', '', BC),
    M('plan : les tuiles d\'un autre code de set sont candidates', C, 'if (!codesDuSet.includes(t.code)) continue;', '', BC),
    M('plan : un doublon (carte, numéro) donne deux visuels', C, 'if (vus.has(cle)) continue;', '', BC),
    M('page : la majorité stricte devient une simple moitié', C, 'if (bonnes * 2 <= n) return', 'if (bonnes * 2 < n) return', BC),
    M('page : une page sans tuile — redondance documentée : la ligne suivante (0 × 2 <= 0) la refuse aussi', C, 'if (!n) return { ok: false', 'if (false) return { ok: false', null),
    M('retrait : le lot n\'est pas jugé (toute entrée pikaqian part)', C, 'e.source === SOURCE && e.lot === LOT)', 'e.source === SOURCE)', BC),
    M('retrait : la vignette n\'est pas listée', C, '[e.cleR2, e.vignette?.cleR2].filter(Boolean)', '[e.cleR2].filter(Boolean)', BC),
    // ── le seuil ──
    M('seuil : pikaqian retirée de la liste des sources sous 350 px', SEUIL, "const PIKAQIAN = require('./pikaqian').SOURCE;", "const PIKAQIAN = 'aucune-source';", BC),
    M('seuil : le seuil de pikaqian (300) s\'applique à toutes les sources', SEUIL, "    if (source === PIKAQIAN) return LARGEUR_MIN_PIKAQIAN;\n    return LARGEUR_MIN;", "    return LARGEUR_MIN_PIKAQIAN;", BC),
    M('seuil : pikaqian prend le seuil des officielles (257) au lieu de 300', SEUIL, 'if (source === PIKAQIAN) return LARGEUR_MIN_PIKAQIAN;', 'if (source === PIKAQIAN) return LARGEUR_MIN_OFFICIELLE;', BC),
    M('seuil : les officielles prennent le seuil de pikaqian (300) au lieu de 257', SEUIL, 'if (SOURCES_OFFICIELLES.includes(source)) return LARGEUR_MIN_OFFICIELLE;', 'if (SOURCES_OFFICIELLES.includes(source)) return LARGEUR_MIN_PIKAQIAN;', BC),
    M('seuil : pikaqian entre dans SOURCES_OFFICIELLES (la liste officielle gardée par le banc des seuils)', SEUIL, "const SOURCES_OFFICIELLES = Object.freeze([...require('./tpc').SOURCES_TPC, 'pokemon-com']);", "const SOURCES_OFFICIELLES = Object.freeze([...require('./tpc').SOURCES_TPC, 'pokemon-com', 'pikaqian']);", BSEUIL),
    M('langue : pikaqian sans règle de langue', LANG, "if (im.source === 'pikaqian') return im.langueSource === 'zh-hans'", "if (im.source === 'pikaqian') return false && im.langueSource === 'zh-hans'", BCOL),
    // ── le collecteur ──
    M('collecteur : la ligne de table n\'est plus comparée mot pour mot', COL, '|| unite.codePk !== L.codePk ||', '||', BCOL),
    M('collecteur : une source bloquée reçoit des requêtes', COL, 'if (bloquee) return refus(', 'if (false) return refus(', BCOL),
    M('collecteur : le tirage du set n\'est pas vérifié', COL, 'if ((set.tirage ?? set.region) !== L.tirage) return', 'if (false) return', BCOL),
    M('collecteur : la taille de la base n\'est pas vérifiée', COL, 'if (st.dataSize + st.indexSize > stopOctets) {', 'if (false) {', BCOL),
    M('collecteur : un set sans produit joint passe', COL, 'if (!produits) return refus(', 'if (false) return refus(', BCOL),
    M('collecteur : une page qui ne désigne pas le set est acceptée', COL, 'if (!V.ok) { await E.updateOne', 'if (false) { await E.updateOne', BCOL),
    M('collecteur : un visuel retiré est repris', COL, "if (deja?.etat === 'retire') { retires++; continue; }", '', BCOL),
    M('collecteur : la reprise redemande les images déjà prises', COL, "if (deja?.sha256 && deja.urlOriginal === p.url && deja.etat === 'ok') { sautes++; continue; }", '', BCOL),
    M('collecteur : un trop-petit est redemandé à chaque passage', COL, "if (deja?.etat === 'trop-petit' && deja.urlOriginal === p.url && !aRejuger(deja, P.SOURCE)) { tropPetits++; continue; }", '', BCOL),
    M('collecteur : plus de seuil de largeur', COL, 'if (!meta.width || meta.width < largeurMinDe(P.SOURCE)) {', 'if (!meta.width) {', BCOL),
    M('collecteur : le seuil écrit n\'est pas celui appliqué', COL, 'seuilApplique: largeurMinDe(P.SOURCE)', 'seuilApplique: 350', BCOL),
    M('collecteur : une autre source qui sert déjà le numéro est écrasée', COL, 'if (T.dejaServi({ images: autres }, slug, im.numero)) {', 'if (false) {', BCOL),
    M('collecteur : la garde de la jointure ne compare plus', COL, 'const garde = avant.autres === apres.autres && apres.siennes === joints;', 'const garde = true;', BCOL),
    M('collecteur : les vignettes ne conditionnent plus « verifie »', COL, 'const vignettesOk = !W.vg.erreur && !W.vg.echecs && !W.vg.interrompu;', 'const vignettesOk = true;', BCOL),
    M('collecteur : l\'erreur répétée n\'arrête pas la boucle', COL, 'if (err.arret) { arretClient = err; break; }', '', BCOL),
    M('collecteur : le compteur d\'échecs n\'est pas relu entre les unités', COL, "client.fixerSuite((await E.findOne({ _id: P.ID_SUITE }))?.suite ?? 0);", '', BCOL),
    M('collecteur : le compteur d\'échecs n\'est pas écrit entre les unités', COL, 'suite: arrete?.repetee ? 0 : client.suiteEchecs()', 'suite: 0', BCOL),
    M('collecteur : l\'erreur répétée sur une image ne pose pas l\'alerte', COL, "else if (arretClient && !arretClient.plafond) await conclureBloque(", 'else if (false) await conclureBloque(', BCOL),
    M('collecteur : l\'erreur répétée sur la page ne pose pas l\'alerte', COL, 'if (e.bloque || (e.arret && !e.plafond)) {', 'if (e.bloque) {', BCOL),
    M('collecteur : le plafond de l\'unité n\'est pas posé', COL, 'client.plafonner(Pl.plan.length + 3);', '', BCOL),
    M('collecteur : le fichier illisible n\'est pas vérifié par le client', COL, "await client.image(p.url, async b => { const m = await sharp(b).metadata(); if (!m.width) throw new Error('largeur illisible'); });", 'await client.image(p.url);', BCOL),
    M('worker : le collecteur pikaqian se charge hors du try', 'collecteur-images.js', "try { pkImg = require('./collecteur-images-pikaqian'); } catch (e) { erreurChargement = e; }", "pkImg = require('./collecteur-images-pikaqian');", BENF),
    M('collecteur : un défi ne pose pas l\'alerte (le blocage n\'est plus compté en base)', COL, "await noterBlocage(E, { unite: unite._id,", "await noterBlocage({ findOne: async () => null, updateOne: async () => ({}) }, { unite: unite._id,", BCOL),
    M('collecteur : une panne passagère de la page devient un refus définitif', COL, "etat: echecTransitoire(e) ? 'incomplet-transitoire' : 'erreur', erreur: e.message, sansJointure: true };", "etat: 'erreur', erreur: e.message, sansJointure: true };", BCOL),
    // ── le réessai espacé (R2) ──
    M('réessai : une source retirée par décision est retentée', REE, "if (etat.retrait === true) return { ok: false", "if (false) return { ok: false", BREE),
    M('réessai : la suspension (3e blocage) n\'interdit plus la tentative', REE, "if (etat.suspendue === true || bl.length >= BLOCAGES_MAX) return { ok: false", "if (false) return { ok: false", BREE),
    M('réessai : le 3e blocage ne suspend plus (le collecteur compte sans fin)', REE, "const BLOCAGES_MAX = 3;", "const BLOCAGES_MAX = 999;", BREE),
    M('réessai : le 3e blocage relevé par le worker ne suspend pas', REE, "const suspendue = tous.length >= BLOCAGES_MAX;\n            const pasAvant = suspendue ? null : now + Math.max(", "const suspendue = false;\n            const pasAvant = suspendue ? null : now + Math.max(", BREE),
    M('réessai : le défi n\'est plus jugé par la définition du client', REE, "if (P.defi({ status: rep.status, cfMitigated: h('cf-mitigated'), texte }))", "if (false)", BREE),
    M('collecteur : plus de mention sur le document', COL, 'attribution: P.MENTION, mention: P.MENTION, lot: P.LOT, telechargeLe: new Date(), etat:', 'attribution: P.MENTION, lot: P.LOT, telechargeLe: new Date(), etat:', BCOL),
    M('collecteur : plus de lot sur l\'entrée de la carte', COL, "numero: im.numero, attribution: P.MENTION, mention: P.MENTION, lot: P.LOT, langue: im.langue", "numero: im.numero, attribution: P.MENTION, mention: P.MENTION, langue: im.langue", BCOL),
    M('collecteur : plus de provenance sur l\'entrée de la carte', COL, 'provenance: im.provenance, urlOfficielle', 'urlOfficielle', BCOL),
    M('collecteur : R2 jamais écrit avant la ligne', COL, 'await deposer(bucket, cleR2, webp.data, \'image/webp\');', '', BCOL),
    // ── le retrait ──
    M('retrait : la simulation écrit', RET, 'if (!ecrire) return plan;', '', BCOL),
    M('retrait : les documents ne passent pas à « retire »', RET, "{ $set: { etat: 'retire', retireLe: le, retireMotif: motif } }", "{ $set: { retireLe: le, retireMotif: motif } }", BCOL),
    M('retrait : la source n\'est pas fermée', RET, "await E.updateOne({ _id: P.ID_ALERTE }, { $set: { active: true, constateLe: le, motif, retrait: true }", "await E.updateOne({ _id: 'alerte/inerte' }, { $set: { active: true, constateLe: le, motif, retrait: true }", BCOL),
    M('retrait : les unités des autres sources sont fermées aussi', RET, "F.find({ source: P.SOURCE, etat: 'attente' })", "F.find({ etat: 'attente' })", BCOL),
    M('retrait : les bilans de sets restent', RET, "for (const s of await S.find({ visuelsPikaqian: { $exists: true } }).toArray())", 'for (const s of [])', BCOL),
    M('retrait : une autre source du même lot est retirée (le lot seul ne suffit pas)', RET, 'const duLot = e => e?.source === P.SOURCE && e?.lot === P.LOT;', 'const duLot = e => e?.lot === P.LOT;', BCOL),
    // ── l'enfilage ──
    M('enfilage : une source bloquée reçoit des unités', ENF, 'if (bloquee) return { inserer', 'if (false) return { inserer', BENF),
    M('enfilage : la garde du commit du worker ne bloque plus', ENF, 'if (worker.bloque) return', 'if (false) return', BENF),
    M('enfilage : le set test n\'est plus exigé', ENF, 'if (autresQueLeTest) {', 'if (false) {', BENF),
    M('enfilage : le bilan du set test non concordant passe', ENF, 'if (b?.concordance === true && b.garde?.ok === true && b.prouves > 0)', 'if (b)', BENF),
    M('enfilage : les unités passent devant la file', ENF, 'ordre: dernier + 1 + i,', 'ordre: 1 + i,', BENF),
    M('enfilage : la reprise remet n\'importe quel refus', ENF, "if (reprendre && deja.etat === 'refuse' && (ARRETS.has(deja.resultat) || deja.resultat === 'incomplet-transitoire' || deja.resultat === 'incomplet'))", "if (reprendre && deja.etat === 'refuse')", BENF),
    M('enfilage : $setOnInsert — redondance documentée : une unité existante est déjà écartée par choisirUnitesPikaqian avant toute écriture (seconde ceinture contre une course)', ENF, '{ $setOnInsert: { ...unite,', '{ $set: { ...unite,', null)
];

const original = new Map();
const lire = f => { if (!original.has(f)) original.set(f, fs.readFileSync(path.join(__dirname, f), 'utf8')); return original.get(f); };
const restaurer = () => { for (const [f, t] of original) fs.writeFileSync(path.join(__dirname, f), t); };
process.on('exit', restaurer);

function banc(b) { const r = spawnSync(process.execPath, [b], { cwd: __dirname, encoding: 'utf8' }); return { code: r.status, rouges: (r.stdout.match(/^(❌|\s*ECHEC )/gm) || []).length, sortie: r.stdout }; }
let tues = 0, vivants = [], sansAttache = [], redondants = [];
for (const b of [BC, BCOL, BENF, BSEUIL, BREE]) { const r = banc(b); if (r.code !== 0) { console.error(`❌ le banc ${b} n'est pas vert avant les mutants (code ${r.code})`); process.exit(2); } }
console.log(`bancs verts avant mutation ; ${MUTANTS.length} mutants\n`);
for (const m of MUTANTS) {
    const t = lire(m.fichier);
    // un fichier de production peut être en CRLF (extraction Windows) : les attaches multi-lignes s'écrivent en LF et s'adaptent au fichier
    const eol = s => (t.includes('\r\n') ? s.replace(/\r?\n/g, '\r\n') : s);
    const des = [].concat(m.de).map(eol), vers = [].concat(m.vers).map(eol);
    const manque = des.filter(d => t.split(d).length - 1 !== 1);
    if (manque.length) { sansAttache.push(`${m.nom} (pas exactement 1 occurrence de ${JSON.stringify(manque[0].slice(0, 60))} dans ${m.fichier})`); continue; }
    if (!m.banc) { redondants.push(m.nom); continue; }
    let muté = t; des.forEach((d, i) => { muté = muté.replace(d, () => vers[i]); });
    fs.writeFileSync(path.join(__dirname, m.fichier), muté);
    let r; try { r = banc(m.banc); } finally { fs.writeFileSync(path.join(__dirname, m.fichier), t); }
    const tue = r.rouges > 0;                       // une ligne ❌ au moins : un plantage SEUL (aucun ❌) ne prouve rien
    if (tue) tues++; else vivants.push(`${m.nom} (code ${r.code}, ${r.rouges} ❌)`);
    console.log(`${tue ? '🔴 rouge vu' : '⚠️ VIVANT  '}  ${m.nom}  [${r.rouges} ❌ au banc ${m.banc}]`);
}
console.log(`\n${tues} mutants tués sur ${MUTANTS.length - redondants.length - sansAttache.length} jugés · ${vivants.length} vivants · ${sansAttache.length} sans point d'attache · ${redondants.length} redondance(s) documentée(s)`);
for (const v of vivants) console.log(`   VIVANT : ${v}`);
for (const s of sansAttache) console.log(`   SANS ATTACHE : ${s}`);
process.exit(vivants.length || sansAttache.length ? 1 : 0);
