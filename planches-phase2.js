// PLANCHES DE LA PHASE 2 — notre visuel contre la copie Cardmarket, un geste par cellule ; puis les PARTAGES (une ligne par entrée : notre visuel, et la copie Cardmarket de CHAQUE produit qu'elle sert).
//   node planches-phase2.js [--sortie=<dossier>]       (lecture seule : l'audit S8, les vignettes en cache, CARDMARKET IMAGE ; n'écrit que dans PHASE2\planches)
// Rien n'est deviné : un côté absent est une case sombre qui le DIT. Vert = écrit, orange = écarté (l'entrée sert un produit juste), rouge = produit faux, gris = non jugé.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const P = require('./collecte-cartes/phase2-visuels');
const { autoriser } = require('./collecte-cartes/garde-ecriture');
const { indexerDisque } = require('./collecte-cartes/staff-detect-io');

const AUDIT = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/AUDIT';
const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const SORTIE = path.resolve(arg('sortie') || 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/PHASE2/planches');
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const L = 200, H = 281, MARGE = 12;
const echapper = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const tampon = (couleur, texte, w, h = 40) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/>${texte}</svg>`);
const ligneTexte = (x, y, t, { taille = 13, fill = '#ddd', gras = false } = {}) => `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${taille}" ${gras ? 'font-weight="bold"' : ''} fill="${fill}">${echapper(t)}</text>`;

async function vignette(chemin) { return sharp(chemin).flatten({ background: '#808080' }).resize(L, H, { fit: 'contain', background: '#303030' }).jpeg({ quality: 88 }).toBuffer(); }
async function absent(texte) {
    const svg = `<svg width="${L}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#202020"/>${ligneTexte(L / 2 - 60, H / 2, texte, { taille: 14, fill: '#aaa' })}</svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

(async () => {
    console.log('lecture de l\'audit (etat-produits, audit-produits)…');
    const etat = new Map(JSON.parse(fs.readFileSync(`${AUDIT}/etat-produits.json`, 'utf8')).map(p => [p.idProduct, p]));
    const audit = new Map(JSON.parse(fs.readFileSync(`${AUDIT}/audit-produits.json`, 'utf8')).map(p => [p.idProduct, p]));
    const idx = indexerDisque();
    const parCle = new Map();
    for (const p of etat.values()) { const k = p.visuel?.entree?.grande?.cle; if (!k) continue; if (!parCle.has(k)) parCle.set(k, []); parCle.get(k).push(p.idProduct); }
    const nous = id => { const c = etat.get(id)?.visuel?.entree?.vignette?.cle; if (!c) return null; const f = `${AUDIT}/cache-nos-vignettes/${sha1(c)}.webp`; return fs.existsSync(f) ? f : null; };
    const cm = id => { const f = idx.get(id); return f && fs.existsSync(f) ? f : null; };
    const classe = id => { const a = audit.get(id); return !a ? '?' : a.classeVisuel === 'CONFORME' ? 'juste' : a.classeVisuel === 'INVERIFIABLE' ? 'non jugé' : a.verdictOeil ? `FAUX (${a.verdictOeil.classe})` : a.classeVisuel.toLowerCase(); };
    const couleurDe = id => { const a = audit.get(id); return !a ? '#999' : a.classeVisuel === 'CONFORME' ? '#7d7' : a.classeVisuel === 'INVERIFIABLE' ? '#999' : '#f77'; };

    // ── les candidats : un par produit des trois lots, avec son geste et sa décision (écrit / écarté)
    const ecrits = new Map([...P.RETRAIT.map(x => [x.idProduct, { ...x, lot: 'A', geste: 'RETRAIT', decision: 'ECRIT' }]), ...P.EMPRUNT.map(x => [x.idProduct, { ...x, lot: 'B', geste: 'EMPRUNT', decision: 'ECRIT' }])]);
    const tous = [...ecrits.values(), ...P.ECARTES.map(x => ({ ...x, geste: x.geste.toUpperCase(), decision: 'ECARTE' }))];
    const lots = { A: tous.filter(x => x.lot === 'A'), B: tous.filter(x => x.lot === 'B'), C: tous.filter(x => x.lot === 'C') };
    const ordre = (a, b) => (a.decision === b.decision ? 0 : a.decision === 'ECRIT' ? -1 : 1);
    fs.mkdirSync(autoriser(SORTIE, [SORTIE]), { recursive: true });
    const sorties = [];

    // ── planche d'un lot : [notre visuel | copie Cardmarket du produit], 4 colonnes
    async function plancheLot(lot, liste) {
        const COL = 4, legende = 66, cW = 2 * L + 10 + MARGE, cH = H + legende + MARGE, lignes = Math.ceil(liste.length / COL);
        const comps = [];
        for (let i = 0; i < liste.length; i++) {
            const x = liste[i], col = i % COL, lig = Math.floor(i / COL), X = MARGE + col * cW, Y = MARGE + lig * cH;
            const n = nous(x.idProduct), c = cm(x.idProduct);
            comps.push({ input: n ? await vignette(n) : await absent('pas de vignette en cache'), left: X, top: Y }, { input: c ? await vignette(c) : await absent('pas de copie Cardmarket'), left: X + L + 10, top: Y });
            const ecrit = x.decision === 'ECRIT', coul = ecrit ? '#7d7' : '#fa5';
            const geste = `${x.geste}${ecrit ? ' : ÉCRIT' : ' : ÉCARTÉ'}`;
            const partage = ecrit ? 'entrée à ce SEUL produit' : `entrée partagée, juste pour : ${x.partageAvec.join(', ')}`;
            comps.push({ input: tampon(coul, ligneTexte(6, 17, `#${i + 1} ${x.idProduct}  ${geste}`, { taille: 15, fill: coul, gras: true }) + ligneTexte(6, 35, (x.nom || etat.get(x.idProduct)?.name || '').slice(0, 58)) + ligneTexte(6, 52, (partage + (x.nature ? ` · ${x.nature}` : '')).slice(0, 70), { taille: 12, fill: '#fc8' }), 2 * L + 10, legende), left: X, top: Y + H });
        }
        const f = `lot-${lot}.jpg`;
        await sharp({ create: { width: MARGE + COL * cW, height: MARGE + lignes * cH, channels: 3, background: '#4a4a4a' } }).composite(comps).jpeg({ quality: 86 }).toFile(autoriser(path.join(SORTIE, f), [SORTIE]));
        sorties.push(f); console.log(`✅ ${f} : ${liste.length} cellules`);
    }
    for (const lot of ['A', 'B', 'C']) await plancheLot(lot, [...lots[lot]].sort(ordre));

    // ── les PARTAGES : une ligne par entrée, notre visuel + la copie Cardmarket de chaque produit servi par la clé (au plus 7)
    async function planchePartages(lot, liste) {
        const cles = [...new Map(liste.map(x => [x.cleR2, x])).values()];
        const COLS = 8, legende = 34, cW = L + 8, cH = H + legende + 8, PAGE = 4, pages = Math.ceil(cles.length / PAGE);
        for (let p = 0; p < pages; p++) {
            const lot4 = cles.slice(p * PAGE, (p + 1) * PAGE), comps = [];
            for (let r = 0; r < lot4.length; r++) {
                const e = lot4[r], servis = parCle.get(e.cleR2) || [], Y = MARGE + r * cH;
                const n = nous(servis[0] ?? e.idProduct);
                comps.push({ input: n ? await vignette(n) : await absent('notre visuel : pas de cache'), left: MARGE, top: Y },
                    { input: tampon('#222', ligneTexte(4, 14, 'NOTRE VISUEL (entrée)', { taille: 11, fill: '#fc8', gras: true }) + ligneTexte(4, 28, `${e.set} n°${e.numero ?? '-'}`.slice(0, 34), { taille: 11 }), L, legende), left: MARGE, top: Y + H });
                const montres = [...servis].sort((a, b) => (ecrits.has(b) ? 1 : 0) - (ecrits.has(a) ? 1 : 0) || a - b).slice(0, COLS - 1);
                for (let k = 0; k < montres.length; k++) {
                    const id = montres[k], X = MARGE + (k + 1) * cW, c = cm(id);
                    const cible = liste.some(x => x.idProduct === id) || ecrits.has(id);
                    comps.push({ input: c ? await vignette(c) : await absent('pas de copie Cardmarket'), left: X, top: Y },
                        { input: tampon('#222', ligneTexte(4, 14, `${id}${cible ? ' (cible)' : ''}`, { taille: 12, fill: cible ? '#f9a' : '#ddd', gras: true }) + ligneTexte(4, 28, classe(id), { taille: 11, fill: couleurDe(id) }), L, legende), left: X, top: Y + H });
                }
                if (servis.length > montres.length) comps.push({ input: tampon('#222', ligneTexte(4, 22, `… +${servis.length - montres.length} autres produits`, { taille: 12 }), L, legende), left: MARGE + COLS * cW, top: Y + H });
            }
            const f = `partages-${lot}-${String(p + 1).padStart(2, '0')}.jpg`;
            await sharp({ create: { width: MARGE + (COLS + 1) * cW, height: MARGE + lot4.length * cH, channels: 3, background: '#4a4a4a' } }).composite(comps).jpeg({ quality: 86 }).toFile(autoriser(path.join(SORTIE, f), [SORTIE]));
            sorties.push(f); console.log(`✅ ${f} : ${lot4.length} entrées`);
        }
    }
    for (const lot of ['A', 'B', 'C']) await planchePartages(lot, lots[lot]);

    // ── PHASE 2 v2 : la planche des 20 LIGNES à détacher — produit, carte jointe, preuve (essai-lot-D.json, écrit par essai-detachement-phase2.js)
    const fD = path.join(path.dirname(SORTIE), 'essai-lot-D.json');
    if (fs.existsSync(fD)) {
        const rangs = JSON.parse(fs.readFileSync(fD, 'utf8')).lignes;
        const COL = 4, legende = 112, cW = 2 * L + 10 + MARGE, cH = H + legende + MARGE, lignesN = Math.ceil(rangs.length / COL), comps = [];
        const coupe = (t, n) => { const mots = String(t).split(' '), ls = ['']; for (const m of mots) { if ((ls[ls.length - 1] + ' ' + m).trim().length > n) ls.push(m); else ls[ls.length - 1] = (ls[ls.length - 1] + ' ' + m).trim(); } return ls; };
        for (let i = 0; i < rangs.length; i++) {
            const r = rangs[i], col = i % COL, lig = Math.floor(i / COL), X = MARGE + col * cW, Y = MARGE + lig * cH;
            const n = nous(r.idProduct), c = cm(r.idProduct);
            comps.push({ input: n ? await vignette(n) : await absent('pas de vignette en cache'), left: X, top: Y }, { input: c ? await vignette(c) : await absent('pas de copie Cardmarket'), left: X + L + 10, top: Y });
            const vu = coupe(r.vu, 62).slice(0, 3);
            const svg = ligneTexte(6, 16, `#${i + 1} ${r.idProduct}  DÉTACHER la ligne ${r.ligne}`, { taille: 13, fill: '#f77', gras: true })
                + ligneTexte(6, 32, `carte jointe : ${r.carteNom} (${r.set} n°${r.numero ?? '-'}, ${r.carteId})`.slice(0, 66), { taille: 12, fill: '#fff' })
                + ligneTexte(6, 47, `ligne posée par : ${r.preuveLigne} · justes gardés : ${r.justes.join(', ')}`.slice(0, 70), { taille: 11, fill: '#9cf' })
                + vu.map((t, k) => ligneTexte(6, 63 + k * 14, (k === 0 ? 'VU : ' : '') + t, { taille: 11, fill: '#fc8' })).join('');
            comps.push({ input: tampon('#111', svg, 2 * L + 10, legende), left: X, top: Y + H });
        }
        await sharp({ create: { width: MARGE + COL * cW, height: MARGE + lignesN * cH, channels: 3, background: '#4a4a4a' } }).composite(comps).jpeg({ quality: 86 }).toFile(autoriser(path.join(SORTIE, 'lot-D.jpg'), [SORTIE]));
        sorties.push('lot-D.jpg'); console.log(`✅ lot-D.jpg : ${rangs.length} lignes à détacher`);
    }
    console.log(`\n${sorties.length} planches dans ${SORTIE}`);
})().catch(e => { console.error('❌', e.stack || e.message); process.exitCode = 1; });
