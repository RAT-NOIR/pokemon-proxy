// ============================================================
// LE DECK CHAMPION DE CHAQUE ANNÉE WCD, ET SA VEDETTE — pour le portrait du site (demande de l'éditeur, 2026-10-07, soir)
// ============================================================
//   node wcd-decks-champions.js --decks=<wcd-decks.json>        (lecture seule → collecte-cartes/wcd-decks-champions.json)
//
// LA SOURCE : les pages de decks Bulbapedia, lues dans leur COPIE Wayback (archive.org seulement, aucune requête à Bulbapedia ; liste
// des decks : « World Championships Deck (TCG) », copie du 2026-08-10). Chaque page dit le joueur et sa place (« X is the name of the deck
// used by Henry Brand, the Masters Division champion at the 2019 World Championships »). Avant 2010, la division Masters s'appelle aussi
// « 15 and Older » / « Fifteen and Older ».
// LA VEDETTE, PAR UNE RÈGLE, JAMAIS À L'ŒIL (DEMANDE-STYLES-LOGOS-COMPOSES.md du site) : le Pokémon qui donne son nom au deck ; si le nom
// n'en nomme aucun, la carte Pokémon la plus présente dans la liste ; à égalité, la carte à règle (ex, EX, GX, V, VMAX, VSTAR, LV.X, BREAK,
// Prime, LEGEND, ☆, δ). La catégorie « Pokémon » est celle de NOTRE carte (cartes.categorie), retrouvée par le titre de sa page.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AUTORISES = [/^--decks=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const DECKS = process.argv.find(a => a.startsWith('--decks='))?.slice(8);
if (!DECKS) { console.error('❌ --decks=<wcd-decks.json> requis'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');

// ➕ 2026-10-07 (soir, demande du site : « le champion Masters 2004 ») — quand AUCUNE page de deck ne se dit championne, la page de
// l'ÉVÉNEMENT peut nommer le champion ; son deck est alors celui dont la page dit « used by <ce joueur> ». Deux pages, deux citations :
// une ligne par année, lue à l'œil dans sa copie, jamais devinée.
const CHAMPIONS_PAR_EVENEMENT = {
    2004: { joueur: 'Tsuguyoshi Yamato', copie: 'http://web.archive.org/web/20260822000048/https://bulbapedia.bulbagarden.net/wiki/2004_World_Championships_(TCG)',
        citation: 'Tsuguyoshi Yamato, of Japan, was the first Fifteen and Over Champion, winning with a perfect match record.' }
};
const MASTERS = /(Masters?\s+Division|\bMasters\b|(?:15|Fifteen)\s+and\s+(?:Older|Over))[^.]{0,60}?\b(champion|winner|World Champion)\b|\b(champion|winner|won)\b[^.]{0,40}\b(Masters?\s+Division|Masters|(?:15|Fifteen)\s+and\s+(?:Older|Over))/i;
const PAS_PREMIER = /runner-up|finalist|semi-final|Top \d|second|third|fourth/i;
const REGLE = /\b(ex|EX|GX|V|VMAX|VSTAR|V-UNION|LV\.X|BREAK|Prime|LEGEND)\b|☆|δ|-GX|-EX/;
const ent = s => String(s).replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
const nu = s => ent(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// le nom d'espèce d'une carte : sans les suffixes de règle, ni le possesseur (« Team Magma's », « Brock's »), ni la forme (« Dark »)
const espece = nom => nu(nom).replace(/^(team \w+'s|[\w-]+'s|dark|light|shining|origin forme|single strike|rapid strike|radiant|galarian|alolan|hisuian|paldean)\s+/g, '').replace(/[-\s]*(ex|gx|v|vmax|vstar|v-union|lv\.x|break|prime|legend|☆|δ)\b.*$/i, '').replace(/[^a-z0-9& ]/g, ' ').trim();

(async () => {
    const J = JSON.parse(fs.readFileSync(DECKS, 'utf8'));
    // une page d'ÉVÉNEMENT (« 2006 World Championships (TCG) ») n'est pas un deck, même si la liste la range sous une année
    const decks = J.decks.filter(d => d.status === 200 && !/World_Championships_\(TCG\)$/.test(d.titre) && Array.isArray(d.lignes) && d.lignes.some(l => l.quantite));
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const titres = [...new Set(decks.flatMap(d => d.lignes.flatMap(l => l.cartes.map(ent))))];
    const parTitre = new Map();
    for (let i = 0; i < titres.length; i += 1000) for (const c of await cx.db.collection('cartes').find({ 'bulba.titre': { $in: titres.slice(i, i + 1000) } }, { projection: { nomEn: 1, categorie: 1, 'bulba.titre': 1, images: 1 } }).toArray()) parTitre.set(c.bulba.titre, c);
    // ➕ 2026-10-07 (soir, demande du site : « une impression sans tampon de Garchomp C LV.X pour 2010 ») — le visuel de l'impression
    // D'ORIGINE d'abord : celle que nomme le titre de la page (« Garchomp C LV.X (Supreme Victors 145) »), dans le set de ce nom, au même
    // numéro. Le TYPE de set ne le dit pas (25th Anniversary Edition est typé « extension » et réimprime) ; l'origine, si.
    const nomsDesSets = new Map((await cx.db.collection('sets').find({}, { projection: { 'bulba.expansion': 1, nomAffichage: 1 } }).toArray()).map(s => [s._id, [].concat(s.bulba?.expansion ?? [], s.nomAffichage ?? []).map(nu)]));
    const cleN = n => String(n ?? '').toUpperCase().replace(/^([A-Z-]*)0*(\d+)/, '$1$2');
    function imagesDeLaVedette(carte) {
        const o = /\(([^()]+?)\s+([A-Za-z]*\d+[A-Za-z]*)\)$/.exec(carte.bulba?.titre || '');
        const estOrigine = m => !!o && cleN(m.numero) === cleN(o[2]) && (nomsDesSets.get(m.set) || []).includes(nu(o[1]));
        return (carte.images || []).filter(m => m && m.cleR2 && m.langue !== 'ja')
            .map(m => ({ set: m.set, numero: m.numero ?? null, cleR2: m.cleR2, source: m.source ?? null, ...(estOrigine(m) ? { impressionDOrigine: `l'impression que nomme la page : « ${o[1]} ${o[2]} »` } : {}) }))
            .sort((a, b) => (b.impressionDOrigine ? 1 : 0) - (a.impressionDOrigine ? 1 : 0)).slice(0, 3);
    }
    const annees = [...new Set(decks.map(d => d.annee))].sort();
    const sortie = [];
    for (const a of annees) {
        const ds = decks.filter(d => d.annee === a);
        let champions = ds.filter(d => d.intro.some(p => MASTERS.test(p) && !PAS_PREMIER.test((MASTERS.exec(p) || [''])[0])));
        const ligne = { annee: a, set: `WCD-${a}`, decksLus: ds.length };
        const ev = CHAMPIONS_PAR_EVENEMENT[a];
        let parEvenement = null;
        if (!champions.length && ev) {
            const usePar = new RegExp(`used by ${ev.joueur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            champions = ds.filter(d => d.intro.some(p => usePar.test(p)));
            if (champions.length === 1) parEvenement = { ...ev, phraseDeck: champions[0].intro.find(p => usePar.test(p)) };
        }
        if (champions.length !== 1) { sortie.push({ ...ligne, deckChampion: null, raison: `${champions.length} deck(s) dont la page se dit champion Masters (${champions.map(d => d.titre).join(', ') || '—'}) sur ${ds.length} lus${ev ? ` ; page de l'événement : ${ev.joueur}` : ''}` }); continue; }
        const d = champions[0], phrase = parEvenement ? `${parEvenement.citation} — ${parEvenement.phraseDeck}` : d.intro.find(p => MASTERS.test(p));
        const joueur = ent((/deck (?:used by|of)\s+([^,.]+?)(?:,| who| in the| at the)/i.exec(d.intro.join(' ')) || [])[1] || '').trim() || null;
        const nomDeck = ent(d.titre.replace(/_/g, ' ').replace(/ \(TCG\)$/, ''));
        // les cartes Pokémon de la liste, avec leur quantité et notre carte
        const pokemon = [];
        for (const l of d.lignes) {
            if (!l.quantite) continue;
            const t = ent(l.cartes[0]); const c = parTitre.get(t);
            // une carte que la base ne connaît pas : la LISTE dit sa catégorie par un marqueur après le nom (« 4× Acro Bike I » — Item,
            // Su(pporter), St(adium), E(nergy), T(rainer), PT (Pokémon Tool)) ; sans marqueur, elle peut être un Pokémon
            // deux formats : « 4× Rare Candy T » (ancien) et « 186/197 Arven Su 4× » (récent) ; une Énergie ancienne n'a pas de marqueur
            const tx = ` ${ent(l.texte || '')} `;
            const nonPokemon = /\s(I|Su|St|E|T|PT|Te)\s+(\d+×)?\s*(—|&#8212;)?\s*$/.test(tx) || /\d+×\s+.+?\s(I|Su|St|E|T|PT|Te)(\s|$|&)/.test(tx) || /\bEnergy\b/.test(t);
            if (!c) { if (!nonPokemon) pokemon.push({ titre: t, quantite: l.quantite, carte: null }); continue; }
            if (c.categorie === 'pokemon') pokemon.push({ titre: t, quantite: l.quantite, carte: c });
        }
        const connus = pokemon.filter(p => p.carte);
        const inconnus = pokemon.filter(p => !p.carte).map(p => p.titre);
        const motsDuNom = ` ${nu(nomDeck).replace(/[^a-z0-9& ]/g, ' ')} `;
        const nommes = connus.filter(p => { const e = espece(p.carte.nomEn); return e && motsDuNom.includes(` ${e} `); });
        const departage = xs => [...xs].sort((x, y) => y.quantite - x.quantite || (REGLE.test(y.carte.nomEn) ? 1 : 0) - (REGLE.test(x.carte.nomEn) ? 1 : 0) || String(x.titre).localeCompare(String(y.titre)));
        let v, regle;
        if (nommes.length) { v = departage(nommes)[0]; regle = `le Pokémon que nomme le deck (« ${nomDeck} »)${nommes.length > 1 ? ` — ${nommes.length} cartes de cette espèce : la plus présente, puis la carte à règle` : ''}`; }
        else if (connus.length) { v = departage(connus)[0]; regle = `le nom du deck ne nomme aucun Pokémon : la carte Pokémon la plus présente (×${v.quantite})${departage(connus).filter(x => x.quantite === v.quantite).length > 1 ? ', à égalité la carte à règle' : ''}`; }
        // une carte de la liste que la base ne connaît pas pourrait être la plus présente : la règle ne conclut pas
        if (v && !nommes.length && inconnus.length && pokemon.filter(p => !p.carte).some(p => p.quantite >= v.quantite)) { v = null; regle = null; }
        // un NOM-VALISE (« Luxdrill » = Luxray + Beedrill, « Twinboar », « Honorstoise ») ne nomme aucune espèce entière : la règle prend
        // alors la plus présente. Les espèces dont un fragment d'au moins 4 lettres est dans le nom sont LISTÉES, jamais choisies (l'éditeur)
        const plat = nu(nomDeck).replace(/[^a-z]/g, '');
        const fragments = e => { const s = e.replace(/[^a-z]/g, ''), out = []; for (let i = 0; i + 4 <= s.length; i++) out.push(s.slice(i, i + 4)); return out; };
        const nomsPossibles = nommes.length ? [] : [...new Set(connus.filter(p => fragments(espece(p.carte.nomEn)).some(f => plat.includes(f))).map(p => p.carte.nomEn))];
        // (2026-10-07, nuit — demande du site, règle de l'éditeur : la vedette est le Pokémon que NOMME le deck, le premier cité, puis le
        // suivant, puis « le Pokémon suivant du deck qui a une image propre » — le site regarde chaque illustration) : la liste ENTIÈRE des
        // cartes Pokémon du deck, par quantité décroissante, la carte à règle à égalité ; et les Pokémon cités par le nom, dans l'ordre du nom
        const liste = [...departage(connus).map(p => ({ carteId: p.carte._id, nomEn: p.carte.nomEn, titrePage: p.titre, quantite: p.quantite, carteARegle: REGLE.test(p.carte.nomEn), images: imagesDeLaVedette(p.carte) })),
            ...pokemon.filter(p => !p.carte).map(p => ({ carteId: null, nomEn: null, titrePage: p.titre, quantite: p.quantite, carteARegle: null, images: [], absenteDeLaBase: true }))]
            .sort((x, y) => y.quantite - x.quantite || (y.carteARegle ? 1 : 0) - (x.carteARegle ? 1 : 0) || String(x.titrePage).localeCompare(String(y.titrePage)));
        const citesParLeNom = nommes.map(p => ({ carteId: p.carte._id, nomEn: p.carte.nomEn, quantite: p.quantite, position: motsDuNom.indexOf(` ${espece(p.carte.nomEn)} `) }))
            .sort((x, y) => x.position - y.position || y.quantite - x.quantite);
        sortie.push({ ...ligne, deckChampion: { nom: nomDeck, joueur, nomsPossibles, pokemon: liste, citesParLeNom, source: { page: d.titre.replace(/_/g, ' '), copie: d.copie, url: d.url ? d.url.replace('id_/', '/') : null, phrase: phrase?.slice(0, 300) ?? null, ...(parEvenement ? { evenement: parEvenement.copie } : {}) },
            vedette: v ? { carteId: v.carte._id, nomEn: v.carte.nomEn, titrePage: v.titre, quantite: v.quantite, regle,
                images: imagesDeLaVedette(v.carte) } : null,
            raisonSansVedette: v ? null : `vedette non déterminée : ${inconnus.length} carte(s) de la liste absente(s) de la base (${inconnus.slice(0, 4).join(', ')})` } });
    }
    await fermer();
    const f = path.join(__dirname, 'collecte-cartes', 'wcd-decks-champions.json');
    fs.writeFileSync(f, JSON.stringify({ genere: new Date().toISOString(), par: 'wcd-decks-champions.js', source: DECKS, annees: sortie }, null, 1));
    for (const s of sortie) console.log(`${s.annee} · ${s.deckChampion ? `« ${s.deckChampion.nom} » (${s.deckChampion.joueur ?? '?'}) → ${s.deckChampion.vedette ? `${s.deckChampion.vedette.nomEn} ×${s.deckChampion.vedette.quantite} · ${s.deckChampion.vedette.regle}` : s.deckChampion.raisonSansVedette}${s.deckChampion.nomsPossibles?.length ? ` · nom-valise ? ${s.deckChampion.nomsPossibles.join(', ')}` : ''}` : `✗ ${s.raison}`}`);
    console.log(`DÉNOMINATEUR : ${sortie.length} années · champion trouvé ${sortie.filter(s => s.deckChampion).length} · vedette ${sortie.filter(s => s.deckChampion?.vedette).length} → ${f}`);
})().catch(e => { console.error(e); process.exit(1); });
