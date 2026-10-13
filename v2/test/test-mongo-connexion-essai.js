'use strict';
// Banc de mongo-connexion.js pour la base du service de TEST (lot AMORÇAGE-ESSAI, D4). Aucune connexion, aucune écriture : des jugements purs et une fausse base.
//  1. `rm_essai` a son adresse (MONGODB_ESSAI_URI) et sa lecture (MONGODB_ESSAI_LECTURE_URI) ; la table n'a rien d'autre de neuf.
//  2. « une base réelle n'est jamais vide » reste vraie pour TOUTES les bases ; le seul passe-droit est une option NOMMÉE, refusée pour toute autre base que rm_essai.
const C = require('../../mongo-connexion');

let ok = 0, ko = 0;
const v = (nom, obtenu, attendu) => { const bon = JSON.stringify(obtenu) === JSON.stringify(attendu); console.log(`${bon ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); bon ? ok++ : ko++; };

(async () => {
    // ── 1. la table
    v('1a. BASES : rm_essai → MONGODB_ESSAI_URI', C.BASES.rm_essai, 'MONGODB_ESSAI_URI');
    v('1b. BASES : les trois anciennes lignes sont inchangées', [C.BASES.test, C.BASES.test_scratch, C.BASES.cartes], ['MONGODB_URI', 'MONGODB_URI', 'MONGODB_CARTES_URI']);
    v('1c. BASES : exactement quatre bases (une base absente de la table est refusée)', Object.keys(C.BASES).sort(), ['cartes', 'rm_essai', 'test', 'test_scratch']);
    v('1d. LECTURES : rm_essai → MONGODB_ESSAI_LECTURE_URI, la production et cartes gardent la leur', [C.LECTURES.rm_essai, C.LECTURES.test, C.LECTURES.cartes], ['MONGODB_ESSAI_LECTURE_URI', 'MONGODB_LECTURE_URI', 'MONGODB_CARTES_LECTURE_URI']);
    v('1e. BASES est gelée', Object.isFrozen(C.BASES) && Object.isFrozen(C.LECTURES), true);

    // ── 2. l'option NOMMÉE : écrite par ce qu'elle autorise (rm_essai, et rien d'autre)
    const j = (b, o) => C.resoudreBaseVide(b, o);
    v('2a. rm_essai + option : le vide est autorisé', j('rm_essai', true), { ok: true, videAutorise: true });
    v('2b. rm_essai sans option : le vide n\'est pas autorisé', j('rm_essai', false), { ok: true, videAutorise: false });
    v('2c. rm_essai, option absente : idem', j('rm_essai', undefined), { ok: true, videAutorise: false });
    for (const b of ['test', 'test_scratch', 'cartes', 'autre', '', 'RM_ESSAI', 'rm_essai ', 'rm_essai2'])
        v(`2d. option sur la base « ${b} » : REFUSÉE`, j(b, true).ok, false);
    v('2e. une valeur truthy qui n\'est pas `true` ne passe pas', [j('rm_essai', 1).ok, j('rm_essai', 'oui').ok, j('rm_essai', {}).ok], [false, false, false]);

    // ── 3. le contrôle d'après connexion : une base réelle n'est jamais vide, sauf rm_essai nommée
    const baseVide = { listCollections: () => ({ toArray: async () => [] }) };
    const basePleine = { listCollections: () => ({ toArray: async () => [{ name: 'a' }] }) };
    const env = {};   // hors banc : le contrôle « jamais vide » s'applique
    const r1 = await C.controlerApresConnexion({ db: baseVide, hote: 'h.example.net', env });
    v('3a. base vide, aucune option : REFUS (comportement historique)', r1.ok, false);
    const r2 = await C.controlerApresConnexion({ db: basePleine, hote: 'h.example.net', env });
    v('3b. base non vide : passe', r2.ok, true);
    const r3 = await C.controlerApresConnexion({ db: baseVide, hote: 'h.example.net', env, videAutorise: true });
    v('3c. base vide + videAutorise: true : passe (c\'est le cas de la copie initiale)', r3.ok, true);
    const r4 = await C.controlerApresConnexion({ db: baseVide, hote: 'h.example.net', env, videAutorise: 'oui' });
    v('3d. base vide + valeur non booléenne : REFUS', r4.ok, false);
    v('3e. le refus du vide parle toujours de la grappe', /AUCUNE collection/.test(r1.raison || ''), true);
    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
