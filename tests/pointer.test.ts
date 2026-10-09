import { describe, expect, it } from 'vitest';
import { trackPointer } from '../src/input/pointer';

/** Ce que le suivi lit d'un événement de pointeur. */
interface FakeEvent {
  pointerId: number;
  button: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
}

/** Faux élément : garde les écouteurs, note les captures, et se place à (left, top) dans la page. */
function fakeTarget(left = 10, top = 20) {
  const listeners = new Map<string, (event: FakeEvent) => void>();
  const captured: number[] = [];
  const target = {
    addEventListener: (type: string, listener: (event: FakeEvent) => void) => void listeners.set(type, listener),
    setPointerCapture: (id: number) => void captured.push(id),
    getBoundingClientRect: () => ({ left, top }),
  };
  const fire = (type: string, init: Partial<FakeEvent> = {}) =>
    listeners.get(type)?.({ pointerId: 1, button: 0, clientX: 0, clientY: 0, preventDefault: () => undefined, ...init });
  return { element: target as unknown as HTMLElement, fire, captured };
}

function track() {
  const { element, fire, captured } = fakeTarget();
  const calls: string[] = [];
  trackPointer(element, {
    onPress: (x, y) => calls.push(`press ${x},${y}`),
    onRelease: (x, y) => calls.push(`release ${x},${y}`),
  });
  return { fire, captured, calls };
}

describe('suivi du pointeur', () => {
  it('donne la position du doigt en pixels CSS, dans le repère de l\'élément, à l\'appui comme au relâchement', () => {
    const { fire, calls, captured } = track();
    fire('pointerdown', { clientX: 110, clientY: 320 });
    fire('pointerup', { clientX: 60, clientY: 220 });
    expect(calls).toEqual(['press 100,300', 'release 50,200']);
    expect(captured).toEqual([1]);
  });

  it('ignore un deuxième doigt, et la fin du geste ne vient que du premier', () => {
    const { fire, calls } = track();
    fire('pointerdown', { pointerId: 1, clientX: 20, clientY: 30 });
    fire('pointerdown', { pointerId: 2, clientX: 200, clientY: 300 });
    fire('pointerup', { pointerId: 2, clientX: 200, clientY: 300 });
    expect(calls).toEqual(['press 10,10']);
    fire('pointerup', { pointerId: 1, clientX: 30, clientY: 40 });
    expect(calls).toEqual(['press 10,10', 'release 20,20']);
  });

  it('ne relâche qu\'une fois, même si plusieurs événements de fin se suivent', () => {
    const { fire, calls } = track();
    fire('pointerdown', { clientX: 10, clientY: 20 });
    fire('pointerup', { clientX: 10, clientY: 20 });
    fire('lostpointercapture', { clientX: 10, clientY: 20 });
    fire('pointercancel', { clientX: 10, clientY: 20 });
    expect(calls).toEqual(['press 0,0', 'release 0,0']);
  });

  it('relâche aussi quand le système annule ou retire le pointeur', () => {
    for (const type of ['pointercancel', 'lostpointercapture']) {
      const { fire, calls } = track();
      fire('pointerdown', { clientX: 10, clientY: 20 });
      fire(type, { clientX: 10, clientY: 20 });
      expect(calls).toEqual(['press 0,0', 'release 0,0']);
    }
  });

  it('ignore les boutons autres que le principal', () => {
    const { fire, calls } = track();
    fire('pointerdown', { button: 2, clientX: 50, clientY: 50 });
    expect(calls).toEqual([]);
  });
});
