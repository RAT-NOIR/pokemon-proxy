// node test-mutants-pokellector.js — LES MUTANTS : on casse une règle à la fois dans le code de production, on rejoue les deux bancs, et chaque casse DOIT être vue (au moins un ❌).
// Un banc qui reste vert quand on retire sa garde ne garde rien. Le fichier cassé est TOUJOURS restauré (copie gardée en mémoire, restauration dans `finally`).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MOD = path.join(__dirname, 'collecte-cartes', 'pokellector.js'), COL = path.join(__dirname, 'collecteur-images-pokellector.js'), RET = path.join(__dirname, 'retirer-visuels-pokellector.js');
const M = (fichier, de, vers, nom) => ({ fichier, de, vers, nom });
const MUTANTS = [
    M(MOD, "f.forme === 'plein' || f.forme === 'mobile'", 'true', 'une vignette (.thumb) devient une adresse valable'),
    M(MOD, "u.hostname !== HOTE_IMAGES || u.port", 'false || u.port', 'l\'hôte d\'images n\'est plus vérifié'),
    M(MOD, "u.hostname !== HOTE_PAGES || u.port", 'false || u.port', 'l\'hôte des pages n\'est plus vérifié'),
    M(MOD, 'Number.isFinite(w) && w >= LARGEUR_PLEINE_TAILLE', 'Number.isFinite(w) && w >= 1', 'le seuil de 570 px tombe'),
    M(MOD, 'if (r?.cfMitigated) return', 'if (false) return', 'cf-mitigated n\'arrête plus'),
    M(MOD, "if (!Buffer.isBuffer(r.octets)) return { etat: 'arret', motif: '200 qui n\\'est pas une image' };", '', 'un 200 qui n\'est pas une image passe'),
    M(MOD, '`pkl/${slugSet}', '`pokellector/${slugSet}', 'la clé R2 nomme la source'),
    M(MOD, 'return !!c.nom && miens.has(nomNorm(c.nom));', 'return true;', 'le nom ne contredit plus'),
    M(MOD, 'if (couverts.has(t.idProduct))', 'if (false)', 'un produit couvert n\'est plus sauté'),
    M(MOD, 'og !== img || !urlImageValide(img)', '!urlImageValide(img)', 'og:image n\'est plus confronté à l\'image affichée'),
    M(MOD, 'ss.length === 1 && l?.length === 1', 'ss.length >= 1 && l?.length >= 1', 'la table des sets accepte l\'ambigu'),
    M(MOD, 'String(c.code).toUpperCase() === o.code && ', '', 'la collection ignore le code d\'origine'),
    M(MOD, 'if (choisie.img == null) {', 'if (false) {', 'une pleine taille non relevée passe au plan'),
    M(MOD, 'if (!urlImageValide(choisie.img))', 'if (false)', 'le plan accepte une adresse hors règle'),
    M(MOD, "if (/\\.\\.|%|\\\\/.test(url)) return false;", '', 'neutre (témoin : ce mutant ne doit PAS matcher)'),
    M(COL, 'Math.max(cadenceMs, P.CADENCE_MS)', 'cadenceMs', 'la cadence peut descendre sous 5 s'),
    M(COL, "flux.demander = async (url, { image = false } = {}) => {\n        if (fs.existsSync(fichierArret(dossierCache)))", "flux.demander = async (url, { image = false } = {}) => {\n        if (false)", 'le fichier d\'arrêt n\'est plus lu par le flux'),
    M(COL, "redirect: 'manual'", "redirect: 'follow'", 'la redirection est suivie'),
    M(COL, "headers: { 'User-Agent': P.UA }", "headers: { 'User-Agent': P.UA, Cookie: 'a=b' }", 'un cookie part'),
    M(COL, 'attendu != null && attendu !== reel', 'false', '--attendu n\'est plus vérifié'),
    M(COL, 'const cleR2 = P.cleR2(slug, u.carteId, u.numero);', 'const cleR2 = `pokellector/${slug}/${u.numero}-${u.carteId}-en.webp`;', 'ecrire écrit une clé qui nomme la source'),
    M(COL, '...champsDeLEntree(im), ', '', 'l\'entrée de carte perd la traçabilité commune (retirable, adresse, date)'),
    M(COL, 'const arb = arbitrer(autres, entree, () => false, { documents });', 'const arb = { sortantes: [], servie: false };', 'la règle commune de remplacement n\'est plus appelée à l\'écriture'),
    M(COL, '{ sansDate++; continue; }', '{ }', 'une image sans date de téléchargement s\'écrit quand même'),
    M(MOD, 'if (admises.length > sortantes.length)', 'if (admises.length > 0)', 'le plan ne remplace plus rien (tout entrée admise sert la fiche)'),
    M(MOD, 'if (admises.length > sortantes.length)', 'if (false)', 'le plan ne protège plus une entrée correcte (« déjà servi » tombe)'),
    M(MOD, "? 'Trick or Trade' : null", '? null : null', 'le tampon de la collection n\'est plus porté (une empruntée n\'est jamais remplacée)'),
    M(MOD, ".replace(/\\band\\b/gi, ' ')", '', 'le liant « and » n\'est plus équivalent'),
    M(COL, 'if (!P.estPleineTaille(meta.width)) { index.images[url] = { statut: \'trop-petit\'', 'if (false) { index.images[url] = { statut: \'trop-petit\'', 'une vignette est gardée au téléchargement'),
    M(COL, 'Math.min(afaire.length + 1, plafondMax ?? Infinity)', 'Infinity', 'le plafond tombe'),
    M(MOD, 'if (reserves.has(t.slugSet))', 'if (false)', 'un set de la liste pokedata n\'est plus réservé'),
    M(COL, 'refusSite: null, slugsSeulement, pokedataSets: cv.pokedataSets });', 'refusSite: null, slugsSeulement });', 'le relevé oublie la réservation pokedata (pages de sets réservés demandées)'),
    M(MOD, "if (s !== 200) return { etat: 'arret', motif: `HTTP ${s} : ni 200 ni 404` };", "if (s !== 200) return { etat: 'interrompu', motif: `HTTP ${s}` };", 'un statut inattendu n\'arrête plus'),
    M(MOD, 'if (!st || !st.test(r.texte))', 'if (false)', 'un mur de connexion en 200 passe pour une page'),
    M(COL, 'n >= 2 ? arret(', 'n >= 99 ? arret(', 'les 5xx répétés n\'arrêtent jamais'),
    M(COL, "&& o.forme !== 'robots') {", ') {', 'un robots.txt réussi remet à zéro le compte des 5xx'),
    M(MOD, '(exSansPrefixe && cles.has(cr(exSansPrefixe)))', 'false', 'les sets EX (Emerald…) ne sont plus réservés'),
    M(COL, 'collecteLe: p.le });', 'collecteLe: new Date() });', 'collecteLe redevient la date d\'écriture'),
    M(MOD, "String(s.langue).toUpperCase() === 'ENGLISH'", 'true', 'la liste pokedata réserve aussi ses sets japonais et chinois'),
    M(MOD, "(m && cles.has(cr(`McDonald's Promos ${m[1]}`)))", 'false', 'McDonald\'s n\'est plus réservé'),
    M(COL, "if (!fs.existsSync(dossier)) return { produits: new Set(), fichiers: 0 };", "if (!fs.existsSync(dossier)) throw new Error('absent');", 'l\'absence du plan pokedata lève de nouveau'),
    M(COL, 'if (!autorisees.has(c.url))', 'if (false)', 'une page non relevée se demande'),
    M(COL, 'if (P.estUnDos(octets))', 'if (false)', 'un dos de carte entre'),
    M(COL, "(set.tirage ?? set.region) !== 'intl'", "(set.tirage ?? set.region) === 'zz'", 'ecrire accepte un tirage non intl'),
    M(COL, "else if (!relevees.has(u)) refusees.push({ url: u, motif: 'hors-releve' });", '', 'une adresse hors relevé passe au téléchargement'),
    M(COL, "if (!Number.isFinite(plafond) || plafond < 1) throw", 'if (false) throw', 'le relevé accepte de partir sans plafond'),
    M(RET, 'const duLot = e => e?.source === P.SOURCE && e?.lot === P.LOT;', 'const duLot = e => e?.source === P.SOURCE;', 'le retrait emporte un autre lot de la même source')
];

const lancer = () => {
    const sorties = [];
    for (const t of ['test-pokellector.js', 'test-collecteur-pokellector.js']) {
        const r = spawnSync(process.execPath, [path.join(__dirname, t)], { encoding: 'utf8', env: process.env, timeout: 300000 });
        sorties.push({ t, code: r.status, echecs: (r.stdout.match(/^❌/gm) || []).length });
    }
    return sorties;
};
const base = lancer();
console.log(`référence : ${base.map(b => `${b.t} code ${b.code}, ${b.echecs} échec(s)`).join(' · ')}`);
if (base.some(b => b.code !== 0)) { console.log('❌ la référence n\'est pas verte : pas de mutants'); process.exit(1); }
let tues = 0, vivants = [], neutres = 0;
for (const m of MUTANTS) {
    const original = fs.readFileSync(m.fichier, 'utf8');
    const n = original.split(m.de).length - 1;
    if (n !== 1) { console.log(`⚪ ${m.nom} : motif trouvé ${n} fois (attendu 1)${/témoin/.test(m.nom) ? ' — c\'est le témoin, attendu' : ' — MUTANT INVALIDE'}`); if (!/témoin/.test(m.nom)) vivants.push(`${m.nom} (motif ${n}×)`); else neutres++; continue; }
    try {
        fs.writeFileSync(m.fichier, original.replace(m.de, () => m.vers));
        const s = lancer();
        const vu = s.some(x => x.code !== 0 || x.echecs > 0);
        console.log(`${vu ? '☠️ tué ' : '🧟 VIVANT'} ${m.nom} — ${s.map(x => `code ${x.code}/${x.echecs}❌`).join(' ')}`);
        if (vu) tues++; else vivants.push(m.nom);
    } finally { fs.writeFileSync(m.fichier, original); }
}
console.log(`\n${tues} mutant(s) tué(s) sur ${MUTANTS.length - neutres}, ${vivants.length} vivant(s)${vivants.length ? ` : ${vivants.join(' | ')}` : ''}`);
process.exitCode = vivants.length ? 1 : 0;
