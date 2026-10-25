'use strict';
// REPLI-REIMPRESSIONS — les MARQUAGES « partagée » portés par l'archive : partageeHoloNonHolo, partageeTamponNonSepare, produitsPartages, tamponNonRepresente, basseDefinition (+ la variante).
// Une colonne de plus (format 2), une validation d'entrée qui les accepte ET les vérifie, une archive ancienne (format 1, sans colonne) qui reste lisible. Pas de base, pas de réseau.
const H = require('./_harnais');
const F = require('../chargeur/format');
const { creerConstructeur, depuisPaquet, StructureInvalide, rejugerEntrees } = require('../chargeur/version');
const { lireEntree } = require('../identifier/visuels');

const brut = (id, o = {}) => ({ idProduct: id, vignette: { cle: `vignettes/${id}.webp`, w: 200, h: 279 }, grande: { cle: `cartes/${id}.webp`, w: 600, h: 838 }, visuel: 'du-set', mention: null,
    idMetacard: null, numero: '1', rarete: null, total: null, variante: null, setNom: 'S', lien: null, ...o });
const refuse = fn => { try { fn(); return null; } catch (e) { return e.name === 'FormatInvalide' ? e.motif : `AUTRE:${e.name}:${e.message}`; } };

(async () => {
    // ── 1. lireEntree accepte ET vérifie les cinq champs
    const ok = o => lireEntree(brut(11, o));
    const p = ok({ partageeHoloNonHolo: true, produitsPartages: [11, 12] });
    H.v('1a. holo/non-holo + deux produits partagés : admis, champs portés', [p.ok, p.doc.partageeHoloNonHolo, p.doc.produitsPartages, p.doc.partageeTamponNonSepare, p.doc.basseDefinition, p.doc.tamponNonRepresente], [true, true, [11, 12], null, null, null]);
    const t = ok({ partageeTamponNonSepare: true, produitsPartages: [12, 11], tamponNonRepresente: 'Staff' });
    H.v('1b. tampon non séparé + tamponNonRepresente : admis, ids triés', [t.ok, t.doc.partageeTamponNonSepare, t.doc.produitsPartages, t.doc.tamponNonRepresente], [true, true, [11, 12], 'Staff']);
    const s = ok({ partageeTamponNonSepare: false, produitsPartages: [11, 12], tamponNonRepresente: 'Play! Pokémon', variante: 'staff' });
    H.v('1c. paire SÉPARÉE (false) : admise, la liste est gardée, la variante portée', [s.ok, s.doc.partageeTamponNonSepare, s.doc.produitsPartages, s.doc.variante], [true, false, [11, 12], 'staff']);
    const b = ok({ basseDefinition: true });
    H.v('1d. basse définition seule : admise, portée', [b.ok, b.doc.basseDefinition, b.doc.produitsPartages], [true, true, null]);
    const sans = ok({});
    H.v('1e. aucun marquage : cinq champs nuls (une image ordinaire n\'en porte aucun)', [sans.ok, sans.doc.partageeHoloNonHolo, sans.doc.partageeTamponNonSepare, sans.doc.produitsPartages, sans.doc.tamponNonRepresente, sans.doc.basseDefinition], [true, null, null, null, null, null]);
    const motif = o => { const r = ok(o); return r.ok ? 'ADMIS' : r.motif; };
    H.v('1f. holo/non-holo sans liste de produits : refusé', /produitsPartages/.test(motif({ partageeHoloNonHolo: true })), true);
    H.v('1g. liste de produits sans marquage de partage : refusé', /partag/.test(motif({ produitsPartages: [11, 12] })), true);
    H.v('1h. la liste ne contient pas l\'idProduct de l\'entrée : refusé', /produitsPartages/.test(motif({ partageeHoloNonHolo: true, produitsPartages: [12, 13] })), true);
    H.v('1i. une liste d\'un seul produit : refusé (un partage est entre au moins deux)', /produitsPartages/.test(motif({ partageeHoloNonHolo: true, produitsPartages: [11] })), true);
    H.v('1j. doublon dans la liste : refusé', /produitsPartages/.test(motif({ partageeHoloNonHolo: true, produitsPartages: [11, 11] })), true);
    H.v('1k. un id non entier : refusé', /produitsPartages/.test(motif({ partageeHoloNonHolo: true, produitsPartages: [11, '12'] })), true);
    H.v('1l. plus de 6 produits : refusé (borne)', /produitsPartages/.test(motif({ partageeHoloNonHolo: true, produitsPartages: [11, 12, 13, 14, 15, 16, 17] })), true);
    H.v('1m. un booléen qui n\'en est pas un ("true") : refusé', /partageeHoloNonHolo/.test(motif({ partageeHoloNonHolo: 'true', produitsPartages: [11, 12] })), true);
    H.v('1n. basseDefinition = 1 : refusé', /basseDefinition/.test(motif({ basseDefinition: 1 })), true);
    H.v('1o. tamponNonRepresente vide ou non texte : refusé', [/tamponNonRepresente/.test(motif({ tamponNonRepresente: '   ' })), /tamponNonRepresente/.test(motif({ tamponNonRepresente: 5 }))], [true, true]);

    // ── 2. la colonne dans la version
    const c = creerConstructeur({ marquages: true });
    c.entree(brut(3001, { partageeHoloNonHolo: true, produitsPartages: [3001, 3002] }));
    c.entree(brut(3002, { partageeHoloNonHolo: true, produitsPartages: [3001, 3002], basseDefinition: true }));
    c.entree(brut(3005, { partageeTamponNonSepare: true, produitsPartages: [3005, 3006], tamponNonRepresente: 'Staff' }));
    c.entree(brut(3009, { partageeTamponNonSepare: false, produitsPartages: [3009, 3010], tamponNonRepresente: 'Play! Pokémon', variante: 'normale' }));
    c.entree(brut(3010, { partageeTamponNonSepare: false, produitsPartages: [3009, 3010], variante: 'staff' }));
    c.entree(brut(3000));                                                               // ordinaire
    c.entree(brut(3020, { partageeHoloNonHolo: true, produitsPartages: [3020, 3021] })); // 3021 n'a PAS d'entrée : la liste de 3020 le nomme quand même
    c.lien('Set-A', '1|001', [3001, 3002]);
    const v = c.finir(new Date('2026-10-17T10:00:00.000Z'));
    H.v('2a. la version porte la colonne des marquages', v.colonneMarquages, true);
    const e = id => v.entree(id);
    H.v('2b. 3001 : holo/non-holo + liste', [e(3001).partageeHoloNonHolo, e(3001).produitsPartages, e(3001).basseDefinition], [true, [3001, 3002], null]);
    H.v('2c. 3002 : basse définition portée', [e(3002).basseDefinition, e(3002).partageeHoloNonHolo], [true, true]);
    H.v('2d. 3005 : tampon non séparé, tamponNonRepresente « Staff »', [e(3005).partageeTamponNonSepare, e(3005).tamponNonRepresente, e(3005).partageeHoloNonHolo], [true, 'Staff', null]);
    H.v('2e. 3009/3010 : paire séparée (false), variantes portées (colonne existante)', [e(3009).partageeTamponNonSepare, e(3009).variante, e(3010).variante, e(3009).tamponNonRepresente, e(3010).tamponNonRepresente], [false, 'normale', 'staff', 'Play! Pokémon', null]);
    H.v('2f. 3000 ordinaire : cinq champs nuls', [e(3000).partageeHoloNonHolo, e(3000).partageeTamponNonSepare, e(3000).produitsPartages, e(3000).tamponNonRepresente, e(3000).basseDefinition], [null, null, null, null, null]);
    H.v('2g. partagesDe : les AUTRES produits du groupe (3001 ↔ 3002, 3005 ↔ 3006, 3009 ↔ 3010 : une paire séparée compte comme non séparée)', [v.partagesDe(3001), v.partagesDe(3002), v.partagesDe(3005), v.partagesDe(3009), v.partagesDe(3010)], [[3002], [3001], [3006], [3010], [3009]]);
    H.v('2h. partagesDe lit aussi dans l\'autre sens : 3021 (sans entrée) est nommé par 3020', [v.partagesDe(3021), v.partagesDe(3020)], [[3020], [3021]]);
    H.v('2i. un produit ordinaire, un produit inconnu : [] (concluant, la colonne est là)', [v.partagesDe(3000), v.partagesDe(424242)], [[], []]);
    H.v('2j. comptes de marquage dans l\'en-tête de la version', v.comptes.marquees, { holo: 3, tampon: 3, partages: 6, basse: 1 });
    H.vrai('2k. toutes les entrées de la version passent la validation d\'entrée', rejugerEntrees(v).ok);

    // ── 3. le fichier : format 2, aller-retour exact
    const brutF = F.serialiser(v);
    H.v('3a. l\'en-tête annonce le format 2 (la colonne est là)', F.lireEntete(brutF).format, 2);
    const w = F.deserialiser(brutF);
    H.v('3b. aller-retour : entrées identiques une à une', [3000, 3001, 3002, 3005, 3009, 3010, 3020].every(id => JSON.stringify(w.entree(id)) === JSON.stringify(v.entree(id))), true);
    H.v('3c. aller-retour : partagesDe, colonne et comptes identiques', [w.colonneMarquages, w.partagesDe(3021), w.partagesDe(3009), JSON.stringify(w.comptes) === JSON.stringify(v.comptes)], [true, [3020], [3010], true]);
    H.vrai('3d. déterministe : deux sérialisations, les mêmes octets', F.serialiser(v).equals(brutF));

    // ── 4. une archive ANCIENNE (format 1, sans colonne) reste lisible, et ne conclut rien
    const a = creerConstructeur(); a.entree(brut(1, { idMetacard: 5 })); a.lien('Set-A', '1|001', [1]);
    const vAncienne = a.finir(new Date('2026-10-11T10:00:00.000Z'));
    const bAncien = F.serialiser(vAncienne);
    H.v('4a. une version sans colonne s\'écrit en format 1', F.lireEntete(bAncien).format, 1);
    const wa = F.deserialiser(bAncien);
    H.v('4b. relue : colonneMarquages faux, partagesDe null (on ne sait pas), entrée aux cinq champs nuls', [wa.colonneMarquages, wa.partagesDe(1), wa.entree(1).partageeHoloNonHolo, wa.entree(1).produitsPartages, wa.entree(1).basseDefinition], [false, null, null, null, null]);
    // avec la colonne des jumeaux mais sans marquages (la forme publiée le 2026-10-17)
    const j = creerConstructeur(); j.entree(brut(1, { idMetacard: 5 })); j.jumeau({ idProduct: 1, idMetacard: 5, idExpansion: 1, numero: '1', tirage: 'intl' }); j.lien('Set-A', '1|001', [1]);
    const vj = j.finir(new Date('2026-10-11T10:00:00.000Z')), wj = F.deserialiser(F.serialiser(vj));
    H.v('4c. format 1 avec jumeaux, sans marquages : lu, colonneJumeaux vrai, colonneMarquages faux', [F.lireEntete(F.serialiser(vj)).format, wj.colonneJumeaux, wj.colonneMarquages], [1, true, false]);

    // ── 5. refus : le format et la structure (un fichier MENTEUR a un hachage juste)
    const corps = brutF.subarray(0, brutF.length - 32);
    const retouche = fn => { const b2 = Buffer.from(corps); fn(b2); return F.sceller(b2); };
    const S = F.sections(brutF); const sec = nom => S.find(x => x.nom === nom);
    H.vrai('5a. format 2 sans les sections de marquage (en-tête réécrit) : refusé', refuse(() => { const en = F.lireEntete(brutF); en.sections = en.sections.filter(x => !x.nom.startsWith('mar.')); F.deserialiser(F.reecrireEntete(brutF, en)); }) !== null);
    H.vrai('5b. format 1 avec les sections de marquage : refusé', refuse(() => { const en = F.lireEntete(brutF); en.format = 1; F.deserialiser(F.reecrireEntete(brutF, en)); }) !== null);
    H.vrai('5c. un numéro de format inconnu (99 ; le 3 est celui de la colonne des emprunts) : refusé', /format/i.test(refuse(() => { const en = F.lireEntete(brutF); en.format = 99; F.deserialiser(F.reecrireEntete(brutF, en)); }) || ''));
    H.vrai('5c2. le format 3 sans la colonne des emprunts (sections du format 2, en-tête réécrit) : refusé', refuse(() => { const en = F.lireEntete(brutF); en.format = 3; F.deserialiser(F.reecrireEntete(brutF, en)); }) !== null);
    const iFlags = sec('mar.flags'), iPdeb = sec('mar.pdeb'), iPfin = sec('mar.pfin'), iTampon = sec('mar.tampon');
    const rang3001 = Array.from(v.identifiants()).indexOf(3001), rang3000 = Array.from(v.identifiants()).indexOf(3000);
    H.vrai('5d. un drapeau de partage sans liste (RESCELLÉ) : refusé par la structure', refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(1, iFlags.debut + 4 * rang3000); }))) !== null);
    H.vrai('5e. un bit de drapeau inconnu (RESCELLÉ) : refusé', refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(1 << 12, iFlags.debut + 4 * rang3000); }))) !== null);
    H.vrai('5f. une liste de produits au-delà des produits (RESCELLÉ) : refusé', refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(99999, iPfin.debut + 4 * rang3001); }))) !== null);
    H.vrai('5g. un indice de texte hors de la réserve (RESCELLÉ) : refusé', refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(999999, iTampon.debut + 4 * rang3000); }))) !== null);
    H.vrai('5h. une liste qui ne contient plus le produit de la ligne (RESCELLÉ) : refusé', refuse(() => {
        const prods = sec('mar.produits'); const b2 = Buffer.from(corps); const dep = b2.readInt32LE(iPdeb.debut + 4 * rang3001);
        b2.writeInt32LE(777777, prods.debut + 4 * dep); b2.writeInt32LE(777778, prods.debut + 4 * (dep + 1)); F.deserialiser(F.sceller(b2));
    }) !== null);
    H.vrai('5i. des comptes de marquage qui mentent (en-tête réécrit) : refusé', refuse(() => { const en = F.lireEntete(brutF); en.comptes.marquees = { holo: 0, tampon: 0, partages: 0, basse: 0 }; F.deserialiser(F.reecrireEntete(brutF, en)); }) !== null);
    H.v('5j. les refus sont des FormatInvalide nommés', [refuse(() => F.deserialiser(retouche(b2 => { b2.writeInt32LE(1, iFlags.debut + 4 * rang3000); }))), ].map(x => typeof x === 'string' && !x.startsWith('AUTRE:')), [true]);
    // la structure par le paquet (voie « fil »)
    const paq = v.paquet().donnees; const casse = patch => { const d = { ...paq, mar: { ...paq.mar } }; patch(d); try { depuisPaquet(d); return null; } catch (x) { return x instanceof StructureInvalide ? x.motif : `AUTRE:${x.name}`; } };
    H.vrai('5k. paquet : colonnes de marquage de longueur différente → refusé', /marquage/.test(casse(d => { d.mar.flags = d.mar.flags.subarray(1); }) || ''));
    H.v('5l. le paquet intact est accepté', casse(() => { }), null);

    // ── 6. le chargeur : une version sans la colonne des marquages ne remplace jamais une version qui l'a
    const E = require('../chargeur/etat'); const { creerChargeur } = require('../chargeur/chargeur');
    const comptesDe = x => ({ sets: 1, cartes: 1, produits: 1, catalogue: 1, visuels: x.comptes.visuels, refusees: 0, motifs: {}, doublons: 0, doublonsContradictoires: 0, fichesLiees: x.comptes.fichesLiees, setsAvecLiens: x.comptes.setsAvecLiens, produitsLies: x.comptes.produitsLies });
    let aCharger = null; const journal = [];
    const ch = creerChargeur({ catalogue: async () => new Map([[1, 1]]), executer: async () => ({ ok: true, version: aCharger, comptes: comptesDe(aCharger) }), journal: m => journal.push(m) });
    E.vider();
    try {
        aCharger = vAncienne;
        const r1 = await ch.charger();
        H.v('6a. sans version en place, une archive d\'avant (sans marquages) s\'installe, et le journal DIT qu\'aucun partage n\'est connu', [r1.ok, E.version() === vAncienne, journal.some(m => /PAS la colonne des marquages/.test(m))], [true, true, true]);
        journal.length = 0; await ch.charger();
        H.v('6a bis. m5 : l\'avertissement est UNIQUE par processus (une seconde charge sans marquages ne le répète pas)', journal.filter(m => /PAS la colonne des marquages/.test(m)).length, 0);
        aCharger = v;
        const r2 = await ch.charger();
        H.v('6b bis. m1 : le journal du chargeur imprime les marquages portés', journal.some(m => /repli : marquages holo 3 tampon 3 partages 6 basse 1/.test(m)), true);
        H.v('6b. une archive du format 2 la remplace', [r2.ok, E.version() === v, E.version().colonneMarquages], [true, true, true]);
        const b2 = creerConstructeur(); b2.entree(brut(1, { idMetacard: 5 })); b2.lien('Set-A', '1|001', [1]);
        aCharger = b2.finir(new Date('2026-10-18T10:00:00.000Z'));
        journal.length = 0;
        const r3 = await ch.charger();
        H.v('6c. une version plus récente MAIS sans la colonne des marquages ne remplace pas celle qui l\'a (la version en place est gardée)', [r3.ok, E.version() === v, journal.some(m => /colonne des marquages alors que celle en place l'a/.test(m))], [false, true, true]);
    } finally { E.vider(); }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
