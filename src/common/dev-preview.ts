export function isDevPreviewAuthEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.DEV_PREVIEW_AUTH === 'false') return false;
  return process.env.DEV_PREVIEW_AUTH === 'true' || process.env.NODE_ENV === 'development';
}

export const DEV_PREVIEW_TOKEN = 'dev-preview-token';

export function devPreviewOrgId(): number {
  const n = parseInt(process.env.DEV_PREVIEW_ORG_ID ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function buildDevPreviewUser() {
  const organizationId = devPreviewOrgId();
  return {
    id: 0,
    email: 'preview@marfyl.local',
    isSuperAdmin: true,
    organizationId,
    tenantId: organizationId,
  };
}
