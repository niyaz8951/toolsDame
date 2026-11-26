/*
 * kit/v1/config.js - the only place the demo's server address is written.
 * Serves: SECURITY "Public and not". Both values are public by design.
 * Must not change: ONLY the Supabase project URL and the PUBLISHABLE key go here.
 * Never the secret key, the service role key or the database password.
 * Empty values mean "not connected yet": every page still opens.
 */
window.DAME_CONFIG = Object.freeze({
  supabaseUrl: 'https://ggpwitbuhxqgcfexsnbf.supabase.co',
  publishableKey: 'sb_publishable_wso5uCPuFDr4l3ocwoL4RQ_ZyKfMlDW'
});
