// Makes the key pair that lets the server send push notifications.
// Run `npm run vapid` once, then follow the two steps it prints.
import { webcrypto } from 'node:crypto';

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = b64u(await webcrypto.subtle.exportKey('raw', pair.publicKey));
const { d } = await webcrypto.subtle.exportKey('jwk', pair.privateKey);

console.log(`
1. Public key. Safe to commit. Put it in wrangler.jsonc under "vars":

   "VAPID_PUBLIC_KEY": "${publicKey}"

2. Private key. Never commit this. Store it as a secret:

   npx wrangler secret put VAPID_PRIVATE_KEY

   and paste this value when asked:

   ${d}
`);
