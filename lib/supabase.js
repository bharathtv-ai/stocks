'use client';
import { createClient } from '@supabase/supabase-js';

// Publishable key: safe to ship to the browser. Row Level Security decides what
// it can actually read, and every policy requires the owner's Google identity.
export const SUPABASE_URL = 'https://qabdrtoommlhyufzdoto.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_k82Tn4irkKYKEMI6WTERrw_p_kCKcAA';
export const OWNER_EMAIL = 'bharathmolit@gmail.com';

let client;
export function getSupabase() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}
