import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

/**
 * Le moteur de points, contre l'emulateur.
 *
 * C'est la partie ou un bug est invisible et durable : personne ne
 * remarque un point de trop, et un point manquant se decouvre des
 * semaines plus tard. Les regles pures — le bareme, les niveaux, le
 * plafond — se verifient sans base ; ce qui suit verifie ce qu'elles ne
 * peuvent pas dire : l'idempotence, l'appariement des rencontres, et les
 * conditions qui dependent de l'etat de la base.
 *
 * Ces tests **exigent l'emulateur**. Ils se lancent par
 * `npm run test:points` a la racine, qui le demarre autour d'eux. Sans
 * `FIREBASE_DATABASE_EMULATOR_HOST`, ils s'ecartent d'eux-memes plutot
 * que d'aller ecrire dans la vraie base.
 */

const EMULATEUR = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const SPOT = 'marrakech';

/* Sans emulateur, on ne joue rien : ecrire dans la base de production
   pour un test serait la pire facon de le decouvrir. */
const suite = EMULATEUR ? describe : describe.skip;

suite('moteur de points', () => {
  let app: App;
  let traiterPresence: (eventId: string, uid: string) => Promise<void>;
  let traiterPost: (spot: string, postId: string, auteur: string) => Promise<void>;

  beforeAll(async () => {
    /* Aucune identite : l'emulateur n'en verifie pas, et lui en donner une
       fausse ne ferait que la faire rejeter. */
    app = initializeApp({
      projectId: 'sirocco-test',
      databaseURL: `http://${EMULATEUR}?ns=sirocco-test-default-rtdb`,
    });

    // L'import vient apres l'initialisation : le module appelle
    // `getDatabase()` des qu'on le touche.
    const points = await import('./index.js');
    traiterPresence = points.traiterPresence;
    traiterPost = points.traiterPost;
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  const db = () => getDatabase(app);

  /** Une base propre, et un evenement dont on connait l'organisateur. */
  async function poser(participants: string[], organisateur = 'org') {
    await db().ref().set(null);
    await db()
      .ref()
      .update({
        [`servers/${SPOT}/timezone`]: 'Africa/Casablanca',
        'eventIndex/e1': { serverId: SPOT, organizerId: organisateur },
        ...Object.fromEntries(
          participants.map((uid) => [`eventAttendance/e1/${uid}`, { at: Date.now(), via: 'qr' }]),
        ),
      });
  }

  const score = async (uid: string): Promise<number> =>
    ((await db().ref(`scores/${SPOT}/all/${uid}`).get()).val() as number | null) ?? 0;

  beforeEach(async () => {
    await db().ref().set(null);
  });

  it('donne cinquante points a qui est venu', async () => {
    await poser(['alice']);
    await traiterPresence('e1', 'alice');
    expect(await score('alice')).toBe(50);
  });

  it("ne donne rien pour un evenement en ligne : on ne s'y est pas vu", async () => {
    await poser(['alice', 'bob']);
    await db().ref(`events/${SPOT}/e1/enLigne`).set(true);
    await traiterPresence('e1', 'alice');
    await traiterPresence('e1', 'bob');
    expect(await score('alice')).toBe(0);
    expect(await score('bob')).toBe(0);
    expect((await db().ref(`rencontres/${SPOT}/bob/alice`).get()).exists()).toBe(false);
  });

  it('ne donne rien deux fois si le declencheur est rejoue', async () => {
    await poser(['alice']);
    await traiterPresence('e1', 'alice');
    await traiterPresence('e1', 'alice');
    await traiterPresence('e1', 'alice');
    // Firebase ne promet pas qu'un declencheur ne parte qu'une fois :
    // c'est la garantie la plus importante de tout le moteur.
    expect(await score('alice')).toBe(50);
  });

  it('compte une rencontre pour chacun des deux, une seule fois', async () => {
    await poser(['alice', 'bob']);
    await traiterPresence('e1', 'alice');
    await traiterPresence('e1', 'bob');

    // alice : 50 de presence. bob : 50 + 15, et alice recoit ses 15 aussi.
    expect(await score('alice')).toBe(65);
    expect(await score('bob')).toBe(65);

    const paire = (await db().ref(`rencontres/${SPOT}/alice/bob`).get()).val() as {
      nombre?: number;
    } | null;
    expect(paire?.nombre).toBe(1);
  });

  it('ne recompte pas une paire deja rencontree', async () => {
    await poser(['alice', 'bob']);
    await traiterPresence('e1', 'alice');
    await traiterPresence('e1', 'bob');
    const avant = await score('bob');

    // Un second evenement, les memes deux personnes, le meme mois.
    await db()
      .ref()
      .update({
        'eventIndex/e2': { serverId: SPOT, organizerId: 'org' },
        'eventAttendance/e2/alice': { at: Date.now(), via: 'qr' },
        'eventAttendance/e2/bob': { at: Date.now(), via: 'qr' },
      });
    await traiterPresence('e2', 'alice');
    await traiterPresence('e2', 'bob');

    // Deux presences de plus (100), mais pas de seconde rencontre.
    expect(await score('bob')).toBe(avant + 50);
  });

  it('paye l’organisateur quand trois personnes sont venues', async () => {
    await poser(['org', 'alice', 'bob'], 'org');
    await traiterPresence('e1', 'org');
    await traiterPresence('e1', 'alice');
    await traiterPresence('e1', 'bob');

    const journal = (await db().ref('journalPoints/org/marrakech').get()).val() as Record<
      string,
      { motif?: string }
    > | null;
    const motifs = Object.values(journal ?? {}).map((ligne) => ligne.motif);
    expect(motifs).toContain('Événement organisé');
  });

  it('ne paye qu’une moitie a l’organisateur d’une sortie spontanee', async () => {
    await poser(['org', 'alice', 'bob'], 'org');
    await db().ref(`events/${SPOT}/e1`).set({ organizerId: 'org', spontane: true });
    await traiterPresence('e1', 'org');
    await traiterPresence('e1', 'alice');
    await traiterPresence('e1', 'bob');

    const journal = (await db().ref('journalPoints/org/marrakech').get()).val() as Record<
      string,
      { motif?: string; points?: number }
    > | null;
    const ligne = Object.values(journal ?? {}).find(
      (entree) => entree.motif === 'Événement organisé',
    );
    // Cinquante au lieu de cent : le geste est plus leger.
    expect(ligne?.points).toBe(50);
  });

  it('ne paye pas l’organisateur en dessous de trois presents', async () => {
    await poser(['org', 'alice'], 'org');
    await traiterPresence('e1', 'org');
    await traiterPresence('e1', 'alice');

    const journal = (await db().ref('journalPoints/org/marrakech').get()).val() as Record<
      string,
      { motif?: string }
    > | null;
    const motifs = Object.values(journal ?? {}).map((ligne) => ligne.motif);
    // Deux personnes, ce n'est pas une sortie, c'est un rendez-vous.
    expect(motifs).not.toContain('Événement organisé');
  });

  it('tient le plafond de deux cents points par jour', async () => {
    await db()
      .ref()
      .update({
        [`servers/${SPOT}/timezone`]: 'Africa/Casablanca',
        ...Object.fromEntries(
          Array.from({ length: 6 }, (_, i) => [
            `eventIndex/p${i}`,
            { serverId: SPOT, organizerId: 'org' },
          ]),
        ),
      });

    for (let i = 0; i < 6; i += 1) {
      await db().ref(`eventAttendance/p${i}/alice`).set({ at: Date.now(), via: 'qr' });
      await traiterPresence(`p${i}`, 'alice');
    }

    // Six presences valent 300, le plafond en laisse passer 200.
    expect(await score('alice')).toBe(200);
  });

  it('ne compte que trois posts par semaine', async () => {
    await db().ref(`servers/${SPOT}/timezone`).set('Africa/Casablanca');
    for (let i = 0; i < 5; i += 1) await traiterPost(SPOT, `post${i}`, 'alice');
    // Publier reste libre au-dela ; cela ne rapporte plus.
    expect(await score('alice')).toBe(9);
  });

  it('debloque un trophee des que son compteur l’atteint', async () => {
    await poser(['alice']);
    // Le catalogue du spot, reduit a ce que le test regarde.
    await db()
      .ref(`trophies/${SPOT}`)
      .set({
        't-bapteme-du-feu': { compteur: 'venus', seuil: 1 },
        't-dix-rencontres': { compteur: 'rencontres', seuil: 10 },
        't-perdu-medina': { progressTarget: 3 },
      });

    await traiterPresence('e1', 'alice');
    const debloques = (await db().ref(`unlockedTrophies/alice/${SPOT}`).get()).val() as Record<
      string,
      unknown
    > | null;

    // Une sortie suffit au premier ; le second en demande dix.
    expect(Object.keys(debloques ?? {})).toEqual(['t-bapteme-du-feu']);
    // Et celui qui n'a pas de compteur reste decoratif, sans jamais tomber.
    expect(debloques?.['t-perdu-medina']).toBeUndefined();
  });

  it('ouvre la fenetre de co-presence sur le tete-a-tete existant', async () => {
    await poser(['alice', 'bob']);
    // Leur tete-a-tete existe deja : ils s'etaient ecrit avant la soiree.
    await db().ref('directConversations/alice_bob').set('c1');

    await traiterPresence('e1', 'alice');
    await traiterPresence('e1', 'bob');

    const fin = (await db().ref('coPresence/c1').get()).val() as number | null;
    expect(fin).toBeGreaterThan(Date.now());
    // Sept jours, a la minute pres.
    expect(fin! - Date.now()).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it('n’ouvre aucune fenetre sans rencontre', async () => {
    await poser(['alice']);
    await db().ref('directConversations/alice_bob').set('c1');
    await traiterPresence('e1', 'alice');
    // Alice etait seule : personne a rencontrer, donc rien a ouvrir.
    expect((await db().ref('coPresence/c1').get()).val()).toBeNull();
  });

  it('inscrit le niveau qui correspond au total', async () => {
    await poser(['alice']);
    await traiterPresence('e1', 'alice');
    const niveau = (await db().ref('users/alice/level').get()).val();
    // Le seuil a 50 est delibere : la premiere sortie fait monter.
    expect(niveau).toBe(2);
  });
});
