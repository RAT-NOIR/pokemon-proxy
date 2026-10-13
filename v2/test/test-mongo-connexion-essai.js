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
    const preuveOk = async () => ({ ok: true });
    const r3 = await C.controlerApresConnexion({ db: baseVide, hote: 'h.example.net', env, videAutorise: true, preuve: preuveOk });
    v('3c. base vide + videAutorise: true + PREUVE conclue : passe (c\'est le cas de la copie initiale)', r3.ok, true);
    const r4 = await C.controlerApresConnexion({ db: baseVide, hote: 'h.example.net', env, videAutorise: 'oui' });
    v('3d. base vide + valeur non booléenne : REFUS', r4.ok, false);
    v('3e. le refus du vide parle toujours de la grappe', /AUCUNE collection/.test(r1.raison || ''), true);

    // ── 4. TOUR 1 (C1) : le passe-droit du vide n'existe qu'APRÈS une preuve, côté serveur, de l'identité de la cible
    const trace = [];
    const dbTrace = { listCollections: () => { trace.push('liste'); return { toArray: async () => [] }; } };
    const sans = await C.controlerApresConnexion({ db: baseVide, hote: 'h.example.net', env, videAutorise: true });
    v('4a. videAutorise: true SANS preuve fournie : REFUS (l\'option ne s\'obtient pas seule)', [sans.ok, /preuve/i.test(sans.raison || '')], [false, true]);
    const nonConclue = async () => ({ ok: false, raison: 'la cible n\'est pas prouvée' });
    const r5 = await C.controlerApresConnexion({ db: baseVide, hote: 'h.example.net', env, videAutorise: true, preuve: nonConclue });
    v('4b. preuve qui refuse : REFUS, raison reprise', [r5.ok, /n'est pas prouvée/.test(r5.raison || '')], [false, true]);
    const r6 = await C.controlerApresConnexion({ db: basePleine, hote: 'h.example.net', env, videAutorise: true, preuve: nonConclue });
    v('4c. preuve qui refuse sur une base NON vide : REFUS aussi (l\'option exige la preuve, toujours)', r6.ok, false);
    const r7 = await C.controlerApresConnexion({ db: baseVide, hote: 'h.example.net', env, videAutorise: true, preuve: async () => { throw new Error('boom'); } });
    v('4d. preuve qui LÈVE : REFUS (un cas non conclu bloque)', r7.ok, false);
    const r8 = await C.controlerApresConnexion({ db: baseVide, hote: 'h.example.net', env, videAutorise: true, preuve: async () => ({}) });
    v('4e. preuve qui rend un objet sans ok:true : REFUS ("je ne sais pas" ne passe pas)', r8.ok, false);
    const r9 = await C.controlerApresConnexion({ db: baseVide, hote: 'h.example.net', env, videAutorise: true, preuve: async () => ({ ok: 'oui' }) });
    v('4f. preuve qui rend ok truthy non booléen : REFUS', r9.ok, false);
    await C.controlerApresConnexion({ db: dbTrace, hote: 'h.example.net', env, videAutorise: true, preuve: async () => { trace.push('preuve'); return { ok: true }; } });
    v('4g. la preuve passe AVANT le contrôle du vide', trace, ['preuve', 'liste']);
    let appelee = 0;
    await C.controlerApresConnexion({ db: basePleine, hote: 'h.example.net', env, preuve: async () => { appelee++; return { ok: true }; } });
    v('4h. sans l\'option, la preuve n\'est pas demandée (aucun autre script n\'est touché)', appelee, 0);
    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
