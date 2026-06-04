import { FOUNDING_ORG_SLUGS } from './founding-orgs';

const RESERVED = new Set([
  ...FOUNDING_ORG_SLUGS,
  'marfyl-demo',
  'marfyl',
  'admin',
  'api',
  'www',
  'app',
  'login',
  'register',
]);

export function normalizeOrganizationSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function assertOrganizationSlugAvailable(slug: string): void {
  if (!slug || slug.length < 2) {
    throw new Error('SLUG_INVALID');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error('SLUG_INVALID');
  }
  if (RESERVED.has(slug)) {
    throw new Error('SLUG_RESERVED');
  }
}
