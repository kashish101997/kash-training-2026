import { next } from '@vercel/functions';

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!api/|app/|icons/|fonts/|docs/|icon.svg|manifest.json|service-worker.js).*)'],
};

export default function middleware() {
  return next({ headers: { 'Cache-Control': 'private, no-store' } });
}
