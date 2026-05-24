/**
 * Meta Pixel helper — typed wrapper around window.fbq.
 *
 * The base pixel + PageView is loaded in index.html. This module exposes
 * helpers to fire custom events from React code (Lead, CompleteRegistration,
 * Purchase, etc.) without polluting components with `window.fbq` checks.
 *
 * Usage :
 *   trackEvent('Lead', { value: 100, currency: 'DZD' });
 *   trackEvent('CompleteRegistration');
 *   trackEvent('Purchase', { value: 45000, currency: 'DZD' });
 *
 * Pixel ID : 1598745172258505
 */

// Standard Meta Pixel events. We type the most useful ones strictly to avoid
// typos. Anything else falls through to string (e.g., custom event names).
type StandardEvent =
  | 'AddPaymentInfo'
  | 'AddToCart'
  | 'AddToWishlist'
  | 'CompleteRegistration'
  | 'Contact'
  | 'CustomizeProduct'
  | 'Donate'
  | 'FindLocation'
  | 'InitiateCheckout'
  | 'Lead'
  | 'Purchase'
  | 'Schedule'
  | 'Search'
  | 'StartTrial'
  | 'SubmitApplication'
  | 'Subscribe'
  | 'ViewContent';

type FbqEvent = StandardEvent | (string & {});

/** Parameters Meta expects for standard events. All optional. */
export interface FbqParams {
  value?: number;
  currency?: string;
  content_name?: string;
  content_category?: string;
  content_ids?: string[];
  content_type?: 'product' | 'product_group';
  num_items?: number;
  predicted_ltv?: number;
  // Custom payload — pixel accepts arbitrary key/value pairs.
  [key: string]: unknown;
}

// Augment window with fbq global. Real declaration sits in index.html.
declare global {
  interface Window {
    fbq?: (action: 'track' | 'trackCustom' | 'init', event: string, params?: FbqParams) => void;
    _fbq?: unknown;
  }
}

/**
 * Fire a standard Meta event. Silently no-ops if the pixel isn't loaded yet
 * (ad-blocker, cold-load race, dev environment without script tag, etc.).
 */
export function trackEvent(event: FbqEvent, params?: FbqParams): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') {
    // Dev/SSR/no-pixel context — log so we still see intent in console.
    // eslint-disable-next-line no-console
    if (typeof window !== 'undefined') console.info('[pixel:no-fbq]', event, params);
    return;
  }
  try {
    window.fbq('track', event, params);
  } catch (e) {
    // Never let a tracking error break the app.
    // eslint-disable-next-line no-console
    console.warn('[pixel] track failed', e);
  }
}

/**
 * Fire a custom (non-standard) event. Use sparingly — Meta optimisation
 * works best on the standard events listed in StandardEvent.
 */
export function trackCustom(event: string, params?: FbqParams): void {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  try {
    window.fbq('trackCustom', event, params);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pixel] trackCustom failed', e);
  }
}
