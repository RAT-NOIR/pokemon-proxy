// node test-arbitrage-bulba.js — l'arbitrage des désaccords entre Bulbapedia et d'autres sources : un verdict par ligne, par TÉMOINS indépendants
// (au moins deux sources, ou une source + une preuve structurelle). Fonctions pures, faux objets. `suite(module)` est rejouée contre des mutants (test-mutants-bulba.js).
function suite(M) {
    let ok = 0, ko = 0;
    const verifier = (nom, obtenu, attendu) => {
        const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
        if (a === b) { ok++; if (require.main === module) console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
    };
    const { arbitrer, arbitrerTout } = M;
    const TABLE_DEX = { seadra: [117], wobbuffet: [202], pikachu: [25] };
    const ctx = { dexDuNom: nom => TABLE_DEX[String(nom).toLowerCase()] || null };
    // une ligne de la confrontation : sources = { pkc: valeur | [valeur, extra] ... } toutes en désaccord (ko)
    const ligne = (champ, bulba, ko, contexte = {}) => ({ champ, cle: 1, bulba, statut: 'desaccord', contexte: { carteId: 1, nomEn: 'Seadra', categorie: 'pokemon', ...contexte },
        parSource: Object.fromEntries(Object.entries(ko).map(([s, v]) => { const [valeur, extra] = Array.isArray(v) && v.length === 2 && typeof v[1] === 'object' && !Array.isArray(v[1]) ? v : [v]; return [s, { statut: 'ko', valeur, ...(extra ? { extra } : {}) }]; })) });
    const v = (l) => { const r = arbitrer(l, ctx); return [r.verdict, r.correction ?? null]; };

    // ── NDEX : la table des noms de Pokédex est la preuve structurelle
    verifier('ndex : Seadra 116, TCGdex 117 et la table 117 → fausse, correction 117', v(ligne('carte.ndex', 116, { tdx: 117 })), ['fausse', 117]);
    let r = arbitrer(ligne('carte.ndex', 116, { tdx: 117 }), ctx);
    verifier('ndex : TCGdex et la table ont la même lignée → solidité moyenne, la table figure parmi les témoins', [r.solidite, r.temoins.map(t => t.source)], ['moyenne', ['tdx', 'table-pokedex']]);
    r = arbitrer(ligne('carte.ndex', 116, { tdx: 117, jp: 117 }), ctx);
    verifier('ndex : une source japonaise indépendante s’ajoute → solidité forte', r.solidite, 'forte');
    verifier('ndex : Wobbuffet 161, pokemon-card.com 202, table 202 → fausse', v(ligne('carte.ndex', 161, { jp: 202 }, { nomEn: 'Wobbuffet' })), ['fausse', 202]);
    verifier('ndex : la table SOUTIENT Bulbapedia, une source contredit → indécidable', v(ligne('carte.ndex', 117, { tdx: 118 })), ['indecidable', null]);
    verifier('ndex : nom absent de la table, une seule source → indécidable', v(ligne('carte.ndex', 5, { tdx: 6 }, { nomEn: 'Inconnu' })), ['indecidable', null]);
    verifier('ndex : la table contredit Bulbapedia mais aucune source ne la rejoint → indécidable', v(ligne('carte.ndex', 116, { tdx: 118 })), ['indecidable', null]);

    // ── RARETÉ
    const V = t => ({ variants: t });
    verifier('rareté : « Rare Holo », TCGdex « Rare » (agrégat) et variantes holo seules → juste', v(ligne('impression.rarete', 'Rare Holo', { tdx: ['Rare', V(['holo', 'reverse'])] })), ['juste', null]);
    verifier('rareté : « Rare Holo », TCGdex « Rare » et variantes SANS holo + pkmncards « Rare » → fausse « Rare »', v(ligne('impression.rarete', 'Rare Holo', { tdx: ['Rare', V(['normal', 'reverse'])], pkc: 'Rare' })), ['fausse', 'Rare']);
    verifier('rareté : « Rare Holo », TCGdex « Rare » sans variantes → indécidable (source trop grossière)', v(ligne('impression.rarete', 'Rare Holo', { tdx: 'Rare' })), ['indecidable', null]);
    verifier('rareté : variantes mêlées (normal ET holo) → indécidable', v(ligne('impression.rarete', 'Rare Holo', { tdx: ['Rare', V(['normal', 'holo'])], pkc: 'Rare' })), ['indecidable', null]);
    verifier('rareté : pkmncards (fin) « Rare » contre « Rare Holo », variantes holo seules → indécidable (deux sources divergent)', v(ligne('impression.rarete', 'Rare Holo', { tdx: ['Rare', V(['holo'])], pkc: 'Rare' })), ['indecidable', null]);
    verifier('rareté : synonyme de nom « Rare Ace » = « ACE SPEC Rare » → juste', v(ligne('impression.rarete', 'Rare Ace', { pkc: 'ACE SPEC Rare', tdx: 'Rare' })), ['juste', null]);
    verifier('rareté : deux sources fines s’accordent sur « Common » → fausse « Common »', v(ligne('impression.rarete', 'Uncommon', { pkc: 'Common', tdx: 'Common' })), ['fausse', 'Common']);
    verifier('rareté : une seule source fine contredit → indécidable', v(ligne('impression.rarete', 'Uncommon', { pkc: 'Common' })), ['indecidable', null]);
    verifier('rareté : « Rare Secret » contre TCGdex « Rare » sans preuve → indécidable', v(ligne('impression.rarete', 'Rare Secret', { tdx: 'Rare' })), ['indecidable', null]);

    // ── CONVENTIONS DE NOM : Bulbapedia écrit « Ultra-Rare Rare » là où pkmncards ET TCGdex écrivent « Holo Rare V », pour des centaines de cartes. Ce n'est pas une erreur de
    //    rareté, c'est un vocabulaire — calibré sur la population (observations, pureté), jamais deviné d'une ligne.
    const L = (b, p, t, cle) => ({ champ: 'impression.rarete', cle, bulba: b, statut: p === b ? 'accord' : 'desaccord', contexte: { carteId: 1, nomEn: 'X', categorie: 'pokemon' },
        parSource: { pkc: { statut: p === b ? 'ok' : 'ko', valeur: p }, tdx: { statut: t === b ? 'ok' : 'ko', valeur: t } } });
    // la convention se calibre PAR SOURCE (chacune a son vocabulaire) : 8 observations au moins, 95 % de pureté dans UN des deux sens
    //   avant : la valeur Bulbapedia mène presque toujours à la même valeur de la source · arrière : la valeur de la source vient presque toujours de la même valeur Bulbapedia
    const vmax = Array.from({ length: 8 }, (_, i) => L('Rare VMAX', 'Holo Rare VMAX', 'Holo Rare VMAX', 'v' + i));
    let conv = M.calibrerConventions(vmax);
    verifier('convention calibrée pour chaque source : 8 observations, pureté 1', [Object.values(conv.pkc).map(c => [c.de, c.vers, c.observations, c.purete, c.sens]), Object.keys(conv.tdx).length], [[['Rare VMAX', 'Holo Rare VMAX', 8, 1, 'avant']], 1]);
    verifier('convention : sous 8 observations, rien', M.calibrerConventions(vmax.slice(0, 7)), { pkc: {}, tdx: {} });
    // une valeur Bulbapedia qui mène à deux valeurs de la source ET une valeur de la source qui vient de deux valeurs Bulbapedia : aucun sens ne tient
    const trouble = [...Array.from({ length: 8 }, (_, i) => L('Rare VMAX', 'Holo Rare VMAX', 'x', 'a' + i)), ...Array.from({ length: 8 }, (_, i) => L('Rare VMAX', 'Common', 'x', 'b' + i)), ...Array.from({ length: 8 }, (_, i) => L('Rare Holo', 'Holo Rare VMAX', 'x', 'c' + i)), ...Array.from({ length: 8 }, (_, i) => L('Uncommon', 'Common', 'x', 'd' + i))];
    verifier('convention : ni sens avant ni sens arrière à 95 % → rien pour « Rare VMAX »', Object.values(M.calibrerConventions(trouble).pkc).filter(c => c.de === 'Rare VMAX'), []);
    // vocabulaire plus GROSSIER chez Bulbapedia (« Ultra-Rare Rare » pour Holo Rare V ET Rare Holo GX) : le sens arrière tient (la source dit toujours la même chose de lui)
    const grossier = [...Array.from({ length: 8 }, (_, i) => L('Ultra-Rare Rare', 'Holo Rare V', 'x', 'g' + i)), ...Array.from({ length: 8 }, (_, i) => L('Ultra-Rare Rare', 'Rare Holo GX', 'x', 'h' + i))];
    verifier('convention du sens arrière (Bulbapedia plus grossière)', Object.values(M.calibrerConventions(grossier).pkc).map(c => [c.vers, c.sens]).sort(), [['Holo Rare V', 'arriere'], ['Rare Holo GX', 'arriere']]);
    verifier('convention : une source absente ne compte pas pour elle', M.calibrerConventions(vmax.map(l => ({ ...l, parSource: { pkc: l.parSource.pkc } }))).tdx, {});
    const ctxC = { ...ctx, conventions: conv };
    r = arbitrer(L('Rare VMAX', 'Holo Rare VMAX', 'Holo Rare VMAX', 'z'), ctxC);
    verifier('rareté : convention de nom pour les deux sources → juste, normalisation proposée', [r.verdict, r.normalisation, r.convention.observations], ['juste', 'Holo Rare VMAX', 8]);
    verifier('rareté : une convention de la source qui contredit explique à elle seule, l’autre ne la contredit pas → juste', arbitrer(L('Rare VMAX', 'Holo Rare VMAX', 'Rare', 'z'), { ...ctx, conventions: { pkc: conv.pkc, tdx: {} } }).verdict, 'juste');
    verifier('rareté : une source contredit sans convention, l’autre est expliquée → pas juste', arbitrer(L('Rare VMAX', 'Holo Rare VMAX', 'Common', 'z'), { ...ctx, conventions: { pkc: conv.pkc, tdx: {} } }).verdict, 'indecidable');
    verifier('rareté : sans convention calibrée, les deux sources contre Bulbapedia → fausse', v(L('Rare VMAX', 'Holo Rare VMAX', 'Holo Rare VMAX', 'z')), ['fausse', 'Holo Rare VMAX']);
    verifier('rareté : une convention ne couvre que SA paire (autre valeur de source → fausse)', arbitrer(L('Rare VMAX', 'Common', 'Common', 'z'), ctxC).verdict, 'fausse');

    // ── SET : le total est un décompte de cartes — le périmètre diffère selon les sources (Trainer Gallery, Shiny Vault à part)
    verifier('total du set : deux sources, écart d’une carte → fausse', v(ligne('set.totalImprime', 164, { pkc: 165, tdx: 165 }, { setId: 'S' })), ['fausse', 165]);
    verifier('total du set : deux sources, écart de 94 cartes (périmètre) → indécidable', v(ligne('set.totalImprime', 163, { pkc: 69, tdx: 69 }, { setId: 'S' })), ['indecidable', null]);

    // ── CHAMPS NUMÉRIQUES / TEXTE
    verifier('pv : deux sources concordent contre Bulbapedia → fausse', v(ligne('carte.pv', 70, { pkc: 60, tdx: 60 })), ['fausse', 60]);
    verifier('pv : une seule source → indécidable', v(ligne('carte.pv', 70, { pkc: 60 })), ['indecidable', null]);
    verifier('pv : deux sources qui divergent entre elles → indécidable', v(ligne('carte.pv', 70, { pkc: 60, tdx: 80 })), ['indecidable', null]);
    verifier('illustrateur d’un Dresseur (réillustré par tirage) : deux sources → indécidable', v(ligne('carte.illustrateur', 'A', { pkc: 'B', tdx: 'B' }, { categorie: 'dresseur' })), ['indecidable', null]);
    verifier('illustrateur d’un Pokémon : deux sources → fausse', v(ligne('carte.illustrateur', 'A', { pkc: 'B', tdx: 'B' })), ['fausse', 'B']);
    verifier('attaques : variante orthographique → indécidable même à deux sources', v(ligne('carte.attaques', ['Sleep Powder'], { pkc: ['Sleep Power'], tdx: ['Sleep Power'] })), ['indecidable', null]);
    verifier('attaques : listes réellement différentes, deux sources → fausse', v(ligne('carte.attaques', ['Bite'], { pkc: ['Scratch'], tdx: ['Scratch'] })), ['fausse', ['Scratch']]);
    verifier('total imprimé de l’impression : deux sources → fausse', v(ligne('impression.total', '130', { pkc: 123, tdx: 123 })), ['fausse', 123]);
    verifier('date de set à un jour d’écart, une source → indécidable', v(ligne('set.dateSortieEn', '2019-02-01', { tdx: '2019-01-31' })), ['indecidable', null]);

    // ── GARDES
    verifier('une ligne sans désaccord n’est pas arbitrée', arbitrer({ ...ligne('carte.pv', 60, {}), statut: 'accord' }, ctx).verdict, 'sans-objet');
    verifier('une source « approx » ou « ok » parmi les témoins : jamais comptée comme contradiction', arbitrer({ ...ligne('carte.pv', 60, { pkc: 60 }), parSource: { pkc: { statut: 'ok', valeur: 60 }, tdx: { statut: 'ko', valeur: 70 } } }, ctx).verdict, 'sans-objet');

    // ── LE TOUT : résumé par champ et dénominateur
    const lignes = [ligne('carte.pv', 70, { pkc: 60, tdx: 60 }), { ...ligne('carte.pv', 70, { pkc: 60 }), cle: 2 }, { ...ligne('carte.pv', 60, {}), statut: 'accord', cle: 3 }];
    const t = arbitrerTout(lignes, ctx);
    verifier('arbitrerTout : seules les lignes en désaccord, résumé par champ', [t.entrees.length, t.resume['carte.pv']], [2, { total: 2, juste: 0, fausse: 1, indecidable: 1 }]);
    return { ok, ko };
}
module.exports = { suite };

if (require.main === module) {
    const { ok, ko } = suite(require('./collecte-cartes/arbitrage-bulba'));
    console.log(`\n${ok} passés, ${ko} en échec`);
    if (ko) process.exit(1);
}
