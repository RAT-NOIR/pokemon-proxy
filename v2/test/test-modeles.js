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
    for (const nom of ['codes_liaison', 'sessions', 'liens_email', 'annonces', 'idempotence', 'limites', 'mouvements', 'analyses']) {   // banc_lignes n'a plus de TTL (B6.4 : la purge est le seul effaceur, objets R2 d'abord) — v2/test/test-banc-effacement.js le prouve
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
    // I1 : la garde compare ce que l'index GARANTIT (clé, unicité, TTL, filtre partiel), pas son nom.
    // Chaque cas fabrique un index de MÊME NOM mais de forme fausse : la garde doit dire NON, et nommer la propriété.
    async function refaire(c, nom, cle, opts) {
        await db.col(c).dropIndex(nom);
        await db.col(c).createIndex(cle, { name: nom, ...opts });
        const r = await M.verifierIndex();
        const ligne = r.manquants.find(m => m.startsWith(`${c}.${nom}`));
        await db.col(c).dropIndex(nom);
        const decl = M.INDEX.find(x => x.c === c && x.opts.name === nom);
        await db.col(c).createIndex(decl.cle, decl.opts);   // rétablit la forme juste pour le cas suivant
        return ligne || null;
    }
    H.vrai('même nom mais NON unique => refusé (comptes_emailCle)', /unique/.test(await refaire('comptes', 'comptes_emailCle', { emailCle: 1 }, {})));
    H.vrai('TTL avec une autre durée => refusé (sessions_ttl)', /expireAfterSeconds/.test(await refaire('sessions', 'sessions_ttl', { expireLe: 1 }, { expireAfterSeconds: 60 })));
    H.vrai('unique SANS filtre partiel => refusé (installations_heritage)', /partialFilterExpression/.test(await refaire('installations', 'installations_heritage', { heriteEmpreinte: 1 }, { unique: true })));
    H.vrai('autre clé sous le même nom => refusé (installations_compte)', /key/.test(await refaire('installations', 'installations_compte', { libelle: 1 }, {})));
    H.v('après rétablissement, rien ne manque', (await M.verifierIndex()).manquants, []);
    await H.fermerBac();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
