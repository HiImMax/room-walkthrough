// App configuration.
//
// BACKEND = 'online': accounts, invite keys and rooms live in the Supabase project below, so they
//                     follow people across devices and the invite keys are checked on the server.
// BACKEND = 'local':  everything is stored in this browser only (for trying things out offline).
export const BACKEND = 'online';

// These two values are public by design (every visitor's browser needs them). The private parts,
// the database password and the secret key, are never put in this app.
export const SUPABASE_URL = 'https://xzdslwluizmurasdjfqc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_59XDjbbF66Moifk6e_xUiw_ASQWUvVW';

// Local mode only: placeholder invite keys. Anyone can read these in the page source, so they are
// not a real gate. Online mode ignores them.
export const LOCAL_INVITE_KEYS = ['FAMILY01', 'FAMILY02', 'FRIENDS1'];
