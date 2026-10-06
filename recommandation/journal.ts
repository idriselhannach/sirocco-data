import { momentDe, motsDe } from './traits';

/**
 * Ce que le telephone sait de ce qu'aime son membre.
 *
 * Un carnet de poids, et rien d'autre : tant pour tel auteur, tant pour tel
 * mot, telle categorie de sortie, tel organisateur, tel moment de la
 * semaine. Chaque geste y ajoute sa part — un like, un signet, un
 * commentaire, une lecture qui dure, une inscription, une presence
 * constatee — et un post masque en retire.
 *
 * Il ne quitte jamais l'appareil. Rien ici n'ecrit dans la base : le
 * carnet vit dans le stockage du telephone, se vide quand on coupe les
 * suggestions dans les reglages, et c'est la seule facon honnete de
 * mesurer le temps passe sur un post.
 *
 * Les gouts s'usent. Un poids perd la moitie de sa valeur en trente
 * jours : ce qu'on aimait l'hiver dernier ne doit pas decider du fil de
 * ce soir. Ce qu'on a deja vu s'efface plus vite, en trois jours.
 *
 * Chaque geste n'est compte qu'une fois. Liker, deliker, reliker ne fait
 * pas monter un auteur de trois crans : la lettre du geste reste posee a
 * cote de l'objet tant qu'il est compte, et c'est elle qui fait foi.
 */

const JOUR = 86_400_000;
const DEMI_VIE_DES_GOUTS = 30 * JOUR;
const DEMI_VIE_DES_VUS = 3 * JOUR;

/** Au-dela, les poids les plus faibles cedent la place. */
const PLAFONDS = {
  auteurs: 300,
  mots: 400,
  categories: 20,
  organisateurs: 200,
  moments: 12,
  vus: 600,
};
const PLAFOND_DES_COMPTES = 1500;
const PLAFOND_DE_L_ATTENTE = 200;

export interface Journal {
  v: 1;
  /** Le dernier passage, d'ou l'usure se compte. */
  maj: number;
  auteurs: Record<string, number>;
  mots: Record<string, number>;
  categories: Record<string, number>;
  organisateurs: Record<string, number>;
  moments: Record<string, number>;
  /** Combien de fois un post est passe sous les yeux. */
  vus: Record<string, number>;
  /** Les gestes deja comptes, une lettre chacun : `p:{post}` ou `e:{sortie}`. */
  comptes: Record<string, string>;
  /** Les gestes dont on ne connait pas encore l'objet : un commentaire, par exemple. */
  attente: Record<string, string>;
  /** La derniere relecture de mes evenements. */
  amorce: number;
}

/** Ce qu'on retient d'un post. */
export interface PostVu {
  id: string;
  auteur: string;
  texte: string;
}

/** Ce qu'on retient d'une sortie. */
export interface SortieVue {
  id: string;
  categorie: string;
  organisateur: string;
  date: string;
  heure: string;
}

export type GesteSurPost = 'like' | 'signet' | 'commentaire' | 'lecture' | 'masque';
export type GesteSurSortie =
  | 'inscription'
  | 'venue'
  | 'organisation'
  | 'signet-sortie'
  | 'masque-sortie';

export type Geste =
  | { quoi: GesteSurPost; post: PostVu; annule?: boolean }
  | { quoi: GesteSurSortie; sortie: SortieVue; annule?: boolean }
  | { quoi: 'note'; sortie: SortieVue; note: number }
  | { quoi: 'vu'; postId: string };

/*
  Ce que vaut chaque geste.

  Commenter engage plus que liker, et s'arreter sur un post moins que les
  deux : il arrive qu'on lise jusqu'au bout ce qui agace. Etre venu a une
  sortie pese plus que s'y inscrire — c'est la seule chose ici qu'un
  organisateur a constatee.
*/
const POIDS_DES_POSTS: Record<GesteSurPost, { lettre: string; auteur: number; mots: number }> = {
  like: { lettre: 'l', auteur: 3, mots: 1 },
  signet: { lettre: 's', auteur: 3, mots: 1.5 },
  commentaire: { lettre: 'c', auteur: 4, mots: 1.5 },
  lecture: { lettre: 'r', auteur: 1, mots: 0.5 },
  masque: { lettre: 'm', auteur: -6, mots: -0.5 },
};

const POIDS_DES_SORTIES: Record<
  GesteSurSortie,
  { lettre: string; categorie: number; organisateur: number; moment: number }
> = {
  inscription: { lettre: 'i', categorie: 4, organisateur: 3, moment: 2 },
  venue: { lettre: 'v', categorie: 5, organisateur: 4, moment: 3 },
  organisation: { lettre: 'o', categorie: 3, organisateur: 0, moment: 1 },
  'signet-sortie': { lettre: 'b', categorie: 2, organisateur: 1, moment: 0.5 },
  'masque-sortie': { lettre: 'h', categorie: -2, organisateur: -3, moment: 0 },
};

export function journalVide(maintenant: number): Journal {
  return {
    v: 1,
    maj: maintenant,
    auteurs: {},
    mots: {},
    categories: {},
    organisateurs: {},
    moments: {},
    vus: {},
    comptes: {},
    attente: {},
    amorce: 0,
  };
}

/* --- Les regles, sans stockage -------------------------------------- */

function eroder(poids: Record<string, number>, facteur: number): Record<string, number> {
  const suite: Record<string, number> = {};
  for (const [cle, valeur] of Object.entries(poids)) {
    const reste = valeur * facteur;
    if (Math.abs(reste) >= 0.05) suite[cle] = reste;
  }
  return suite;
}

/** Une copie usee jusqu'a maintenant : les regles ne touchent jamais l'original. */
function vieillir(journal: Journal, maintenant: number): Journal {
  const ecoule = Math.max(0, maintenant - journal.maj);
  const gouts = Math.pow(0.5, ecoule / DEMI_VIE_DES_GOUTS);
  const vus = Math.pow(0.5, ecoule / DEMI_VIE_DES_VUS);
  return {
    ...journal,
    maj: Math.max(journal.maj, maintenant),
    auteurs: eroder(journal.auteurs, gouts),
    mots: eroder(journal.mots, gouts),
    categories: eroder(journal.categories, gouts),
    organisateurs: eroder(journal.organisateurs, gouts),
    moments: eroder(journal.moments, gouts),
    vus: eroder(journal.vus, vus),
    comptes: { ...journal.comptes },
    attente: { ...journal.attente },
  };
}

/**
 * Ajoute un poids, ou le retire.
 *
 * Retirer ne fait jamais changer un gout de signe : un like pose il y a un
 * mois a perdu la moitie de sa valeur, et le retirer en entier ferait d'un
 * auteur apprecie un auteur qu'on fuit.
 */
function ajouter(poids: Record<string, number>, cle: string, delta: number, annule: boolean): void {
  if (!cle || delta === 0) return;
  const avant = poids[cle] ?? 0;
  let apres = annule ? avant - delta : avant + delta;
  if (annule && avant !== 0 && Math.sign(apres) !== Math.sign(avant)) apres = 0;
  if (Math.abs(apres) < 0.05) delete poids[cle];
  else poids[cle] = apres;
}

function garderLesPlusForts(poids: Record<string, number>, plafond: number): Record<string, number> {
  const entrees = Object.entries(poids);
  if (entrees.length <= plafond) return poids;
  return Object.fromEntries(
    entrees.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, plafond),
  );
}

/** Les cles les plus anciennes partent les premieres : l'ordre d'insertion fait foi. */
function garderLesDerniers(marques: Record<string, string>, plafond: number): Record<string, string> {
  const entrees = Object.entries(marques);
  return entrees.length <= plafond ? marques : Object.fromEntries(entrees.slice(-plafond));
}

function borner(journal: Journal): Journal {
  return {
    ...journal,
    auteurs: garderLesPlusForts(journal.auteurs, PLAFONDS.auteurs),
    mots: garderLesPlusForts(journal.mots, PLAFONDS.mots),
    categories: garderLesPlusForts(journal.categories, PLAFONDS.categories),
    organisateurs: garderLesPlusForts(journal.organisateurs, PLAFONDS.organisateurs),
    moments: garderLesPlusForts(journal.moments, PLAFONDS.moments),
    vus: garderLesPlusForts(journal.vus, PLAFONDS.vus),
    comptes: garderLesDerniers(journal.comptes, PLAFOND_DES_COMPTES),
    attente: garderLesDerniers(journal.attente, PLAFOND_DE_L_ATTENTE),
  };
}

/** Pose ou retire la lettre d'un geste. */
function marquer(marques: Record<string, string>, cle: string, lettre: string, retirer: boolean): void {
  const avant = marques[cle] ?? '';
  const apres = retirer ? avant.replace(lettre, '') : avant.includes(lettre) ? avant : avant + lettre;
  if (apres) marques[cle] = apres;
  else delete marques[cle];
}

/** Le journal apres un geste. Fonction pure : l'original reste intact. */
export function noter(journal: Journal, geste: Geste, maintenant: number): Journal {
  const j = vieillir(journal, maintenant);

  if (geste.quoi === 'vu') {
    j.vus[geste.postId] = (j.vus[geste.postId] ?? 0) + 1;
    return borner(j);
  }

  if (geste.quoi === 'note') {
    const cle = `e:${geste.sortie.id}`;
    if ((j.comptes[cle] ?? '').includes('n')) return j;
    // Une bonne note rapproche d'un organisateur, une mauvaise en eloigne.
    const delta = geste.note >= 4 ? 3 : geste.note <= 2 ? -4 : 0;
    ajouter(j.organisateurs, geste.sortie.organisateur, delta, false);
    marquer(j.comptes, cle, 'n', false);
    return borner(j);
  }

  const annule = geste.annule === true;

  if ('post' in geste) {
    const regle = POIDS_DES_POSTS[geste.quoi];
    const cle = `p:${geste.post.id}`;
    const deja = (j.comptes[cle] ?? '').includes(regle.lettre);
    // Un geste deja compte ne se recompte pas ; un geste jamais compte ne se retire pas.
    if (deja === !annule) return j;
    ajouter(j.auteurs, geste.post.auteur, regle.auteur, annule);
    for (const mot of motsDe(geste.post.texte)) ajouter(j.mots, mot, regle.mots, annule);
    marquer(j.comptes, cle, regle.lettre, annule);
    return borner(j);
  }

  const regle = POIDS_DES_SORTIES[geste.quoi];
  const cle = `e:${geste.sortie.id}`;
  const deja = (j.comptes[cle] ?? '').includes(regle.lettre);
  if (deja === !annule) return j;
  ajouter(j.categories, geste.sortie.categorie, regle.categorie, annule);
  ajouter(j.organisateurs, geste.sortie.organisateur, regle.organisateur, annule);
  ajouter(j.moments, momentDe(geste.sortie.date, geste.sortie.heure), regle.moment, annule);
  marquer(j.comptes, cle, regle.lettre, annule);
  return borner(j);
}

/** Retient un geste dont l'objet n'est pas sous la main : il sera compte a sa prochaine lecture. */
export function mettreEnAttente(journal: Journal, cle: string, lettre: string): Journal {
  const attente = { ...journal.attente };
  marquer(attente, cle, lettre, false);
  return borner({ ...journal, attente });
}

/** Un post tel qu'une page du fil le rend, avec ce que j'en ai deja fait. */
export interface PostCharge extends PostVu {
  aime: boolean;
  enregistre: boolean;
}

/**
 * Ce qu'une page du fil apprend au journal.
 *
 * Le fil dit pour chaque post si je l'ai like ou enregistre — y compris
 * depuis un autre telephone, ou avant que le journal existe. On rattrape
 * donc ici ce qui manque, et on defait ce qui a ete defait ailleurs.
 */
export function apprendreDuFil(
  journal: Journal,
  posts: readonly PostCharge[],
  moi: string,
  maintenant: number,
): Journal {
  let j = journal;
  for (const post of posts) {
    if (post.auteur === moi) continue;
    const cle = `p:${post.id}`;
    const comptes = j.comptes[cle] ?? '';
    if (post.aime !== comptes.includes('l')) {
      j = noter(j, { quoi: 'like', post, annule: !post.aime }, maintenant);
    }
    if (post.enregistre !== comptes.includes('s')) {
      j = noter(j, { quoi: 'signet', post, annule: !post.enregistre }, maintenant);
    }
    if ((j.attente[cle] ?? '').includes('c')) {
      j = noter(j, { quoi: 'commentaire', post }, maintenant);
      const attente = { ...j.attente };
      delete attente[cle];
      j = { ...j, attente };
    }
  }
  return j;
}

/** Mes sorties, relues de la base : ou je suis alle, ou je vais, ce que j'organise. */
export function amorcerDesSorties(
  journal: Journal,
  mes: { venues: readonly SortieVue[]; inscrites: readonly SortieVue[]; organisees: readonly SortieVue[] },
  maintenant: number,
): Journal {
  let j = journal;
  for (const sortie of mes.venues) j = noter(j, { quoi: 'venue', sortie }, maintenant);
  for (const sortie of mes.inscrites) j = noter(j, { quoi: 'inscription', sortie }, maintenant);
  for (const sortie of mes.organisees) j = noter(j, { quoi: 'organisation', sortie }, maintenant);
  return { ...j, amorce: maintenant };
}

/* --- Le stockage du telephone ---------------------------------------- */

const PREFIXE = 'sirocco.pourtoi.journal.';

function bienForme(valeur: unknown): valeur is Journal {
  const j = valeur as Partial<Journal> | null;
  return Boolean(
    j &&
      j.v === 1 &&
      typeof j.maj === 'number' &&
      [j.auteurs, j.mots, j.categories, j.organisateurs, j.moments, j.vus, j.comptes, j.attente].every(
        (carte) => carte !== null && typeof carte === 'object',
      ),
  );
}

/** Le journal d'un membre sur ce telephone, ou un journal vide. */
export function lireLeJournal(uid: string, maintenant: number): Journal {
  try {
    const brut = localStorage.getItem(PREFIXE + uid);
    const lu: unknown = brut ? JSON.parse(brut) : null;
    return bienForme(lu) ? lu : journalVide(maintenant);
  } catch {
    return journalVide(maintenant);
  }
}

export function ecrireLeJournal(uid: string, journal: Journal): void {
  try {
    localStorage.setItem(PREFIXE + uid, JSON.stringify(journal));
  } catch {
    // Stockage plein ou refuse : les suggestions repartiront de zero.
  }
}

/** Efface tous les journaux de ce telephone, quel que soit le compte. */
export function oublierLesJournaux(): void {
  try {
    const cles: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const cle = localStorage.key(i);
      if (cle?.startsWith(PREFIXE)) cles.push(cle);
    }
    for (const cle of cles) localStorage.removeItem(cle);
  } catch {
    // Rien a effacer si le stockage est inaccessible.
  }
}
