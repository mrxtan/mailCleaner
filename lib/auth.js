import { readFile, writeFile, mkdtemp, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';

async function saveToken(path, token) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(token), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function authorize(tokenPath) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env. See .env.example.');
  }

  // Reuse the refresh token while reading client secrets from .env.
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken) {
    try {
      const saved = JSON.parse(await readFile(tokenPath, 'utf8'));
      if (saved.client_id && saved.client_id !== clientId) {
        throw new Error('Saved token belongs to another OAuth client. Remove the token file and sign in again.');
      }
      if (typeof saved.refresh_token !== 'string' || !saved.refresh_token) {
        throw new Error('Saved token is invalid. Remove the token file and authorize again.');
      }
      refreshToken = saved.refresh_token;
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('Saved token contains invalid JSON. Remove it and authorize again.');
      if (error.code !== 'ENOENT') throw error;
    }
  }

  let auth;
  if (refreshToken) {
    auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
  } else {
    // Google's browser login helper requires a temporary credentials file.
    const directory = await mkdtemp(join(tmpdir(), 'mail-cleaner-'));
    try {
      const keyfilePath = join(directory, 'credentials.json');
      await writeFile(keyfilePath, JSON.stringify({ installed: {
        client_id: clientId, client_secret: clientSecret,
        redirect_uris: ['http://localhost'],
      } }), { mode: 0o600 });
      auth = await authenticate({ keyfilePath, scopes: ['https://www.googleapis.com/auth/gmail.modify'] });
      if (!auth.credentials.refresh_token) throw new Error('No refresh token received. Revoke this app in your Google account and authorize again.');
      // Atomic replacement prevents an interrupted write from corrupting the token.
      await saveToken(tokenPath, {
        client_id: clientId, refresh_token: auth.credentials.refresh_token,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  return auth;
}
