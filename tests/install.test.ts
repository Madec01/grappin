import { describe, expect, it } from 'vitest';
import { NO_INSTALLER, browserInstaller, installStateOf, isIos, type InstallHost, type InstallPromptEvent } from '../src/app/install';

/**
 * Retour du propriétaire (0.12.4) : « le jeu ne me propose toujours pas de
 * l'installer ». Le titre doit le proposer dès que le navigateur sait
 * installer, et rappeler le chemin sur iPhone.
 */

/** Un navigateur imité : ses faits, et les écouteurs qu'il reçoit. */
function host(parts: Partial<InstallHost> = {}): InstallHost & { fire: (type: string, event?: Event) => void } {
  const listeners = new Map<string, ((event: Event) => void)[]>();
  return {
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    standalone: undefined,
    displayStandalone: false,
    addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    fire: (type, event = new Event(type, { cancelable: true })) => listeners.get(type)?.forEach((listener) => listener(event)),
    ...parts,
  };
}

/** L'invite de Chrome, imitée : compte ses déclenchements et répond ce qu'on lui dit. */
function invite(outcome: 'accepted' | 'dismissed' = 'accepted'): InstallPromptEvent & { prompted: number } {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent & { prompted: number };
  event.prompted = 0;
  Object.assign(event, {
    prompt: () => {
      event.prompted += 1;
      return Promise.resolve();
    },
    userChoice: Promise.resolve({ outcome }),
  });
  return event;
}

describe('ce que le titre montre de l\'installation', () => {
  it('l\'invite dès que le navigateur sait installer, le rappel sur iPhone, rien une fois installé ou ouvert en application', () => {
    expect(installStateOf({ standalone: false, ios: false, promptReady: true })).toBe('prompt');
    expect(installStateOf({ standalone: false, ios: true, promptReady: false })).toBe('ios');
    expect(installStateOf({ standalone: false, ios: true, promptReady: true })).toBe('prompt');
    expect(installStateOf({ standalone: false, ios: false, promptReady: false })).toBeNull();
    expect(installStateOf({ standalone: true, ios: true, promptReady: false })).toBeNull();
    expect(installStateOf({ standalone: true, ios: false, promptReady: true })).toBeNull();
    expect(NO_INSTALLER.state()).toBeNull();
  });

  it('reconnaît iPhone, iPad et iPod, et l\'iPad récent qui se dit Mac à écran tactile', () => {
    expect(isIos({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X)', platform: 'iPad', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
  });
});

describe('l\'installateur du navigateur', () => {
  it('garde l\'invite de Chrome au lieu de la laisser s\'afficher, la déclenche au bouton, une seule fois', async () => {
    const browser = host();
    const installer = browserInstaller(browser);
    expect(installer.state()).toBeNull();
    const event = invite();
    browser.fire('beforeinstallprompt', event);
    expect(event.defaultPrevented).toBe(true);
    expect(installer.state()).toBe('prompt');
    await installer.prompt();
    expect(event.prompted).toBe(1);
    // L'invite ne sert qu'une fois : le bouton s'efface jusqu'à ce que le navigateur en redonne une.
    expect(installer.state()).toBeNull();
    await installer.prompt();
    expect(event.prompted).toBe(1);
    browser.fire('beforeinstallprompt', invite('dismissed'));
    expect(installer.state()).toBe('prompt');
  });

  it('une fois l\'application installée, plus rien, même si une invite attendait', () => {
    const browser = host();
    const installer = browserInstaller(browser);
    browser.fire('beforeinstallprompt', invite());
    expect(installer.state()).toBe('prompt');
    browser.fire('appinstalled');
    expect(installer.state()).toBeNull();
    browser.fire('beforeinstallprompt', invite());
    expect(installer.state()).toBeNull();
  });

  it('ouvert depuis l\'écran d\'accueil, rien ; sur iPhone dans Safari, le rappel', () => {
    const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', platform: 'iPhone' };
    expect(browserInstaller(host({ ...iphone, standalone: false })).state()).toBe('ios');
    expect(browserInstaller(host({ ...iphone, standalone: true })).state()).toBeNull();
    expect(browserInstaller(host({ displayStandalone: true })).state()).toBeNull();
    const android = host({ displayStandalone: true });
    const installer = browserInstaller(android);
    android.fire('beforeinstallprompt', invite());
    expect(installer.state()).toBeNull();
  });
});
