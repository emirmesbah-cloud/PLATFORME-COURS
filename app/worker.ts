interface Env {
  ASSETS: Fetcher;
}

// Static SPA gateway. Last deployment verification: 2026-08-24.

const BLOCKED_PATHS = [
  /^\/content\/immigration\/bonus(?:\/|$)/,
  /^\/assets\/.*\.map$/,
  /^\/sw\.js\.map$/,
  /^\/workbox-.*\.js\.map$/,
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (BLOCKED_PATHS.some((pattern) => pattern.test(pathname))) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
