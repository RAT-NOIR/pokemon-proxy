// Lecture de LISTE-LOGOS-A-CHERCHER.md (phase 1 des logos officiels) en lignes structurées. Une ligne = un fichier Pokécardex (jamais collecté) et,
// pour un OFFICIEL, l'URL EXACTE écrite sur la ligne. Aucune URL n'est devinée : ce qui n'est pas écrit sur la ligne n'existe pas ici.
const fs = require('fs');

const VERDICTS = ['OFFICIEL', 'DIFFÉRENT', 'INTROUVABLE', 'À REGARDER'];
const reUrl = /https?:\/\/[^\s)|«»"]+/g;
// le slug du set : premier mot de la cellule « set (base) · raison » ; « ? » juste après = identifié par le code seulement ; « non identifié » = aucun
function lireSet(cell) {
    const c = String(cell).trim();
    if (/^set non identifi/i.test(c) || /non identifi/i.test(c.split('·')[0])) return { slug: null, sur: false, brut: c };
    const m = /^([A-Za-z0-9][A-Za-z0-9'.&+-]*)(\s+\?)?\s*(·|\(|$)/.exec(c);
    if (!m) return { slug: null, sur: false, brut: c };
    // « sûr » s'écrit par ce qu'il AUTORISE : la base porte déjà ce fichier sur ce set, ou le nom du logo (Bill's), ou le nom FR/l'année — jamais « par le code seulement »
    const parLeCodeSeulement = !!m[2] || /par le code du fichier seulement|NON confirm/i.test(c);
    return { slug: m[1], sur: !parLeCodeSeulement, brut: c };
}
function lireListe(texte) {
    const lignes = texte.split(/\r?\n/);
    const out = [];
    let part = null;
    for (const l of lignes) {
        if (/^# LISTE-LOGOS-A-CHERCHER — part FR/.test(l)) part = 'FR';
        else if (/^# LISTE-LOGOS-A-CHERCHER — part JP/.test(l)) part = 'JP';
        if (!part || !l.startsWith('|')) continue;
        const cells = l.replace(/^\|\s*/, '').replace(/\s*\|\s*$/, '').split(' | ');
        const iv = cells.findIndex(c => VERDICTS.some(v => c.trim().startsWith(`**${v}**`)));
        if (iv < 0) continue;
        const verdict = VERDICTS.find(v => cells[iv].trim().startsWith(`**${v}**`));
        const dec = part === 'FR' ? 1 : 0;      // FR : colonne 0 = numéro
        const fichier = cells[dec].replace(/`/g, '').trim();
        const set = lireSet(cells[dec + 1]);
        const ailleurs = cells[dec + 3] ?? '';
        const urls = (ailleurs.match(reUrl) || []).map(u => u.replace(/[.,;]+$/, ''));
        const score = cells[dec + 4];
        out.push({ part, fichier: part === 'FR' ? `Logo FR/${fichier}` : `Logo JP/${fichier}`, set: set.slug, setSur: set.sur, setBrut: set.brut, urls, ailleurs, score, verdict, ligne: cells.join(' | ') });
    }
    return out;
}
function hoteDe(u) { try { return new URL(u).hostname; } catch { return null; } }
module.exports = { lireListe, lireSet, hoteDe, VERDICTS };
if (require.main === module) {
    const f = process.argv[2];
    const L = lireListe(fs.readFileSync(f, 'utf8'));
    const c = {}; for (const x of L) { const k = `${x.part} ${x.verdict}`; c[k] = (c[k] || 0) + 1; }
    console.log(JSON.stringify(c), L.length);
}
