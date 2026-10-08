'use strict';
const H = require('./_harnais');
const db = require('../db');
const M = require('../modeles');

(async () => {
    await H.ouvrirBac('test-modeles.js');
    // la garde SAIT dire non : sans index, tout est manquant
    const avant = await M.verifierIndex();
    H.vrai('sans index créé, verifierIndex liste des manquants', avant.manquants.length === M.INDEX.length);
    await M.creerIndex();
    const apres = await M.verifierIndex();
    H.v('après creerIndex, rien ne manque', apres.manquants, []);
    // l'unicité de l'e-mail normalisé est RÉELLE
    const c = M.nouveauCompte({ email: 'A.B@exemple.fr', emailCle: 'a.b@exemple.fr', motDePasse: { algo: 'scrypt' } });
    await db.col('comptes').insertOne(c);
    let code = null; try { await db.col('comptes').insertOne(M.nouveauCompte({ email: 'a.b@exemple.fr', emailCle: 'a.b@exemple.fr', motDePasse: {} })); } catch (e) { code = e.code; }
    H.v('second compte de même emailCle => 11000', code, 11000);
    // les TTL existent (expireAfterSeconds: 0 sur expireLe)
    for (const nom of ['codes_liaison', 'sessions', 'liens_email', 'annonces', 'idempotence', 'limites', 'mouvements', 'analyses', 'banc_lignes']) {
        const idx = await db.col(nom).indexes();
        H.vrai(`TTL sur ${nom}`, idx.some(i => i.key.expireLe === 1 && i.expireAfterSeconds === 0));
    }
    // cleIdempotence : unique PARTIEL (deux mouvements sans clé coexistent, deux avec la même clé non)
    await db.col('mouvements').insertMany([{ x: 1 }, { x: 2 }]);
    await db.col('mouvements').insertOne({ cleIdempotence: 'k1' });
    let dup = null; try { await db.col('mouvements').insertOne({ cleIdempotence: 'k1' }); } catch (e) { dup = e.code; }
    H.v('cleIdempotence dupliquée => 11000', dup, 11000);
    // fabriques
    const i = M.nouvelleInstallation({ jetonEmpreinte: 'h', essais: 3, libelle: 'Chrome · Windows' });
    H.v('installation neuve non liée', [i.compteId, i.essais, i.libelle], [null, 3, 'Chrome · Windows']);
    await H.fermerBac();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
