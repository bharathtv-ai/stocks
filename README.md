# Portfolio Tracker

Personal portfolio tracker for NSDL / CDSL demat accounts and mutual fund folios,
seeded from an NSDL Consolidated Account Statement (eCAS).

**Live:** https://portfolio-tracker-amber-iota.vercel.app

## Stack

- Next.js 14 (App Router, JavaScript)
- Supabase (Postgres + RLS + pg_cron for the NVM sweep)
- Vercel (deploys)
- `pdfjs-dist` for server-side PDF text extraction

## What lives where

```
app/
  page.jsx           dashboard: overview, positions, holdings, accounts
  upload/page.jsx    upload a new eCAS and preview the diff
  api/parse-cas/     server route: decrypt PDF, extract text, parse eCAS
components/
  TrendChart.jsx     inline SVG line/area chart
  EditDrawer.jsx     side panel to edit a purchase row
  FlagChip.jsx       date-flag pill (Actual / Assumed / NVM)
  InvestorPicker.jsx header dropdown: which investor's data (or Combined)
lib/
  supabase.js        client
  format.js          INR / date / number formatters
  investor.js        localStorage-backed investor selection
  pdfText.js         pdfjs-dist wrapper — extracts text with layout preserved
  parseCas.js        pure JS parser for NSDL eCAS text
```

## Database

Owned in Supabase project `qabdrtoommlhyufzdoto` (ap-south-1). Key tables:

| Table | Role |
|---|---|
| `investor` | you + spouse |
| `demat_account`, `mf_folio` | 6 demat + 10 MF folios |
| `security`, `mf_scheme`, `amc` | instrument master data |
| `holding_snapshot`, `mf_holding_snapshot` | month-end snapshots per statement |
| **`holding_tracker`** | one row per position, with editable purchase date/price + flags |
| `purchase_lot`, `disposal` | tax-lot detail (unused for now) |
| `portfolio_value_history`, `portfolio_composition` | monthly value + asset mix |
| `demat_transaction`, `corporate_action`, `statement_file` | audit trail |

Every table has RLS enabled and forced. Dashboard-open policies (`anon_*`) let
the browser read/write while the UI has no sign-in.

## The `holding_tracker` flag

Purchase date and price default to today with `flag = 'NO'` (assumed placeholder).
Editing the value auto-flips the flag to `'YES'` (a trigger does this). If a
placeholder is never corrected, a daily `pg_cron` job (`expire_stale_holding_flags`)
flips it to `'NVM'` one month after seed.

## Local dev

```
npm install
npm run dev
```

The publishable Supabase key is hard-coded in `lib/supabase.js`. It is designed
to be shipped to the browser; RLS in Postgres is the actual access boundary.
