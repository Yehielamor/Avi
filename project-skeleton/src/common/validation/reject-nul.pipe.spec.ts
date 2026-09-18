import { BadRequestException } from '@nestjs/common';

import { RejectNulPipe } from './reject-nul.pipe';

const NUL = String.fromCharCode(0);

describe('RejectNulPipe', () => {
  const pipe = new RejectNulPipe();

  it.each([
    ['a top-level string', `a${NUL}b`],
    ['a nested field', { note: `x${NUL}` }],
    ['an array element', { windows: [{ date: '2026-10-01', part: `noon${NUL}` }] }],
    ['a key', { [`k${NUL}`]: 'v' }],
    ['a null-prototype query object', Object.assign(Object.create(null) as object, { from: `2026${NUL}` })],
  ])('rejects NUL in %s with 400', (_l, value) => {
    expect(() => pipe.transform(value)).toThrow(BadRequestException);
  });

  it('passes ordinary input through unchanged, including Hebrew, emoji and other control characters', () => {
    const body = { note: 'שלום 👋\n\tטקסט', n: 3, ok: true, none: null, list: ['a', 1] };
    expect(pipe.transform(body)).toBe(body);
  });

  it('does not scan uploaded file buffers (binary is legitimate there)', () => {
    const file = { originalname: 'a.pdf', buffer: Buffer.from([0, 1, 0, 2]) };
    expect(pipe.transform(file)).toBe(file);
  });
});
