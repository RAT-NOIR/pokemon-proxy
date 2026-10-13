// node test-recepteur-pikaqian-promo.js — LOT PQ-PROMO (2026-10-13), côté RÉCEPTEUR : une page promo acceptée par des déclarations fermées, et le DIAGNOSTIC de tout refus de page.
// Aucun réseau extérieur : un serveur sur un port ÉPHÉMÈRE de 127.0.0.1, des pages et une table FABRIQUÉES par le banc (codes, dossiers et titres inventés : pikaqian-sets.json n'en porte aucun).
// PK_RECEPTEUR (rouge-recepteur-pikaqian.js) : un récepteur MUTANT à tester à la place du vrai.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const sharp = require('sharp');
const R = require(process.env.PK_RECEPTEUR ? path.resolve(process.env.PK_RECEPTEUR) : './recepteur-pikaqian');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tuile = (n, codeTuile, dossier, num, nom) => `<a class="w-full group" data-discover="true" href="/cards/${UUID(n)}"><div class="x"><img alt="${nom}" src="https://images.pikaqian.com/${dossier}/${UUID(n)}.webp" loading="lazy"/></div><h2 class="t">${nom}</h2><p class="font-mono text-xs">${codeTuile}<!-- --> · ${num}</p></a>`;
const page = (h1, ...t) => `<!DOCTYPE html><html><head><title>${h1 ?? 'Set'} | PikaQian</title></head><body>${h1 == null ? '' : `<h1>${h1}</h1><p>701 cartes</p>`}${t.join('')}</body></html>`;
const trois = (code = 'code-banc', dossier = 'dossier-banc') => [tuile(1, code, dossier, '001', 'Pikachu'), tuile(2, code, dossier, '002', 'Raichu'), tuile(3, code, dossier, '003', 'Pichu')];

const ligne = (slug, codePk, extra = {}) => ({ slug, code: slug.toUpperCase(), codePk, langue: 'zh-hans', tirage: 'zh-hans', trous: 10, tuiles: null, mesure: 'ni ouverte ni appariée', site: 'pikaqian', ...extra });
const DECL = { mesure: 'valeurs fabriquées par le banc', tuiles: 3, codesTuiles: ['code-banc'], dossiersImages: ['dossier-banc'], titrePk: 'Titre du banc' };
const TABLE = [ligne('A', 'promo-sv-p', DECL), ligne('B', 'promo-s-p', { ...DECL, codesTuiles: ['code-autre'], dossiersImages: ['dossier-autre'], titrePk: 'Autre titre' }), ligne('C', 'promo-m-p')];
const TABLE_INCOMPLETE = [ligne('A', 'promo-sv-p', { ...DECL, tuiles: null })];
const url = c => `https://pikaqian.com/sets/${c}`;
const BON = { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE };

function envoyer(port, chemin, corps) {
    return new Promise(resolve => {
        const donnees = JSON.stringify(corps);
        const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: chemin, headers: { ...BON, 'Content-Length': Buffer.byteLength(donnees) } }, res => {
            const m = []; res.on('data', c => m.push(c));
            res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(m).toString('utf8')); } catch { } resolve({ status: res.statusCode, json: j }); });
        });
        req.on('error', e => resolve({ status: 0, erreur: e.code || e.message }));
        req.write(donnees); req.end();
    });
}

(async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'recepteur-promo-'));
    const dossier = path.join(base, 'apprises'), dossierImages = path.join(base, 'passif'), dossierRefusees = path.join(base, 'refusees');
    const journal = [];
    const lance = (table = TABLE, extra = {}) => R.demarrer({ racine: os.tmpdir(), port: 0, dossier, dossierImages, dossierRefusees, table, journal: m => journal.push(m), ...extra });
    const fiches = () => fs.existsSync(dossier) ? fs.readdirSync(dossier).filter(n => n.endsWith('.json')).sort() : [];
    const refusees = () => fs.existsSync(dossierRefusees) ? fs.readdirSync(dossierRefusees).sort() : [];
    const refuseesM = () => refusees().filter(n => n.startsWith('promo-m-p--'));
    const srv = await lance();
    try {
        // ── ce que la garde AUTORISE : la page promo, sous les codes et le titre déclarés
        let r = await envoyer(srv.port, '/apprendre', { url: url('promo-sv-p'), html: page('Titre du banc', ...trois()) });
        verifier('page promo déclarée (titre exact, 3 tuiles aux codes déclarés, 3 relevées) : 200', [r.status, r.json?.ok, r.json?.tuilesLues, r.json?.tuilesAuCode], [200, true, 3, 3]);
        const nom = r.json?.fichier;
        const f = JSON.parse(fs.readFileSync(path.join(dossier, nom), 'utf8'));
        verifier('… la fiche écrite porte le titre lu (pour que le plan et l\'import rejugent la page sans la recharger)', [f.code, f.titre], ['promo-sv-p', 'Titre du banc']);
        verifier('… et aucun fichier de diagnostic n\'est écrit pour une page acceptée', refusees().length, 0);

        // ── ce qu'elle REFUSE, chaque refus pris SEUL : rien d'écrit dans les fiches
        const avant = fiches().length;
        const refus = async (nomCas, corps, motif) => {
            const x = await envoyer(srv.port, '/apprendre', corps);
            verifier(`${nomCas} : refusé (422, motif ${motif}), aucune fiche écrite`, [x.status, motif.test(x.json?.motif || ''), fiches().length === avant], [422, true, true]);
            return x;
        };
        await refus('titre différent', { url: url('promo-sv-p'), html: page('Un autre titre', ...trois()) }, /titre/);
        await refus('aucun titre lu', { url: url('promo-sv-p'), html: page(null, ...trois()).replace(/<title>[^<]*<\/title>/, '') }, /titre/);
        await refus('moins de tuiles que relevé (2 pour 3)', { url: url('promo-sv-p'), html: page('Titre du banc', ...trois().slice(0, 2)) }, /page incomplète : 2 tuiles lues, 3 relevées/);
        await refus('majorité sur un code non déclaré', { url: url('promo-sv-p'), html: page('Titre du banc', ...trois('code-inconnu')) }, /ne désigne pas ce set/);
        await refus('code déclaré pour un AUTRE set (la page promo-s-p porte les codes de promo-sv-p)', { url: url('promo-s-p'), html: page('Autre titre', ...trois('code-banc', 'dossier-autre')) }, /ne désigne pas ce set/);
        await refus('rien de déclaré (promo-m-p) : les tuiles ne portent pas le code de l\'adresse', { url: url('promo-m-p'), html: page('Titre du banc', ...trois()) }, /ne désigne pas ce set/);

        // ── le DIAGNOSTIC d'un refus de page
        const nRef = refuseesM().length, dejaM = new Set(refuseesM());
        const nouveauM = () => refuseesM().filter(n => !dejaM.has(n)).sort()[0];
        const html422 = page('Promo SV-P', ...trois('code-inconnu', 'dossier-ailleurs'));
        const d1 = await envoyer(srv.port, '/apprendre', { url: url('promo-m-p'), html: html422 });
        const dg = d1.json?.diagnostic;
        verifier('un refus de page (GARDE:verdict) renvoie un diagnostic : codes lus, dossiers des images, titre (h1, title), annonce du nombre de cartes', [d1.status, dg?.codes?.[0], dg?.dossiers?.[0], dg?.h1, dg?.title, dg?.annonces?.some(a => /701/.test(a))], [422, { code: 'code-inconnu', n: 3 }, { dossier: 'dossier-ailleurs', n: 3 }, 'Promo SV-P', 'Promo SV-P | PikaQian', true]);
        verifier('… avec des lignes prêtes à afficher (le userscript n\'a rien à reformater)', [Array.isArray(dg?.lignes), dg?.lignes?.some(l => /code-inconnu×3/.test(l)), dg?.lignes?.some(l => /dossier-ailleurs×3/.test(l))], [true, true, true]);
        verifier('… et la réponse ne porte ni HTML ni tuile complète ni adresse d\'image', [JSON.stringify(d1.json).includes('<html'), JSON.stringify(d1.json).includes(UUID(1)), JSON.stringify(d1.json).includes('images.pikaqian.com')], [false, false, false]);
        verifier('le journal du récepteur porte la répartition des codes et des dossiers', [journal.some(l => /code-inconnu×3/.test(l)), journal.some(l => /dossier-ailleurs×3/.test(l))], [true, true]);
        verifier('un fichier de diagnostic refusees/<code>--<date>.json est écrit', [refuseesM().length - nRef, /^promo-m-p--\d{8}T\d{6}Z(-\d+)?\.json$/.test(nouveauM() || '')], [1, true]);
        const fich = JSON.parse(fs.readFileSync(path.join(dossierRefusees, nouveauM()), 'utf8'));
        verifier('… il porte le code, l\'adresse, le motif, les comptes et le diagnostic', [fich.code, fich.url, /ne désigne pas ce set/.test(fich.motif), fich.tuilesLues, fich.diagnostic?.codes?.[0]], ['promo-m-p', url('promo-m-p'), true, 3, { code: 'code-inconnu', n: 3 }]);
        const brutFich = fs.readFileSync(path.join(dossierRefusees, nouveauM()), 'utf8');
        verifier('… sans aucun HTML, aucune tuile complète, aucun identifiant de carte', [brutFich.includes('<'), brutFich.includes(UUID(1))], [false, false]);
        const contenuAvant = brutFich, nomAvant = nouveauM();
        await envoyer(srv.port, '/apprendre', { url: url('promo-m-p'), html: html422 });
        verifier('le même refus une seconde fois (même seconde) : un fichier de plus, le premier JAMAIS écrasé', [refuseesM().length - nRef, fs.readFileSync(path.join(dossierRefusees, nomAvant), 'utf8') === contenuAvant], [2, true]);
        const nApres = refusees().length;
        await envoyer(srv.port, '/apprendre', { url: 'https://exemple.test/sets/promo-m-p', html: html422 });
        verifier('un refus d\'ADRESSE n\'écrit pas de diagnostic', refusees().length, nApres);
        // PQ-PROMO2 (décision du testeur : « un diagnostic au refus ancres > tuiles ») : la page PARTIELLE écrit désormais son fichier de diagnostic, comme le refus du verdict (test-pikaqian-promo2.js le détaille)
        await envoyer(srv.port, '/apprendre', { url: url('promo-sv-p'), html: page('Titre du banc', ...trois(), `<a href="/cards/${UUID(9)}">en cours</a>`) });
        verifier('un refus de page PARTIELLE (ancres > tuiles) écrit un diagnostic (lot PQ-PROMO2) ; un refus d\'adresse, non', refusees().length - nApres, 1);

        // ── les IMAGES : le dossier déclaré passe, un dossier non déclaré est refusé par image
        const png = (await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).png().toBuffer()).toString('base64');
        const mixte = page('Titre du banc', tuile(1, 'code-banc', 'dossier-banc', '001', 'Pikachu'), tuile(2, 'code-banc', 'dossier-banc', '002', 'Raichu'), tuile(3, 'code-banc', 'dossier-inconnu', '003', 'Pichu'));
        const a2 = await envoyer(srv.port, '/apprendre', { url: url('promo-sv-p'), html: mixte });
        verifier('une page dont une tuile range son image dans un dossier non déclaré est acceptée (la majorité des tuiles et le titre sont bons)', a2.status, 200);
        const im = (n, dossierImg, num, nomCarte) => ({ id: UUID(n), src: `https://images.pikaqian.com/${dossierImg}/${UUID(n)}.webp`, nom: nomCarte, numero: num, voie: 'canvas', b64: png });
        const ri = await envoyer(srv.port, '/images', { fichier: a2.json?.fichier, sansImage: 0, images: [im(1, 'dossier-banc', '001', 'Pikachu'), im(3, 'dossier-inconnu', '003', 'Pichu')] });
        verifier('/images : l\'image du dossier déclaré est reçue, celle du dossier non déclaré est refusée avec son motif', [ri.status, ri.json?.recues, ri.json?.refusees?.map(x => x.id), /dans le dossier du set|dossier/.test(ri.json?.refusees?.[0]?.motif || '')], [200, 1, [UUID(3)], true]);
        verifier('… le fichier reçu est rangé sous le code du set (<dossierImages>/promo-sv-p/)', fs.existsSync(path.join(dossierImages, 'promo-sv-p')) && fs.readdirSync(path.join(dossierImages, 'promo-sv-p')).some(n => n.startsWith(UUID(1))), true);
        const ri2 = await envoyer(srv.port, '/images', { fichier: a2.json?.fichier, sansImage: 0, images: [{ ...im(1, 'dossier-banc', '001', 'Pikachu'), src: `https://images.pikaqian.com/dossier-banc/${UUID(2)}.webp` }] });
        verifier('/images : une adresse qui ne porte pas l\'identifiant de la tuile est refusée', [ri2.json?.recues, ri2.json?.refusees?.length], [0, 1]);
    } finally { await srv.fermer(); }

    // ── une déclaration incomplète refuse la page (titrePk sans tuiles)
    const srvI = await lance(TABLE_INCOMPLETE);
    const inc = await envoyer(srvI.port, '/apprendre', { url: url('promo-sv-p'), html: page('Titre du banc', ...trois()) });
    verifier('table dont la ligne déclare titrePk SANS tuiles : la page est refusée (422, déclaration incomplète)', [inc.status, /incompl/.test(inc.json?.motif || '')], [422, true]);
    await srvI.fermer();

    // ── le dossier des diagnostics est jugé comme les autres : sous la racine autorisée, jamais dans le dépôt
    let leve = null; try { await R.demarrer({ racine: os.tmpdir(), port: 0, dossier, dossierImages, dossierRefusees: path.join(os.homedir(), 'hors-racine-du-banc', 'refusees'), table: TABLE, journal: () => { } }); } catch (e) { leve = e.message; }
    verifier('dossier des diagnostics hors de la racine autorisée : démarrage refusé', /racine autorisée/.test(leve || ''), true);
    if (!process.env.PK_RECEPTEUR) {   // (un mutant vit dans un dossier temporaire : « le dépôt » n'y a pas de sens)
        leve = null; try { await R.demarrer({ racine: os.tmpdir(), port: 0, dossier, dossierImages, dossierRefusees: path.join(__dirname, 'refusees-test'), table: TABLE, journal: () => { } }); } catch (e) { leve = e.message; }
        verifier('dossier des diagnostics dans le dépôt : démarrage refusé, rien créé', [/dépôt/.test(leve || ''), fs.existsSync(path.join(__dirname, 'refusees-test'))], [true, false]);
    }
    // l'écriture elle-même se juge au moment d'écrire : hors de la racine, rien n'est créé
    // (la racine du banc et le « dehors » sont deux sous-dossiers du dossier temporaire du banc : un mutant qui écrirait quand même ne sort pas du dossier que le banc supprime)
    const racineBanc = path.join(base, 'racine'), dehors = path.join(base, 'dehors');
    fs.mkdirSync(racineBanc);
    verifier('ecrireRefusee hors de la racine autorisée : rien d\'écrit, rien de créé (null)', [R.ecrireRefusee(dehors, { code: 'promo-sv-p', le: new Date().toISOString() }, { racine: racineBanc }), fs.existsSync(dehors)], [null, false]);
    verifier('ecrireRefusee sous la racine : écrit, et ne réécrit jamais le même nom', (() => { const f = { code: 'promo-sv-p', le: '2026-10-13T10:00:00.000Z' }; const a = R.ecrireRefusee(path.join(racineBanc, 'r'), f, { racine: racineBanc }), b = R.ecrireRefusee(path.join(racineBanc, 'r'), f, { racine: racineBanc }); return [a, b]; })(), ['promo-sv-p--20261013T100000Z.json', 'promo-sv-p--20261013T100000Z-2.json']);
    // par défaut, le dossier des diagnostics est le voisin « refusees » du dossier de production, et un voisin du dossier donné ailleurs
    verifier('défaut : pikaqian\\refusees pour le dossier de production', R.dossierRefuseesParDefaut(R.DOSSIER_DEFAUT), 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pikaqian\\refusees');
    verifier('défaut : un dossier ailleurs a son voisin <dossier>-refusees (les bancs n\'écrivent jamais en production)', R.dossierRefuseesParDefaut(path.join(os.tmpdir(), 'x')), `${path.resolve(path.join(os.tmpdir(), 'x'))}-refusees`);

    fs.rmSync(base, { recursive: true, force: true });
    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ banc interrompu :', e); process.exit(1); });
