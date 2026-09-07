// ==UserScript==
// @name         Rat-Market — Apprentissage manuel Cardmarket
// @namespace    rat-market
// @version      1.4
// @description  Bouton "Apprendre cette page" sur les galeries Singles. Lit UNIQUEMENT la page ouverte — ne navigue jamais.
// @match        https://www.cardmarket.com/*/Pokemon/Products/Singles*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      pokemon-proxy-ratnoir666.onrender.com
// @run-at       document-idle
// ==/UserScript==

// ============================================================
// CE QUI A CHANGÉ EN 1.4 — 2026-09-07, LE CONTRAT A BOUGÉ CÔTÉ SERVEUR
// ============================================================
// 1. `userId` EST OBLIGATOIRE. `/api/apprendre-lot` répond 400 sans lui depuis le commit
//    707692a (durcissement : ces routes écrivent `numeros_cartes` et `codes_set`, les deux
//    seules tables non régénérables du projet, et n'étaient gardées que par un jeton
//    partagé extractible du script). On génère un identifiant UNE fois et on le persiste
//    par `GM_setValue` : c'est une IDENTITÉ, pas un décompte — aucun crédit n'est débité.
//    ⚠️ Il doit être STABLE. Un identifiant régénéré à chaque chargement rendrait les
//    refus du serveur intraçables, ce qui est exactement ce que la garde cherche à offrir.
//
// 2. UN LOT MIXTE NE PASSE PLUS POUR UN SUCCÈS SILENCIEUX. Le serveur lit désormais
//    l'`idExpansion` PAR CARTE ; quand un lot en touche plusieurs, il rend
//    `idExpansion: null` ET `couverture: null`, avec la liste dans `idExpansions`.
//    L'ancien script affichait alors « ✅ n nouvelles » sans couverture et sans un mot —
//    l'utilisateur ne pouvait pas distinguer « galerie finie » de « lot mêlé ». La
//    couverture manquante est maintenant EXPLIQUÉE, jamais tue.
//
// 3. LE CODE HTTP EST LU. `onload` résolvait la réponse quel que soit le statut : un 400
//    ou un 429 (limiteur d'apprentissage, 120/h/IP) arrivait comme un objet sans `success`
//    et sortait en « refus serveur » sans son code. On le rend maintenant.
//
// ⚠️ CE QUI N'EST PAS AJOUTÉ, ET POURQUOI. `/api/apprendre` (au singulier) peut désormais
// répondre `success:false, refuse:'ligne-exacte-existante'`. CE SCRIPT NE L'APPELLE PAS —
// il n'emprunte que `/api/apprendre-lot`. Écrire ici un traitement pour une réponse qu'on
// ne peut pas recevoir fabriquerait du code mort qui a l'air d'une garde : c'est
// exactement ce que la règle « soit on le branche, soit on le supprime » interdit. Le cas
// est consigné au chantier, à traiter par le client qui appelle réellement cette route.

// ============================================================
// CE QUI A CHANGÉ EN 1.3, ET POURQUOI
// ============================================================
// 1. LA QUERY STRING EST RETIRÉE DU SLUG. La 1.1 prenait le dernier segment de l'href
//    tel quel, donc "Rotom-mC248?language=2", et en extrayait les chiffres de FIN : le
//    "2" de `language`. Puis elle envoyait ce "2" comme numeroUrl. C'est exactement le
//    bug qu'on vient de corriger sur 20 917 documents — le script les aurait repollués.
//
// 2. LE numeroUrl N'EST PLUS ENVOYÉ DU TOUT. Le serveur le recalcule lui-même depuis le
//    slug, avec la seule règle qui fait foi (scoring.numeroDepuisSlug). L'ancienne règle
//    /(\d+)$/ avalait aussi les chiffres du code de set : "sI100340" donnait 100340 au
//    lieu de 340, et 28,4 % des numeroUrl étaient faux. Le client n'a plus à connaître
//    cette règle, donc plus à s'en écarter.
//
// 3. LE NUMÉRO DU TITRE EST LA VRAIE PRISE. C'est lui qui fait foi ("Nom (CODE 176)").
//    Le panneau affiche donc combien de cartes de la page en ont un — c'est ça qui
//    mesure l'utilité du passage, pas le nombre de cartes lues.
//
// 4. LA COUVERTURE DE L'EXPANSION est affichée après chaque envoi. Sans elle, on ne sait
//    pas quand une galerie est finie. Le serveur la renvoie désormais.
//
// 5. PAGINATION visible, MAIS AUCUN paramètre d'URL ajouté. La 1.2 proposait
//    "?perSite=100" pour tourner moins de pages : Cloudflare y a répondu par un ban.
//    Un paramètre inhabituel sur une galerie ressemble à du scraping, et c'est
//    exactement ce que la répartition des rôles cherche à éviter — on navigue comme un
//    humain, page par page, avec les URL que le site propose lui-même. Le script se
//    contente donc d'AFFICHER où on en est et de reprendre le lien "page suivante"
//    présent dans la page. Il ne fabrique aucune URL et ne navigue jamais de lui-même.

(function () {
  'use strict';

  // ===================== À CONFIGURER =====================
  const URL_API    = 'https://pokemon-proxy-ratnoir666.onrender.com';
  const JETON      = 'K10-Sr7izvo-CG3bSRfCbhSnw8KTNrbJ';
  const TAILLE_LOT = 25;

  // ===== L'identifiant utilisateur, généré UNE fois et persisté ============
  // Le serveur exige `userId` (400 sans lui) et le tronque à 80 caractères. Aucun format
  // n'est imposé : ce qui compte est qu'il soit STABLE d'une session à l'autre, pour que
  // les refus tracés côté serveur désignent toujours le même poste.
  // ⚠️ `GM_getValue`/`GM_setValue` et non `localStorage` : le userscript tourne sur les
  // pages Cardmarket, et un `localStorage` y serait partagé avec le site — effaçable par
  // lui, et visible de lui. Le stockage Tampermonkey appartient au script.
  function identifiantUtilisateur() {
    let id = null;
    try { id = GM_getValue('rm_userId', null); } catch (_) { /* API indisponible */ }
    if (typeof id === 'string' && id.length > 0) return id;
    // `crypto.randomUUID` existe partout où Tampermonkey tourne aujourd'hui ; le repli
    // n'est pas une élégance, c'est la garantie qu'un navigateur ancien n'envoie pas une
    // chaîne vide — qui vaudrait 400 à chaque appel, sans que le panneau dise pourquoi.
    const neuf = 'rm-' + ((self.crypto && self.crypto.randomUUID)
      ? self.crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    try { GM_setValue('rm_userId', neuf); } catch (_) { /* non persisté : on l'envoie quand même */ }
    return neuf;
  }
  const ID_UTILISATEUR = identifiantUtilisateur();

  // ===== Lecture de la page ================================================
  // ⚠️ MÊME logique que scraperListeExpansion (live-cardmarket.js), à une exception
  //    près et elle est volontaire : on n'extrait PAS le numéro de l'URL. Le serveur
  //    le fait, pour que la règle n'existe qu'à un seul endroit.
  function lireCartesDeLaPage() {
    const cartes = [];
    document.querySelectorAll('a.galleryBox').forEach(a => {
      // --- idProduct + code set, depuis l'URL de l'image ---
      const img = a.querySelector('img');
      const src = (img && (img.getAttribute('data-echo') || img.getAttribute('src'))) || '';
      const mImg = src.match(/\/(\d+)\/(\d+)\.jpg/i);
      if (!mImg) return;
      const idProduct = parseInt(mImg[1], 10);
      if (!idProduct) return;

      // Le code set est un segment d'URL, donc ENCODÉ ("SV-P%2FCS"). On le décode ici ;
      // le serveur le redécode par sécurité (decoderCodeSet), les deux sont idempotents.
      const mCode = src.match(/cardmarket\.com\/\d+\/([^/]+)\//i);
      let codeSet = mCode ? mCode[1] : null;
      if (codeSet) { try { codeSet = decodeURIComponent(codeSet); } catch (_) { /* brut */ } }

      // --- Nom FRANÇAIS, depuis l'attribut alt ---
      // C'est la prise la plus précieuse de tout le script. Elle permet d'apparier ce que
      // l'IA lit sur une carte française sans passer par TCGdex — mesuré à 97,9 % de
      // couverture, et c'est elle qui a résolu "Carabaffe", "Nix" et "Vesper", trois noms
      // qu'on prenait pour des hallucinations alors qu'ils sont les noms FR officiels.
      const nomFr = (img && img.getAttribute('alt') || '').trim() || null;

      // --- Numéro, depuis le TITRE : "Lambda de la Team Rocket (DRI 176)" ---
      // La source la plus fiable : elle gère les numéros à lettres (TG06, S19).
      const h2 = a.querySelector('h2');
      let numero = null;
      if (h2) {
        const mTitre = h2.textContent.trim().match(/\(([^)\s]+)\s+([^)\s]+)\)\s*$/);
        if (mTitre) numero = mTitre[2];
      }

      // --- Slug + variante, depuis le lien ---
      const href = a.getAttribute('href') || '';
      const morceaux = href.split('/').filter(Boolean);
      // ⚠️ .split('?')[0] : sans lui, "?language=2" reste collé au slug et le serveur en
      // tirerait "2" comme numéro. C'était le bug de la 1.1.
      const dernierSegment = (morceaux[morceaux.length - 1] || '').split('?')[0];
      const slugSet = morceaux[morceaux.length - 2] || null;
      const mVar = dernierSegment.match(/-(V\d+)-/i);
      const variante = mVar ? mVar[1].toUpperCase() : null;

      // Pas de numeroUrl : c'est le serveur qui le dérive du slug (point 2 de l'en-tête).
      cartes.push({ idProduct, numero, codeSet, nomFr, variante, slug: dernierSegment || null, slugSet });
    });
    return cartes;
  }

  // ===== Contexte de la page : quelle galerie, quelle page ? ===============
  // ⚠️ On LIT la page, on ne fabrique aucune URL. Le lien "page suivante" est celui que
  //    Cardmarket affiche lui-même — ajouter un paramètre maison (perSite) a déclenché un
  //    ban Cloudflare, et c'est mérité : ça ne ressemble pas à de la navigation humaine.
  function contexteDeLaPage() {
    const morceaux = location.pathname.split('/').filter(Boolean);
    const slugSet = morceaux[morceaux.length - 1] || '?';
    const page = parseInt(new URLSearchParams(location.search).get('site') || '1', 10) || 1;
    // Nombre total de pages : Cardmarket l'affiche dans sa pagination.
    let pages = null;
    for (const el of document.querySelectorAll('.pagination a, .pagination span, nav a, nav span')) {
      const m = (el.textContent || '').trim().match(/^(\d+)$/);
      if (m) pages = Math.max(pages || 0, parseInt(m[1], 10));
    }
    // Le lien de la page suivante, tel qu'il EXISTE dans la page. null s'il n'y en a pas.
    let hrefSuivant = null;
    for (const a of document.querySelectorAll('.pagination a, nav a')) {
      const t = (a.textContent || '').trim();
      const aria = (a.getAttribute('aria-label') || '').toLowerCase();
      const estSuivant = t === String(page + 1) || /suivant|next/.test(aria) || /suivant|next/i.test(t);
      if (estSuivant && a.getAttribute('href')) { hrefSuivant = a.href; break; }
    }
    return { slugSet, page, pages, hrefSuivant };
  }

  // ===== Envoi d'un lot (GM_xmlhttpRequest = pas de CORS) ==================
  function envoyerLot(lot) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: URL_API + '/api/apprendre-lot',
        headers: { 'Content-Type': 'application/json', 'x-jeton': JETON },
        // ⚠️ `userId` OBLIGATOIRE depuis le 2026-09-06 : 400 sans lui.
        data: JSON.stringify({ userId: ID_UTILISATEUR, cartes: lot }),
        timeout: 30000,
        // Le STATUT est remonté avec le corps. Sans lui, un 400 (userId manquant) et un 429
        // (limiteur d'apprentissage, 120/h/IP) sortaient tous deux en « refus serveur »
        // sans qu'on puisse les distinguer — deux causes opposées sous un même message.
        onload:  r => {
          let corps = null;
          try { corps = JSON.parse(r.responseText); } catch { /* corps illisible : le statut reste utile */ }
          if (!corps) return reject(new Error(`réponse illisible (HTTP ${r.status})`));
          resolve(Object.assign({ _status: r.status }, corps));
        },
        onerror: () => reject(new Error('requête échouée')),
        ontimeout: () => reject(new Error('délai dépassé'))
      });
    });
  }

  // ===== UI ===============================================================
  const ctx = contexteDeLaPage();
  const panneau = document.createElement('div');
  panneau.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:99999;background:#0d0d10;color:#eee;' +
    'font:13px system-ui,sans-serif;padding:12px 14px;border:1px solid #D4AF37;border-radius:10px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.4);width:278px';
  panneau.innerHTML =
    '<div style="font-weight:600;margin-bottom:2px">🐀 Apprendre cette page</div>' +
    `<div style="color:#888;font-size:11px;margin-bottom:8px">${ctx.slugSet} · page ${ctx.page}${ctx.pages ? '/' + ctx.pages : ''}</div>` +
    '<button id="rm-go" style="width:100%;padding:7px;background:#0c0c0e;color:#D4AF37;' +
    'border:1px solid #D4AF37;border-radius:6px;cursor:pointer;font-weight:600">Apprendre</button>' +
    '<div id="rm-barwrap" style="display:none;height:6px;background:#333;border-radius:3px;margin-top:10px;overflow:hidden">' +
    '<div id="rm-bar" style="height:100%;width:0;background:#D4AF37;transition:width .2s"></div></div>' +
    '<div id="rm-msg" style="margin-top:8px;min-height:16px;color:#bbb;line-height:1.4"></div>';
  document.body.appendChild(panneau);

  const btn     = panneau.querySelector('#rm-go');
  const barwrap = panneau.querySelector('#rm-barwrap');
  const bar     = panneau.querySelector('#rm-bar');
  const msg     = panneau.querySelector('#rm-msg');

  btn.addEventListener('click', async () => {
    const cartes = lireCartesDeLaPage();
    if (!cartes.length) {
      msg.textContent = 'Aucune carte trouvée. Passe en vue GALERIE (icône grille).';
      return;
    }

    // Le numéro du TITRE est ce qui fait foi. S'il manque partout, ce passage
    // n'apportera presque rien, et il vaut mieux le savoir AVANT d'envoyer.
    const avecNumeroTitre = cartes.filter(c => c.numero).length;
    if (avecNumeroTitre === 0) {
      msg.innerHTML = '<span style="color:#e6a23c">⚠️ Aucune carte de cette page n\'affiche de numéro dans son titre.</span>' +
                      '<br><span style="color:#888">L\'apprentissage ne pourra pas renseigner de numéro. On envoie quand même : les noms FR et les codes de set restent utiles.</span>';
    }

    btn.disabled = true; btn.style.opacity = '.6';
    barwrap.style.display = 'block';
    bar.style.width = '0';
    const prefixe = `Lecture : ${cartes.length} cartes, dont ${avecNumeroTitre} avec un numéro de titre…`;
    if (avecNumeroTitre > 0) msg.textContent = prefixe;

    let nouv = 0, amel = 0, exact = 0, sansNum = 0, erreur = false, couverture = null;
    // Les expansions vues sur TOUS les lots. Un lot mixte rend `couverture: null` : sans
    // cette trace, l'absence de couverture serait indiscernable d'une galerie non finie.
    const expansionsVues = new Set();
    let lotMixte = false;
    for (let i = 0; i < cartes.length; i += TAILLE_LOT) {
      const lot = cartes.slice(i, i + TAILLE_LOT);
      try {
        const r = await envoyerLot(lot);
        if (r && r.success) {
          nouv += r.nouvelles; amel += r.ameliorees; exact += r.dejaExactes; sansNum += (r.sansNumero || 0);
          if (r.couverture) couverture = r.couverture;   // la dernière renvoyée est la plus à jour
          // `idExpansions` est ADDITIF : le serveur le rend pour que le client sache
          // POURQUOI `idExpansion` et `couverture` sont nuls. On ne le lit pas comme un
          // détail d'affichage — c'est ce qui empêche un lot mêlé de passer pour un succès.
          if (Array.isArray(r.idExpansions)) { for (const e of r.idExpansions) expansionsVues.add(e); if (r.idExpansions.length > 1) lotMixte = true; }
          else if (r.idExpansion != null) expansionsVues.add(r.idExpansion);
        } else {
          erreur = true;
          // Le statut d'abord : un 400 dit « le script est à corriger », un 429 dit
          // « attends ». Les confondre ferait chercher un bug là où il n'y en a pas.
          const st = r && r._status ? ` (HTTP ${r._status})` : '';
          const aide = r && r._status === 400 ? ' — identifiant manquant côté script, version à mettre à jour'
            : r && r._status === 429 ? ' — limite d\'apprentissage atteinte (120/h), réessaie plus tard'
              : '';
          msg.textContent = '❌ ' + ((r && r.error) || 'refus serveur') + st + aide;
          break;
        }
      } catch (e) { erreur = true; msg.textContent = '❌ ' + e.message; break; }
      bar.style.width = Math.round(((i + lot.length) / cartes.length) * 100) + '%';
    }

    if (!erreur) {
      bar.style.width = '100%';
      let html =
        `✅ <b>${nouv}</b> nouvelles · <b>${amel}</b> améliorées · ${exact} déjà exactes` +
        (sansNum ? `<br><span style="color:#888">${sansNum} sans numéro ignorées</span>` : '');

      // ⚠️ UNE COUVERTURE ABSENTE N'EST PAS UNE COUVERTURE À ZÉRO, et ne se tait plus.
      // Le serveur ne la calcule que sur un lot d'UNE seule expansion ; sur un lot mêlé il
      // rend `idExpansion: null` et `couverture: null`. Avant la 1.4, l'utilisateur voyait
      // « ✅ n nouvelles » sans un mot et ne pouvait pas savoir si la galerie était finie.
      if (!couverture && (lotMixte || expansionsVues.size > 1)) {
        html += `<br><span style="color:#e6a23c">⚠️ lot sur ${expansionsVues.size} expansions ` +
                `(${[...expansionsVues].join(', ')}) — le serveur ne calcule pas de couverture dans ce cas.` +
                `<br><span style="color:#888">Les cartes sont bien apprises, chacune avec SA propre expansion. ` +
                `Pour suivre l'avancement d'une galerie, apprends une page à la fois.</span></span>`;
      }

      // La couverture dit si la galerie est finie. C'est elle qui compte : une expansion
      // à 0 % de numéros est invisible pour l'identification locale.
      if (couverture) {
        const pc = couverture.pourcent;
        const couleur = pc >= 90 ? '#67c23a' : pc >= 50 ? '#e6a23c' : '#f56c6c';
        html += `<br><span style="color:${couleur}">📊 expansion couverte à ${pc} % ` +
                `(${couverture.avecNumero}/${couverture.produits} numéros)</span>`;
        if (pc < 90) {
          // Le lien vient de la PAGE, pas de nous : voir contexteDeLaPage.
          html += ctx.hrefSuivant
            ? `<br><a href="${ctx.hrefSuivant}" style="color:#D4AF37">→ page suivante${ctx.pages ? ` (${ctx.page + 1}/${ctx.pages})` : ''}</a>`
            : `<br><span style="color:#888">Dernière page. Le reste n'a pas de numéro dans son titre : rien de plus à tirer d'ici.</span>`;
        } else {
          html += '<br><span style="color:#67c23a">Expansion terminée 🎉</span>';
        }
      }
      msg.innerHTML = html;
    }
    btn.disabled = false; btn.style.opacity = '1';
  });
})();
