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
    const charge = donnees.charges.find(c => String(c.lecture.name).includes(cible)) || donnees.charges[0];
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
