import { describe, it, expect } from 'vitest';
import { imageAccept, imageTypeOf } from '../imageUpload';

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('image uploads (O12)', () => {
  it('PNG / JPEG / WebP / GIF are accepted; ICO only where a favicon is', () => {
    expect(imageTypeOf(file('logo.png', 'image/png'))).toEqual({ type: 'image/png' });
    expect(imageTypeOf(file('photo.jfif', ''))).toEqual({ type: 'image/jpeg' }); // no type given → the extension decides
    expect(imageTypeOf(file('fav.ico', ''))).toEqual({ problem: 'Upload a PNG, JPEG, WebP or GIF image.' });
    expect(imageTypeOf(file('fav.ico', ''), true)).toEqual({ type: 'image/x-icon' });
    expect(imageAccept(true)).toContain('.ico');
    expect(imageAccept()).not.toContain('ico');
  });
  it('SVG is refused with the reason; too big is refused with the size', () => {
    expect(imageTypeOf(file('logo.svg', 'image/svg+xml'))).toEqual({ problem: expect.stringMatching(/SVG images aren't accepted/) });
    expect(imageTypeOf(file('big.png', 'image/png', 3 * 1024 * 1024))).toEqual({ problem: 'That image is 3.0 MB — the limit is 2 MB.' });
  });
});
