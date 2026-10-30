/* Stockage local chiffré (AES-GCM, clé dérivée du code personnel) et opérations sur les données. */
(function () {
  'use strict';

  const CLE_STOCKAGE = 'astreinte-minuteur.v1';
  const ITERATIONS = 250000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function versB64(buf) {
    const octets = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const depuisB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  let derniereMaj = 0;

  // Heures enregistrées à la minute près : ce qui est affiché (Début, Fin) donne exactement la Durée
  const aLaMinute = (ts) => Math.round(ts / 60000) * 60000;
  function arrondirSegment(s) {
    if (s.fin == null) return;
    s.debut = aLaMinute(s.debut);
    s.fin = Math.max(s.debut, aLaMinute(s.fin));
  }

  async function deriverCle(code, sel) {
    const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: sel, iterations: ITERATIONS, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function chiffrer(cle, objet) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cle, enc.encode(JSON.stringify(objet)));
    return { iv: versB64(iv), data: versB64(data) };
  }
  async function dechiffrer(cle, paquet) {
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: depuisB64(paquet.iv) }, cle, depuisB64(paquet.data));
    return JSON.parse(dec.decode(buf));
  }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  function etatInitial() {
    return {
      version: 1,
      appareil: uid(),
      config: Object.assign(JSON.parse(JSON.stringify(window.CONFIG_DEFAUT)), { majLe: 0 }),
      medecinCourant: '',
      semaines: {},   // { 'AAAA-MM-JJ': { effectifs: { 'Etab|Antenne': n }, note, majLe } }
      dossiers: [],
      plages: [],     // plages continues déclarées : [{ id, debut, fin, majLe }] (travail transversal)
    };
  }

  let cle = null;
  let sel = null;
  let minuterie = null;

  const Store = {
    state: null,
    uid,

    existe: () => !!localStorage.getItem(CLE_STOCKAGE),

    async creer(code) {
      sel = crypto.getRandomValues(new Uint8Array(16));
      cle = await deriverCle(code, sel);
      this.state = etatInitial();
      await this.sauver();
    },

    // Lève une erreur si le code est faux
    async ouvrir(code) {
      const brut = JSON.parse(localStorage.getItem(CLE_STOCKAGE));
      sel = depuisB64(brut.sel);
      const essai = await deriverCle(code, sel);
      this.state = await dechiffrer(essai, brut);
      cle = essai;
      // Listes jamais modifiées par l'utilisateur : on reprend les listes par défaut (nouveautés incluses)
      const defaut = JSON.parse(JSON.stringify(window.CONFIG_DEFAUT));
      if (!this.state.config.majLe) ['etablissements'].forEach((k) => { this.state.config[k] = defaut[k]; });
      this.renommerEtablissements(this.state);
      // Établissements ajoutés depuis la création de l'espace (ex. SSBDR) : ajoutés aussi aux listes déjà modifiées
      const etabs = this.state.config.etablissements || (this.state.config.etablissements = []);
      JSON.parse(JSON.stringify(window.CONFIG_DEFAUT.etablissements)).forEach((e) => {
        const ici = etabs.find((x) => x.nom === e.nom);
        if (!ici) etabs.push(e);
        else if (!ici.antennes.length) ici.antennes = e.antennes;
      });
      this.state.config = Object.assign(defaut, this.state.config);
      if (!this.state.plages) this.state.plages = [];   // v1.17 : plages continues
      // v1.6.2 : temps terminés ramenés à la minute (les secondes faussaient Durée = Fin − Début)
      this.state.dossiers.forEach((d) => { (d.segments || []).forEach(arrondirSegment); });
      // v1.10 : un dossier = un patient sur une semaine d'astreinte (doublons réunis, semaines séparées)
      // v1.11 : Mémo et Commentaire du dossier passés sur son intervention la plus récente (fait par Rules.regrouper)
      this.regrouper();
    },

    async sauver() {
      if (!cle || !this.state) return;
      clearTimeout(minuterie);
      const paquet = await chiffrer(cle, this.state);
      localStorage.setItem(CLE_STOCKAGE, JSON.stringify({ v: 1, sel: versB64(sel), ...paquet }));
    },

    // Sauvegarde différée (évite de chiffrer à chaque frappe)
    planifier() {
      clearTimeout(minuterie);
      minuterie = setTimeout(() => this.sauver(), 400);
    },

    verrouiller() { cle = null; this.state = null; },

    async changerCode(nouveau) {
      sel = crypto.getRandomValues(new Uint8Array(16));
      cle = await deriverCle(nouveau, sel);
      await this.sauver();
    },

    effacerTout() { localStorage.removeItem(CLE_STOCKAGE); cle = null; this.state = null; },

    /* ---------- Sauvegarde / transfert par fichier ---------- */
    async exporterSauvegarde() {
      const paquet = await chiffrer(cle, this.state);
      return JSON.stringify({ type: 'astreinte-minuteur-sauvegarde', v: 1, sel: versB64(sel), ...paquet });
    },

    async lireSauvegarde(texte, code) {
      const brut = JSON.parse(texte);
      if (brut.type !== 'astreinte-minuteur-sauvegarde') throw new Error('Fichier non reconnu');
      const k = await deriverCle(code, depuisB64(brut.sel));
      return dechiffrer(k, brut);
    },

    // Anciens noms (« HAD NICE » → « NICE », antenne « SSBDR » → « Arles ») : listes, dossiers et clés des
    // effectifs (« HAD NICE|Menton »)
    renommerEtablissements(etat) {
      const nouveau = (nom) => window.RENOMMAGES_ETAB[nom] || nom;
      const antenne = (nom) => window.RENOMMAGES_ANTENNES[nom] || nom;
      ((etat.config && etat.config.etablissements) || []).forEach((e) => { e.nom = nouveau(e.nom); e.antennes = (e.antennes || []).map(antenne); });
      (etat.dossiers || []).forEach((d) => { if (d.etab) d.etab = nouveau(d.etab); if (d.antenne) d.antenne = antenne(d.antenne); });
      Object.values(etat.semaines || {}).forEach((sem) => {
        const eff = {};
        Object.entries(sem.effectifs || {}).forEach(([k, v]) => {
          const parties = k.split('|');
          parties[0] = nouveau(parties[0]);
          if (parties.length > 1) parties[1] = antenne(parties[1]);
          eff[parties.join('|')] = v;
        });
        sem.effectifs = eff;
      });
      return etat;
    },

    // Fusion sans doublon : pour chaque élément, la version modifiée le plus récemment gagne
    fusionner(autre) {
      this.renommerEtablissements(autre);
      const s = this.state;
      const parId = new Map(s.dossiers.map((d) => [d.id, d]));
      let ajoutes = 0, maj = 0;
      (autre.dossiers || []).forEach((d) => {
        const local = parId.get(d.id);
        if (!local) { s.dossiers.push(d); ajoutes++; }
        else if ((d.majLe || 0) > (local.majLe || 0)) { Object.assign(local, d); maj++; }
      });
      Object.entries(autre.semaines || {}).forEach(([k, sem]) => {
        if (!s.semaines[k] || (sem.majLe || 0) > (s.semaines[k].majLe || 0)) s.semaines[k] = sem;
      });
      // Plages continues : par identifiant, la plus récemment modifiée l'emporte
      if (!s.plages) s.plages = [];
      (autre.plages || []).forEach((p) => {
        const i = s.plages.findIndex((x) => x.id === p.id);
        if (i < 0) s.plages.push(p);
        else if ((p.majLe || 0) > (s.plages[i].majLe || 0)) s.plages[i] = p;
      });
      if (autre.config && (autre.config.majLe || 0) > (s.config.majLe || 0)) s.config = autre.config;
      s.config.medecins = [...new Set([...(s.config.medecins || []), ...((autre.config && autre.config.medecins) || [])])];
      this.regrouper();
      this.planifier();
      return { ajoutes, maj };
    },

    /* ---------- Dossiers et segments de temps ---------- */
    dossiersActifs() { return this.state.dossiers.filter((d) => !d.supprime); },

    segmentActif() {
      for (const d of this.dossiersActifs()) {
        const seg = d.segments.find((x) => x.fin == null);
        if (seg) return { dossier: d, seg };
      }
      return null;
    },

    // Dernière modification (ordre des barres : le plus récemment traité en haut) ; strictement croissante,
    // pour qu'un dossier repris passe devant celui qu'il vient d'arrêter dans la même milliseconde
    horodatage() { derniereMaj = Math.max(Date.now(), derniereMaj + 1); return derniereMaj; },

    // majLe : dernière modification (fusion entre appareils) ; traiteLe : dernière action du médecin sur ce dossier
    // (ordre des barres). Un arrêt automatique (un autre dossier démarre) ne fait pas remonter le dossier arrêté.
    toucher(d, { traite = true } = {}) {
      d.majLe = this.horodatage();
      if (traite) d.traiteLe = d.majLe;
      this.planifier();
    },

    // Termine le segment en cours (un seul chronomètre actif à la fois)
    arreterActif(ts = Date.now(), traite = true) {
      const a = this.segmentActif();
      if (!a) return null;
      a.seg.fin = Math.max(ts, a.seg.debut);
      arrondirSegment(a.seg);
      this.toucher(a.dossier, { traite });
      return a;
    },

    nouveauSegment(d, type, debut = Date.now(), fin = null) {
      if (fin == null) this.arreterActif(debut, false);
      const seg = { id: uid(), type, debut, fin, medecin: this.state.medecinCourant || '', note: '', memo: '', commentaire: '' };
      d.segments.push(seg);
      d.clos = false;   // une nouvelle intervention rouvre le dossier
      this.toucher(d);
      return seg;
    },

    nouveauDossier(type = 'Appel reçu', debut = Date.now(), fin = null) {
      const d = {
        id: uid(), creeLe: Date.now(), majLe: Date.now(), supprime: false, clos: false,
        etab: '', antenne: '', rpss: '', nom3: '', prenom2: '', memo: '', commentaire: '', segments: [],
      };
      this.state.dossiers.push(d);
      this.nouveauSegment(d, type, debut, fin);
      return d;
    },

    // Dossier clos : il quitte les fenêtres et la liste « en cours » (son chronomètre s'arrête)
    clore(d) {
      const a = this.segmentActif();
      if (a && a.dossier === d) this.arreterActif();
      d.clos = true;
      this.toucher(d);
      this.retirerFenetre(d.id);
    },

    /* ---------- Fenêtres ouvertes sur PC (4 au maximum) ---------- */
    fenetres() {
      const ids = (this.state.fenetres || []).filter((id) => {
        const d = this.state.dossiers.find((x) => x.id === id);
        return d && !d.supprime && !d.clos;
      });
      this.state.fenetres = ids;
      return ids;
    },

    // Ajoute une fenêtre ; s'il y en a déjà 4, retire celle dont l'activité est terminée depuis le plus longtemps
    ouvrirFenetre(id, max = 4) {
      const ids = this.fenetres();
      if (ids.includes(id)) return null;
      let chasse = null;
      if (ids.length >= max) {
        const actif = this.segmentActif();
        const candidats = ids.map((x) => this.state.dossiers.find((d) => d.id === x))
          .filter((d) => !(actif && actif.dossier === d));
        candidats.sort((a, b) => this.derniereActivite(a) - this.derniereActivite(b));
        chasse = candidats[0];
        ids.splice(ids.indexOf(chasse.id), 1);
      }
      ids.push(id);
      this.planifier();
      return chasse;
    },

    retirerFenetre(id) {
      this.state.fenetres = (this.state.fenetres || []).filter((x) => x !== id);
      this.planifier();
    },

    supprimerDossier(d) {
      this.retirerFenetre(d.id);
      // On garde une trace minimale pour que la suppression se propage lors des fusions
      Object.keys(d).forEach((k) => { if (!['id', 'creeLe'].includes(k)) delete d[k]; });
      d.supprime = true; d.segments = []; d.majLe = Date.now();
      this.planifier();
    },

    // « Un dossier = un patient sur une semaine d'astreinte » (Rules.regrouper) : dossiers réunis ou scindés
    regrouper() {
      const r = Rules.regrouper(this.state.dossiers, uid);
      r.fusions.forEach(({ garde, verse }) => { this.supprimerDossier(verse); this.toucher(garde); });
      r.scindes.forEach((n) => this.toucher(n));
      if (r.fusions.length || r.scindes.length) this.planifier();
      return r;
    },

    dureeSegment: (s, maintenant = Date.now()) => Math.max(0, (s.fin == null ? maintenant : s.fin) - s.debut),
    dureeDossier(d) { return d.segments.reduce((t, s) => t + this.dureeSegment(s), 0); },
    debutDossier: (d) => Math.min(...d.segments.map((s) => s.debut)),
    derniereActivite: (d) => Math.max(...d.segments.map((s) => (s.fin == null ? Date.now() : s.fin))),

    codePatient: (d) => (d.nom3 || d.prenom2) ? `${(d.nom3 || '???').toUpperCase()}-${(d.prenom2 || '??').toUpperCase()}` : '',

    // Dossiers ayant au moins un segment dans la semaine
    dossiersDeSemaine(cleSem) {
      const { debut, fin } = Rules.bornesSemaine(cleSem);
      return this.dossiersActifs().filter((d) => d.segments.some((s) => s.debut >= debut && s.debut < fin));
    },

    semaine(cleSem) {
      if (!this.state.semaines[cleSem]) this.state.semaines[cleSem] = { effectifs: {}, note: '', majLe: 0 };
      return this.state.semaines[cleSem];
    },

    effectifsSaisis(cleSem) {
      const s = this.state.semaines[cleSem];
      return !!s && Object.values(s.effectifs).some((n) => n > 0);
    },

    /* ---------- Conservation : 1 mois ---------- */
    aPurger(jours = window.DUREE_CONSERVATION_JOURS) {
      const limite = Date.now() - jours * 864e5;
      return this.state.dossiers.filter((d) => d.supprime ? (d.majLe || 0) < limite
        : d.segments.every((s) => s.fin != null) && this.derniereActivite(d) < limite);
    },

    purger(jours) {
      const cibles = new Set(this.aPurger(jours));
      this.state.dossiers = this.state.dossiers.filter((d) => !cibles.has(d));
      const limite = Date.now() - (jours || window.DUREE_CONSERVATION_JOURS) * 864e5;
      Object.keys(this.state.semaines).forEach((k) => {
        if (Rules.bornesSemaine(k).fin < limite) delete this.state.semaines[k];
      });
      this.planifier();
      return cibles.size;
    },
  };

  window.Store = Store;
})();
