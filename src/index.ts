import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = 'token.json';
// Path to OAuth2 credentials JSON. Can be overridden via env var or CLI arg
const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || process.argv[2] || 'credentials.json';
console.log(`Using credentials file: ${CREDENTIALS_PATH}`);
const DATA_DIR = 'data';

async function loadCredentials() {
  const content = await fs.promises.readFile(CREDENTIALS_PATH, 'utf-8');
  const credentials = JSON.parse(content);
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
  return { client_id, client_secret, redirect_uris };
}

function getOAuth2Client({ client_id, client_secret, redirect_uris }: any) {
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

async function authorize() {
  // Load raw credentials JSON
  const content = await fs.promises.readFile(CREDENTIALS_PATH, 'utf-8');
  const credentialsJson: any = JSON.parse(content);
  // Service account flow (requires domain-wide delegation)
  if (credentialsJson.type === 'service_account') {
    const subject = process.env.GMAIL_IMPERSONATE_USER;
    if (!subject) {
      throw new Error(
        'Service account credentials require impersonation of a user. ' +
        'Set the GMAIL_IMPERSONATE_USER environment variable to the target Gmail address.'
      );
    }
    const client = new JWT({
      email: credentialsJson.client_email,
      key: credentialsJson.private_key,
      scopes: SCOPES,
      subject,
    });
    return client;
  }
  // OAuth2 client flow
  const credSource = credentialsJson.installed || credentialsJson.web;
  if (!credSource) {
    console.error('OAuth2 credentials JSON must contain an "installed" or "web" property.');
    process.exit(1);
  }
  const { client_id, client_secret, redirect_uris } = credSource;
  if (!redirect_uris || redirect_uris.length === 0) {
    const section = credentialsJson.installed ? 'installed' : 'web';
    console.error(
      `No redirect_uris found in credentials JSON under "${section}".`
    );
    console.error(
      'For command-line use, create "Desktop app" (Installed) OAuth2 credentials ' +
      '(which include redirect_uris), or add an authorized redirect URI to your ' +
      'Web application client (e.g. http://localhost).' 
    );
    process.exit(1);
  }
  const oAuth2Client = getOAuth2Client({ client_id, client_secret, redirect_uris });
  try {
    const token = await fs.promises.readFile(TOKEN_PATH, 'utf-8');
    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;
  } catch {
    return getNewToken(oAuth2Client);
  }
}

function getNewToken(oAuth2Client: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', async (code) => {
      rl.close();
      try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        await fs.promises.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        console.log('Token stored to', TOKEN_PATH);
        resolve(oAuth2Client);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function listAllMessageIds(auth: any): Promise<string[]> {
  const gmail = google.gmail({ version: 'v1', auth });
  let messageIds: string[] = [];
  let nextPageToken: string | undefined = undefined;

  do {
    // Explicitly annotate as any to satisfy TypeScript noImplicitAny
    const res: any = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 100,
      pageToken: nextPageToken,
    });
    const messages = res.data.messages;
      if (messages?.length) {
        // 'm' is annotated as any to avoid implicit any error
        messageIds.push(...messages.map((m: any) => m.id!));
    }
    nextPageToken = res.data.nextPageToken || undefined;
  } while (nextPageToken);

  return messageIds;
}

async function fetchAndSaveMessages(auth: any, messageIds: string[]) {
  const gmail = google.gmail({ version: 'v1', auth });
  await fs.promises.mkdir(DATA_DIR, { recursive: true });

  for (const id of messageIds) {
    const filePath = path.join(DATA_DIR, `${id}.json`);
    // Skip messages already fetched
    if (fs.existsSync(filePath)) {
      console.log('Skipping message', id, '(already saved)');
      continue;
    }
    try {
      const res = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });
      const msg = res.data;
      const out = {
        id: msg.id,
        threadId: msg.threadId,
        labelIds: msg.labelIds,
        snippet: msg.snippet,
        headers: msg.payload?.headers,
      };
      await fs.promises.writeFile(filePath, JSON.stringify(out, null, 2));
      console.log('Saved message', id);
    } catch (err) {
      console.error('Failed to fetch message', id, err);
    }
  }
}

async function main() {
  const auth = await authorize();
  // Attempt to list message IDs, handling unauthorized_client errors
  let ids: string[];
  try {
    ids = await listAllMessageIds(auth);
  } catch (err: any) {
    const errData = err.response?.data;
    if (errData?.error === 'unauthorized_client') {
      console.error('Gmail API authorization error: unauthorized_client');
      console.error('  - If using a service account, ensure you have enabled domain-wide delegation');
      console.error('    in your G Suite Admin console and granted access to the scope(s):', SCOPES.join(', '));
      console.error('  - For personal Gmail accounts, service accounts cannot be used; use OAuth2 user credentials instead.');
      process.exit(1);
    }
    throw err;
  }
  console.log(`Found ${ids.length} messages.`);
  await fetchAndSaveMessages(auth, ids);
}

main().catch(console.error);