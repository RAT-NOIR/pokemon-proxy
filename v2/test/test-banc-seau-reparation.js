'use strict';
// BANC-200 (tour 3) — UN PROCESSUS TUÉ entre la réservation et la terminaison ne gèle plus le banc sans que personne le voie.
// (a) la vue du seau expose ecritures, termine et l'écart `enVol` ; (b) le scellé refusé pour écritures en vol porte un code DISTINCT (ECRITURES_EN_VOL) avec l'écart et l'âge de la dernière réservation ;
// (c) `reparer-seau.js` journalisé : seau OUVERT seulement, écart == --attendu, dernière réservation plus vieille que N minutes (30), une seule `updateOne` conditionnelle sur les valeurs lues, une trace dans banc_reparations ;
// (M5) un seau déclaré AVANT le tour 2 (compteurs absents) se scelle : un champ absent vaut 0.
// Base EN MÉMOIRE, stockage MÉMOIRE (dont un `ecrire` qui ne revient JAMAIS : la requête « tuée »), aucun réseau.
const H = require('./_harnais');
const crypto = require('crypto');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const S = require('../banc/stockage');
const { creerSeaux } = require('../banc/seau');

const oid = () => new mongoose.Types.ObjectId();
const octets = () => crypto.randomBytes(48);
const essayer = async (nom, f) => { try { await f(); } catch (e) { H.v(`${nom} (exception)`, String(e && (e.stack || e.message)), 'aucune'); } };
const code = async f => { try { await f(); return 'a réussi'; } catch (e) { return (e && (e.detail || e.code)) || 'erreur'; } };

(async () => {
    await H.ouvrirBac('test-banc-seau-reparation.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_BANC_SEAU: '1' });
    const memoire = S.creerStockageMemoire(S.CLE_SEAU);
    let tuer = false;                                  // quand c'est vrai, `ecrire` ne revient jamais : le processus est « tué » au milieu de l'écriture
    const stockage = { verifierBucket: async () => { }, ecrire: (c, b) => (tuer ? new Promise(() => { }) : memoire.ecrire(c, b)), lire: c => memoire.lire(c), supprimer: c => memoire.supprimer(c) };
    let decalageMs = 0;
    const horloge = () => new Date(Date.now() + decalageMs);
    const seaux = creerSeaux({ cfg, stockage, horloge, catalogue: { lire: async ids => new Map(ids.map(i => [i, { idProduct: i }])) } });
    const PORTEUR = `compte:${oid()}`;
    const semer = async () => { const _id = oid(); await db.col('analyses').insertOne({ _id, porteur: PORTEUR, statut: 'identifiee', cartes: [{ idProduct: 2001, statut: 'identifiee' }], creeLe: new Date(), expireLe: new Date(Date.now() + 864e5) }); return String(_id); };
    const photo = async (seau, index = 0, scanId = null) => seaux.enregistrerPhoto({ scanId: scanId || await semer(), porteur: PORTEUR, seauId: seau.id, index, octets: octets(), type: 'image/jpeg' });
    const seau0 = id => db.col('banc_seaux').findOne({ _id: id });
    const R = require('../banc/reparer-seau');

    let seau, s1;
    await essayer('écriture tuée', async () => {
        seau = await seaux.declarer({ nom: 'tue-1', type: 'entrainement', cible: 5, par: 'test' });
        s1 = await semer(); await photo(seau, 0, s1);
        const avant = await seaux.courant();
        H.v('1. (a) la vue expose ecritures, termine et l\'écart enVol (0 au repos)', [avant.ecritures, avant.termine, avant.enVol], [1, 1, 0]);
        // la requête « tuée » : la réservation est prise, l'objet ne revient jamais
        tuer = true; photo(seau, 1, s1).catch(() => { });          // jamais attendue : elle ne se termine pas
        await new Promise(r => setTimeout(r, 150)); tuer = false;
        const apres = await seaux.courant();
        H.v('1. (a) après la requête tuée : ecritures 2, termine 1, enVol 1, et la date de la dernière réservation', [apres.ecritures, apres.termine, apres.enVol, apres.derniereReservation instanceof Date], [2, 1, 1, true]);
        let e1 = null; try { await seaux.sceller(seau.id); } catch (e) { e1 = e; }
        H.v('1. (b) le scellé est refusé avec un code DISTINCT ECRITURES_EN_VOL (pas « ecritures-en-cours »), l\'écart et l\'âge', [e1 && e1.detail, e1 && e1.enVol, e1 && typeof e1.ageMs === 'number', e1 && /1 écriture/.test(e1.message)], ['ECRITURES_EN_VOL', 1, true, true]);
        H.v('1. (b) …et l\'état reste ouvert (rien n\'est figé)', (await seau0(seau.id)).etat, 'ouvert');
        H.v('1. le banc est gelé : aucun autre seau ne peut naître (c\'est ce que la réparation débloque)', await code(() => seaux.declarer({ nom: 'tue-2', type: 'entrainement', cible: 5, par: 'test' })), 'seau-ouvert');
    });

    await essayer('réparation refusée', async () => {
        const base = { seauId: seau.id, colFn: n => db.col(n), par: 'operateur', horloge };
        H.v('2. (c) trop tôt (dernière réservation d\'il y a quelques ms) : refusée TROP_RECENT', await code(() => R.reparerSeau({ ...base, attendu: 1 })), 'TROP_RECENT');
        decalageMs = 31 * 60e3;
        H.v('2. (c) un mauvais --attendu (2 au lieu de 1) : refusée ATTENDU_DIFFERENT', await code(() => R.reparerSeau({ ...base, attendu: 2 })), 'ATTENDU_DIFFERENT');
        H.v('2. (c) --attendu absent ou non entier : refusée ENTREE', [await code(() => R.reparerSeau({ ...base })), await code(() => R.reparerSeau({ ...base, attendu: '1' })), await code(() => R.reparerSeau({ ...base, attendu: 0 }))], ['ENTREE', 'ENTREE', 'ENTREE']);
        H.v('2. (c) sans opérateur nommé : refusée ENTREE', await code(() => R.reparerSeau({ ...base, par: '', attendu: 1 })), 'ENTREE');
        H.v('2. (c) un seau inconnu : refusée SEAU_INCONNU', await code(() => R.reparerSeau({ ...base, seauId: 'a'.repeat(16), attendu: 1 })), 'SEAU_INCONNU');
        H.v('2. (c) la durée minimale doit être un entier positif', await code(() => R.reparerSeau({ ...base, attendu: 1, minutes: 0 })), 'ENTREE');
        const v = await seau0(seau.id);
        H.v('2. rien n\'a été touché par les refus (termine toujours 1), aucune trace de réparation', [v.termine, await db.col('banc_reparations').countDocuments({ seauId: seau.id, resultat: 'faite' })], [1, 0]);
        // une dernière réservation INCONNUE (seau d'avant ce tour) : on ne devine pas l'âge
        const sansDate = await db.col('banc_seaux').findOne({ _id: seau.id });
        await db.col('banc_seaux').updateOne({ _id: seau.id }, { $unset: { derniereReservation: '' } });
        H.v('2. (c) dernière réservation inconnue : refusée RESERVATION_INCONNUE (on ne devine pas l\'âge)', await code(() => R.reparerSeau({ ...base, attendu: 1 })), 'RESERVATION_INCONNUE');
        await db.col('banc_seaux').updateOne({ _id: seau.id }, { $set: { derniereReservation: sansDate.derniereReservation } });
    });

    await essayer('course pendant la réparation', async () => {
        // la valeur lue n'est plus la valeur écrite : une réservation arrive entre la lecture et la mise à jour
        let fait = false;
        const colPiege = n => { const c = db.col(n); if (n !== 'banc_seaux') return c; return { findOne: async (q, o) => { const d = await c.findOne(q, o); if (!fait) { fait = true; await c.updateOne({ _id: seau.id }, { $inc: { ecritures: 1 } }); } return d; }, updateOne: (q, u, o) => c.updateOne(q, u, o) }; };
        const r = await code(() => R.reparerSeau({ seauId: seau.id, colFn: colPiege, par: 'operateur', horloge, attendu: 1 }));
        H.v('3. (c) une réservation s\'est glissée entre la lecture et l\'écriture : refusée CONCURRENCE, rien n\'est écrit', [r, (await seau0(seau.id)).termine], ['CONCURRENCE', 1]);
        const tr = await db.col('banc_reparations').find({ seauId: seau.id }).toArray();
        H.v('3. la tentative manquée laisse sa trace (resultat echec)', tr.map(t => t.resultat), ['echec']);
        await db.col('banc_seaux').updateOne({ _id: seau.id }, { $inc: { ecritures: -1 } });       // on rend l'état d'avant (échafaudage du banc)
        await db.col('banc_reparations').deleteMany({ seauId: seau.id });
    });

    await essayer('réparation acceptée', async () => {
        decalageMs = 31 * 60e3;
        const r = await R.reparerSeau({ seauId: seau.id, colFn: n => db.col(n), par: 'operateur', horloge, attendu: 1 });
        H.v('4. (c) réparation acceptée : ecritures = termine (2), écart 1 réparé', [r.avant.ecritures, r.avant.termine, r.apres.ecritures, r.apres.termine, r.ecart], [2, 1, 2, 2, 1]);
        const v = await seaux.courant();
        H.v('4. la vue dit enVol 0', v.enVol, 0);
        const traces = await db.col('banc_reparations').find({ seauId: seau.id }).toArray();
        H.v('4. 🔑 la TRACE : qui, quand, seau, écart, valeurs avant et après', [traces.length, traces[0].par, traces[0].le instanceof Date, traces[0].seauId, traces[0].ecart, traces[0].avant, traces[0].apres, traces[0].attendu, traces[0].minutes, traces[0].resultat],
            [1, 'operateur', true, seau.id, 1, { ecritures: 2, termine: 1 }, { ecritures: 2, termine: 2 }, 1, 30, 'faite']);
        H.v('4. une seconde réparation n\'a plus rien à réparer : RIEN_A_REPARER', await code(() => R.reparerSeau({ seauId: seau.id, colFn: n => db.col(n), par: 'operateur', horloge, attendu: 1 })), 'RIEN_A_REPARER');
        decalageMs = 0;
        const sc = await seaux.sceller(seau.id);
        H.v('4. 🔑 le scellé est de nouveau possible', [sc.etat, sc.n], ['scelle', 1]);
        H.v('4. le banc est dégelé : un autre seau peut naître', (await seaux.declarer({ nom: 'tue-2', type: 'entrainement', cible: 5, par: 'test' })).etat, 'ouvert');
    });

    await essayer('seau scellé', async () => {
        // un seau SCELLÉ n'est JAMAIS touché, même avec un écart et la bonne valeur
        await db.col('banc_seaux').updateOne({ _id: seau.id }, { $inc: { ecritures: 3 } });
        decalageMs = 31 * 60e3;
        const avant = await seau0(seau.id);
        H.v('5. (c) un seau SCELLÉ : refusée SEAU_NON_OUVERT', await code(() => R.reparerSeau({ seauId: seau.id, colFn: n => db.col(n), par: 'operateur', horloge, attendu: 3 })), 'SEAU_NON_OUVERT');
        const apres = await seau0(seau.id);
        H.v('5. …et rien n\'a bougé (termine, état)', [apres.termine === avant.termine, apres.etat], [true, 'scelle']);
        decalageMs = 0;
    });

    await essayer('M5 compteurs absents', async () => {
        // un seau déclaré AVANT le tour 2 n'a pas de compteurs : un champ absent vaut 0
        await db.col('banc_seaux').updateOne({ etat: 'ouvert' }, { $set: { etat: 'scelle' } });       // libère la place (échafaudage)
        const vieux = await seaux.declarer({ nom: 'avant-tour-2', type: 'entrainement', cible: 5, par: 'test' });
        const sv = await semer(); await photo(vieux, 0, sv);
        await db.col('banc_seaux').updateOne({ _id: vieux.id }, { $unset: { ecritures: '', termine: '' } });
        H.v('6. M5 : le seau sans compteurs les expose à 0 (enVol 0)', ((v) => [v.ecritures, v.termine, v.enVol])(await seaux.courant()), [0, 0, 0]);
        const sc = await seaux.sceller(vieux.id);
        H.v('6. M5 🔑 un seau sans compteurs SE SCELLE (champ absent = 0)', [sc.etat, sc.n], ['scelle', 1]);
        // idem après une écriture : la réservation crée les champs, le scellé les lit
        await db.col('banc_seaux').updateOne({ _id: vieux.id }, { $set: { etat: 'scelle' } });
        const v2 = await seaux.declarer({ nom: 'avant-tour-2-bis', type: 'entrainement', cible: 5, par: 'test' });
        await db.col('banc_seaux').updateOne({ _id: v2.id }, { $unset: { ecritures: '', termine: '' } });
        await photo(v2);
        const apres = await seau0(v2.id);
        H.v('6. M5 : une écriture sur un seau sans compteurs les crée (1 et 1)', [apres.ecritures, apres.termine], [1, 1]);
        H.v('6. M5 : …et il se scelle', (await seaux.sceller(v2.id)).etat, 'scelle');
    });

    await essayer('CLI', async () => {
        const arg = R.analyserArgs;
        H.v('7. CLI : arguments refusés (attendu absent, base test, argument inconnu, doublon)', [arg(['--base=x', '--seau=' + 'a'.repeat(16), '--par=moi']).erreur !== undefined, arg(['--base=test', '--seau=' + 'a'.repeat(16), '--attendu=1', '--par=moi']).erreur !== undefined, arg(['--base=x', '--seau=' + 'a'.repeat(16), '--attendu=1', '--par=moi', '--force']).erreur !== undefined, arg(['--base=x', '--base=y', '--seau=' + 'a'.repeat(16), '--attendu=1', '--par=moi']).erreur !== undefined], [true, true, true, true]);
        const ok = arg(['--base=x', '--seau=' + 'a'.repeat(16), '--attendu=2', '--par=moi', '--minutes=45']);
        H.v('7. CLI : arguments valides (attendu entier, minutes 45)', [ok.attendu, ok.minutes, ok.par], [2, 45, 'moi']);
        H.v('7. CLI : minutes par défaut 30', arg(['--base=x', '--seau=' + 'a'.repeat(16), '--attendu=2', '--par=moi']).minutes, 30);
        const sorties = [];
        const code0 = await R.lancerCLI(['--base=test_scratch', '--seau=' + 'a'.repeat(16), '--attendu=1', '--par=moi'], { env: {}, connecter: async () => ({ colFn: n => db.col(n), fermer: async () => { } }), journal: l => sorties.push(l) });
        H.v('7. CLI : sans MONGODB_ESSAI_URI, refus (code 1) avant toute connexion', code0, 1);
    });

    H.bilan();
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
