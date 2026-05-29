export function isConcertFeatureEnabled(): boolean {
  if (process.env.CONCERT_FEATURE_ENABLED === 'false') return false;
  return process.env.CONCERT_FEATURE_ENABLED === 'true' || process.env.NODE_ENV !== 'production';
}

export const CONCERT_HOLD_MINUTES = 12;
