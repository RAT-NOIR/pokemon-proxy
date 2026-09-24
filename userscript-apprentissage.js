// ==UserScript==
// @name         Rat-Market — Apprentissage manuel Cardmarket
// @namespace    rat-market
// @version      1.5
// @description  Apprend chaque page de galerie Singles dès son chargement. Lit UNIQUEMENT la page ouverte — ne navigue jamais.
// @match        https://www.cardmarket.com/*/Pokemon/Products/Singles*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      pokemon-proxy-ratnoir666.onrender.com
// @run-at       document-idle
// ==/UserScript==

// ============================================================
// CE QUI A CHANGÉ EN 1.5 — 2026-09-24, POUR LE PASSAGE DES 30 EXPANSIONS JAMAIS APPRISES
// ============================================================
// 0. « Identifiant utilisateur manquant » : c'était la 1.3 en service. Le serveur exige `userId` depuis 707692a ;
//    la 1.4 l'envoyait déjà, la 1.5 le garde (généré une fois, persisté par GM_setValue).
// 1. L'APPRENTISSAGE PART AU CHARGEMENT DE LA PAGE (case « auto », cochée par défaut). On ne clique plus : on tourne
//    les pages. Le script lit toujours la seule page ouverte et ne navigue jamais de lui-même.
// 2. UN ENVOI PAR PAGE, PAS PAR 25 CARTES. Le limiteur du serveur compte des REQUÊTES (120/h/IP), pas des cartes :
//    découper une page en lots de 25 dépensait 2 à 4 requêtes pour rien. Jusqu'à 200 cartes par envoi (~50 Ko, sous
//    la limite de 100 Ko d'express.json()).
// 3. UNE PAGE LUE N'EST JAMAIS PERDUE (§38 : une source a une cadence ET une reprise). Chaque page lue entre dans une
//    file locale (GM_setValue) AVANT l'envoi et n'en sort qu'au succès :
//      · 503 « le serveur se réveille » (Render endormi) : on interroge /ping jusqu'à ce que Mongo réponde, puis on
//        renvoie — le serveur refuse un lot à froid plutôt que de l'écrire amputé ;
//      · 429 (limite de 120/h) : reprise AUTOMATIQUE à l'heure que le serveur donne (en-tête RateLimit-Reset). Les
//        pages lues entre-temps partent GROUPÉES, jusqu'à 200 cartes : dix pages pour une seule requête ;
//      · coupure réseau : trois essais à 15 s, puis reprise dans 2 min ;
//      · 400 / 401 / erreur serveur : arrêt et message — ce sont des défauts à corriger, pas à marteler.
//    La file survit à la fermeture de l'onglet : elle repart au prochain chargement d'une page Singles.
// 4. UNE PAGE DÉJÀ APPRISE N'EST PAS RENVOYÉE (le budget de 120/h sert aux pages neuves) ; « Réapprendre » force.
// 5. LA LISTE DU 25/09 EST DANS LE SCRIPT (APPRENTISSAGE-2026-09-25.md) : position de l'expansion ouverte, nombre de
//    terminées, et la suivante. Son lien est l'URL du FILTRE D'EXPANSION du site (`?idCategory=51&idExpansion=N`, celle
//    que live-cardmarket.js ouvrait, SANS `perSite` — le paramètre qui avait valu un ban) : c'est toi qui cliques.
// 6. Touche N : ouvre le lien « page suivante » QUE LA PAGE AFFICHE. Un raccourci pour ta main, pas une navigation.
// 7. La page « 1015 » de Cardmarket est reconnue : le panneau dit de s'arrêter, la file et la liste sont gardées.
// 8. Le serveur COMPLÈTE désormais les lignes exactes sans slug (slug, slugSet, nomFr, variante — jamais le numéro) :
//    246 lignes étaient sautées à chaque passage. Le panneau les compte (« complétées »).
//
// ⚠️ CE QUE LA ROUTE NE FAIT PAS, ET QUE LE PANNEAU DIT : une carte SANS numéro (ni dans le titre, ni dans le slug)
// n'est pas écrite (« sans numéro ignorées »). Les énergies de base (6697, 5415) risquent de n'apporter rien.

// ============================================================
// CE QUI RESTE DE 1.3 ET 1.4 — LES RÈGLES QUI TIENNENT
// ============================================================
// · La query string est retirée du slug (« ?language=2 » donnait le numéro « 2 »).
// · Le numeroUrl n'est PAS envoyé : le serveur le recalcule (scoring.numeroDepuisSlug), la règle vit à un seul endroit.
// · Le numéro du TITRE (« Nom (CODE 176) ») est la vraie prise ; le panneau compte les cartes qui en ont un.
// · Aucun paramètre d'URL fabriqué pour tourner les pages : on suit le lien « page suivante » de la page.
// · Un lot sur plusieurs expansions n'a pas de couverture : c'est dit, jamais tu.

(function () {
  'use strict';

  // ===================== À CONFIGURER =====================
  const URL_API = 'https://pokemon-proxy-ratnoir666.onrender.com';
  const JETON = 'K10-Sr7izvo-CG3bSRfCbhSnw8KTNrbJ';
  const MAX_CARTES_PAR_ENVOI = 200;
  const SEUIL_TERMINEE = 90;           // % de produits numérotés à partir duquel une expansion est « terminée »
  const REVEIL_MAX_MS = 120000, PAUSE_REVEIL_MS = 5000, ESSAIS_RESEAU = 3;

  // La liste du 25/09, dans l'ordre (APPRENTISSAGE-2026-09-25.md). Les 12 dernières sont connues : 29 produits neufs.
  const LISTE = [
    [6601, '30th Celebration (anglais) — à compléter'], [6604, '30th Celebration — version 158 cartes'],
    [6628, 'Premium Deck Set Espeon & Umbreon (1)'], [6774, 'Premium Deck Set Espeon & Umbreon (2)'],
    [6602, '30th Celebration — version 135 cartes + Espeon ex'], [6603, '30th Celebration — version 135 cartes'],
    [6700, 'set chinois ère Soleil et Lune'], [6767, '30th Celebration Live Code Card (2 vraies cartes)'],
    [1537, 'Aquapolis — pose les slugs'], [6673, 'Grookey, Rillaboom V (380)'], [6633, 'Crustle, Ethan\'s Pinsir (287)'],
    [6699, 'TAG TEAM GX (266)'], [6669, 'Applin, Alolan Dugtrio (196)'], [6694, 'Detective Pikachu (187)'],
    [6672, 'Scorbunny, Grookey (146)'], [6634, 'Lugia ex, Kecleon (141)'], [6636, 'Heracross, Surskit (113)'],
    [6635, 'Teal Mask Ogerpon ex (97)'], [6637, 'Jolteon, Rotom, Pawmi (20)'], [6638, 'Carvanha, Liepard, Darkrai (20)'],
    [6639, 'Shaymin, Sprigatito (18)'], [6683, 'Pikachu [Scrappy Spark] (2)'], [6697, 'énergies de base (80)'],
    [5874, 'Lapras ex, Mudkip (19)'], [5875, 'Magmar ex, Torchic (19)'], [5876, 'Scyther ex, Treecko (19)'],
    [5716, 'Staryu, Ditto (15)'], [5717, 'Ponyta, Ditto (15)'], [5415, 'énergies de base (9)'], [6354, 'Raihan, Bea, Leon (8)'],
    ...[6324, 6514, 6232, 3143, 1745, 6393, 6392, 6391, 6230, 1539, 4290, 4170].map(id => [id, 'connue : produits neufs'])
  ];

  // ===== Stockage du script (GM_*, jamais localStorage : celui-là appartient au site) =====
  const lire = (cle, defaut) => { try { const v = GM_getValue(cle, defaut); return v === undefined ? defaut : v; } catch (_) { return defaut; } };
  const garder = (cle, v) => { try { GM_setValue(cle, v); } catch (_) { /* non persisté : la session continue */ } };
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // L'identifiant : STABLE d'une session à l'autre, pour que les refus tracés côté serveur désignent le même poste.
  function identifiantUtilisateur() {
    const id = lire('rm_userId', null);
    if (typeof id === 'string' && id) return id;
    const neuf = 'rm-' + ((self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    garder('rm_userId', neuf);
    return neuf;
  }
  const ID_UTILISATEUR = identifiantUtilisateur();

  // ===== Lecture de la page (inchangée depuis 1.3 : même logique que scraperListeExpansion) =====
  function lireCartesDeLaPage() {
    const cartes = [];
    document.querySelectorAll('a.galleryBox').forEach(a => {
      const img = a.querySelector('img');
      const src = (img && (img.getAttribute('data-echo') || img.getAttribute('src'))) || '';
      const mImg = src.match(/\/(\d+)\/(\d+)\.jpg/i);
      if (!mImg) return;
      const idProduct = parseInt(mImg[1], 10);
      if (!idProduct) return;
      const mCode = src.match(/cardmarket\.com\/\d+\/([^/]+)\//i);
      let codeSet = mCode ? mCode[1] : null;
      if (codeSet) { try { codeSet = decodeURIComponent(codeSet); } catch (_) { /* brut */ } }
      const nomFr = (img && img.getAttribute('alt') || '').trim() || null;
      const h2 = a.querySelector('h2');
      let numero = null;
      if (h2) { const m = h2.textContent.trim().match(/\(([^)\s]+)\s+([^)\s]+)\)\s*$/); if (m) numero = m[2]; }
      const morceaux = (a.getAttribute('href') || '').split('/').filter(Boolean);
      const dernierSegment = (morceaux[morceaux.length - 1] || '').split('?')[0];
      const slugSet = morceaux[morceaux.length - 2] || null;
      const mVar = dernierSegment.match(/-(V\d+)-/i);
      cartes.push({ idProduct, numero, codeSet, nomFr, variante: mVar ? mVar[1].toUpperCase() : null, slug: dernierSegment || null, slugSet });
    });
    return cartes;
  }

  // ===== Contexte : quelle expansion, quelle page — LU, jamais fabriqué =====
  function contexteDeLaPage(cartes) {
    const params = new URLSearchParams(location.search);
    const morceaux = location.pathname.split('/').filter(Boolean);
    const dernier = morceaux[morceaux.length - 1] || '';
    // Sur la page du filtre (`Singles?idExpansion=N`), le chemin se termine par « Singles » : le slug vient des cartes.
    const slugSet = (dernier && dernier !== 'Singles' ? dernier : null) || (cartes[0] && cartes[0].slugSet) || '?';
    const idUrl = parseInt(params.get('idExpansion') || '', 10) || null;
    const page = parseInt(params.get('site') || '1', 10) || 1;
    let pages = null;
    for (const el of document.querySelectorAll('.pagination a, .pagination span, nav a, nav span')) {
      const m = (el.textContent || '').trim().match(/^(\d+)$/);
      if (m) pages = Math.max(pages || 0, parseInt(m[1], 10));
    }
    let hrefSuivant = null;
    const lienRel = document.querySelector('a[rel="next"]');
    if (lienRel && lienRel.getAttribute('href')) hrefSuivant = lienRel.href;
    for (const a of hrefSuivant ? [] : document.querySelectorAll('.pagination a, nav a')) {
      const t = (a.textContent || '').trim();
      const aria = (a.getAttribute('aria-label') || '').toLowerCase();
      if ((t === String(page + 1) || /suivant|next/.test(aria) || /suivant|next/i.test(t)) && a.getAttribute('href')) { hrefSuivant = a.href; break; }
    }
    const langue = morceaux[0] || 'fr';
    return { slugSet, idUrl, page, pages, hrefSuivant, langue, cle: location.pathname + location.search };
  }

  // ===== Le serveur =====
  function envoyer(cartes) {
    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method: 'POST', url: URL_API + '/api/apprendre-lot', timeout: 60000,
        headers: { 'Content-Type': 'application/json', 'x-jeton': JETON },
        data: JSON.stringify({ userId: ID_UTILISATEUR, cartes }),
        onload: r => {
          let corps = null; try { corps = JSON.parse(r.responseText); } catch (_) { /* le statut reste utile */ }
          // Les en-têtes du limiteur (express-rate-limit, standardHeaders) : quand il reprend, et ce qui reste dans l'heure.
          const m = /^ratelimit-reset:\s*(\d+)/im.exec(r.responseHeaders || '');
          const reste = /^ratelimit-remaining:\s*(\d+)/im.exec(r.responseHeaders || '');
          if (reste) session.restant = parseInt(reste[1], 10);
          resolve({ status: r.status, corps, reset: m ? parseInt(m[1], 10) : null });
        },
        onerror: () => resolve({ status: 0, erreur: 'requête échouée' }),
        ontimeout: () => resolve({ status: 0, erreur: 'délai dépassé' })
      });
    });
  }
  function mongoPret() {
    return new Promise(resolve => GM_xmlhttpRequest({
      method: 'GET', url: URL_API + '/ping', timeout: 20000,
      onload: r => { try { resolve(JSON.parse(r.responseText).mongo === true); } catch (_) { resolve(false); } },
      onerror: () => resolve(false), ontimeout: () => resolve(false)
    }));
  }
  async function attendreReveil() {
    const debut = Date.now();
    while (Date.now() - debut < REVEIL_MAX_MS) {
      etat(`😴 Le serveur se réveille… ${Math.round((Date.now() - debut) / 1000)} s`);
      if (await mongoPret()) return true;
      await pause(PAUSE_REVEIL_MS);
    }
    return false;
  }

  // ===== La file locale : une page lue y entre AVANT l'envoi, n'en sort qu'au succès =====
  function enfiler(p) { const f = lire('rm_file', []).filter(x => x.cle !== p.cle); f.push(p); garder('rm_file', f); }
  function retirer(cles) { garder('rm_file', lire('rm_file', []).filter(x => !cles.includes(x.cle))); }
  // Les pages en tête de file, de la MÊME galerie, jusqu'à MAX_CARTES_PAR_ENVOI : une expansion par envoi, pour que le
  // serveur rende sa couverture ; un idProduct vu deux fois ne part qu'une fois.
  function prochainEnvoi(file) {
    const items = [], parId = new Map();
    for (const it of file) {
      if (items.length && it.slugSet !== items[0].slugSet) break;
      if (items.length && parId.size + it.cartes.length > MAX_CARTES_PAR_ENVOI) break;
      items.push(it);
      for (const c of it.cartes) parId.set(c.idProduct, c);
    }
    return { items, cartes: [...parId.values()] };
  }

  const session = { nouvelles: 0, ameliorees: 0, dejaExactes: 0, completees: 0, sansNumero: 0, envois: 0, restant: null };
  let enCours = false, reprise = null, repriseA = null, bloque = null;
  function planifier(ms) {
    clearTimeout(reprise); repriseA = Date.now() + ms;
    reprise = setTimeout(() => { repriseA = null; vider(); }, ms);
  }

  async function vider() {
    if (enCours || bloque) return;
    enCours = true; clearTimeout(reprise); repriseA = null;
    let reseau = 0;
    try {
      for (;;) {
        const file = lire('rm_file', []);
        if (!file.length) break;
        const { items, cartes } = prochainEnvoi(file);
        etat(`📤 Envoi : ${cartes.length} cartes${items.length > 1 ? ` (${items.length} pages groupées)` : ''}…`);
        const r = await envoyer(cartes);
        if (r.status === 200 && r.corps && r.corps.success) {
          reseau = 0; session.envois++;
          retirer(items.map(i => i.cle));
          noterSucces(items, r.corps);
          continue;
        }
        if (r.status === 503) { if (await attendreReveil()) continue; etat('😴 Serveur toujours endormi : nouvel essai dans 1 min.'); planifier(60000); break; }
        if (r.status === 429) { const s = r.reset != null ? r.reset : 300; etat(`⏳ Limite de 120 envois/h atteinte : reprise automatique dans ${Math.ceil(s / 60)} min. Tu peux continuer à tourner les pages.`); planifier(s * 1000 + 3000); break; }
        if (r.status === 0) { if (++reseau < ESSAIS_RESEAU) { etat(`📶 ${r.erreur} — nouvel essai dans 15 s (${reseau}/${ESSAIS_RESEAU - 1})`); await pause(15000); continue; } etat('📶 Réseau indisponible : nouvel essai dans 2 min.'); planifier(120000); break; }
        // 400, 401, ou 200 + success:false : un défaut, pas une surcharge. On s'arrête et on le dit ; la file est gardée.
        const aide = r.status === 400 ? ' — identifiant manquant : version du script à mettre à jour'
          : r.status === 401 ? ' — jeton refusé : JETON à recopier depuis le .env du serveur' : '';
        bloque = `❌ ${(r.corps && r.corps.error) || 'refus serveur'} (HTTP ${r.status})${aide}. Les pages restent dans la file.`;
        etat(bloque);
        break;
      }
    } finally { enCours = false; majPanneau(); }
  }

  function noterSucces(items, c) {
    for (const k of ['nouvelles', 'ameliorees', 'dejaExactes', 'completees', 'sansNumero']) session[k] += (c[k] || 0);
    const faites = lire('rm_pagesFaites', {});
    for (const it of items) faites[it.cle] = { le: Date.now(), n: it.cartes.length };
    const cles = Object.keys(faites); if (cles.length > 3000) for (const k of cles.sort((a, b) => faites[a].le - faites[b].le).slice(0, cles.length - 3000)) delete faites[k];
    garder('rm_pagesFaites', faites);
    const exps = Array.isArray(c.idExpansions) ? c.idExpansions : (c.idExpansion != null ? [c.idExpansion] : []);
    if (c.idExpansion != null) {
      const slugExp = lire('rm_slugExp', {}); for (const it of items) slugExp[it.slugSet] = c.idExpansion; garder('rm_slugExp', slugExp);
      const couv = lire('rm_couv', {});
      const precedent = couv[c.idExpansion] || {};
      // « terminée » : la couverture passe le seuil, OU la dernière page de la galerie vient d'être apprise.
      const derniere = items.some(it => it.derniere);
      couv[c.idExpansion] = { ...(c.couverture || {}), le: Date.now(), terminee: !!(precedent.terminee || derniere || (c.couverture && c.couverture.pourcent >= SEUIL_TERMINEE)) };
      garder('rm_couv', couv);
    }
    dernierBilan = { c, exps, pages: items.length };
  }

  // ===== Le panneau =====
  let dernierBilan = null;
  const cartesPage = lireCartesDeLaPage();
  const ctx = contexteDeLaPage(cartesPage);
  const avantPage = lire('rm_dernierePage', null);
  garder('rm_dernierePage', Date.now());

  const panneau = document.createElement('div');
  panneau.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:99999;background:#0d0d10;color:#eee;font:13px system-ui,sans-serif;' +
    'padding:12px 14px;border:1px solid #D4AF37;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.4);width:300px;line-height:1.45';
  document.body.appendChild(panneau);
  let ligneEtat = '';
  const etat = t => { ligneEtat = t; majPanneau(); };

  function idCourant() { return ctx.idUrl || lire('rm_slugExp', {})[ctx.slugSet] || null; }

  function majPanneau() {
    const couv = lire('rm_couv', {});
    const file = lire('rm_file', []);
    const id = idCourant();
    const rang = id != null ? LISTE.findIndex(([x]) => x === id) : -1;
    const terminees = LISTE.filter(([x]) => couv[x] && couv[x].terminee).length;
    const suivante = LISTE.find(([x]) => x !== id && !(couv[x] && couv[x].terminee));
    const avecNum = cartesPage.filter(c => c.numero).length;
    const faite = lire('rm_pagesFaites', {})[ctx.cle];
    const auto = lire('rm_auto', true);
    const cv = id != null ? couv[id] : null;
    let h = `<div style="display:flex;justify-content:space-between;align-items:center"><b>🐀 Apprentissage</b>` +
      `<label style="font-size:11px;color:#aaa;cursor:pointer"><input id="rm-auto" type="checkbox" ${auto ? 'checked' : ''} style="vertical-align:middle"> auto</label></div>`;
    h += `<div style="color:#888;font-size:11px;margin:2px 0 6px">exp ${esc(id ?? '?')} · ${esc(ctx.slugSet)} · page ${ctx.page}${ctx.pages ? '/' + ctx.pages : ''} · ${cartesPage.length} cartes (${avecNum} numérotées)` +
      (avantPage ? ` · page précédente il y a ${Math.round((Date.now() - avantPage) / 1000)} s` : '') + '</div>';
    h += `<div style="font-size:12px;margin-bottom:6px">📋 Liste du 25/09 : ${rang >= 0 ? `<b>n° ${rang + 1}/${LISTE.length}</b> — ${esc(LISTE[rang][1])}` : 'expansion hors liste'} · ${terminees} terminée(s)` +
      (suivante ? `<br>➡️ suivante : <a href="/${esc(ctx.langue)}/Pokemon/Products/Singles?idCategory=51&idExpansion=${suivante[0]}" style="color:#D4AF37">${suivante[0]} — ${esc(suivante[1])}</a>` : '<br>🎉 liste terminée') + '</div>';
    if (cv && cv.pourcent != null) {
      const coul = cv.pourcent >= SEUIL_TERMINEE ? '#67c23a' : cv.pourcent >= 50 ? '#e6a23c' : '#f56c6c';
      h += `<div style="color:${coul}">📊 expansion couverte à ${cv.pourcent} % (${cv.avecNumero}/${cv.produits})${cv.terminee ? ' — terminée ✅' : ''}</div>`;
    }
    if (dernierBilan) {
      const c = dernierBilan.c;
      h += `<div>✅ ${c.nouvelles} nouvelles · ${c.ameliorees} améliorées · ${c.dejaExactes} déjà exactes${c.completees ? ` (${c.completees} complétées)` : ''}${c.sansNumero ? ` · <span style="color:#e6a23c">${c.sansNumero} sans numéro ignorées</span>` : ''}</div>`;
      if (dernierBilan.exps.length > 1) h += `<div style="color:#e6a23c">⚠️ envoi sur ${dernierBilan.exps.length} expansions (${dernierBilan.exps.join(', ')}) : pas de couverture calculée.</div>`;
    }
    if (!cartesPage.length) h += `<div style="color:#e6a23c">${estPage1015() ? '🛑 Cardmarket te limite (erreur 1015). Arrête-toi un moment : ta file et ta liste sont gardées.' : 'Aucune carte lue : passe en vue GALERIE (icône grille).'}</div>`;
    else if (!avecNum) h += `<div style="color:#e6a23c">⚠️ aucune carte de la page n'a de numéro dans son titre.</div>`;
    if (faite && !file.some(x => x.cle === ctx.cle)) h += `<div style="color:#888">Page déjà apprise (${new Date(faite.le).toLocaleString()}).</div>`;
    if (ligneEtat) h += `<div style="margin-top:4px">${esc(ligneEtat)}</div>`;
    if (file.length) h += `<div style="color:#aaa;font-size:11px">📦 ${file.length} page(s) en attente d'envoi${repriseA ? ` · reprise ${new Date(repriseA).toLocaleTimeString()}` : ''}</div>`;
    if (session.envois || session.restant != null) h += `<div style="color:#777;font-size:11px">onglet : ${session.envois} envoi(s), ${session.nouvelles} nouvelles, ${session.ameliorees} améliorées${session.completees ? `, ${session.completees} complétées` : ''}` +
      (session.restant != null ? ` · reste ${session.restant} envoi(s) dans l'heure` : '') + '</div>';
    h += ctx.hrefSuivant ? `<div style="margin-top:6px"><a href="${esc(ctx.hrefSuivant)}" style="color:#D4AF37;font-weight:600">→ page suivante${ctx.pages ? ` (${ctx.page + 1}/${ctx.pages})` : ''}</a> <span style="color:#666;font-size:11px">touche N</span></div>`
      : (cartesPage.length ? '<div style="margin-top:6px;color:#888">Dernière page de cette galerie.</div>' : '');
    h += `<div style="display:flex;gap:6px;margin-top:8px"><button id="rm-go" style="flex:1;padding:6px;background:#0c0c0e;color:#D4AF37;border:1px solid #D4AF37;border-radius:6px;cursor:pointer;font-weight:600">${faite ? 'Réapprendre' : 'Apprendre'}</button>` +
      (file.length && !enCours ? '<button id="rm-vider" style="flex:1;padding:6px;background:#0c0c0e;color:#ccc;border:1px solid #555;border-radius:6px;cursor:pointer">Envoyer maintenant</button>' : '') + '</div>';
    panneau.innerHTML = h;
    panneau.querySelector('#rm-auto').addEventListener('change', e => { garder('rm_auto', e.target.checked); });
    panneau.querySelector('#rm-go').addEventListener('click', () => apprendreCettePage(true));
    const bv = panneau.querySelector('#rm-vider'); if (bv) bv.addEventListener('click', () => { bloque = null; vider(); });
  }

  function estPage1015() {
    const t = (document.title + ' ' + ((document.body && document.body.innerText) || '').slice(0, 3000));
    return /\b1015\b/.test(t) && /rate.?limit|limit/i.test(t);
  }

  function apprendreCettePage(forcer) {
    if (!cartesPage.length) { majPanneau(); return; }
    if (!forcer && lire('rm_pagesFaites', {})[ctx.cle]) { majPanneau(); vider(); return; }
    enfiler({ cle: ctx.cle, slugSet: ctx.slugSet, cartes: cartesPage, le: Date.now(), derniere: !ctx.hrefSuivant });
    bloque = null;
    vider();
  }

  // Touche N : le lien « page suivante » que la page affiche. Jamais quand on tape dans un champ.
  document.addEventListener('keydown', e => {
    if ((e.key !== 'n' && e.key !== 'N') || e.ctrlKey || e.metaKey || e.altKey) return;
    const cible = e.target; if (cible && (cible.isContentEditable || /^(input|textarea|select)$/i.test(cible.tagName))) return;
    if (ctx.hrefSuivant) location.href = ctx.hrefSuivant;
  });
  // Le décompte « page précédente il y a » et la reprise se rafraîchissent seuls.
  setInterval(() => { if (!enCours) majPanneau(); }, 15000);

  majPanneau();
  if (lire('rm_auto', true)) apprendreCettePage(false);
  else vider();   // même en manuel, une file laissée par une page précédente repart
})();
