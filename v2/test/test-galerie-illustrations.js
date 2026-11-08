'use strict';
// GALERIE L10 — la bibliothèque d'ILLUSTRATIONS PRIVÉES de l'Atelier : GET /api/illustrations, PUT et DELETE /api/illustrations/{id}, POST et DELETE /api/illustrations/{id}/publication.
// Base dédiée EN MÉMOIRE, faux R2 (aucun appel réseau réel), faux Turnstile. Chaque garde est éprouvée sur le code réel ET sur une copie mutée (le fragment retiré du texte du module).
// Règles : suppression = objets R2 effacés (privé et public), zones qui la citent lues `null` ; 30 stockées ; URL signées en lecture 1 h pour l'auteur ; dépôt présigné 300 s ; 5 publications par jour (partagées avec les classeurs).
const A = require('./_aide-galerie');
const H = A.H;

(async () => {
    const B = await A.outillerBanc('test-galerie-illustrations.js');
    const { F, svc, compte, appel, lire, code, detail, brut, sv, serveur, variante, artPublic, deposer, stockage, SITE } = B;
    const cles = o => Object.keys(o);
    const luma = await compte({}, 'luma'), noa = await compte({}, 'noa'), modo = await compte({ role: 'moderateur' }, 'modo-illus'), sansPseudo = await compte({}, null);
    const decider = (type, id, decision, extra = {}) => appel(sv, 'POST', `/api/admin/moderation/${type}.${id}/decision`, { c: modo, corps: { decision, ...extra } });
    const certifie = (extra = {}) => ({ certifieAuteur: true, cgu: '2026-10', ...extra });
    const cleDe = id => ({ attente: [`galerie/attente/${id}.webp`, `galerie/attente/${id}-480.webp`], pub: [`galerie/pub/${id}.webp`, `galerie/pub/${id}-480.webp`] });
    const svP = await serveur(variante({}, { publicationsCompteJour: 100 }));         // les refus de forme consomment la limite du jour : ce banc la relève, la section « 5 par jour » joue la réelle

    // ═══ 1. LA LISTE : mes illustrations, avec leurs URL ═══
    const d1 = await deposer(sv, luma, { nom: 'Fond doux', format: '1' });
    const id1 = d1.id;
    const l1 = await appel(sv, 'GET', '/api/illustrations', { c: luma, sansSite: true });
    H.v('GET /api/illustrations : { success, illustrations, suite }, no-store', [l1.statut, cles(l1.json), l1.json.suite, l1.entetes['cache-control']], [200, ['success', 'illustrations', 'suite'], null, 'no-store']);
    const i1 = l1.json.illustrations[0];
    H.v('   les clés de l\'Illustration', cles(i1), ['id', 'titre', 'format', 'largeur', 'hauteur', 'couleur', 'image', 'vignette', 'artisteDeclare', 'ambiances', 'formats', 'visibilite', 'motif', 'creeLe']);
    H.v('   déposée et finalisée : « en-attente » (la certification des deux droits se donne au dépôt, O19), titre = le nom, format, artiste = le pseudo, ambiances et formats vides', [i1.visibilite, i1.titre, i1.format, i1.artisteDeclare, i1.ambiances, i1.formats, i1.motif], ['en-attente', 'Fond doux', '1', 'luma', [], [], null]);
    H.v('   URL signées en lecture (GET, 1 h) vers le bucket PRIVÉ : image et vignette', [/X-Amz-Expires=3600/.test(i1.image), /X-Amz-Expires=3600/.test(i1.vignette), i1.image.includes(`${stockage.bucketPrive}/galerie/attente/${id1}.webp`), i1.vignette.includes(`galerie/attente/${id1}-480.webp`)], [true, true, true, true]);
    H.v('   la liste d\'un autre compte ne contient rien du premier ; sans session : 401 SESSION', [(await appel(sv, 'GET', '/api/illustrations', { c: noa, sansSite: true })).json.illustrations.length, code(await lire(sv, '/api/illustrations'))], [0, 'SESSION']);
    H.v('   un paramètre inconnu : 400 ENTREE', code(await appel(sv, 'GET', '/api/illustrations?zzz=1', { c: luma, sansSite: true })), 'ENTREE');
    const pubA = await artPublic(luma, { nom: 'Art accepté' });
    const lp = (await appel(sv, 'GET', '/api/illustrations', { c: luma, sansSite: true })).json.illustrations.find(x => x.id === pubA);
    H.v('   un art PUBLIC se lit par son adresse publique (le bucket public, sans signature)', [lp.visibilite, lp.image, lp.vignette], ['public', `${stockage.urlPublique}/galerie/pub/${pubA}.webp`, `${stockage.urlPublique}/galerie/pub/${pubA}-480.webp`]);
    const refusee = await artPublic(luma, { nom: 'Refusée', etat: 'refuse', publieLe: null, motif: { code: 'droits', texte: 'scan' } });
    const lr = (await appel(sv, 'GET', '/api/illustrations', { c: luma, sansSite: true })).json.illustrations.find(x => x.id === refusee);
    H.v('   un art refusé : ni image ni vignette (ses objets sont partis), le motif écrit', [lr.visibilite, lr.image, lr.vignette, lr.motif], ['refuse', null, null, { code: 'droits', texte: 'scan' }]);

    // ═══ 2. LES ILLUSTRATIONS D'AUTRUI : 404 INTROUVABLE uniforme, jamais 403 ═══
    {
        const ab = await appel(sv, 'PUT', `/api/illustrations/${F.nouvelId()}`, { c: noa, corps: { ambiances: ['douce'] } });
        const a1 = await appel(sv, 'PUT', `/api/illustrations/${id1}`, { c: noa, corps: { ambiances: ['douce'] } });
        const a2 = await appel(sv, 'DELETE', `/api/illustrations/${id1}`, { c: noa });
        const a3 = await appel(svP, 'POST', `/api/illustrations/${id1}/publication`, { c: noa, corps: certifie() });
        const a4 = await appel(sv, 'DELETE', `/api/illustrations/${id1}/publication`, { c: noa });
        H.v('PUT, DELETE, publication, dépublication d\'une illustration d\'autrui : le MÊME corps que l\'absent, 404 INTROUVABLE partout', [a1, a2, a3, a4].map(r => [r.statut, code(r), r.texte === ab.texte]), Array(4).fill([404, 'INTROUVABLE', true]));
        H.v('   l\'illustration est intacte', [(await brut('arts').findOne({ _id: id1 })).auteurId, (await brut('arts').findOne({ _id: id1 })).ambiances], [luma.id, []]);
        H.v('   un identifiant mal formé : 404 INTROUVABLE aussi', code(await appel(sv, 'DELETE', '/api/illustrations/!!', { c: luma })), 'INTROUVABLE');
    }

    // ═══ 3. PUT : titre, artiste, ambiances, formats ═══
    {
        const m = await appel(sv, 'PUT', `/api/illustrations/${id1}`, { c: luma, corps: { titre: 'Fond très doux', artisteDeclare: 'Luma Dessin', ambiances: ['douce', 'nuit'], formats: ['3x3', 'double-page'] } });
        H.v('PUT /api/illustrations/{id} : 200 { success, illustration } mise à jour', [m.statut, cles(m.json), m.json.illustration.titre, m.json.illustration.artisteDeclare, m.json.illustration.ambiances, m.json.illustration.formats], [200, ['success', 'illustration'], 'Fond très doux', 'Luma Dessin', ['douce', 'nuit'], ['3x3', 'double-page']]);
        H.v('   le titre se retrouve dans la banque : le nom ET les mots de la recherche suivent', [(await brut('arts').findOne({ _id: id1 })).nom, (await brut('arts').findOne({ _id: id1 })).mots.includes('tres')], ['Fond très doux', true]);
        for (const [nom, corps, d] of [['corps vide', {}, 'corps'], ['champ inconnu', { zzz: 1 }, 'corps'], ['ambiance hors liste', { ambiances: ['gore'] }, 'ambiances'], ['ambiance en double', { ambiances: ['douce', 'douce'] }, 'ambiances'], ['format hors liste', { formats: ['5x5'] }, 'formats'],
            ['titre vide', { titre: '' }, 'titre'], ['titre binaire', { titre: 'data:image/png;base64,AAAA' }, 'donnee-binaire'], ['artiste de plus de 80 caractères', { artisteDeclare: 'x'.repeat(81) }, 'artiste-declare'], ['ambiances qui n\'est pas une liste', { ambiances: 'douce' }, 'ambiances']]) {
            const r = await appel(sv, 'PUT', `/api/illustrations/${id1}`, { c: luma, corps });
            H.v(`   refusé — ${nom}`, [r.statut, code(r), detail(r)], [400, 'ENTREE', d]);
        }
        H.v('   artisteDeclare: null remet le pseudo par défaut', (await appel(sv, 'PUT', `/api/illustrations/${id1}`, { c: luma, corps: { artisteDeclare: null } })).json.illustration.artisteDeclare, 'luma');
        const pu = await appel(sv, 'PUT', `/api/illustrations/${pubA}`, { c: luma, corps: { titre: 'Autre titre' } });
        H.v('   un art PUBLIC : le titre et l\'artiste ne se changent plus (la modération a jugé ce texte) — 409 CONFLIT etat', [pu.statut, code(pu), detail(pu), (await brut('arts').findOne({ _id: pubA })).nom], [409, 'CONFLIT', 'etat', 'Art accepté']);
        H.v('   … mais ses ambiances et ses formats (listes fermées) se changent', (await appel(sv, 'PUT', `/api/illustrations/${pubA}`, { c: luma, corps: { ambiances: ['mer'] } })).statut, 200);
    }

    // ═══ 4. LES REFUS, DANS L'ORDRE : SESSION, ORIGINE, LIMITE_DEBIT ═══
    {
        H.v('sans session : 401 SESSION ; sans Origin : 403 ORIGINE (PUT, DELETE, publication, dépublication)', await Promise.all([['PUT', `/api/illustrations/${id1}`], ['DELETE', `/api/illustrations/${id1}`], ['POST', `/api/illustrations/${id1}/publication`], ['DELETE', `/api/illustrations/${id1}/publication`]].map(async ([m, ch]) => [code(await H.appel(sv.url, ch, { methode: m, corps: m === 'PUT' || m === 'POST' ? {} : undefined, entetes: { 'x-forwarded-for': B.IP(), origin: SITE, 'x-rat-market': '1' } })), code(await appel(sv, m, ch, { c: luma, corps: m === 'PUT' || m === 'POST' ? {} : undefined, sansSite: true }))])), Array(4).fill(['SESSION', 'ORIGINE']));
        const svL = await serveur(variante({}, { ecrituresCompteHeure: 1 }));
        const pl = await compte({}, 'limite-ill'), al = await artPublic(pl, { etat: 'prive', publieLe: null });          // un compte NEUF : les compteurs d'écriture sont partagés par compte
        const r1 = await appel(svL, 'PUT', `/api/illustrations/${al}`, { c: pl, corps: { ambiances: ['douce'] } }), r2 = await appel(svL, 'PUT', `/api/illustrations/${al}`, { c: pl, corps: { ambiances: [] } });
        H.v('la limite d\'écriture : 429 LIMITE_DEBIT avec reessayerDans', [r1.statut, r2.statut, code(r2), Number.isInteger(r2.json.erreur.reessayerDans)], [200, 429, 'LIMITE_DEBIT', true]);
    }

    // ═══ 5. PUBLICATION d'une illustration PRIVÉE ═══
    const priv = await artPublic(luma, { nom: 'Privée', etat: 'prive', publieLe: null });
    for (const k of cleDe(priv).attente) stockage.poser(k, Buffer.from('image-privee'));          // un art fabriqué n'a pas d'objet : l'acceptation en copie
    const pub =(c, id, corps, s = svP) => appel(s, 'POST', `/api/illustrations/${id}/publication`, { c, corps });
    {
        H.v('sans pseudo : 403 INTERDIT pseudo-requis', [code(await pub(sansPseudo, priv, certifie())), detail(await pub(sansPseudo, priv, certifie()))], ['INTERDIT', 'pseudo-requis']);
        H.v('sans certification d\'auteur : 400 auteur-non-certifie ; certifieAuteur false : le même ; champ inconnu : corps', [detail(await pub(luma, priv, { cgu: '2026-10' })), detail(await pub(luma, priv, { certifieAuteur: false, cgu: '2026-10' })), detail(await pub(luma, priv, { ...certifie(), zzz: 1 }))], ['auteur-non-certifie', 'auteur-non-certifie', 'corps']);
        H.v('   ambiance hors liste : 400 ambiances ; cgu absente : 400 cgu', [detail(await pub(luma, priv, certifie({ ambiances: ['gore'] }))), detail(await pub(luma, priv, { certifieAuteur: true }))], ['ambiances', 'cgu']);
        H.v('   rien n\'a changé par ces refus', (await brut('arts').findOne({ _id: priv })).etat, 'prive');
        const ok = await pub(luma, priv, certifie({ artisteDeclare: 'Luma', ambiances: ['douce'], formats: ['2x2'] }));
        const d = await brut('arts').findOne({ _id: priv });
        H.v('POST …/publication : 200 { success, illustration } « en-attente », certification des droits posée avec la version des CGU', [ok.statut, cles(ok.json), ok.json.illustration.visibilite, d.etat, d.certification.droits, d.certification.nonOfficielle, d.certification.cgu, d.ambiances, d.formats, d.artisteDeclare], [200, ['success', 'illustration'], 'en-attente', 'en-attente', true, true, '2026-10', ['douce'], ['2x2'], 'Luma']);
        const file = await appel(sv, 'GET', '/api/admin/moderation?file=publications', { c: modo, sansSite: true });
        H.v('   la modération la voit (avec un aperçu signé)', [file.json.elements.some(e => e.id === `art.${priv}`), Boolean((file.json.elements.find(e => e.id === `art.${priv}`) || { cible: {} }).cible.image)], [true, true]);
        H.v('   publier une illustration déjà en attente : 200, rien ne change (idempotent)', [(await pub(luma, priv, certifie())).statut, (await brut('arts').findOne({ _id: priv })).etat], [200, 'en-attente']);
        H.v('   publier une illustration REFUSÉE : 409 CONFLIT etat (ses objets sont partis)', [(await pub(luma, refusee, certifie())).statut, detail(await pub(luma, refusee, certifie()))], [409, 'etat']);
        const ap = await decider('art', priv, 'accepter');
        H.v('   acceptée : publique, dans la banque, les objets d\'attente partis, la copie publique posée', [ap.statut, (await brut('arts').findOne({ _id: priv })).etat, (await lire(sv, '/api/banque')).json.arts.some(a => a.id === priv), cleDe(priv).attente.some(k => stockage.objets.has(k)), cleDe(priv).pub.every(k => stockage.objets.has(k))], [200, 'public', true, false, true]);
        H.v('   publier une illustration déjà PUBLIQUE : 200, rien ne change', [(await pub(luma, priv, certifie())).statut, (await brut('arts').findOne({ _id: priv })).etat], [200, 'public']);
    }

    // ═══ 6. DÉPUBLIER : en attente → privé ; public → privé (la copie privée revient, la publique part, les votes s'effacent) ═══
    {
        const dA = await deposer(sv, luma, { nom: 'Attente' });                                                 // en attente
        const rA = await appel(sv, 'DELETE', `/api/illustrations/${dA.id}/publication`, { c: luma });
        H.v('DELETE …/publication d\'une illustration EN ATTENTE : 200, « prive », sortie de la file de modération (une décision tardive se heurte à l\'état)', [rA.statut, cles(rA.json), rA.json.illustration.visibilite, (await decider('art', dA.id, 'accepter')).statut], [200, ['success', 'illustration'], 'prive', 409]);
        H.v('   ses objets privés sont toujours là (elle redevient une illustration privée, pas une illustration perdue)', cleDe(dA.id).attente.every(k => stockage.objets.has(k)), true);
        H.v('   la dépublier encore : 200 sans effet', (await appel(sv, 'DELETE', `/api/illustrations/${dA.id}/publication`, { c: luma })).statut, 200);
        // public → privé
        const dP = await deposer(sv, luma, { nom: 'Publique' });
        await decider('art', dP.id, 'accepter');
        await appel(sv, 'PUT', `/api/illustrations/${dP.id}/jaime`, { c: noa });
        H.v('instrument : l\'art est public, aimé par un autre compte, sans objet d\'attente', [(await brut('arts').findOne({ _id: dP.id })).etat, (await brut('arts').findOne({ _id: dP.id })).nbJaime, cleDe(dP.id).attente.some(k => stockage.objets.has(k))], ['public', 1, false]);
        stockage.panneCopie = true;
        const rPanne = await appel(sv, 'DELETE', `/api/illustrations/${dP.id}/publication`, { c: luma });
        stockage.panneCopie = false;
        H.v('la copie privée ne peut pas être refaite (panne R2) : 503 INDISPONIBLE, RIEN n\'a changé (toujours public, copie publique intacte, vote gardé)', [rPanne.statut, code(rPanne), (await brut('arts').findOne({ _id: dP.id })).etat, cleDe(dP.id).pub.every(k => stockage.objets.has(k)), await brut('votes').countDocuments({ cible: dP.id })], [503, 'INDISPONIBLE', 'public', true, 1]);
        const rP = await appel(sv, 'DELETE', `/api/illustrations/${dP.id}/publication`, { c: luma });
        const aP = await brut('arts').findOne({ _id: dP.id });
        H.v('DELETE …/publication d\'une illustration PUBLIQUE : 200, « prive », la copie privée revient, la copie publique est effacée, plus dans la banque', [rP.statut, rP.json.illustration.visibilite, aP.etat, cleDe(dP.id).attente.every(k => stockage.objets.has(k)), cleDe(dP.id).pub.some(k => stockage.objets.has(k)), (await lire(sv, '/api/banque')).json.arts.some(a => a.id === dP.id)], [200, 'prive', 'prive', true, false, false]);
        H.v('   ses votes sont effacés et son compteur remis à zéro', [await brut('votes').countDocuments({ cible: dP.id }), aP.nbJaime, aP.publieLe], [0, 0, null]);
        H.v('   l\'auteur la relit en privé (URL signées) et peut la republier', [(await appel(sv, 'GET', '/api/illustrations', { c: luma, sansSite: true })).json.illustrations.find(x => x.id === dP.id).visibilite, (await pub(luma, dP.id, certifie())).json.illustration.visibilite], ['prive', 'en-attente']);
        // refusée / retirée : rien à retirer
        H.v('   dépublier une illustration refusée : 200, elle reste refusée', [(await appel(sv, 'DELETE', `/api/illustrations/${refusee}/publication`, { c: luma })).statut, (await brut('arts').findOne({ _id: refusee })).etat], [200, 'refuse']);
    }

    // ═══ 7. SUPPRIMER : les objets R2 partent (privé ET public), les zones qui la citent se lisent null, la place se libère ═══
    {
        const dS = await deposer(sv, luma, { nom: 'À supprimer' });
        await decider('art', dS.id, 'accepter');
        const dQ = await deposer(sv, luma, { nom: 'Privée à supprimer' });
        // un classeur de l'auteur et celui d'un autre (qui cite l'art public) : la lecture ne tombe pas, la zone se lit null
        const pg = id => ({ nb: 9, blocs: [{ c: 0, r: 0, l: 1, h: 1, genre: 'art', contenu: { type: 'art', artId: id } }, { c: 1, r: 0, l: 1, h: 1, genre: 'carte', contenu: { type: 'carte', cle: '1234|001', setSlug: 'Base-Set' } }] });
        const clMien = await appel(sv, 'POST', '/api/classeurs', { c: luma, corps: { titre: 'Mien', pages: [pg(dS.id)], couverture: { illustration: dQ.id } } });
        const clAutre = await appel(sv, 'POST', '/api/classeurs', { c: noa, corps: { titre: 'Autrui', pages: [pg(dS.id)] } });
        await appel(sv, 'PUT', `/api/illustrations/${dS.id}/jaime`, { c: noa });
        const avant = (await brut('arts').findOne({ _id: dS.id })).nbJaime;
        const r = await appel(sv, 'DELETE', `/api/illustrations/${dS.id}`, { c: luma });
        H.v('DELETE /api/illustrations/{id} : 200 { success: true } ; le document, les objets privés ET publics, les votes et le dépôt disparaissent', [avant, r.statut, r.json, await brut('arts').countDocuments({ _id: dS.id }), [...cleDe(dS.id).attente, ...cleDe(dS.id).pub].some(k => stockage.objets.has(k)), await brut('votes').countDocuments({ cible: dS.id }), await brut('depots').countDocuments({ artId: dS.id })], [1, 200, { success: true }, 0, false, 0, 0]);
        const lm = await appel(sv, 'GET', `/api/classeurs/${clMien.json.classeur.id}`, { c: luma, sansSite: true }), la = await appel(sv, 'GET', `/api/classeurs/${clAutre.json.classeur.id}`, { c: noa, sansSite: true });
        H.v('   les zones qui la citent se lisent null, chez l\'auteur ET chez un autre compte, sans casser la lecture ; la carte voisine reste', [lm.statut, lm.json.classeur.pages[0].blocs[0].contenu, lm.json.classeur.pages[0].blocs[1].contenu.cle, la.statut, la.json.classeur.pages[0].blocs[0].contenu], [200, null, '1234|001', 200, null]);
        H.v('   l\'avoir supprimée deux fois : 404 INTROUVABLE', code(await appel(sv, 'DELETE', `/api/illustrations/${dS.id}`, { c: luma })), 'INTROUVABLE');
        // une panne R2 pendant la suppression : la clé entre dans la file de reprise, l'illustration est partie quand même
        stockage.panneSuppression = true;
        const rPanne = await appel(sv, 'DELETE', `/api/illustrations/${dQ.id}`, { c: luma });
        stockage.panneSuppression = false;
        H.v('panne R2 pendant la suppression : 200 quand même, le document est parti, les clés sont en FILE de reprise (le balayeur les rejoue)', [rPanne.statut, await brut('arts').countDocuments({ _id: dQ.id }), await brut('purges_r2').countDocuments({ _id: { $in: cleDe(dQ.id).attente } })], [200, 0, 2]);
        const b = await require('../galerie/balayeur').passe({ stockage });
        H.v('   la passe du balayeur efface ces objets et vide la file', [b.purgesRejouees >= 2, cleDe(dQ.id).attente.some(k => stockage.objets.has(k)), await brut('purges_r2').countDocuments({ _id: { $in: cleDe(dQ.id).attente } })], [true, false, 0]);
        // la borne de 30 : une suppression libère la place
        const svB = await serveur(variante({ V2_ILLUSTRATIONS_MAX: '1' })), pB = await compte({}, 'borne-ill');
        const o1 = await deposer(svB, pB, { nom: 'Une' }), o2 = await appel(svB, 'POST', '/api/illustrations/depot', { c: pB, corps: { type: 'image/png', octets: 1000 } });
        const lib = await appel(svB, 'DELETE', `/api/illustrations/${o1.id}`, { c: pB }), o3 = await appel(svB, 'POST', '/api/illustrations/depot', { c: pB, corps: { type: 'image/png', octets: 1000 } });
        H.v('la borne d\'illustrations (1 ici) : la deuxième est refusée 409 borne-illustrations ; une suppression libère la place', [o1.fin.statut, o2.statut, detail(o2), lib.statut, o3.statut], [201, 409, 'borne-illustrations', 200, 201]);
    }

    // ═══ 8. LE QUOTA DE PUBLICATIONS EST PARTAGÉ AVEC LES CLASSEURS ═══
    {
        const svQ = await serveur(variante({}, { publicationsCompteJour: 2 })), p = await compte({}, 'quota-pub');
        const iA = await artPublic(p, { etat: 'prive', publieLe: null }), iB = await artPublic(p, { etat: 'prive', publieLe: null });
        const cl = await appel(svQ, 'POST', '/api/classeurs', { c: p, corps: { titre: 'Q', pages: [{ nb: 9, blocs: [{ c: 0, r: 0, l: 1, h: 1, genre: 'carte', contenu: { type: 'carte', cle: '1|1', setSlug: 'Base-Set' } }] }] } });
        const r1 = await appel(svQ, 'POST', `/api/classeurs/${cl.json.classeur.id}/publication`, { c: p, corps: certifie() });
        const r2 = await pub(p, iA, certifie(), svQ), r3 = await pub(p, iB, certifie(), svQ);
        H.v('2 publications par jour (ici) : un classeur puis une illustration passent, la troisième (une illustration) est 429 LIMITE_DEBIT — UN seul compteur pour les deux', [r1.statut, r2.statut, r3.statut, code(r3), Number.isInteger(r3.json.erreur.reessayerDans), (await brut('arts').findOne({ _id: iB })).etat], [200, 200, 429, 'LIMITE_DEBIT', true, 'prive']);
    }

    // ═══ 9. LE BALAYEUR NE TOUCHE PAS À UNE ILLUSTRATION PRIVÉE ═══
    {
        const p = await compte({}, 'balai');
        const dB = await deposer(sv, p, { nom: 'Privée vieille' });
        await appel(sv, 'DELETE', `/api/illustrations/${dB.id}/publication`, { c: p });          // en attente → privée
        for (const k of cleDe(dB.id).attente) stockage.dates.set(k, new Date(Date.now() - 3 * 24 * 3600e3));
        stockage.poser('galerie/attente/orphelinOrphelin0000AbCd.webp', Buffer.from('x'), 3 * 24 * 3600e3);
        await require('../galerie/balayeur').passe({ stockage, ageMs: 24 * 3600e3 });
        H.v('une illustration PRIVÉE vieille de 3 jours garde ses objets au passage du balayeur ; un orphelin de 3 jours est retiré', [cleDe(dB.id).attente.every(k => stockage.objets.has(k)), stockage.objets.has('galerie/attente/orphelinOrphelin0000AbCd.webp')], [true, false]);
    }

    // ═══ 10. LES GARDES SAVENT DIRE NON (copies mutées) ═══
    {
        const p = await compte({}, 'mut-ill'), autre = await compte({}, 'mut-autre');
        const a = await artPublic(p, { etat: 'prive', publieLe: null });
        const reel = require('../galerie/illustrations');
        const sansAuteur = A.charger('illustrations.js', [["const d = await trouver(id, mien);", "const d = await G.col('arts').findOne({ _id: id });"], ["{ _id: id, auteurId: mien, ...(texte ? { etat: { $ne: 'public' } } : {}) }", "{ _id: id }"]]);
        const r1 = await reel.modifier({ compteId: autre.id, id: a, corps: { ambiances: ['douce'] } }), m1 = await sansAuteur.modifier({ compteId: autre.id, id: a, corps: { ambiances: ['douce'] } });
        H.v('garde d\'auteur : le réel répond introuvable à un autre compte, le mutant (sans l\'auteur dans la recherche) modifie l\'illustration d\'autrui', [Boolean(r1.introuvable), Boolean(m1.illustration)], [true, true]);
        const sansCopie = A.charger('illustrations.js', [["await stockage.copier(`${d.clePublique}${s}`, `${d.cle}${s}`);", "/* copie retirée */"]]);
        const dP = await deposer(sv, p, { nom: 'Mutant' }); await decider('art', dP.id, 'accepter');
        const rm = await sansCopie.depublier({ compteId: p.id, id: dP.id, stockage, maintenant: new Date() });
        H.v('MUTANT « la copie privée n\'est plus refaite avant de dépublier » : l\'illustration passe privée SANS ses objets d\'attente (le réel les refait)', [rm.ok === true, cleDe(dP.id).attente.some(k => stockage.objets.has(k))], [true, false]);
        const sansPurge = A.charger('illustrations.js', [["for (const k of [...svc.clesDe(d.cle), ...svc.clesDe(d.clePublique)]) await svc.supprimerOuFile(stockage, k, 'suppression-illustration');", "/* objets gardés */"]]);
        const dX = await deposer(sv, p, { nom: 'Mutant 2' });
        await sansPurge.supprimer({ compteId: p.id, id: dX.id, stockage });
        H.v('MUTANT « les objets R2 ne sont plus effacés à la suppression » : le document part, les objets restent (le réel les efface)', [await brut('arts').countDocuments({ _id: dX.id }), cleDe(dX.id).attente.some(k => stockage.objets.has(k))], [0, true]);
    }

    await B.fermer();
    H.bilan();
})();
