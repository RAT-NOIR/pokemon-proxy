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
    { nom: 'd : les alias ne sont plus lus', fichier: LV, de: 'aliasDe(indexAlias, [carte.name ?? carte.nom, carte.nomBrut], coupes)', vers: '[]' },
    { nom: 'd : un alias de 1 caractère suffit', fichier: LV, de: 'ALIAS_LONGUEUR_MIN = 4', vers: 'ALIAS_LONGUEUR_MIN = 1' },
    // ── tour 1 (B, C, D, H) : les exclusions de consulterProbable, échouer fermé et dire, coût borné, signal
    { nom: 'B : une question avec motif ou contradiction est travaillée', fichier: LV, de: "if (resultat.motif || resultat.contradiction) return note('motif-ou-contradiction');", vers: '' },
    { nom: 'B : une question à UN candidat sert un probable', fichier: LV, de: "if (baseIds.length < 2 && cfg.leviersUnCandidat !== true) note('un-candidat');", vers: "if (false) note('un-candidat');" },        // sans le drapeau : jamais un probable (tour 2 : l'ancre suit la condition du drapeau)
    { nom: 'C : l\'index d\'alias pas prêt laisse passer un repli vide', fichier: LV, de: "if (!(indexAlias instanceof Map)) return echec('alias-non-pret');", vers: '' },
    { nom: 'C : l\'index d\'alias absent n\'échoue plus fermé', fichier: LV, de: "if (!catalogue || typeof catalogue.indexAliasFrSansAttente !== 'function') return echec('alias-absent');", vers: '' },
    { nom: 'C : l\'index d\'alias en panne devient un repli vide', fichier: LV, de: "catch { return echec('alias-indisponible'); }", vers: 'catch { indexAlias = new Map(); }' },
    { nom: 'C : l\'échec du catalogue n\'est plus compté', fichier: LV, de: "catch { return echec('catalogue-en-panne'); }", vers: "catch { return note('catalogue-en-panne'); }" },
    { nom: 'C : une exception du levier est avalée sans trace', fichier: LV, de: "catch (e) { return echec('erreur', e && e.name ? `(${String(e.name).slice(0, 40)})` : ''); }", vers: "catch (e) { return note('erreur'); }" },
    { nom: 'C : le compteur d\'échecs ne compte plus', fichier: LV, de: 'ECHECS[cause] = (ECHECS[cause] || 0) + 1;', vers: 'ECHECS[cause] = (ECHECS[cause] || 0);' },
    { nom: 'C : le journal d\'échecs n\'est plus limité à une ligne par minute', fichier: LV, de: 't - DERNIER_ECHEC[cause] >= 60000', vers: 't - DERNIER_ECHEC[cause] >= 0' },
    { nom: 'D : l\'éventail d\'alias passe à 21', fichier: LV, de: 'const ALIAS_MAX = 20;', vers: 'const ALIAS_MAX = 21;' },
    { nom: 'D : la coupe de l\'éventail n\'est plus écrite', fichier: LV, de: 'coupes.push({ cle: cles.join(\' | \'), total: sortie.length, gardes: ALIAS_MAX });', vers: '' },
    { nom: 'D : le nom lu n\'est plus borné avant la normalisation', fichier: LV, de: "String(s || '').slice(0, NOM_LU_MAX).normalize('NFKD')", vers: "String(s || '').normalize('NFKD')" },
    { nom: 'D : un produit sans ligne prend un créneau du vivier', fichier: LV, de: 'viv.filter(i => existe(i) && ko(i) === 0)', vers: 'viv.filter(i => ko(i) === 0)' },
    { nom: 'D : un produit sans ligne entre au pool', fichier: LV, de: 'existe: id => lignes.has(id) });', vers: '});' },
    { nom: 'H : le signal journalisé n\'est plus `A`', fichier: LV, de: "const SIGNAL = 'A', LEVIER = 'abde';", vers: "const SIGNAL = 'ABDE', LEVIER = 'abde';" },
    { nom: 'H : le levier n\'est plus écrit dans analyses', fichier: 'v2/identifier/routes.js', de: '...(sortie.probable.levier ? { levier: sortie.probable.levier } : {})', vers: '' },
    { nom: 'M1 : la tolérance flottante de l\'écart est retirée', fichier: LV, de: 'gap >= ecart - TOLERANCE', vers: 'gap >= ecart' },
    { nom: 'M1 : un cosinus inconnu est classé avant les connus (c3)', fichier: LV, de: 'const c3OuBas = c => (scoreC3(c) === null ? -9 : scoreC3(c));', vers: 'const c3OuBas = c => (scoreC3(c) === null ? 9 : scoreC3(c));' },
    { nom: 'M1 : un cosinus inconnu est classé avant les connus (cosinus)', fichier: LV, de: 'const cosOuBas = c => (c && Number.isFinite(c.cos) ? c.cos : -9);', vers: 'const cosOuBas = c => (c && Number.isFinite(c.cos) ? c.cos : 9);' },
    { nom: 'M1 : la normalisation des alias ne retire plus les marques', fichier: LV, de: ".normalize('NFKD').replace(/[̀-ͯ]/g, '')", vers: ".normalize('NFKD')" },
    { nom: 'M1 : la langue décisive n\'est plus recopiée sur la question refaite', fichier: LV, de: 'if (resultat.langueDecisive !== undefined) nouveau = { ...nouveau, langueDecisive: resultat.langueDecisive };', vers: '' },
    { nom: 'M1 : l\'ordre des voisins du pool est inversé', fichier: LV, de: 'for (const liste of (Array.isArray(produitsDesVoisins) ? produitsDesVoisins : []))', vers: 'for (const liste of [...(Array.isArray(produitsDesVoisins) ? produitsDesVoisins : [])].reverse())' },
    { nom: 'D : l\'index d\'alias construit n\'est plus gardé prêt', fichier: 'v2/identifier/catalogue.js', de: 'if (aliasEnCours === p) aliasPret = idx;', vers: '' },
    { nom: 'D : la lecture sans attente ne rend plus l\'index prêt', fichier: 'v2/identifier/catalogue.js', de: '        return aliasPret;', vers: '        return null;' },
    { nom: 'D : le préchauffage de prechauffer() est retiré', fichier: 'v2/identifier/catalogue.js', de: 'if (cfg.leviersAbde === true) r.alias = await prechaufferAlias();', vers: '' },
    { nom: 'D : le drapeau seul ne préchauffe plus au démarrage', fichier: 'v2/identifier/catalogue.js', de: 'if (cfg.leviersAbde === true) return (async () =>', vers: 'if (false) return (async () =>' },
    { nom: 'D : temps et mémoire de la construction ne sont plus gardés', fichier: 'v2/identifier/catalogue.js', de: 'aliasStats = { noms: index.size,', vers: 'aliasStats = null && { noms: index.size,' },
    // ── les portes de l'étape (un sûr ne change jamais, rien d'autre qu'une question)
    { nom: 'porte : une question de GROUPE (marqueurs) est travaillée', fichier: LV, de: "if (estGroupe(traceMarqueurs)) return note('groupe-marqueurs');", vers: '' },
    { nom: 'porte I3 : un désigné de même dessin est servi probable', fichier: LV, de: 'if (dansUnGroupe(version, d.id, d.top3))', vers: 'if (false)' },
    { nom: 'porte I2 : un désigné sans prix de guide est servi probable', fichier: LV, de: "PR.depuisGuide(c.prixGuide, 'tendance-seule') === null", vers: 'false' },
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
    { nom: 'e : les lignes des 3 premiers ne sont plus exigées (la panne SERVEUR)', fichier: AD, de: ' && ctx.produits instanceof Map && ids.slice(0, 3).every(id => ctx.produits.has(id))', vers: '' },
    { nom: 'e site 1 : coupé', fichier: AD, de: 'if (jumeauxEnQuestion(ctx, tous)) return { ...question(tous, etat, ctx), jumeauxEnQuestion: true };', vers: '' },
    { nom: 'e site 2 : coupé', fichier: AD, de: 'if (jumeauxEnQuestion(ctx, g.ids)) return { ...question(g.ids.slice(0, 3), etat, ctx), jumeauxEnQuestion: true };', vers: '' },
    { nom: 'e site 3 : coupé', fichier: AD, de: 'if (jumeauxEnQuestion(ctx, avecPart)) return {', vers: 'if (false) return {' },
    { nom: 'e site 3 : le résumé de la contradiction est perdu', fichier: AD, de: 'return { ...question(avecPart, etat, ctx), contradiction: g.resume, jumeauxEnQuestion: true };', vers: 'return { ...question(avecPart, etat, ctx), jumeauxEnQuestion: true };' },
    // ── tour 1, ruling A : e ne se promeut jamais en sûr, n'agit que si la route le permet
    { nom: 'e : la route n\'a plus à le permettre (leviersE)', fichier: AD, de: 'ctx.leviersE === true && ', vers: '' },
    { nom: 'e : la question née de e perd sa marque (site 2)', fichier: AD, de: 'question(g.ids.slice(0, 3), etat, ctx), jumeauxEnQuestion: true }', vers: 'question(g.ids.slice(0, 3), etat, ctx) }' },
    { nom: 'e : la désignation peut affirmer une question née de e', fichier: AD, de: "r.issue !== 'question' || r.jumeauxEnQuestion === true) return r;", vers: "r.issue !== 'question') return r;" },
    { nom: 'e : la route ne pose plus leviersE sous le niveau probable servi', fichier: 'v2/identifier/routes.js', de: 'niveauServi(cfg, entree) ? { leviersE: true } : {}', vers: 'true ? { leviersE: true } : {}' },
    { nom: 'e : la seconde lecture voit une question née de e', fichier: 'v2/identifier/routes.js', de: "if (resultat.issue === 'question' && !resultat.jumeauxEnQuestion) {", vers: "if (resultat.issue === 'question') {" },
    { nom: 'e : le tampon voit une question née de e', fichier: 'v2/identifier/routes.js', de: "resultat.issue === 'affirmee') && !resultat.jumeauxEnQuestion) {", vers: "resultat.issue === 'affirmee')) {" },
    { nom: 'e : la règle G voit une question née de e', fichier: 'v2/identifier/routes.js', de: 'if (resultat.jumeauxEnQuestion === true) { /* e : jamais promue */ } else if (', vers: 'if (' },
    { nom: 'e : SUR-PAR-IMAGE voit une question née de e', fichier: 'v2/identifier/routes.js', de: '!(empreinteInfo && empreinteInfo.influence) && !resultat.jumeauxEnQuestion) {', vers: '!(empreinteInfo && empreinteInfo.influence)) {' },
    { nom: 'e : le titre jumbo peut affirmer une question née de e', fichier: 'v2/identifier/garde-marqueurs.js', de: 'lot || resultat.jumeauxEnQuestion === true ?', vers: 'lot ?' },
    { nom: 'e : la question du groupe (marqueurs) ne reçoit plus `lot`', fichier: 'v2/identifier/garde-marqueurs.js', de: 'produits, jumeaux, lot })', vers: 'produits, jumeaux })' },
    // ── configuration, /ping, câblage
    { nom: 'config : le drapeau est allumé par défaut', fichier: 'v2/config.js', de: "booleen('V2_LEVIERS_ABDE', env.V2_LEVIERS_ABDE, false)", vers: "booleen('V2_LEVIERS_ABDE', env.V2_LEVIERS_ABDE, true)" },
    { nom: 'config : l\'écart par défaut passe à 0,2', fichier: 'v2/config.js', de: "ecartLeviers('V2_LEVIERS_ECART', env.V2_LEVIERS_ECART, 0.1)", vers: "ecartLeviers('V2_LEVIERS_ECART', env.V2_LEVIERS_ECART, 0.2)" },
    { nom: 'E : un écart sous 0,05 est accepté', fichier: 'v2/config.js', de: 'if (n < ECART_LEVIERS_MIN || n > ECART_LEVIERS_MAX) throw', vers: 'if (n > ECART_LEVIERS_MAX) throw' },
    { nom: 'E : un écart au-dessus de 0,5 est accepté', fichier: 'v2/config.js', de: 'if (n < ECART_LEVIERS_MIN || n > ECART_LEVIERS_MAX) throw', vers: 'if (n < ECART_LEVIERS_MIN) throw' },
    { nom: 'E : le plancher passe à 0,04', fichier: 'v2/config.js', de: 'ECART_LEVIERS_MIN = 0.05', vers: 'ECART_LEVIERS_MIN = 0.04' },
    { nom: 'E : le plafond passe à 0,6', fichier: 'v2/config.js', de: 'ECART_LEVIERS_MAX = 0.5', vers: 'ECART_LEVIERS_MAX = 0.6' },
    // ── TOUR 2 : re-relecture 1 (éventail coupé, plafond total) et 2 (attente après un échec de l'index)
    { nom: 'T2 alias : le plafond redevient 20 PAR forme', fichier: LV, de: 'return sortie.slice(0, ALIAS_MAX);', vers: 'return sortie;' },
    { nom: 'T2 alias : la coupe n\'est plus écrite', fichier: LV, de: 'if (sortie.length > ALIAS_MAX && Array.isArray(coupes)) coupes.push(', vers: 'if (false) coupes.push(' },
    { nom: 'T2 alias : un éventail coupé fabrique encore une marge (plus d\'échec fermé)', fichier: LV, de: "return echec('alias-coupe', JSON.stringify(coupes)); }", vers: "signaler('alias-tronque', JSON.stringify(coupes)); }" },
    { nom: 'T2 alias : plus d\'attente après un échec de l\'index', fichier: 'v2/identifier/catalogue.js', de: ' && Date.now() - aliasEchecLe >= ALIAS_ATTENTE_MS) indexAliasFr()', vers: ') indexAliasFr()' },
    { nom: 'T2 alias : l\'attente tombe à 30 s', fichier: 'v2/identifier/catalogue.js', de: 'ALIAS_ATTENTE_MS = 60 * 1000', vers: 'ALIAS_ATTENTE_MS = 30 * 1000' },
    { nom: 'T2 alias : l\'attente tombe à 59 s', fichier: 'v2/identifier/catalogue.js', de: 'ALIAS_ATTENTE_MS = 60 * 1000', vers: 'ALIAS_ATTENTE_MS = 59 * 1000' },
    { nom: 'T2 alias : l\'échec n\'est plus daté', fichier: 'v2/identifier/catalogue.js', de: 'aliasLe = 0; aliasEchecLe = Date.now(); }', vers: 'aliasLe = 0; }' },
    // ── TOUR 2 : V2_LEVIERS_UN_CANDIDAT
    { nom: 'T2 config : toute valeur non vide allume le drapeau un candidat', fichier: 'v2/config.js', de: "leviersUnCandidat: env.V2_LEVIERS_UN_CANDIDAT === '1',", vers: "leviersUnCandidat: Boolean(env.V2_LEVIERS_UN_CANDIDAT)," },
    { nom: 'T2 config : le drapeau un candidat est allumé par défaut', fichier: 'v2/config.js', de: "leviersUnCandidat: env.V2_LEVIERS_UN_CANDIDAT === '1',", vers: 'leviersUnCandidat: true,' },
    { nom: 'T2 levier : une question à un candidat devient toujours un probable', fichier: 'v2/identifier/leviers-abde.js', de: "if (baseIds.length < 2 && cfg.leviersUnCandidat !== true) note('un-candidat');", vers: "if (baseIds.length < 2 && false) note('un-candidat');" },
    { nom: 'T2 levier : le drapeau un candidat est sans effet', fichier: 'v2/identifier/leviers-abde.js', de: "if (baseIds.length < 2 && cfg.leviersUnCandidat !== true) note('un-candidat');", vers: "if (baseIds.length < 2) note('un-candidat');" },
    { nom: 'T2 levier : I3 (même dessin) oubliée pour un candidat unique', fichier: 'v2/identifier/leviers-abde.js', de: "else if (dansUnGroupe(version, d.id, d.top3)) note('groupe-donnees');", vers: "else if (baseIds.length > 1 && dansUnGroupe(version, d.id, d.top3)) note('groupe-donnees');" },
    { nom: 'T2 levier : I2 (prix de guide) oubliée pour un candidat unique', fichier: 'v2/identifier/leviers-abde.js', de: "else if (!c || PR.depuisGuide(c.prixGuide, 'tendance-seule') === null) note('sans-prix');", vers: "else if (baseIds.length > 1 && (!c || PR.depuisGuide(c.prixGuide, 'tendance-seule') === null)) note('sans-prix');" },
    { nom: 'T2 réserve 5 : le règlement lit `choix.length`', fichier: 'v2/argent/questions.js', de: "if (q.probable === true && !(motif === 'question-aucune'", vers: "if (q.choix.length === 99) { } if (q.probable === true && !(motif === 'question-aucune'" },
    { nom: '/ping : le jeton est annoncé drapeau éteint', fichier: 'v2/capacites.js', de: "'leviers-abde': (cfg) => cfg.leviersAbde === true && cfg.probable === true", vers: "'leviers-abde': (cfg) => cfg.probable === true" },
    { nom: 'F : /ping annonce le jeton sans V2_PROBABLE', fichier: 'v2/capacites.js', de: "'leviers-abde': (cfg) => cfg.leviersAbde === true && cfg.probable === true", vers: "'leviers-abde': (cfg) => cfg.leviersAbde === true" },
    { nom: '/ping : le jeton est annoncé quel que soit le drapeau', fichier: 'v2/capacites.js', de: "'leviers-abde': (cfg) => cfg.leviersAbde === true && cfg.probable === true", vers: "'leviers-abde': (cfg) => true" },
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
