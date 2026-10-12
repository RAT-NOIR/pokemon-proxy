// ============================================================
// LE CLONE TCGDEX : QUELLE VARIANTE EST UN PRODUIT CARDMARKET ? (lot M2, 2026-10-13)
// ============================================================
// Les fichiers du dépôt `tcgdex/cards-database` (data/<série>/<set>.ts et data/<série>/<set>/<n>.ts) portent, par carte, `thirdParty.cardmarket`
// (l'idProduct de la carte) et `variants: [{ type, foil?, stamp?, thirdParty? }]` — un `stamp` (prerelease, staff, league…) est un TAMPON, et une
// variante peut porter SON PROPRE idProduct Cardmarket. C'est la seule source locale qui dit ce qu'est un produit « de variante non nommée » (§66, §71).
// ⚠️ Le clone N'EST PAS `variants_detailed` de l'API : pas de prix, et l'idProduct par variante n'y est que quand TCGdex le connaît (INV-INTL : le clone
// nomme une minorité de produits). Un produit absent du clone n'est PAS un produit sans tampon : c'est un produit dont on ne sait rien.
// Lecture SANS évaluation de code : le texte est balayé (chaînes sautées, crochets équilibrés) puis converti en JSON ; un fichier qui ne se lit pas LÈVE.
const fs = require('fs');
const path = require('path');

/** Index du caractère fermant du bloc qui s'ouvre à `debut` (`[` ou `{`), en sautant les chaînes ("…", '…', `…`). -1 si le bloc ne se ferme pas. */
function finDuBloc(t, debut) {
    let profondeur = 0;
    for (let i = debut; i < t.length; i++) {
        const c = t[i];
        if (c === '"' || c === '\'' || c === '`') { for (i++; i < t.length && t[i] !== c; i++) if (t[i] === '\\') i++; continue; }
        if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; continue; }             // commentaire de ligne (une apostrophe n'y ouvre pas une chaîne)
        if (c === '/' && t[i + 1] === '*') { const f = t.indexOf('*/', i + 2); if (f < 0) return -1; i = f + 1; continue; }
        if (c === '[' || c === '{') profondeur++;
        else if (c === ']' || c === '}') { profondeur--; if (profondeur === 0) return i; }
    }
    return -1;
}

/** Un littéral de données TypeScript (clés nues, virgules finales, chaînes simples ou doubles) -> JSON. Pas d'évaluation. */
function litteralVersJson(l) {
    let sortie = '';
    for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (c === '"' || c === '\'') {
            let s = '';
            for (i++; i < l.length && l[i] !== c; i++) { if (l[i] === '\\') { s += l[i] + (l[i + 1] ?? ''); i++; } else s += l[i] === '"' ? '\\"' : l[i]; }
            sortie += `"${s}"`; continue;
        }
        if (c === '/' && l[i + 1] === '/') { while (i < l.length && l[i] !== '\n') i++; continue; }
        if (c === '/' && l[i + 1] === '*') { const f = l.indexOf('*/', i + 2); if (f < 0) throw new Error('commentaire non fermé'); i = f + 1; continue; }
        if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < l.length && /[\w$]/.test(l[j])) j++; const mot = l.slice(i, j); let k = j; while (/\s/.test(l[k] || '')) k++; sortie += l[k] === ':' ? `"${mot}"` : mot; i = j - 1; continue; }
        sortie += c;
    }
    return sortie.replace(/,(\s*[}\]])/g, '$1');
}

const bloc = (t, re) => { const m = re.exec(t); if (!m) return null; const o = m.index + m[0].length - 1; const f = finDuBloc(t, o); return f < 0 ? undefined : t.slice(o, f + 1); };

/**
 * @param {string} texte le contenu d'un fichier de carte
 * @returns {{cardmarket: number|null, variantes: Array<{type: string|null, foil: string|null, stamp: string[], cardmarket: number|null}>}}
 */
function analyserCarte(texte) {
    const tp = bloc(texte, /^\tthirdParty:\s*\{/m);
    if (tp === undefined) throw new Error('thirdParty : bloc qui ne se ferme pas');
    const cm = tp ? /cardmarket:\s*(\d+)/.exec(tp) : null;
    const vb = bloc(texte, /^\tvariants:\s*\[/m);
    if (vb === undefined) throw new Error('variants : bloc qui ne se ferme pas');
    let variantes = [];
    if (vb) {
        let arr;
        try { arr = JSON.parse(litteralVersJson(vb)); } catch (e) { throw new Error(`variants : illisible (${e.message})`); }
        if (!Array.isArray(arr)) throw new Error('variants : ce n\'est pas une liste');
        variantes = arr.map(v => ({ type: v.type ?? null, foil: v.foil ?? null, stamp: Array.isArray(v.stamp) ? v.stamp.map(String) : [], cardmarket: Number.isInteger(v.thirdParty?.cardmarket) ? v.thirdParty.cardmarket : null }));
    }
    return { cardmarket: cm ? Number(cm[1]) : null, variantes };
}

/**
 * @param {string} dossierData  …/cards-database/data
 * @returns {{nSets: number, nCartes: number, parProduit: Map<number, Array<{setId, localId, variante: object|null}>>, setsParExpansion: Map<number, string[]>, carte: (setId: string, localId: string) => object|null}}
 */
function lireClone(dossierData) {
    if (!fs.existsSync(dossierData) || !fs.statSync(dossierData).isDirectory()) throw new Error(`${dossierData} : le dossier du clone TCGdex n'existe pas`);
    const parProduit = new Map(), setsParExpansion = new Map(), cartes = new Map();
    const noter = (id, e) => { (parProduit.get(id) || parProduit.set(id, []).get(id)).push(e); };
    let nSets = 0, nCartes = 0;
    for (const serie of fs.readdirSync(dossierData)) {
        const ds = path.join(dossierData, serie);
        if (!fs.statSync(ds).isDirectory()) continue;
        for (const f of fs.readdirSync(ds)) {
            if (!f.endsWith('.ts')) continue;
            const src = fs.readFileSync(path.join(ds, f), 'utf8');
            const id = /^\tid:\s*["']([^"']+)["']/m.exec(src)?.[1];
            if (!id) continue;
            nSets++;
            const exp = /^\tthirdParty:\s*\{[^}]*?cardmarket:\s*(\d+)/m.exec(src)?.[1];
            if (exp) { const k = Number(exp); (setsParExpansion.get(k) || setsParExpansion.set(k, []).get(k)).push(id); }
            const dc = path.join(ds, f.replace(/\.ts$/, ''));
            if (!fs.existsSync(dc)) continue;
            for (const g of fs.readdirSync(dc)) {
                if (!g.endsWith('.ts')) continue;
                const localId = g.replace(/\.ts$/, '');
                let a;
                try { a = analyserCarte(fs.readFileSync(path.join(dc, g), 'utf8')); } catch (e) { throw new Error(`${path.join(serie, f.replace(/\.ts$/, ''), g)} : ${e.message}`); }
                nCartes++;
                cartes.set(`${id}|${localId}`, a);
                if (a.cardmarket != null) noter(a.cardmarket, { setId: id, localId, variante: null });
                for (const v of a.variantes) if (v.cardmarket != null) noter(v.cardmarket, { setId: id, localId, variante: { type: v.type, foil: v.foil, stamp: v.stamp, cardmarket: v.cardmarket } });
            }
        }
    }
    if (!nSets || !nCartes) throw new Error(`${dossierData} : ${nSets} set(s) et ${nCartes} carte(s) lus — un zéro sur un clone non vide est une lecture fausse (mauvais dossier ?), pas un résultat`);
    return { nSets, nCartes, parProduit, setsParExpansion, carte: (setId, localId) => cartes.get(`${setId}|${localId}`) ?? null };
}

module.exports = { analyserCarte, lireClone, finDuBloc, litteralVersJson };
