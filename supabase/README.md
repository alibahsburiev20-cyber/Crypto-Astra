# Supabase setup — Crypto Astra

Project name: `crypto-astra`  
Project ref: `yqbcmenuwqrgtrhjssoz`  
Region: `eu-central-1` (Frankfurt)  
Project URL: `https://yqbcmenuwqrgtrhjssoz.supabase.co`

## Migrations

The SQL files in `migrations/` use the exact versions already applied to the remote database:

1. `20261102110126_initial_game_schema.sql`
2. `20261102110214_index_foreign_keys_and_lock_security_events.sql`
3. `20261102110402_bootstrap_players_and_secure_game_actions.sql`
4. `20261102111005_tighten_rpc_search_path_and_expedition_concurrency.sql`

Do not re-run these migrations against the existing project. For a fresh project, apply them in version order.

## Browser client

`config.js` contains only the Supabase project URL and the publishable key. This key is designed for public clients; RLS and database privileges are the actual security boundary.

Never add a Supabase secret/service-role key to this repository.

## Auth dashboard settings still required

In Supabase Dashboard → Authentication → URL Configuration:
- Set Site URL to `https://crypto-astra.pages.dev`.
- Add `https://crypto-astra.pages.dev/**` to the allowed redirect URLs.

For real email confirmation at scale, configure a trusted SMTP provider in Authentication → SMTP Settings. Supabase's default email sender is intended for limited testing and should not be relied on for a public game.

## Database security

All 14 public tables have RLS enabled. Client-side writes to player balances, inventory, rockets, expeditions, ledger and payouts are blocked. The three game RPCs are intentionally `SECURITY DEFINER`: each requires `auth.uid()`, is not executable by `anon` or `PUBLIC`, uses an empty search path, and applies ownership checks before modifying data.

Supabase Security Advisor may flag authenticated execution of these RPCs because they are SECURITY DEFINER. This is an expected review warning for the deliberately exposed, ownership-checked game commands; re-review their bodies before adding any new RPC.

## Not enabled yet

- Cloudflare Turnstile on sign-up / sign-in.
- Custom SMTP.
- Admin moderation tools.
- Real-money Astra Pool accounting and payouts.
- Production monitoring and load testing.
