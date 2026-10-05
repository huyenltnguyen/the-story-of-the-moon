import { describe, it, should } from 'vitest';

import { publicAssetSrcSet, publicAssetUrl } from './publicAssetUrl';

const chaiShould = should();

describe('publicAssetUrl', () => {
  it('should prefix a public asset path with the configured base URL', () => {
    chaiShould.equal(
      publicAssetUrl('/moon/moon-2k.jpg', '/the-story-of-the-moon/'),
      '/the-story-of-the-moon/moon/moon-2k.jpg'
    );
  });

  it('should leave absolute URLs unchanged', () => {
    chaiShould.equal(
      publicAssetUrl(
        'https://example.com/image.jpg',
        '/the-story-of-the-moon/'
      ),
      'https://example.com/image.jpg'
    );
  });

  it('should prefix every candidate in a srcset', () => {
    chaiShould.equal(
      publicAssetSrcSet(
        '/moon-800.avif 800w, /moon-1600.avif 1600w',
        '/the-story-of-the-moon/'
      ),
      '/the-story-of-the-moon/moon-800.avif 800w, /the-story-of-the-moon/moon-1600.avif 1600w'
    );
  });
});
