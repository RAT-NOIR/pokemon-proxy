// Capture la REPONSE REELLE de /api/identifier sur une charge du verrou, telle quelle.
// Hors ligne, aucun appel IA, ecritures confinees a test_scratch.
// USAGE : node capture-reponse.js [nomDeLaCharge]
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { demarrer, appeler } = require('./verrou/serveur');

const FICHIER_CHARGES = path.join(__dirname, 'verrou', 'charges.json');
const JETON = process.env.JETON_API || 'jeton-verrou';
const cible = process.argv[2] || 'Vileplume';

(async () => {
    const donnees = JSON.parse(fs.readFileSync(FICHIER_CHARGES, 'utf8'));
    // ⚠️ ÉCHEC BRUYANT SUR UNE CLÉ INCONNUE. La version d'origine retombait sur
    // `donnees.charges[0]` : demander « Light Togetic » rendait la réponse de Gardevoir ex,
    // sans un mot. Un outil de VÉRIFICATION qui répond autre chose que ce qu'on lui demande
    // est pire qu'un outil absent — on croit avoir vérifié, et c'est la capture qui part
    // en passation. Le repli silencieux est exactement le défaut qu'on traque partout
    // ailleurs dans ce projet.
    const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const charge = donnees.charges.find(c => norm(c.lecture.name).includes(norm(cible)));
    if (!charge) {
        console.error(`\n❌ Aucune charge ne correspond à « ${cible} ».`);
        console.error(`   Les charges disponibles sont :`);
        for (const c of donnees.charges) {
            console.error(`     ${String(c.lecture.name).padEnd(20)} — ${c.cellule}`);
        }
        console.error(`\n   node capture-reponse.js "<nom exact ou fragment>"`);
        process.exit(1);
    }
    const srv = await demarrer(path.join(__dirname, 'verrou', 'faux-reseau.js'), {
        VERROU_CHARGES: FICHIER_CHARGES, JETON_API: JETON, OPENROUTER_API_KEY: ''
    });
    if (!await srv.attendreMongo()) { console.error('Mongo non connecté'); srv.enfant.kill(); process.exit(1); }

    const r = await appeler(srv.port, 'POST', '/api/identifier', {
        userId: 'capture-reponse', imageUrls: [charge.imageUrl], title: null, vintedEtat: null
    }, JETON);

    console.log(`charge : "${charge.lecture.name}" (${charge.cellule})`);
    console.log(`status : ${r.status}\n`);
    // ANONYMISATION : on retire les URL d'annonce et d'image, rien d'autre. La FORME doit
    // rester exactement celle que l'extension recevra.
    const j = r.json;
    const anonymiser = o => {
        if (o && typeof o === 'object') {
            for (const k of Object.keys(o)) {
                if (/url/i.test(k) && typeof o[k] === 'string') o[k] = '<URL retirée>';
                else anonymiser(o[k]);
            }
        }
        return o;
    };
    console.log(JSON.stringify(anonymiser(j), null, 2));

    // ════════════════════════════════════════════════════════════════════════
    // LA PREUVE QUI COMPTE : classement[0] EST-IL LE PRODUIT RETENU ?
    // ════════════════════════════════════════════════════════════════════════
    // La réponse ne contient PAS l'idProduct du gagnant : l'extension doit le lire dans
    // `classement[0]`. Si une décision tardive changeait le gagnant sans réordonner le
    // classement, l'extension tarifierait un AUTRE produit — avec un verdict prononcé si
    // la réserve est forte. On ne le déduit donc pas, on le VÉRIFIE : le serveur vient
    // d'écrire une ligne de journal dans test_scratch avec l'idProduct RÉELLEMENT retenu.
    try {
        const mongoose = require('mongoose');
        const bac = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
        // La ligne que ce scan vient d'écrire (fire-and-forget : on laisse le temps).
        await new Promise(r => setTimeout(r, 1500));
        const ligne = await bac.collection('journal_scans')
            .find({ userId: 'capture-reponse' }).sort({ le: -1 }).limit(1).next();
        console.log('\n── PREUVE : classement[0] EST-IL LE GAGNANT ? ──');
        if (!ligne) {
            console.log('   ⚠️ aucune ligne de journal — preuve IMPOSSIBLE, ne pas conclure');
        } else {
            const retenu = ligne.idProduct ?? null;
            const premier = j?.classement?.[0]?.idProduct ?? null;
            const annonce = j?.carte?.idProduct ?? null;
            // LES TROIS DOIVENT COÏNCIDER. `carte.idProduct` est le champ que l'extension
            // doit lire ; `classement[0]` est l'ordre du tableau ; le journal est ce que le
            // serveur a RÉELLEMENT retenu. Si les trois ne sont pas égaux, l'un des deux
            // contrats ment, et l'extension tariferait un autre produit — avec un verdict
            // prononcé quand la réserve est forte.
            console.log(`   idProduct retenu (journal) : ${retenu}`);
            console.log(`   carte.idProduct (annoncé)  : ${annonce}`);
            console.log(`   classement[0].idProduct    : ${premier}`);
            // ⚠️ RIEN À COMPARER N'EST PAS UNE DIVERGENCE. Sur un refus, les trois valeurs
            // sont nulles — aucun produit n'a été retenu, c'est tout l'objet du refus — et
            // l'ancienne condition (`retenu != null && ...`) rendait FAUX, donc imprimait
            // « DIVERGENCE — l'extension tarifierait le mauvais produit ». Un outil de
            // vérification qui crie au loup fait chasser des fantômes, et la fois suivante
            // on ne le croit plus quand il a raison. TROIS ÉTATS, PAS DEUX : c'est le même
            // premier principe que partout ailleurs ici — « je ne sais pas » n'est pas
            // « je sais que non ».
            if (retenu == null && premier == null && annonce == null) {
                const refus = j && j.success === false;
                console.log(`   ⃝ SANS OBJET — aucun produit retenu${refus ? ' (refus)' : ''} : les trois valeurs sont nulles, il n'y a rien à comparer.`);
                // Ce que le refus DOIT porter, lui, se vérifie : le marqueur de remboursement.
                if (refus) {
                    console.log(`   rembourse (réponse)  : ${j.rembourse === undefined ? '❌ ABSENT' : j.rembourse}`);
                    console.log(`   motifRefus (réponse) : ${j.motifRefus === undefined ? '❌ ABSENT' : j.motifRefus}`);
                    console.log(`   natureRefus (réponse): ${j.natureRefus === undefined ? '❌ ABSENT — l\'extension ne peut pas distinguer un refus délibéré d\'une panne' : j.natureRefus}`);
                    // LE MOTIF DE LA RÉPONSE DOIT ÊTRE CELUI DU JOURNAL. Ce sont deux écritures
                    // distinctes du même fait ; si elles divergent, l'une des deux ment et on ne
                    // saurait pas laquelle. Le journal reste la référence historique.
                    const accord = j.motifRefus === ligne.motifEchec;
                    console.log(`   motifEchec (journal) : ${ligne.motifEchec ?? '—'} · rembourse=${ligne.rembourse ?? '—'}  ${accord ? '✅ accord' : '❌ DÉSACCORD réponse/journal'}`);
                }
            } else if (retenu != null && retenu === premier && retenu === annonce) {
                console.log('   ✅ LES TROIS COÏNCIDENT — carte.idProduct est le gagnant, et classement[0] aussi');
            } else {
                console.log('   ❌ DIVERGENCE — l\'extension tarifierait le mauvais produit');
            }
            console.log(`   raisonReserve=${ligne.raisonReserve ?? '—'} · niveauReserve=${ligne.niveauReserve ?? '—'} · nbExAequo=${ligne.nbExAequo ?? '—'} · strategieReverse=${ligne.strategieReverse ?? '—'}`);
        }
        // ⚠️ TOUT OUTIL QUI FAIT ÉCRIRE UNE COLLECTION LA VIDE EN SORTANT — la règle est
        // écrite en tête de verrou-avant-push.js. `remboursements` manquait ici aussi, et
        // le relevé le montrait : « capture-reponse 2026-08-10 count=5 », donc AU PLAFOND.
        // Cet outil n'assertait rien sur le remboursement, il n'a donc rien faussé — mais
        // il laissait un compteur saturé derrière lui, sur le même bac que le verrou.
        const rb = await bac.collection('remboursements').deleteMany({ userId: 'capture-reponse' });
        await bac.collection('journal_scans').deleteMany({ userId: 'capture-reponse' });
        await bac.collection('credits').deleteMany({ userId: 'capture-reponse' });
        if (rb.deletedCount) console.log(`   🧹 ${rb.deletedCount} compteur(s) de remboursement supprimé(s).`);
        await bac.close();
    } catch (e) { console.log(`\n   ⚠️ preuve impossible : ${e.message}`); }

    console.log('\n── CLÉS DE PREMIER NIVEAU ──');
    console.log('   ' + Object.keys(j || {}).join(' · '));
    for (const k of Object.keys(j || {})) {
        if (j[k] && typeof j[k] === 'object' && !Array.isArray(j[k])) {
            console.log(`   ${k}.  ` + Object.keys(j[k]).join(' · '));
        }
    }

    try { srv.enfant.send('arret'); } catch (_) { srv.enfant.kill(); }
    setTimeout(() => { try { srv.enfant.kill(); } catch (_) { } process.exit(0); }, 2000);
})();
