import { getDatabase, ServerValue } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { BAREME, LIBELLES, PLAFONDS, attribuable, niveauDe, type Motif } from './bareme.js';

/**
 * L'attribution des points.
 *
 * Un seul chemin mene ici, et il part toujours d'un evenement de base :
 * une presence constatee, un post publie. **Jamais d'appel client qui
 * dirait « donne-moi cinquante points »** — les regles refusent au client
 * d'ecrire un seul point, et cette fonction est la seule a en poser.
 *
 * Trois garde-fous, dans cet ordre :
 *
 * 1. **L'idempotence.** Une Cloud Function peut etre rejouee : Firebase ne
 *    promet pas qu'un declencheur ne parte qu'une fois. Chaque fait porte
 *    donc une cle, et la cle se reserve avant d'attribuer. Rejouer ne
 *    donne rien la seconde fois.
 * 2. **Le plafond du jour**, dans le fuseau du spot : il ne bride pas un
 *    membre assidu, il borne ce qu'une faille inconnue pourrait produire.
 * 3. **Les plafonds par geste**, qui vivent chez les appelants parce
 *    qu'eux seuls savent compter les rencontres d'une soiree.
 */

function db() {
  return getDatabase();
}

/** Le fuseau d'un spot, avec un repli commun plutot que celui du serveur. */
async function fuseauDe(spot: string): Promise<string> {
  const lu = (await db().ref(`servers/${spot}/timezone`).get()).val() as string | null;
  return lu ?? 'Europe/Paris';
}

/**
 * Le compte de l'application ne gagne rien.
 *
 * Il publie les annonces et accueille les nouveaux : autant de gestes que
 * le bareme recompense chez un membre. Il se retrouvait ainsi premier du
 * mois a Paris, devant ceux pour qui le classement existe. Le drapeau est
 * celui qui le tient deja hors des amities et des appels.
 */
async function estOfficiel(uid: string): Promise<boolean> {
  return (await db().ref(`users/${uid}/officiel`).get()).val() === true;
}

/**
 * Un serveur sans trophees ne compte rien.
 *
 * Le premier serveur prive, celui d'une ecole, n'a ni trophees, ni
 * points, ni classement : on s'y retrouve entre soi, on n'y joue pas. Le
 * drapeau vit sur la fiche du serveur, comme `prive`.
 */
async function sansTrophees(spot: string): Promise<boolean> {
  return (await db().ref(`servers/${spot}/sansTrophees`).get()).val() === true;
}

/** "2026-08-14" dans le fuseau donne. */
function jourDe(timezone: string, instant: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

/** "2026-08" dans le fuseau donne — la periode du classement mensuel. */
export function moisDe(timezone: string, instant: number): string {
  return jourDe(timezone, instant).slice(0, 7);
}

/** Les compteurs sur lesquels les trophees se jugent. */
export type Compteur = 'venus' | 'organises' | 'rencontres' | 'nouveauxAccueillis' | 'postes';

export interface Fait {
  uid: string;
  spot: string;
  motif: Motif;
  /**
   * Ce qui identifie le fait, une fois pour toutes.
   *
   * Deux passages du meme declencheur produisent la meme cle : c'est ce
   * qui rend l'attribution rejouable sans consequence.
   */
  cle: string;
  /** Ce a quoi le fait se rapporte, pour le journal. */
  ref?: string;
  /** Le compteur a incrementer, s'il y en a un. */
  compteur?: Compteur;
  /** Multiplie le bareme : cinq rencontres d'un coup, par exemple. */
  fois?: number;
  /**
   * Remplace la valeur du bareme.
   *
   * Un seul cas aujourd'hui : organiser une sortie spontanee vaut la
   * moitie d'un evenement prepare. Le geste est plus leger, la
   * recompense aussi.
   */
  montant?: number;
}

/**
 * Attribue les points d'un fait. Rend ce qui a reellement ete donne.
 *
 * Zero veut dire « deja compte » ou « plafond atteint » — les deux sont
 * des issues normales, pas des erreurs.
 */
export async function attribuer(fait: Fait): Promise<number> {
  const { uid, spot, motif, cle, ref, compteur, fois = 1, montant } = fait;
  if (!uid || !spot) return 0;
  if ((await estOfficiel(uid)) || (await sansTrophees(spot))) return 0;

  /*
    La cle se reserve par une transaction : deux passages simultanes du
    meme declencheur ne peuvent pas la prendre tous les deux. Le second
    lit une valeur deja posee et abandonne.
  */
  const verrou = db().ref(`points/attribue/${spot}/${uid}/${cle}`);
  const prise = await verrou.transaction((actuel) => (actuel === null ? Date.now() : undefined));
  if (!prise.committed || prise.snapshot.val() === null) return 0;

  const timezone = await fuseauDe(spot);
  const maintenant = Date.now();
  const jour = jourDe(timezone, maintenant);
  const mois = moisDe(timezone, maintenant);

  const deja = ((await db().ref(`points/plafond/${spot}/${uid}/${jour}`).get()).val() as
    | number
    | null) ?? 0;

  const donne = attribuable(deja, (montant ?? BAREME[motif]) * Math.max(1, fois));
  if (donne <= 0) {
    logger.info('plafond du jour atteint', { uid, spot, motif });
    return 0;
  }

  const entree = db().ref(`journalPoints/${uid}/${spot}`).push().key;

  await db()
    .ref()
    .update({
      /*
        Le total du membre sur ce spot **est** son score de toujours : on
        ne le double pas sur sa fiche. Une regle enfant ne peut pas
        retirer un droit accorde au parent, et `users/{uid}` est ecrit par
        son proprietaire — un total range la serait forgeable.
      */
      [`scores/${spot}/all/${uid}`]: ServerValue.increment(donne),
      [`scores/${spot}/${mois}/${uid}`]: ServerValue.increment(donne),
      /*
        La copie d'affichage, tenue par le meme geste.

        Le profil montre les points par ville depuis
        `users/{uid}/destinations`, et le total s'en deduit. Cette copie
        n'etait ecrite que par le client, du temps ou lui seul attribuait
        des trophees : depuis que le moteur en donne, elle ne voyait plus
        rien passer. Vingt et une destinations avaient decroche de leur
        score, jusqu'a vingt-cinq points d'ecart.

        C'est bien une copie, et le classement ne la lit pas — il lit
        `scores`, qu'un membre ne peut pas ecrire. Ce qui est range sous
        `users/{uid}` reste donc affichable et jamais opposable.
      */
      [`users/${uid}/destinations/${spot}/points`]: ServerValue.increment(donne),
      // Le plafond du jour, dans le fuseau du spot.
      [`points/plafond/${spot}/${uid}/${jour}`]: ServerValue.increment(donne),
      /*
        Le journal. Un compteur dont on ne comprend pas la variation n'est
        pas motivant, il est suspect — et c'est le premier outil de
        deboguage quand un total parait faux.
      */
      [`journalPoints/${uid}/${spot}/${entree}`]: {
        motif: LIBELLES[motif],
        points: donne,
        date: maintenant,
        ...(ref ? { ref } : {}),
      },
      ...(compteur
        ? { [`stats/${uid}/${spot}/${compteur}`]: ServerValue.increment(Math.max(1, fois)) }
        : {}),
      /*
        Les sorties se comptent aussi mois par mois : la regularite ne se
        lit pas dans un cumul. « Trois fois dans le mois » et « trois mois
        differents » sortent tous deux de cette ligne.
      */
      ...(compteur === 'venus'
        ? { [`stats/${uid}/${spot}/parMois/${mois}`]: ServerValue.increment(1) }
        : {}),
    });

  /*
    Le total global et le niveau restent sur la fiche : ils sont partout a
    l'ecran, et les deplacer voudrait dire relire un second chemin pour
    chaque avatar affiche. Ils sont donc forgeables — un membre peut se
    peindre un niveau qu'il n'a pas. Ce qui ne l'est pas, c'est le
    classement, qui vit dans `scores` et que nul client n'ecrit : le rang
    reste honnete, seule la pastille peut mentir.
  */
  const totaux = ((await db().ref(`scores`).get()).val() as Record<
    string,
    Record<string, Record<string, number>>
  > | null) ?? {};
  const total = Object.values(totaux).reduce(
    (somme, parPeriode) => somme + (parPeriode?.all?.[uid] ?? 0),
    0,
  );
  await db()
    .ref()
    .update({ [`users/${uid}/totalPoints`]: total, [`users/${uid}/level`]: niveauDe(total) });

  await evaluerTrophees(uid, spot);

  logger.info('points attribues', { uid, spot, motif, donne, total });
  return donne;
}

/**
 * Debloque les trophees que les compteurs justifient.
 *
 * Rien ne le faisait : `unlockedTrophies` n'etait ecrit par personne, et
 * le catalogue affichait donc des promesses que rien ne tenait. On
 * n'evalue que les trophees qui portent un compteur — ceux qui demandent
 * une position restent decoratifs tant que l'application n'en releve
 * aucune, et il vaut mieux que ce soit explicite dans la donnee que cache
 * dans le code.
 *
 * Appele apres chaque attribution : c'est le seul moment ou un compteur
 * bouge.
 */
export async function evaluerTrophees(uid: string, spot: string): Promise<void> {
  /*
    La meme porte qu'ailleurs, et elle manquait ici.

    `crediterTrophee` refusait bien de payer le compte de l'application
    et les serveurs sans trophees — mais la medaille, elle, se posait
    quand meme : le credit est refuse en aval, la pose se faisait en
    amont. Le compte Sirocco collectionnait donc des trophees a zero
    point, et l'ecole en accumulait pour un onglet qui n'existe pas chez
    elle. Un trophee qui ne vaut rien et que personne ne peut voir n'a
    aucune raison d'exister.
  */
  if ((await estOfficiel(uid)) || (await sansTrophees(spot))) return;

  const [catalogue, stats, deja, lieux] = await Promise.all([
    db().ref(`trophies/${spot}`).get(),
    db().ref(`stats/${uid}/${spot}`).get(),
    db().ref(`unlockedTrophies/${uid}/${spot}`).get(),
    db().ref(`visitedPlaces/${uid}/${spot}`).get(),
  ]);

  const trophees = (catalogue.val() as Record<
    string,
    { compteur?: string; seuil?: number; points?: number }
  > | null) ?? {};
  const compteurs = (stats.val() as Record<string, number | Record<string, number>> | null) ?? {};
  const acquis = (deja.val() as Record<string, unknown> | null) ?? {};

  const parMois = (compteurs.parMois as Record<string, number> | undefined) ?? {};
  const parCategorie = (compteurs.parCategorie as Record<string, number> | undefined) ?? {};
  const valeurs: Record<string, number> = {
    venus: (compteurs.venus as number) ?? 0,
    organises: (compteurs.organises as number) ?? 0,
    rencontres: (compteurs.rencontres as number) ?? 0,
    nouveauxAccueillis: (compteurs.nouveauxAccueillis as number) ?? 0,
    postes: (compteurs.postes as number) ?? 0,
    // Le meilleur mois, et le nombre de mois ou l'on est sorti.
    sortiesDunMois: Math.max(0, ...Object.values(parMois)),
    moisAvecSortie: Object.keys(parMois).length,

    /*
      Ce qui se compte ailleurs que dans les compteurs.

      Quatre trophees ne se jugeaient sur rien : ce qu'ils demandent ne
      s'incremente pas a un geste, il se lit sur un etat. Les categories
      de sortie viennent de `parCategorie`, les lieux distincts de ce que
      la fonction des passages a retenu, et la couronne se compte sur les
      trophees deja gagnes — c'est ce qui en fait une couronne.
    */
    categoriesDifferentes: Object.keys(parCategorie).length,
    sportives: parCategorie.sport ?? 0,
    /*
      La cle porte le trophee : deux lieux d'index zero, dans deux
      trophees differents, sont deux endroits. Les compter comme un seul
      aurait bloque les cartographes a une poignee de lieux.
    */
    lieuxDistincts: new Set(
      Object.entries(
        (lieux.val() as Record<string, Record<string, number>> | null) ?? {},
      ).flatMap(([trophee, marques]) => Object.keys(marques).map((i) => `${trophee}:${i}`)),
    ).size,
    tropheesGagnes: Object.keys(acquis).length,
  };

  const patch: Record<string, unknown> = {};
  /* Ce qu'on vient de debloquer, credite une fois la pose faite : un
     trophee ecrit puis un credit qui echoue vaut mieux que l'inverse. */
  const gagnes: Array<{ id: string; points: number }> = [];
  for (const [id, trophee] of Object.entries(trophees)) {
    if (!trophee?.compteur || acquis[id]) continue;
    if ((valeurs[trophee.compteur] ?? 0) >= (trophee.seuil ?? 1)) {
      /*
        Les deux noms de la meme date : le moteur ecrivait `at`, l'ecran
        des trophees lit `unlockedAt`. On pose les deux plutot que de
        faire choisir.
      */
      const quand = Date.now();
      patch[`unlockedTrophies/${uid}/${spot}/${id}`] = { at: quand, unlockedAt: quand };
      gagnes.push({ id, points: Math.max(0, trophee.points ?? 0) });
    }
  }

  if (Object.keys(patch).length > 0) {
    await db().ref().update(patch);
    logger.info('trophees debloques', { uid, spot, combien: Object.keys(patch).length });
  }

  for (const gagne of gagnes) await crediterTrophee(uid, spot, gagne.id, gagne.points);
}

/**
 * Ce qu'un trophee rapporte.
 *
 * Le catalogue annonce des points depuis toujours, et personne ne les
 * versait : on lisait « Premiers pas, 10 points » puis un total qui n'en
 * portait aucune trace. Le trophee etait pose, le score l'ignorait.
 *
 * **Exportee parce que trois chemins deverrouillent des trophees**, et
 * qu'un seul passait par ici. L'arrivee dans une ville (`premierPas`) et
 * les trophees de lieu (`lieux.ts`) ecrivent `unlockedTrophies`
 * directement : leurs trophees se posaient sans etre payes. C'est ce qui
 * donnait dix-huit points a Berlin pour un post et deux trophees.
 *
 * **Hors du plafond du jour, exprès.** Le plafond existe pour qu'on ne
 * puisse pas moissonner des gestes ; un trophee ne se gagne qu'une fois,
 * il n'y a rien a moissonner. L'y soumettre punirait celui qui le
 * decroche un jour ou il a ete actif — et comme le verrou empeche tout
 * second passage, les points rognes seraient perdus pour toujours.
 */
export async function crediterTrophee(
  uid: string,
  spot: string,
  trophyId: string,
  points: number,
): Promise<void> {
  if (points <= 0) return;
  if ((await estOfficiel(uid)) || (await sansTrophees(spot))) return;

  /* Le meme verrou que les autres attributions : deux evaluations
     simultanees ne peuvent pas crediter deux fois. */
  const verrou = db().ref(`points/attribue/${spot}/${uid}/trophee_${trophyId}`);
  const prise = await verrou.transaction((actuel) => (actuel === null ? Date.now() : undefined));
  if (!prise.committed || prise.snapshot.val() === null) return;

  const maintenant = Date.now();
  const mois = moisDe(await fuseauDe(spot), maintenant);
  const entree = db().ref(`journalPoints/${uid}/${spot}`).push().key;

  await db()
    .ref()
    .update({
      [`scores/${spot}/all/${uid}`]: ServerValue.increment(points),
      [`scores/${spot}/${mois}/${uid}`]: ServerValue.increment(points),
      /* La copie d'affichage suit, comme pour un fait — voir `attribuer`. */
      [`users/${uid}/destinations/${spot}/points`]: ServerValue.increment(points),
      [`journalPoints/${uid}/${spot}/${entree}`]: {
        motif: 'Trophée débloqué',
        points,
        date: maintenant,
        ref: trophyId,
      },
    });

  logger.info('points de trophee', { uid, spot, trophyId, points });
}

/**
 * Combien de fois ce geste a deja compte cette semaine.
 *
 * Les plafonds hebdomadaires — trois posts, cinq commentaires, deux
 * evenements organises — se comptent sur les cles deja reservees plutot
 * que sur le journal : la cle est ce qui fait foi, et elle porte deja sa
 * date.
 */
export async function comptePourLaSemaine(
  spot: string,
  uid: string,
  prefixe: string,
): Promise<number> {
  const toutes = ((await db().ref(`points/attribue/${spot}/${uid}`).get()).val() as Record<
    string,
    number
  > | null) ?? {};

  const depuis = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return Object.entries(toutes).filter(([cle, quand]) => cle.startsWith(prefixe) && quand >= depuis)
    .length;
}

export { BAREME, PLAFONDS };
