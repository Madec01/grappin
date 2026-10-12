/**
 * L'installation du jeu sur l'écran d'accueil, vue du jeu.
 *
 * Le jeu est une application web installable (manifeste, service worker), mais
 * aucun navigateur ne le propose de lui-même de façon sûre : Chrome, sur
 * Android, n'offre l'installation qu'après un temps d'usage, par une petite
 * barre qu'on ferme sans la voir ; Safari, sur iPhone et iPad, ne la propose
 * jamais, il faut passer par « Partager → Sur l'écran d'accueil ». Retour du
 * propriétaire (0.12.4) : « le jeu ne me propose toujours pas de l'installer ».
 * Le titre porte donc un bouton « Installer le jeu » dès que le navigateur sait
 * installer en un geste (`beforeinstallprompt`, que l'on garde pour le
 * déclencher au bouton), et, sur iPhone et iPad hors application, le rappel du
 * chemin par le menu Partager. Ouvert depuis l'écran d'accueil, ou une fois
 * installé, plus rien. Sans DOM ni PixiJS : le navigateur est décrit par un
 * `InstallHost`, que les tests imitent.
 */

/** Ce que le titre montre : l'invite en un geste, le rappel pour iPhone, ou rien. */
export type InstallState = 'prompt' | 'ios' | null;

export interface Installer {
  state(): InstallState;
  /** Déclenche l'invite du navigateur (état `prompt`) ; sans invite en attente, ne fait rien. */
  prompt(): Promise<void>;
}

/** Aucune installation possible : les tests, et un navigateur qui ne dit rien. */
export const NO_INSTALLER: Installer = { state: () => null, prompt: () => Promise.resolve() };

/** Les faits qui décident, pour les tests et pour `browserInstaller`. */
export interface InstallFacts {
  /** Ouvert depuis l'écran d'accueil, ou installé pendant cette visite. */
  readonly standalone: boolean;
  /** iPhone, iPad ou iPod : pas d'invite, seulement le menu Partager. */
  readonly ios: boolean;
  /** Le navigateur a annoncé qu'il sait installer, et l'invite attend un geste. */
  readonly promptReady: boolean;
}

export function installStateOf(facts: InstallFacts): InstallState {
  if (facts.standalone) return null;
  if (facts.promptReady) return 'prompt';
  return facts.ios ? 'ios' : null;
}

/** L'événement `beforeinstallprompt` de Chrome : une invite différée, à déclencher d'un geste du joueur. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

/** Ce que l'installateur lit du navigateur : le strict nécessaire, pour l'imiter dans les tests. */
export interface InstallHost {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
  /** Safari sur iPhone : vrai quand la page est ouverte depuis l'écran d'accueil ; absent ailleurs. */
  readonly standalone: boolean | undefined;
  /** `(display-mode: standalone)` : ouvert comme une application, sur tout navigateur. */
  readonly displayStandalone: boolean;
  addEventListener(type: string, listener: (event: Event) => void): void;
}

export function hostOf(win: Window, nav: Navigator): InstallHost {
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: (nav as Navigator & { standalone?: boolean }).standalone,
    displayStandalone: typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches,
    addEventListener: (type, listener) => win.addEventListener(type, listener),
  };
}

/** iPhone, iPad, iPod ; et l'iPad récent, qui se dit Mac mais a un écran tactile. */
export function isIos(host: Pick<InstallHost, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  return /iPhone|iPad|iPod/.test(host.userAgent) || (host.platform === 'MacIntel' && host.maxTouchPoints > 1);
}

/**
 * L'installateur du navigateur : garde l'invite de `beforeinstallprompt` au lieu
 * de laisser Chrome la montrer à sa guise, et la déclenche au bouton ; sait
 * quand l'application est installée (`appinstalled`) ou déjà ouverte comme
 * telle. L'invite ne sert qu'une fois : acceptée ou refusée, le bouton s'efface
 * jusqu'à ce que le navigateur en redonne une.
 */
export function browserInstaller(host: InstallHost): Installer {
  let deferred: InstallPromptEvent | null = null;
  let standalone = host.displayStandalone || host.standalone === true;
  const ios = isIos(host);
  host.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
  });
  host.addEventListener('appinstalled', () => {
    deferred = null;
    standalone = true;
  });
  return {
    state: () => installStateOf({ standalone, ios, promptReady: deferred !== null }),
    prompt: async () => {
      const invite = deferred;
      if (!invite) return;
      deferred = null;
      await invite.prompt();
      await invite.userChoice;
    },
  };
}
