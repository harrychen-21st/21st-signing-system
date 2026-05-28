import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from '../server.ts';
import type { Express } from 'express';

let appPromise: Promise<Express> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  appPromise ||= createApp();
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
