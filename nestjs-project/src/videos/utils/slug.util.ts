import * as crypto from 'crypto';

export const SLUG_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const SLUG_LENGTH = 11;
export const SLUG_REGEX = /^[A-Za-z0-9_-]{11}$/;

export function generateSlug(length: number = SLUG_LENGTH): string {
  const bytes = crypto.randomBytes(length);
  let slug = '';
  for (let i = 0; i < length; i++) {
    slug += SLUG_ALPHABET[bytes[i] & 63];
  }
  return slug;
}
