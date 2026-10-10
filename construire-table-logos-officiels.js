// ============================================================
// LA TABLE DES LOGOS OFFICIELS (phase 2) — LISTE-LOGOS-A-CHERCHER.md → collecte-cartes/logos-officiels-table.json
// ============================================================
//   node construire-table-logos-officiels.js --liste=<LISTE-LOGOS-A-CHERCHER.md> --pokecardex=<racine du dépôt principal> --cache-jp=<dl> --cache-fr=<logos-FR>
// Lecture seule, zéro requête. Chaque ligne OFFICIEL / À REGARDER de la phase 1 devient une entrée : le fichier Pokécardex (LU pour comparer, jamais
// collecté ; son empreinte est gardée), le set de la ligne, les URL EXACTES écrites sur la ligne, et — quand la phase 1 l'a téléchargé — l'empreinte du
// fichier qui a été comparé (`cache.sha256`) : la collecte exige le MÊME fichier, sinon elle re-mesure.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lireListe, hoteDe } = require('./collecte-cartes/lire-liste-logos');
const { HOTES_COLLECTE, sourceDe } = require('./collecter-logos-officiels');

const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const lire = f => (f && fs.existsSync(f)) ? fs.readFileSync(f) : null;

// où la phase 1 a rangé le fichier comparé, d'après l'URL de la ligne (aucune URL n'est devinée : on part de celle qui est écrite)
function fichierCache(url, { cacheJp, cacheFr }) {
    const u = new URL(url), base = decodeURIComponent(path.posix.basename(u.pathname));
    if (u.hostname === 'billsarchive.com') return [path.join(cacheJp, 'bills', base), path.join(cacheFr, 'bills-logos', base)].find(fs.existsSync) ?? null;
    if (u.hostname === 'assets.tcgdex.net') { const m = /\/fr\/[^/]+\/([^/]+)\/logo\.(png|webp)$/.exec(u.pathname); return m ? [path.join(cacheFr, 'tcgdex', `${m[1]}.png`), path.join(cacheFr, 'tcgdex', `${m[1]}.${m[2]}`)].find(fs.existsSync) ?? null : null; }
    if (u.hostname === 'web.archive.org' || u.hostname === 'archives.bulbagarden.net') return path.join(cacheJp, 'bulba', base);
    return null;
}

if (require.main === module) {
    const [liste, racine, cacheJp, cacheFr] = [arg('liste'), arg('pokecardex'), arg('cache-jp'), arg('cache-fr')];
    if (![liste, racine, cacheJp, cacheFr].every(Boolean)) { console.error('❌ --liste= --pokecardex= --cache-jp= --cache-fr= requis'); process.exit(2); }
    const texte = fs.readFileSync(liste, 'utf8');
    const L = lireListe(texte).filter(x => x.verdict === 'OFFICIEL' || x.verdict === 'À REGARDER');
    const lignes = [];
    for (const x of L) {
        const chemin = path.join(racine, x.part === 'FR' ? x.fichier : `${x.fichier}.png`);
        const b = lire(chemin);
        if (!b) throw new Error(`fichier Pokécardex introuvable : ${chemin}`);
        const urlChoisie = x.urls.find(u => HOTES_COLLECTE.includes(hoteDe(u))) ?? null;
        const comparee = urlChoisie ?? x.urls[0] ?? null;
        const fc = comparee ? fichierCache(comparee, { cacheJp, cacheFr }) : null;
        const bc = lire(fc);
        lignes.push({
            part: x.part, fichier: x.part === 'FR' ? x.fichier : `${x.fichier}.png`, pokecardexSha256: sha256(b),
            verdict: x.verdict, set: x.set, setSur: x.setSur, raisonDuSet: x.setBrut.split('·').slice(1).join('·').trim().slice(0, 160),
            cible: x.part === 'FR' ? 'fr' : 'ja',
            langue: x.part === 'FR' ? (/ANGLAIS/.test(x.ligne) ? 'en' : 'fr') : 'ja',
            score: x.score, urls: x.urls, urlChoisie, source: urlChoisie ? sourceDe(urlChoisie) : (x.urls.length ? 'bulbapedia' : null),
            bulbapediaSeule: x.verdict === 'OFFICIEL' && x.urls.length > 0 && !urlChoisie,
            cache: bc ? { fichier: path.basename(fc), sha256: sha256(bc), url: comparee } : null
        });
    }
    const sortie = { genere: new Date().toISOString().slice(0, 10), liste: 'LISTE-LOGOS-A-CHERCHER.md', listeSha256: sha256(Buffer.from(texte)), lignes };
    fs.writeFileSync(path.join(__dirname, 'collecte-cartes', 'logos-officiels-table.json'), JSON.stringify(sortie, null, 1));
    const c = {}; for (const l of lignes) { const k = `${l.part} ${l.verdict}${l.bulbapediaSeule ? ' bulbapedia-seule' : ''}${l.verdict === 'OFFICIEL' && !l.bulbapediaSeule ? (l.set && l.setSur ? ' collectable' : ' set-non-sur') : ''}`; c[k] = (c[k] || 0) + 1; }
    console.log(JSON.stringify(c, null, 1), `· ${lignes.length} lignes · cache connu ${lignes.filter(l => l.cache).length}`);
}
