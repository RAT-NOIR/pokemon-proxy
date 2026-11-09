'use strict';
// DECISION-SURS — BANC DE MUTATION : chaque condition de la promotion est CASSÉE à tour de rôle (une ancre de source remplacée, en mémoire, au chargement — _mutation-precharge.js) et le banc
// test-promotion-surs.js doit alors ÉCHOUER. Une mutation qui le laisse passer est une condition que rien ne tient. Une ancre absente ou ambiguë, ou un témoin (aucune mutation) qui échoue, font échouer ce banc lui-même.
// Une mutation par condition : S2 (numéro d'un jumeau inconnu), S3 (attaque ignorée, jumeaux connus), I (marge, tolérance, voisin n°1, jumeaux au pool, lignes, champ contredit, nom, cosinus inconnu),
// « seulement des probables », le drapeau (étape, route, configuration, jeton), la décision de la route. Aucune base, aucun réseau. Les fichiers du dépôt ne sont jamais modifiés.
// Équivalente nommée, non mutée : retirer `GC.contredire` de la règle I ne change rien, la garde ne répond que s'il existe un champ 'ko' et la ligne suivante (aucun 'ko') est plus large.
const { spawnSync } = require('child_process');
const path = require('path');
const H = require('./_harnais');

const BANC = 'test-promotion-surs.js';
const PRECHARGE = path.join(__dirname, '_mutation-precharge.js');
const PS = 'v2/identifier/promotion-surs.js', LV = 'v2/identifier/leviers-abde.js', PSR = 'v2/identifier/promotion-surs-route.js', CA = 'v2/identifier/critere-a.js', RT = 'v2/identifier/routes.js', CFG = 'v2/config.js', CAP = 'v2/capacites.js';
const JETON = 'cfg.promotionSurs === true && cfg.leviersAbde === true && cfg.probable === true && cfg.gardeMarqueurs === true';
const MUTATIONS = [
    // ── S2 : le numéro d'un jumeau peut être inconnu tant qu'aucun ne concorde
    { nom: 'S2 : le numéro inconnu d\'un jumeau n\'est plus permis par la promotion', fichier: PS, de: 'jumeauxInconnusPermis: true', vers: 'jumeauxInconnusPermis: false' },
    { nom: 'S2 : tout paramètre truthy permet l\'inconnu (plus de === true)', fichier: CA, de: 'jumeauxInconnusPermis !== true) return non(', vers: '!jumeauxInconnusPermis) return non(' },
    { nom: 'S2 : un jumeau qui CONCORDE n\'est plus bloquant', fichier: CA, de: "if (cj.concorde.includes('numero')) return non(", vers: "if (false) return non(" },
    { nom: 'S2 : la ligne d\'un jumeau n\'est plus exigée', fichier: CA, de: "if (autres.some(i => !produits.has(i))) return non('une ligne de jumeau manque');", vers: '' },
    { nom: 'S2/S3 : l\'étiquette de la règle est toujours S2', fichier: PS, de: "regle: jumeaux.length ? 'S2' : 'S3' }", vers: "regle: 'S2' }" },
    // ── S3 : l'attaque lue ne bloque plus ; des jumeaux inconnus ne sont pas « aucun jumeau »
    { nom: 'S3 : l\'attaque lue bloque encore (plus ignorée)', fichier: PS, de: "champsIgnores: ['attaque']", vers: 'champsIgnores: []' },
    { nom: 'S3 : un autre champ que l\'attaque peut être ignoré', fichier: CA, de: "const IGNORABLES = Object.freeze(['attaque']);", vers: "const IGNORABLES = Object.freeze(['attaque', 'langue']);" },
    { nom: 'S3 : le champ ignoré n\'est plus filtré des champs contredits', fichier: CA, de: "&& !champsIgnores.includes(k));", vers: ');' },
    { nom: 'S3 : des jumeaux inconnus (colonne muette) valent « aucun jumeau »', fichier: LV, de: "if (!Array.isArray(jum) || !jum.every(Number.isInteger)) return dit('jumeaux-inconnus');", vers: 'if (!Array.isArray(jum)) jum = [];' },
    { nom: 'S3/S2/I : I2 et I3 ne sont plus exigés', fichier: PS, de: "if (i2i3 !== true) return non(", vers: 'if (false) return non(' },
    { nom: 'S2 : plus de plafond de jumeaux (règle)', fichier: PS, de: 'if (jumeaux.length > MAX_JUMEAUX) return non(', vers: 'if (false) return non(' },
    { nom: 'S2 : plus de plafond de jumeaux (aucune ligne ne devrait être lue au-delà)', fichier: LV, de: "if (jum.length > PS.MAX_JUMEAUX) return dit('trop-de-jumeaux');", vers: '' },
    { nom: 'S2 : le plafond de jumeaux passe à 101', fichier: PS, de: 'const MAX_JUMEAUX = 100;', vers: 'const MAX_JUMEAUX = 101;' },
    { nom: 'S2 : une lecture de jumeaux en panne n\'est plus comptée', fichier: LV, de: "catch { signaler('jumeaux-en-panne'); return dit('jumeaux-en-panne'); }", vers: "catch { return dit('jumeaux-en-panne'); }" },
    // ── I : le voisin n°1 de l'image, écart de cosinus >= 0,2, tous les jumeaux au pool
    { nom: 'I : la marge passe à 0,1', fichier: PS, de: 'a - b >= MARGE - TOLERANCE', vers: 'a - b >= 0.1 - TOLERANCE' },
    { nom: 'I : la tolérance flottante est retirée', fichier: PS, de: 'a - b >= MARGE - TOLERANCE', vers: 'a - b >= MARGE' },
    { nom: 'I : le désigné n\'a plus à être le voisin n°1', fichier: PS, de: "|| !cle || cle !== top1Cle)", vers: "|| !cle)" },
    { nom: 'I : le voisin n°1 du raccordement est perdu (plus de clé)', fichier: LV, de: 'top1Cle: p.trouve.top.length ? p.trouve.top[0][0] : null', vers: 'top1Cle: null' },
    { nom: 'I : un jumeau hors du pool est toléré', fichier: PS, de: 'if (!jumeaux.every(j => idsPool.has(j)))', vers: 'if (false)' },
    { nom: 'I : la ligne d\'un jumeau n\'est plus exigée', fichier: PS, de: 'if (!jumeaux.every(j => produits.has(j)))', vers: 'if (false)' },
    { nom: 'I : un champ lu qui contredit le désigné est toléré', fichier: PS, de: "if (Object.values(GC.statuts(lu, ligne)).includes('ko'))", vers: 'if (false)' },
    { nom: 'I : le nom lu qui contredit le désigné est toléré', fichier: PS, de: 'if (formes.length && !nomCompatible(formes, ligne)) return non(\'le nom lu', vers: 'if (false) return non(\'le nom lu' },
    { nom: 'I : un cosinus inconnu est toléré', fichier: PS, de: 'if (a === null || b === null || !(a - b', vers: 'if (!(a - b' },
    // ── « seulement des probables » et le drapeau, à l'étape
    { nom: 'probables : la promotion s\'applique aussi à une question (tête du classement)', fichier: LV, de: 'if (probable && cfg.promotionSurs === true && ', vers: 'if (cfg.promotionSurs === true && ' },
    { nom: 'drapeau : l\'étape promeut drapeau éteint', fichier: LV, de: 'cfg.promotionSurs === true && cfg.gardeMarqueurs === true && baseIds', vers: 'cfg.gardeMarqueurs === true && baseIds' },
    { nom: 'C1 : une question à UN candidat est promue (V2_LEVIERS_UN_CANDIDAT)', fichier: LV, de: 'baseIds.length >= 2 && resultat.jumeauxEnQuestion', vers: 'resultat.jumeauxEnQuestion' },
    { nom: 'C1 : une question née du levier e est promue', fichier: LV, de: ' && resultat.jumeauxEnQuestion !== true) {', vers: ') {' },
    { nom: 'C1 : deux candidats minimum devient un seul (>= 1)', fichier: LV, de: 'baseIds.length >= 2 && resultat.jumeauxEnQuestion', vers: 'baseIds.length >= 1 && resultat.jumeauxEnQuestion' },
    { nom: 'M3 : la garde des marqueurs n\'est plus exigée pour promouvoir', fichier: LV, de: 'cfg.gardeMarqueurs === true && baseIds', vers: 'baseIds' },
    // ── la décision de la route
    { nom: 'route : le drapeau n\'est plus lu par la décision', fichier: PSR, de: 'if (!(cfg && cfg.promotionSurs === true)) return null;', vers: '' },
    { nom: 'route : l\'affirmation d\'un AUTRE produit est acceptée', fichier: PSR, de: 'c.carte.idProduct === id))', vers: 'true))' },
    { nom: 'route : la garde des marqueurs ne renvoie plus le sûr à la question', fichier: PSR, de: 'if (gm && gm.resultat) return', vers: 'if (false) return' },
    { nom: 'route : une garde des marqueurs en erreur laisse passer le sûr', fichier: PSR, de: "journal('promotion en sûr (marqueurs)', e); return { trace: { issue: 'garde-marqueurs-en-erreur', regle: p.regle, produit: id } };", vers: "journal('promotion en sûr (marqueurs)', e); gm = null;" },
    { nom: 'route : la décision de la promotion n\'est plus consultée', fichier: PSR, de: 'if (lv.promotion) {', vers: 'if (false) {' },
    { nom: 'route : la question d\'avant n\'est plus notée avant la promotion', fichier: PSR, de: 'noter(res);', vers: '' },
    { nom: 'route : le résultat de l\'étape n\'est plus repris par la route', fichier: RT, de: 'resultat = ep.resultat; probableDecide = ep.probableDecide;', vers: 'probableDecide = ep.probableDecide;' },
    { nom: 'route : le sûr confirmé ne remplace plus le résultat', fichier: PSR, de: 'if (pr.resultat) { res = pr.resultat; probableDecide = null;', vers: 'if (false) { res = pr.resultat; probableDecide = null;' },
    { nom: 'route : le probable reste servi à côté du sûr', fichier: PSR, de: 'res = pr.resultat; probableDecide = null;', vers: 'res = pr.resultat;' },
    { nom: 'route : la garde relue ne voit plus les lignes de la promotion', fichier: RT, de: 'produits: lignesPromo, version: version0', vers: 'produits, version: version0' },
    { nom: 'route : la trace des marqueurs du sûr confirmé est perdue', fichier: PSR, de: 'if (pr.traceMarqueurs) tm = pr.traceMarqueurs;', vers: '' },
    { nom: 'M2 : la trace de la première garde est écrasée par un sûr refusé', fichier: PSR, de: 'else if (pr.traceMarqueurs) tracePromotion = { ...pr.trace, marqueurs: pr.traceMarqueurs };', vers: 'else if (pr.traceMarqueurs) { tm = pr.traceMarqueurs; }' },
    { nom: 'route : le règlement du crédit réservé d\'une affirmation est retiré', fichier: RT, de: "if (resultat.issue === 'affirmee' && reqH.questionId && !admin && credit) {", vers: 'if (false) {' },
    { nom: 'route : la promotion n\'est plus journalisée', fichier: RT, de: '...(tracePromotion ? { promotionSurs: tracePromotion } : {})', vers: '' },
    // ── configuration et /ping
    { nom: 'config : V2_PROMOTION_SURS allumé par défaut', fichier: CFG, de: "booleen('V2_PROMOTION_SURS', env.V2_PROMOTION_SURS, false)", vers: "booleen('V2_PROMOTION_SURS', env.V2_PROMOTION_SURS, true)" },
    { nom: 'config : toute valeur non vide allume V2_PROMOTION_SURS', fichier: CFG, de: "booleen('V2_PROMOTION_SURS', env.V2_PROMOTION_SURS, false)", vers: "Boolean(env.V2_PROMOTION_SURS)" },
    { nom: '/ping : le jeton est annoncé sans le drapeau de la promotion', fichier: CAP, de: JETON, vers: 'cfg.leviersAbde === true && cfg.probable === true && cfg.gardeMarqueurs === true' },
    { nom: '/ping : le jeton est annoncé sans V2_LEVIERS_ABDE', fichier: CAP, de: JETON, vers: 'cfg.promotionSurs === true && cfg.probable === true && cfg.gardeMarqueurs === true' },
    { nom: '/ping : le jeton est annoncé sans V2_PROBABLE', fichier: CAP, de: JETON, vers: 'cfg.promotionSurs === true && cfg.leviersAbde === true && cfg.gardeMarqueurs === true' },
    { nom: '/ping : le jeton est annoncé sans V2_GARDE_MARQUEURS (M3)', fichier: CAP, de: JETON, vers: 'cfg.promotionSurs === true && cfg.leviersAbde === true && cfg.probable === true' },
    { nom: '/ping : le jeton sort de la liste fermée', fichier: CAP, de: "'leviers-abde', 'promotion-surs', 'prix-pro-reserve']);", vers: "'leviers-abde', 'prix-pro-reserve']);" }
];

function lancer(mutation) {
    const env = { ...process.env }; delete env.LEVIERS_MUTATION;
    const args = [];
    if (mutation) { env.LEVIERS_MUTATION = JSON.stringify(mutation); args.push('--require', PRECHARGE); }
    args.push(path.join(__dirname, BANC));
    return spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 120000, cwd: path.join(__dirname, '..', '..') }).status;
}
H.v('témoin : sans mutation, le banc réussit', lancer(null), 0);
let tues = 0; const survivantes = [], invalides = [];
for (const m of MUTATIONS) {
    // 99 : ancre absente ou ambiguë ; 98 : le banc ne charge pas le fichier muté ; 0 : le banc passe malgré la mutation (survivante) ; autre : le banc ÉCHOUE = tuée
    const c = lancer({ fichier: m.fichier, de: m.de, vers: m.vers });
    if (c === 99 || c === 98) { invalides.push(m.nom); H.vrai(`mutation INVALIDE (ancre absente, ambiguë, ou fichier jamais chargé) : ${m.nom}  [code ${c}]`, false); continue; }
    const tuee = c !== 0;
    if (tuee) tues++; else survivantes.push(m.nom);
    H.vrai(`mutation tuée : ${m.nom}  [code ${c}]`, tuee);
}
console.log(`\n${tues} mutations tuées sur ${MUTATIONS.length} · survivantes ${survivantes.length}${survivantes.length ? ' : ' + JSON.stringify(survivantes) : ''} · invalides ${invalides.length}`);
H.bilan();
