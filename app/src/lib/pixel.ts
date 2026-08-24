/**
 * Meta Pixel helper — typed wrapper around window.fbq.
 *
 * The pixel is loaded only after explicit consent on public acquisition pages.
 * It is never bootstrapped globally on student/admin routes.
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

export const META_CONSENT_KEY = 'aurel:meta-consent:v1';
const PIXEL_ID = '1598745172258505';

export function hasMetaConsent(): boolean {
  return typeof window !== 'undefined' && localStorage.getItem(META_CONSENT_KEY) === 'granted';
}

/** Load Meta's external SDK without an inline script. Idempotent. */
export function loadMetaPixel(): void {
  if (typeof window === 'undefined' || !hasMetaConsent() || typeof window.fbq === 'function') return;
  type QueueFn = ((...args: unknown[]) => void) & {
    callMethod?: (...args: unknown[]) => void;
    queue?: unknown[][];
    loaded?: boolean;
    version?: string;
    push?: (...args: unknown[]) => void;
  };
  const fbq: QueueFn = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue?.push(args);
  };
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.push = fbq;
  window.fbq = fbq as Window['fbq'];
  window._fbq = fbq;
  const script = document.createElement('script');
  script.id = 'aurel-meta-pixel';
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);
  window.fbq?.('init', PIXEL_ID);
}

/**
 * Fire a standard Meta event. Silently no-ops if the pixel isn't loaded yet
 * (ad-blocker, cold-load race, dev environment without script tag, etc.).
 */
export function trackEvent(event: FbqEvent, params?: FbqParams): void {
  if (typeof window === 'undefined' || !hasMetaConsent()) return;
  loadMetaPixel();
  if (typeof window.fbq !== 'function') {
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
  if (typeof window === 'undefined' || !hasMetaConsent()) return;
  loadMetaPixel();
  if (typeof window.fbq !== 'function') return;
  try {
    window.fbq('trackCustom', event, params);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pixel] trackCustom failed', e);
  }
}
