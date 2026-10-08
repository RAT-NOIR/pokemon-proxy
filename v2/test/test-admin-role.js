'use strict';
// B4.3 — le rôle administrateur : posé par script, jamais par une route. La preuve porte sur ce que le cas redouté n'a PAS :
// aucune route montée ne laisse un compte avec `role` après qu'on le lui ait demandé.
const fs = require('fs');
const path = require('path');
const express = require('express');
const H = require('./_harnais');
const M = require('../modeles');
const { col } = require('../db');
const admin = require('../admin/poser-role');

const RACINE_V2 = path.join(__dirname, '..');

// Le détecteur d'écriture de `role` : une occurrence de `role` précédée (dans la même instruction) d'un verbe d'écriture Mongo.
function ecritRole(src) {
    const sansCommentaires = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const re = /\brole\b/g; let m;
    while ((m = re.exec(sansCommentaires))) {
        const avant = sansCommentaires.slice(Math.max(0, m.index - 220), m.index);
        const derniereInstruction = avant.split(';').pop();
        if (/\$set|\$setOnInsert|\$unset|insertOne|insertMany|replaceOne|updateOne|updateMany|findOneAndUpdate|findOneAndReplace|bulkWrite/.test(derniereInstruction)) return true;
    }
    return false;
}
function fichiersJs(dossier, sortie = []) {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
        const p = path.join(dossier, e.name);
        if (e.isDirectory()) { if (e.name !== 'test' && e.name !== 'node_modules') fichiersJs(p, sortie); } else if (e.name.endsWith('.js')) sortie.push(p);
    }
    return sortie;
}
const lister = router => router.stack.flatMap(l => l.route
    ? Object.keys(l.route.methods).filter(m => ['post', 'delete', 'put', 'patch'].includes(m)).map(m => ({ methode: m.toUpperCase(), chemin: l.route.path }))
    : (l.handle && l.handle.stack ? lister(l.handle).map(r => ({ ...r, chemin: (l.regexp.source.includes('^\\/') ? '' : '') + r.chemin })) : []));

(async () => {
    await H.ouvrirBac('test-admin-role.js'); await M.creerIndex();
    const comptes = col('comptes');
    const email = 'quentin.test@example.org', emailCle = 'quentin.test@example.org';
    await comptes.insertOne({ email, emailCle, verifie: true });

    // 1. la fonction
    let r = await admin.poserRole(emailCle, 'administrateur');
    H.v('1. poserRole(administrateur) => modifie:true', r.modifie, true);
    H.v('   le champ est posé en base', (await comptes.findOne({ emailCle })).role, 'administrateur');
    r = await admin.poserRole(emailCle, 'aucun');
    H.v('   poserRole(aucun) => modifie:true', r.modifie, true);
    H.v('   le champ est RETIRÉ (absent, pas "aucun")', 'role' in (await comptes.findOne({ emailCle })), false);
    r = await admin.poserRole('inconnu@example.org', 'administrateur');
    H.v('   e-mail inconnu => compte-inconnu', r, { modifie: false, raison: 'compte-inconnu' });
    H.v('   ... et aucun compte créé', await comptes.countDocuments({}), 1);
    for (const mauvais of ['Administrateur', 'admin', 'superadmin', '', null, undefined, { $ne: 1 }]) {
        let leve = false; try { await admin.poserRole(emailCle, mauvais); } catch { leve = true; }
        H.vrai(`   rôle hors liste fermée refusé (lève) : ${JSON.stringify(mauvais)}`, leve);
    }
    let leveFiltre = false; try { await admin.poserRole({ $ne: null }, 'administrateur'); } catch { leveFiltre = true; }
    H.vrai('   emailCle non-chaîne (opérateur Mongo) refusé : jamais un filtre', leveFiltre);
    H.v('   aucun rôle posé par ces refus', await comptes.countDocuments({ role: { $exists: true } }), 0);

    // la CLI : arguments, production, masquage
    const sorties = []; let connexions = 0;
    const deps = { connecter: async () => { connexions++; return 'test_scratch'; }, ecrire: s => sorties.push(s) };
    let code = await admin.main(['--base=test_scratch', `--email=${email}`, '--role=administrateur'], deps);
    const imprime = sorties.join('\n');
    H.v('   CLI : code de sortie 0', code, 0);
    H.vrai('   CLI : l\'adresse est MASQUÉE (ni entière ni son local-part)', imprime.length > 0 && !imprime.includes(email) && !imprime.includes('quentin.test'));
    H.v('   CLI : le compte a bien le rôle', (await comptes.findOne({ emailCle })).role, 'administrateur');
    sorties.length = 0;
    code = await admin.main(['--base=test_scratch', '--email=nobody@example.org', '--role=administrateur'], deps);
    H.v('   CLI : e-mail inconnu => code 1', code, 1);
    code = await admin.main(['--base=test_scratch', `--email=${email}`, '--role=root'], deps);
    H.v('   CLI : rôle invalide => code 1', code, 1);
    connexions = 0;
    code = await admin.main(['--base=test', `--email=${email}`, '--role=administrateur'], deps);
    H.v('   CLI : --base=test sans --confirmer-production => refus avant toute connexion', [code, connexions], [1, 0]);
    code = await admin.main([`--email=${email}`, '--role=administrateur'], deps);
    H.v('   CLI : sans --base => refus (on ne devine pas)', [code, connexions], [1, 0]);
    const demandes = []; const depsProd = { ...deps, connecter: async opts => { demandes.push(opts); throw new Error('arrêt du banc : pas de connexion réelle'); } };
    await admin.main(['--base=test', '--confirmer-production', `--email=${email}`, '--role=aucun'], depsProd).catch(() => 0);
    H.v('   CLI : --base=test confirmé => connecterMongo({ecrit:true, confirmationProduction:true})', demandes.map(d => [d.ecrit, d.confirmationProduction]), [[true, true]]);
    await admin.poserRole(emailCle, 'aucun');

    // 2. aucune route v2 ne pose `role`
    const v2 = require('../index');
    const app = express(); app.use(express.json());
    v2.monter(app, {}, { RM_API_V2: '1', MONGODB_BASE: 'test_scratch' });
    const routeurV2 = app._router.stack.find(l => l.name === 'router');
    const routes = routeurV2 ? lister(routeurV2.handle) : [];
    // détecteur de contrôle : une route FAUTIVE (copie le corps dans $set) doit être attrapée par la même procédure
    const fautive = express(); fautive.use(express.json());
    fautive.post('/api/compte/mauvais', async (req, res) => { await col('comptes').updateOne({ emailCle }, { $set: req.body.$set || req.body }); res.json({ ok: true }); });
    const parcourir = async (application, liste) => {
        const s = await H.serveur(application); let n = 0;
        for (const rt of liste) for (const corps of [{ role: 'administrateur' }, { $set: { role: 'administrateur' } }]) {
            await fetch(s.url + rt.chemin.replace(/:[A-Za-z]+/g, 'x'), { method: rt.methode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) }).catch(() => 0); n++;
        }
        await s.fermer(); return n;
    };
    const nFautif = await parcourir(fautive, [{ methode: 'POST', chemin: '/api/compte/mauvais' }]);
    H.v(`   contrôle : une route fautive POSE le rôle (le détecteur sait dire non) [${nFautif} appels]`, (await comptes.findOne({ emailCle })).role, 'administrateur');
    await admin.poserRole(emailCle, 'aucun');
    const nAppels = await parcourir(app, routes);
    console.log(`   dénominateur : ${routes.length} routes POST/DELETE/PUT/PATCH montées x 2 corps = ${nAppels} appels`);
    H.v('2. aucun compte n\'a de rôle après tous les appels', await comptes.countDocuments({ role: { $exists: true } }), 0);
    if (!routes.length) console.log('   ⚠️ 0 route montée dans ce worktree (les lots B2/B3/B1… arrivent à l\'intégration) : ce banc DOIT être relancé alors, il compte alors N routes.');

    // 3. grep : `role` n'est écrit que dans admin/poser-role.js et modeles.js
    H.vrai('3. le détecteur attrape un $set de role', ecritRole("await c.updateOne({a:1}, { $set: { role: 'administrateur' } });"));
    H.vrai('   ... un insertOne avec role', ecritRole("await c.insertOne({ email, role: 'administrateur' });"));
    H.vrai('   ... et ne crie pas sur une lecture', !ecritRole("const ok = compte.role === 'administrateur'; const x = await c.findOne({ role: 'administrateur' });"));
    const fichiers = fichiersJs(RACINE_V2); const autorises = new Set(['admin/poser-role.js', 'modeles.js']);
    const fautifs = fichiers.filter(f => !autorises.has(path.relative(RACINE_V2, f).replace(/\\/g, '/')) && ecritRole(fs.readFileSync(f, 'utf8')));
    console.log(`   dénominateur : ${fichiers.length} fichiers v2 (hors test) examinés`);
    H.v('   aucun autre fichier v2 n\'écrit `role`', fautifs.map(f => path.relative(RACINE_V2, f)), []);
    H.vrai('   poser-role.js, lui, écrit bien `role` (le détecteur le voit)', ecritRole(fs.readFileSync(path.join(RACINE_V2, 'admin', 'poser-role.js'), 'utf8')));

    // 5. MOTIFS (lot B3) : testé si le module existe, sinon dit en attente — jamais compté comme réussi
    let motifs = null; try { motifs = require('../argent/ledger').MOTIFS; } catch { /* B3 pas encore intégré */ }
    if (Array.isArray(motifs) || (motifs && typeof motifs === 'object')) {
        const liste = Array.isArray(motifs) ? motifs : Object.values(motifs);
        H.vrai('5. MOTIFS contient administrateur', liste.includes('administrateur'));
        H.vrai('   MOTIFS ne contient PAS code-maitre', !liste.includes('code-maitre'));
    } else console.log('   ⏳ 4 et 5 (B3.2 : débit administrateur sans décrément ; MOTIFS) : argent/ledger.js absent de ce worktree, à rejouer à l\'intégration — NON comptés.');

    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
