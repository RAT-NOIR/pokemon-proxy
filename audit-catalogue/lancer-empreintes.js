'use strict';
// node audit-catalogue/lancer-empreintes.js --cm | --nous | --cm --nous   [--refaire]
//   UV_THREADPOOL_SIZE=8 ; NODE_PATH = node_modules du dépôt principal. Écrit SEULEMENT dans S8\AUDIT\ (garde d'écriture) :
//   cache\empreintes-cm.bin/.json   — l'empreinte de chaque copie locale Cardmarket (CARDMARKET IMAGE, lue, jamais écrite)
//   cache\empreintes-nous.bin/.json — l'empreinte de NOTRE vignette servie, par cleR2
//   cache-nos-vignettes\<sha1>.webp — les vignettes de notre bucket R2 lues UNE fois (reprise : un fichier présent ne se relit pas)
//   progression-<étape>.json        — l'avancement (un calcul de plus de 10 min se lance en arrière-plan)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { indexerDisque } = require('../collecte-cartes/staff-detect-io');
const E = require('./empreinte');
const { ecrireJson, ecrireBinaire, lireJson, sortie, DOSSIER_AUDIT } = require('./ecrire');
const { ouvrirR2Lecture, R2Absent } = require('./lecture-r2');

const args = process.argv.slice(2);
const AUTORISES = ['--cm', '--nous', '--refaire'];
const inconnus = args.filter(a => !AUTORISES.includes(a));
if (inconnus.length || !(args.includes('--cm') || args.includes('--nous'))) { console.error(`argument inconnu ou manquant : ${inconnus.join(' ') || '(aucune étape)'} — autorisés : ${AUTORISES.join(' ')}`); process.exit(2); }
const REFAIRE = args.includes('--refaire');
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');

async function pool(items, n, fn, progres) {
    let i = 0, faits = 0; const t0 = Date.now();
    const ouvrier = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); if (++faits % 2000 === 0 && progres) progres(faits, items.length, (Date.now() - t0) / 1000); } };
    await Promise.all(Array.from({ length: n }, ouvrier));
    return (Date.now() - t0) / 1000;
}
const progresVers = nom => (faits, total, s) => { ecrireJson(`progression-${nom}.json`, { faits, total, secondes: Math.round(s), parSeconde: +(faits / s).toFixed(1), maj: new Date().toISOString() }); console.log(`   ${nom} ${faits}/${total} · ${(faits / s).toFixed(0)}/s`); };

/** Écrit un jeu d'empreintes : .bin (enregistrements de TAILLE octets, dans l'ordre des clés) + .json (clés, dimensions, erreurs). */
function ecrireJeu(nom, cles, infos, tampons) {
    const bin = Buffer.alloc(cles.length * E.TAILLE);
    tampons.forEach((t, i) => { if (t) t.copy(bin, i * E.TAILLE); });
    ecrireBinaire(`cache/${nom}.bin`, bin);
    ecrireJson(`cache/${nom}.json`, { cree: new Date().toISOString(), taille: E.TAILLE, largeur: E.LARGEUR, hauteur: E.HAUTEUR, region: E.REGION, fenetre: E.FENETRE, n: cles.length, cles, infos });
}

(async () => {
    if (args.includes('--cm')) {
        if (!REFAIRE && fs.existsSync(sortie('cache/empreintes-cm.json'))) console.log('cm : déjà fait (--refaire pour recommencer)');
        else {
            const idx = indexerDisque();
            const ids = [...idx.keys()].sort((a, b) => a - b);
            console.log(`CM : ${ids.length} copies locales indexées (idProduct → premier fichier trouvé, comme ecrire-descripteurs.js)`);
            const infos = new Array(ids.length), tampons = new Array(ids.length);
            const s = await pool(ids.map((id, k) => k), 8, async k => {
                try { const r = await E.analyser(await fs.promises.readFile(idx.get(ids[k]))); tampons[k] = r.empreinte; infos[k] = { w: r.w, h: r.h }; }
                catch (e) { infos[k] = { erreur: String(e.message).slice(0, 100) }; }
            }, progresVers('cm'));
            ecrireJeu('empreintes-cm', ids, infos, tampons);
            console.log(`CM : ${ids.length} empreintes en ${s.toFixed(0)} s (${(ids.length / s).toFixed(0)}/s) · illisibles ${infos.filter(x => x.erreur).length}`);
        }
    }
    if (args.includes('--nous')) {
        const produits = lireJson('etat-produits.json');
        // la forme d'un fichier dans une entrée de l'API est { cle, w, h } (decision.js : fichierDe), PAS { cleR2 } : lire `cleR2` ici rendrait zéro clé sur des milliers d'entrées (§41)
        const cles = [...new Set(produits.filter(p => p.copieLocale && p.visuel.entree?.vignette?.cle).map(p => p.visuel.entree.vignette.cle))].sort();
        if (!cles.length) throw new Error('aucune vignette lue dans etat-produits.json : la clé de lecture est fausse');
        console.log(`NOUS : ${cles.length} vignettes distinctes à empreindre (produits servis avec copie locale : ${produits.filter(p => p.copieLocale && p.visuel.entree).length})`);
        if (!REFAIRE && fs.existsSync(sortie('cache/empreintes-nous.json'))) console.log('nous : déjà fait (--refaire pour recommencer)');
        else {
            const r2 = await ouvrirR2Lecture();
            console.log(`R2 : bucket joignable (juridiction ${r2.juridiction}), lecture seule`);
            fs.mkdirSync(sortie('cache-nos-vignettes'), { recursive: true });
            const infos = new Array(cles.length), tampons = new Array(cles.length);
            let lusR2 = 0, octetsR2 = 0, absents = 0;
            const s = await pool(cles.map((c, k) => k), 12, async k => {
                const cle = cles[k], f = sortie(`cache-nos-vignettes/${sha1(cle)}.webp`);
                try {
                    let buf;
                    if (fs.existsSync(f)) buf = fs.readFileSync(f);
                    else { buf = await r2.lire(cle); lusR2++; octetsR2 += buf.length; fs.writeFileSync(f, buf); }
                    const r = await E.analyser(buf); tampons[k] = r.empreinte; infos[k] = { w: r.w, h: r.h, octets: buf.length };
                } catch (e) { if (e instanceof R2Absent) absents++; infos[k] = { erreur: e instanceof R2Absent ? 'absent-du-bucket' : String(e.message).slice(0, 100) }; }
            }, progresVers('nous'));
            ecrireJeu('empreintes-nous', cles, infos, tampons);
            const dossier = sortie('cache-nos-vignettes'); let n = 0, o = 0; for (const x of fs.readdirSync(dossier)) { n++; o += fs.statSync(path.join(dossier, x)).size; }
            console.log(`NOUS : ${cles.length} empreintes en ${s.toFixed(0)} s · lus sur R2 ce passage ${lusR2} (${(octetsR2 / 1048576).toFixed(0)} Mo) · absents du bucket ${absents} · erreurs ${infos.filter(x => x.erreur).length} · cache-nos-vignettes : ${n} fichiers, ${(o / 1048576).toFixed(0)} Mo`);
        }
    }
})().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exit(1); });
