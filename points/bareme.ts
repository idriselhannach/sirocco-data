/**
 * Ce que vaut chaque geste, et pourquoi.
 *
 * **On ne récompense que ce qu'on veut voir arriver dans le monde réel.**
 * Si un post rapporte gros, on aura des posts ; on veut des rencontres.
 * D'où trois absences volontaires : rien pour une demande d'ami acceptée
 * — cela pousserait au harcèlement —, rien pour un message envoye — cela
 * pousserait au spam —, et rien pour un evenement *cree*. Seulement pour
 * un evenement qui a **eu lieu**, atteste par des presences constatees.
 *
 * Le rapport de grandeur est le message : une seule sortie vaut plus
 * qu'un mois de bavardage, et organiser vaut le double de venir, parce
 * que l'organisateur est la ressource rare.
 *
 * Ce fichier ne touche a rien. Il calcule, et rien d'autre : c'est ce qui
 * permet de l'eprouver sans base.
 */

/** Les motifs, tels qu'ils s'ecrivent dans le journal du membre. */
export type Motif =
  | 'presence'
  | 'rencontre'
  | 'organisation'
  | 'accueil'
  | 'post'
  | 'commentaire';

/** Ce que rapporte chaque geste. */
export const BAREME: Record<Motif, number> = {
  presence: 50,
  rencontre: 15,
  organisation: 100,
  accueil: 20,
  post: 3,
  commentaire: 1,
};

/** Ce qu'on lit dans le journal, en francais. */
export const LIBELLES: Record<Motif, string> = {
  presence: 'Présence à un événement',
  rencontre: 'Nouvelle rencontre',
  organisation: 'Événement organisé',
  accueil: 'Nouveau membre accueilli',
  post: 'Post publié',
  commentaire: 'Commentaire',
};

/** Les garde-fous, par geste. */
export const PLAFONDS = {
  /** Rencontres comptees pour un meme evenement. */
  rencontresParEvenement: 5,
  /** Une meme paire ne recompte pas avant ce delai. */
  memePaireMs: 30 * 24 * 60 * 60 * 1000,
  /** Nouveaux membres accueillis comptes pour un meme evenement. */
  accueilsParEvenement: 3,
  /** Un membre est « nouveau » pendant ce delai apres son inscription. */
  nouveauMs: 30 * 24 * 60 * 60 * 1000,
  /** Evenements organises comptes par semaine. */
  organisationsParSemaine: 2,
  /** Ce qu'il faut de monde pour qu'un evenement compte comme organise. */
  presentsPourOrganiser: 3,
  /** Posts comptes par semaine. */
  postsParSemaine: 3,
  /** Commentaires comptes par semaine. */
  commentairesParSemaine: 5,
  /**
   * Plafond global, par membre et par jour du spot.
   *
   * Il n'est pas la pour brider un membre assidu — atteindre 200 points
   * en un jour demande une sortie et des rencontres — mais pour borner ce
   * qu'une faille inconnue pourrait produire.
   */
  parJour: 200,
} as const;

/* --- Les niveaux ----------------------------------------------------- */

/**
 * Les seuils, en points cumules.
 *
 * Le premier a 50 est delibere : **la premiere sortie fait monter d'un
 * niveau, immediatement**. C'est le seul moment ou l'on peut prouver a
 * quelqu'un que venir sert a quelque chose.
 */
export const SEUILS = [0, 50, 150, 350, 700, 1200, 2000] as const;

/** Au-dela du dernier seuil, un niveau tous les mille points. */
export const PAS_AU_DELA = 1000;

export const NOMS_DE_NIVEAU = [
  'Arrivant',
  'De passage',
  'Habitué',
  'Familier',
  'Pilier',
  'Ancien',
  'Mémoire de la ville',
] as const;

/** Le niveau correspondant a un total de points. Le premier vaut 1. */
export function niveauDe(points: number): number {
  const total = Math.max(0, Math.floor(points));

  let niveau = 1;
  for (let i = 1; i < SEUILS.length; i += 1) {
    if (total >= SEUILS[i]) niveau = i + 1;
  }
  if (total < SEUILS[SEUILS.length - 1]) return niveau;

  const surplus = total - SEUILS[SEUILS.length - 1];
  return SEUILS.length + Math.floor(surplus / PAS_AU_DELA);
}

/** Le nom d'un niveau. Au-dela des sept, le dernier nom reste. */
export function nomDuNiveau(niveau: number): string {
  return NOMS_DE_NIVEAU[Math.min(niveau, NOMS_DE_NIVEAU.length) - 1] ?? NOMS_DE_NIVEAU[0];
}

/** Ce qu'il reste a gagner avant le niveau suivant. */
export function prochainSeuil(points: number): number {
  const niveau = niveauDe(points);
  if (niveau < SEUILS.length) return SEUILS[niveau];
  return SEUILS[SEUILS.length - 1] + (niveau - SEUILS.length + 1) * PAS_AU_DELA;
}

/* --- Le plafond du jour ---------------------------------------------- */

/**
 * Ce qu'on peut encore attribuer aujourd'hui.
 *
 * On n'attribue jamais a moitie : si le plafond ne laisse pas la place
 * entiere, on donne ce qui reste. Un membre qui perd trois points sur un
 * plafond ne s'en apercevra pas ; un membre qui voit son evenement ne
 * rien rapporter, si.
 */
export function attribuable(dejaAujourdhui: number, demande: number): number {
  const reste = PLAFONDS.parJour - Math.max(0, dejaAujourdhui);
  return Math.max(0, Math.min(demande, reste));
}
