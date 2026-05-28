import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from '../server';

const appPromise = createApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await appPromise;

  if (req.url) {
    const url = new URL(req.url, 'https://vercel.local');
    const path = url.searchParams.get('path');
    if (path) {
      url.searchParams.delete('path');
      req.url = `/api/${path}${url.search}`;
    }
  }

  return app(req, res);
}
