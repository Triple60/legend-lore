// Static single-page app: every route is prerendered as an empty shell at
// build time and rendered entirely in the browser (all data comes from
// Supabase at runtime, after login).
export const prerender = true;
export const ssr = false;
