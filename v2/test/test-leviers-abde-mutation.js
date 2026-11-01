'use strict';
// LEVIERS-ABDE (ordre n°17) — BANC DE MUTATION : chaque garde de production est CASSÉE à tour de rôle (une ancre de source remplacée, en mémoire, au chargement — _mutation-precharge.js), et les deux bancs
// (test-leviers-abde.js, test-leviers-abde-etape.js) doivent alors ÉCHOUER. Une mutation que les bancs laissent passer est une garde que rien ne tient. Une ancre absente ou ambiguë, ou un témoin (aucune mutation) qui échoue,
// font échouer le banc lui-même (jamais un faux « tué »). Aucune base, aucun réseau. Les fichiers du dépôt ne sont jamais modifiés.
const { spawnSync } = require('child_process');
const path = require('path');
const H = require('./_harnais');

const BANCS = ['test-leviers-abde.js', 'test-leviers-abde-etape.js'];
const PRECHARGE = path.join(__dirname, '_mutation-precharge.js');
const LV = 'v2/identifier/leviers-abde.js', AD = 'v2/identifier/adaptateur.js';
const MUTATIONS = [
    // ── noyau (a, b, d)
    { nom: 'a : poids des champs concordants à 0', fichier: LV, de: 'POIDS_OK = 0.05', vers: 'POIDS_OK = 0' },
    { nom: 'a : poids des champs contredits à 0', fichier: LV, de: 'POIDS_KO = 0.25', vers: 'POIDS_KO = 0' },
    { nom: 'a : pool de 11 au lieu de 10', fichier: LV, de: 'const TAILLE_POOL = 10,', vers: 'const TAILLE_POOL = 11,' },
    { nom: 'a : 81 lignes du vivier lues au lieu de 80', fichier: LV, de: 'VIVIER_LU = 80', vers: 'VIVIER_LU = 81' },
    { nom: 'a : 11 du vivier retenus au lieu de 10', fichier: LV, de: 'VIVIER_RETENU = 10', vers: 'VIVIER_RETENU = 11' },
    { nom: 'a : le pool trié au cosinus (le point validé d\'avant) au lieu de c3', fichier: LV, de: "const pool = classerPool(candidats, 'c3');", vers: "const pool = classerPool(candidats, 'cosinus');" },
    { nom: 'b : un premier CONTREDIT peut être désigné', fichier: LV, de: 'if (premier.ko === 0 && gap >= ecart - TOLERANCE)', vers: 'if (gap >= ecart - TOLERANCE)' },
    { nom: 'b : l\'écart est strict (> au lieu de >=)', fichier: LV, de: 'gap >= ecart - TOLERANCE', vers: 'gap > ecart' },
    { nom: 'b : l\'écart de la configuration est ignoré (0,1 en dur)', fichier: LV, de: 'decider(pool, cfg.leviersEcart)', vers: 'decider(pool, 0.1)' },
    { nom: 'd : les alias ne sont plus lus', fichier: LV, de: 'aliasDe(await catalogue.indexAliasFr(), [carte.name ?? carte.nom, carte.nomBrut])', vers: '[]' },
    { nom: 'd : un alias de 1 caractère suffit', fichier: LV, de: 'ALIAS_LONGUEUR_MIN = 4', vers: 'ALIAS_LONGUEUR_MIN = 1' },
    // ── les portes de l'étape (un sûr ne change jamais, rien d'autre qu'une question)
    { nom: 'porte : une question de GROUPE (marqueurs) est travaillée', fichier: LV, de: "if (estGroupe(traceMarqueurs)) return note('groupe-marqueurs');", vers: '' },
    { nom: 'porte I3 : un désigné de même dessin est servi probable', fichier: LV, de: 'if (dansUnGroupe(version, d.id, d.top3))', vers: 'if (false)' },
    { nom: 'porte I2 : un désigné sans prix de guide est servi probable', fichier: LV, de: "PR.depuisGuide(c.prixGuide, 'tendance-seule') === null", vers: 'false' },
    { nom: 'porte : un candidat sans ligne de catalogue entre dans la question', fichier: LV, de: 'if (!d.top3.every(id => lignes.has(id)))', vers: 'if (false)' },
    { nom: 'porte : l\'issue n\'est plus exigée « question » (un SÛR serait travaillé)', fichier: LV, de: "if (!resultat || resultat.issue !== 'question') return note('pas-une-question');", vers: "if (!resultat) return note('pas-une-question');" },
    { nom: 'porte : le statut a-trancher n\'est plus exigé', fichier: LV, de: "cartes[0].statut !== 'a-trancher' || ", vers: '' },
    { nom: 'porte : le drapeau V2_LEVIERS_ABDE n\'est plus exigé', fichier: LV, de: 'cfg && cfg.leviersAbde === true && cfg.probable === true) || !entree', vers: 'cfg && cfg.probable === true) || !entree' },
    { nom: 'porte : V2_PROBABLE n\'est plus exigé', fichier: LV, de: 'cfg.leviersAbde === true && cfg.probable === true) || !entree', vers: 'cfg.leviersAbde === true) || !entree' },
    { nom: 'porte : la version de l\'extension n\'est plus exigée', fichier: LV, de: ' || !P.versionAuMoins(entree.versionExtension, cfg.versionMinProbable)', vers: '' },
    { nom: 'porte : la photo non redressée n\'est plus refusée', fichier: LV, de: "if (p.e0.redressee !== true) return note('non-redressee');", vers: '' },
    { nom: 'porte : un seul candidat classable est servi', fichier: LV, de: "if (d.top3.length < 2) return note('moins-de-deux-classes');", vers: '' },
    { nom: 'question : la question est refaite même quand ses 3 candidats sont les mêmes', fichier: LV, de: 'if (!meme(d.top3, baseIds)) {', vers: 'if (true) {' },
    { nom: 'catalogue : toutes les lignes du pool sont relues (pas seulement les manquantes)', fichier: LV, de: 'const manquants = visés.filter(id => !lignes.has(id));', vers: 'const manquants = visés;' },
    // ── e : l'adaptateur
    { nom: 'e : le drapeau n\'est plus exigé (les introuvables deviennent des questions drapeau éteint)', fichier: AD, de: 'ctx.cfg.leviersAbde === true && ', vers: '' },
    { nom: 'e : un LOT reçoit la question', fichier: AD, de: 'ctx.lot !== true && ', vers: '' },
    { nom: 'e : les lignes des 3 premiers ne sont plus exigées (la panne SERVEUR)', fichier: AD, de: ' && ctx.produits instanceof Map && ids.slice(0, 3).length >= 2 && ids.slice(0, 3).every(id => ctx.produits.has(id))', vers: '' },
    { nom: 'e site 1 : coupé', fichier: AD, de: 'if (jumeauxEnQuestion(ctx, tous)) return question(tous, etat, ctx);', vers: '' },
    { nom: 'e site 2 : coupé', fichier: AD, de: 'if (jumeauxEnQuestion(ctx, g.ids)) return question(g.ids.slice(0, 3), etat, ctx);', vers: '' },
    { nom: 'e site 3 : coupé', fichier: AD, de: 'if (jumeauxEnQuestion(ctx, avecPart)) return {', vers: 'if (false) return {' },
    { nom: 'e site 3 : le résumé de la contradiction est perdu', fichier: AD, de: 'return { ...question(avecPart, etat, ctx), contradiction: g.resume };', vers: 'return { ...question(avecPart, etat, ctx) };' },
    // ── configuration, /ping, câblage
    { nom: 'config : le drapeau est allumé par défaut', fichier: 'v2/config.js', de: "booleen('V2_LEVIERS_ABDE', env.V2_LEVIERS_ABDE, false)", vers: "booleen('V2_LEVIERS_ABDE', env.V2_LEVIERS_ABDE, true)" },
    { nom: 'config : l\'écart par défaut passe à 0,2', fichier: 'v2/config.js', de: "decimal01('V2_LEVIERS_ECART', env.V2_LEVIERS_ECART, 0.1)", vers: "decimal01('V2_LEVIERS_ECART', env.V2_LEVIERS_ECART, 0.2)" },
    { nom: '/ping : le jeton est annoncé drapeau éteint', fichier: 'v2/capacites.js', de: "'leviers-abde': (cfg) => cfg.leviersAbde === true", vers: "'leviers-abde': (cfg) => true" },
    { nom: '/ping : le jeton sort de la liste fermée', fichier: 'v2/capacites.js', de: "'probable', 'leviers-abde']);", vers: "'probable']);" },
    { nom: 'route : l\'étape n\'est plus derrière le drapeau', fichier: 'v2/identifier/routes.js', de: 'if (cfg.leviersAbde === true) {', vers: 'if (cfg.probable === true) {' },
    { nom: 'route : la question de l\'étape ne remplace plus celle de la chaîne', fichier: 'v2/identifier/routes.js', de: 'if (lv) { if (lv.resultat) resultat = lv.resultat; probableDecide = lv.probable; }', vers: 'if (lv) { probableDecide = lv.probable; }' },
    { nom: 'lot : le contexte d\'un lot ne dit plus `lot: true`', fichier: 'v2/identifier/lot.js', de: '...ctxLD, lot: true }', vers: '...ctxLD }' },
    { nom: 'catalogue : un index d\'alias tronqué est accepté', fichier: 'v2/identifier/catalogue.js', de: 'if (lus < attendu) throw', vers: 'if (false) throw' },
    { nom: 'catalogue : le plancher de l\'index d\'alias est retiré', fichier: 'v2/identifier/catalogue.js', de: 'if (lus < INDEX_CODE_NUMERO_MIN) throw', vers: 'if (false) throw' }
];

function lancer(banc, mutation) {
    const env = { ...process.env }; delete env.LEVIERS_MUTATION;
    const args = [];
    if (mutation) { env.LEVIERS_MUTATION = JSON.stringify(mutation); args.push('--require', PRECHARGE); }
    args.push(path.join(__dirname, banc));
    const r = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 120000, cwd: path.join(__dirname, '..', '..') });
    return r.status;
}

// le témoin : sans mutation, les deux bancs passent (sinon « tué » ne voudrait rien dire)
const temoin = BANCS.map(b => lancer(b, null));
H.v('témoin : sans mutation, chaque banc réussit', temoin, BANCS.map(() => 0));
let tues = 0; const survivantes = [], invalides = [];
for (const m of MUTATIONS) {
    // 99 : ancre absente ou ambiguë (invalide) ; 98 : ce banc ne charge pas le fichier muté (il n'a rien à dire) ; 0 : le banc passe malgré la mutation ; autre : le banc ÉCHOUE = la mutation est tuée (on s'arrête au premier qui la tue)
    const codes = [];
    for (const b of BANCS) { const c = lancer(b, { fichier: m.fichier, de: m.de, vers: m.vers }); codes.push(c); if (c !== 0 && c !== 98) break; }
    if (codes.includes(99) || codes.every(c => c === 98)) { invalides.push(m.nom); H.vrai(`mutation INVALIDE (ancre absente, ambiguë, ou fichier jamais chargé) : ${m.nom}  [bancs : ${codes.join(', ')}]`, false); continue; }
    const tuee = codes.some(c => c !== 0 && c !== 98);
    if (tuee) tues++; else survivantes.push(m.nom);
    H.vrai(`mutation tuée : ${m.nom}  [bancs : ${codes.join(', ')}]`, tuee);
}
console.log(`\n${tues} mutations tuées sur ${MUTATIONS.length} · survivantes ${survivantes.length}${survivantes.length ? ' : ' + JSON.stringify(survivantes) : ''} · invalides ${invalides.length}`);
H.bilan();
