import { generateSlug, SLUG_REGEX, SLUG_LENGTH } from './slug.util';

describe('slug.util', () => {
  it('should generate a slug with exactly 11 characters matching the URL-safe regex', () => {
    const slug = generateSlug();
    expect(slug).toHaveLength(SLUG_LENGTH);
    expect(SLUG_REGEX.test(slug)).toBe(true);
  });

  it('should generate custom length if specified', () => {
    const slug = generateSlug(16);
    expect(slug).toHaveLength(16);
    expect(/^[A-Za-z0-9_-]{16}$/.test(slug)).toBe(true);
  });

  it('should generate 10,000 unique slugs without collision', () => {
    const set = new Set<string>();
    const count = 10000;

    for (let i = 0; i < count; i++) {
      const slug = generateSlug();
      expect(SLUG_REGEX.test(slug)).toBe(true);
      set.add(slug);
    }

    expect(set.size).toBe(count);
  });
});
