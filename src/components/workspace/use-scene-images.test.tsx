import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { useSceneImages } from './use-scene-images';
import { imageLayer, sceneOf } from '../../testing/layers';

type FakeImage = {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  decoding: string;
  src: string;
};

/**
 * Replaces `window.Image` with a stub the test drives by hand.
 *
 * jsdom never loads an image, so the load callbacks have to be fired deliberately: that is the
 * only way to reach the failed-load state, and then the retry.
 */
function installFakeImages(): FakeImage[] {
  const created: FakeImage[] = [];
  const Fake = function FakeImageConstructor(): FakeImage {
    const image: FakeImage = { onload: null, onerror: null, decoding: 'auto', src: '' };
    created.push(image);
    return image;
  };
  Object.defineProperty(window, 'Image', { value: Fake, writable: true, configurable: true });
  return created;
}

const HREF = '/forge-assets/aurora-mesh.svg';

/**
 * The scene is built once.
 *
 * The hook keys its loads on the scene's layers, so a scene rebuilt on every render would ask the
 * browser for the graphic again on every render — which is a different behaviour from the one the
 * application has, where the scene is a stable value.
 */
const SCENE = sceneOf(imageLayer('lyr-graphic', { href: HREF }));

function Harness() {
  const images = useSceneImages(SCENE);
  return (
    <div>
      <span data-testid="status">{images.status.get(HREF) ?? 'none'}</span>
      <span data-testid="loading">{String(images.loading)}</span>
      <span data-testid="errors">{images.errors.join(',')}</span>
      <button type="button" onClick={() => images.retry()}>
        Reload graphics
      </button>
    </div>
  );
}

describe('useSceneImages', () => {
  it('re-requests a graphic that failed to load when the reader retries', async () => {
    const created = installFakeImages();
    render(<Harness />);

    // The graphic was requested once.
    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe(HREF);

    // The browser refused it.
    act(() => {
      created[0]?.onerror?.();
    });
    expect(screen.getByTestId('status')).toHaveTextContent('error');
    expect(screen.getByTestId('errors')).toHaveTextContent(HREF);

    // Retrying asks for it again. Without a new request the graphic could never load, and the
    // reader would be left looking at a spinner that never resolves.
    await userEvent.click(screen.getByRole('button', { name: 'Reload graphics' }));
    expect(created).toHaveLength(2);
    expect(created[1]?.src).toBe(HREF);

    // The new request succeeds, so the graphic is ready again.
    act(() => {
      created[1]?.onload?.();
    });
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('reports a graphic that has not finished loading', () => {
    installFakeImages();
    render(<Harness />);

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
  });
});
