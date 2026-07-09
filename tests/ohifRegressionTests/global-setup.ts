import { request, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Mint an XNAT session from an alias token (basic auth against
 * /data/JSESSIONID) and persist it as Playwright storageState so every
 * test runs already authenticated — no SSO involved.
 *
 * Requires XNAT_ALIAS / XNAT_SECRET in the environment (.env).
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = process.env.XNAT_BASE_URL || 'https://cirxnat3.cir.mcw.edu';
  const alias = process.env.XNAT_ALIAS;
  const secret = process.env.XNAT_SECRET;
  if (!alias || !secret) {
    throw new Error('XNAT_ALIAS / XNAT_SECRET not set (expected in workspace .env)');
  }

  const ctx = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
  const res = await ctx.get('/data/JSESSIONID', {
    headers: { Authorization: 'Basic ' + Buffer.from(`${alias}:${secret}`).toString('base64') },
  });
  if (!res.ok()) {
    throw new Error(`XNAT auth failed: HTTP ${res.status()} — alias token may be expired`);
  }
  const jsessionid = (await res.text()).trim();
  await ctx.dispose();

  const base = new URL(baseURL);
  const state = {
    cookies: [
      {
        name: 'JSESSIONID',
        value: jsessionid,
        domain: base.hostname,
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: base.protocol === 'https:',
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };
  fs.writeFileSync(path.resolve(__dirname, 'auth-state.json'), JSON.stringify(state, null, 2));
  console.log(`XNAT session established (JSESSIONID ...${jsessionid.slice(-6)})`);
}
