'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import { readInvestor } from '@/lib/investor';
import { inr, qty, num, shortDate } from '@/lib/format';
import InvestorPicker from '@/components/InvestorPicker';

const PROVIDERS = [
  { value: 'NSDL_CAS', label: 'NSDL Consolidated Account Statement (eCAS)' },
];

export default function UploadPage() {
  const [investors, setInvestors] = useState([]);
  const [investorId, setInvestorId] = useState('');
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState('');
  const [provider, setProvider] = useState('NSDL_CAS');
  const [status, setStatus] = useState('idle'); // idle | parsing | ready | applying | done | error
  const [error, setError] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [existing, setExisting] = useState(null); // { equities, mfs } for compare
  const [diff, setDiff] = useState(null);
  const [applyLog, setApplyLog] = useState([]);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    sb.from('investor').select('id,full_name').order('created_at').then(({ data }) => {
      const list = data ?? [];
      setInvestors(list);
      const stored = readInvestor();
      const initial = stored && stored !== 'COMBINED' && list.find((i) => i.id === stored)
        ? stored : (list[0]?.id || '');
      setInvestorId(initial);
    });
  }, []);

  const currentInvestorName = investors.find((i) => i.id === investorId)?.full_name || '';

  async function fetchExistingForInvestor(id) {
    const sb = getSupabase();
    const [{ data: eq }, { data: mf }, { data: da }, { data: fo }, { data: sec }, { data: sch }] = await Promise.all([
      sb.from('v_current_holdings').select('*').eq('investor_id', id),
      sb.from('v_current_mf_holdings').select('*').eq('investor_id', id),
      sb.from('demat_account').select('*').eq('investor_id', id),
      sb.from('mf_folio').select('*').eq('investor_id', id),
      sb.from('security').select('isin,name'),
      sb.from('mf_scheme').select('isin,scheme_name'),
    ]);
    return {
      equities: eq ?? [],
      mfs: mf ?? [],
      accounts: da ?? [],
      folios: fo ?? [],
      securities: new Map((sec ?? []).map((r) => [r.isin, r])),
      schemes: new Map((sch ?? []).map((r) => [r.isin, r])),
    };
  }

  function computeDiff(parsedData, ex) {
    // Equities: group parsed by (dp_id, client_id, isin)
    const eqParsed = [];
    for (const a of parsedData.demat_accounts) {
      for (const e of a.equities) {
        eqParsed.push({ ...e, dp_id: a.dp_id, client_id: a.client_id, dp_name: a.dp_name, depository: a.depository });
      }
    }
    const eqExistingByKey = new Map();
    for (const e of ex.equities) {
      eqExistingByKey.set(`${e.dp_id}|${e.client_id}|${e.isin}`, e);
    }
    const equityDiff = [];
    const seen = new Set();
    for (const p of eqParsed) {
      const key = `${p.dp_id}|${p.client_id}|${p.isin}`;
      seen.add(key);
      const prev = eqExistingByKey.get(key);
      const account = ex.accounts.find((a) => a.dp_id === p.dp_id && a.client_id === p.client_id);
      const hasAccount = !!account;
      const hasSecurity = ex.securities.has(p.isin);
      let change;
      if (!prev) change = 'NEW';
      else if (Number(prev.quantity) !== Number(p.quantity)) change = 'QTY';
      else if (Number(prev.market_price) !== Number(p.market_price)) change = 'PRICE';
      else change = 'SAME';
      equityDiff.push({
        ...p,
        prev_quantity: prev ? Number(prev.quantity) : null,
        prev_price: prev ? Number(prev.market_price) : null,
        change, hasAccount, hasSecurity,
        account_id: account?.id || null,
      });
    }
    for (const [k, prev] of eqExistingByKey.entries()) {
      if (!seen.has(k)) {
        equityDiff.push({
          isin: prev.isin, company_name: prev.company_name, dp_id: prev.dp_id, client_id: prev.client_id,
          quantity: 0, market_price: null, market_value: 0,
          prev_quantity: Number(prev.quantity), prev_price: Number(prev.market_price),
          change: 'MISSING', hasAccount: true, hasSecurity: true,
          account_id: null,
        });
      }
    }

    // MFs
    const mfExistingByKey = new Map();
    for (const m of ex.mfs) mfExistingByKey.set(`${m.folio_no}|${m.isin}`, m);
    const mfDiff = [];
    const mfSeen = new Set();
    for (const g of (parsedData.mf_folios_grouped ?? [])) {
      for (const h of g.holdings) {
        const key = `${g.folio_no}|${h.isin}`;
        mfSeen.add(key);
        const prev = mfExistingByKey.get(key);
        const folio = ex.folios.find((f) => f.folio_no === g.folio_no);
        const hasFolio = !!folio;
        const hasScheme = ex.schemes.has(h.isin);
        let change;
        if (!prev) change = 'NEW';
        else if (Number(prev.units) !== Number(h.units)) change = 'UNITS';
        else if (Number(prev.nav) !== Number(h.nav)) change = 'NAV';
        else change = 'SAME';
        mfDiff.push({
          ...h,
          folio_no: g.folio_no,
          prev_units: prev ? Number(prev.units) : null,
          prev_nav: prev ? Number(prev.nav) : null,
          prev_value: prev ? Number(prev.current_value) : null,
          change, hasFolio, hasScheme,
          folio_id: folio?.id || null,
        });
      }
    }
    for (const [k, prev] of mfExistingByKey.entries()) {
      if (!mfSeen.has(k)) {
        mfDiff.push({
          isin: prev.isin, folio_no: prev.folio_no, description: prev.scheme_name,
          units: 0, avg_cost_per_unit: null, total_cost: null, nav: null, current_value: 0, unrealised_pnl: 0,
          prev_units: Number(prev.units), prev_nav: Number(prev.nav), prev_value: Number(prev.current_value),
          change: 'MISSING', hasFolio: true, hasScheme: true,
          folio_id: null,
        });
      }
    }

    return { equities: equityDiff, mfs: mfDiff };
  }

  async function onParse() {
    if (!file) { setError('Pick a PDF first.'); return; }
    if (!investorId) { setError('Pick an investor.'); return; }
    setStatus('parsing'); setError(null); setParsed(null); setDiff(null); setApplyLog([]);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('password', password);
      fd.append('provider', provider);
      const res = await fetch('/api/parse-cas', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Parse failed');
      const ex = await fetchExistingForInvestor(investorId);
      setExisting(ex);
      setParsed(json);
      setDiff(computeDiff(json.parsed, ex));
      setStatus('ready');
    } catch (e) {
      setError(String(e.message || e));
      setStatus('error');
    }
  }

  async function onApply() {
    if (!parsed || !diff) return;
    setStatus('applying');
    const log = [];
    const sb = getSupabase();
    const p = parsed.parsed;
    const statementDate = p.statement_date;
    if (!statementDate) {
      setError('Could not detect statement date — cannot apply.');
      setStatus('ready');
      return;
    }

    try {
      // 1) statement_file registry
      await sb.from('statement_file').insert({
        investor_id: investorId,
        provider: 'NSDL CAS',
        period_start: p.period_start,
        period_end: p.period_end,
        file_name: parsed.file_name,
        total_value: p.total_value,
      });
      log.push(`Registered statement file for ${statementDate}`);

      // 2) Auto-create any new securities (equity)
      const newSecurities = diff.equities
        .filter((e) => !e.hasSecurity && e.change !== 'MISSING')
        .map((e) => ({
          isin: e.isin, name: e.company_name || e.isin,
          face_value: e.face_value ?? null, is_listed: true,
        }));
      if (newSecurities.length) {
        const { error } = await sb.from('security').upsert(newSecurities, { onConflict: 'isin', ignoreDuplicates: true });
        if (error) throw new Error('security insert: ' + error.message);
        log.push(`Created ${newSecurities.length} new securities`);
      }

      // 3) Auto-create any new MF schemes
      const newSchemes = diff.mfs
        .filter((m) => !m.hasScheme && m.change !== 'MISSING')
        .map((m) => ({
          isin: m.isin, scheme_name: m.description || m.isin,
        }));
      if (newSchemes.length) {
        const { error } = await sb.from('mf_scheme').upsert(newSchemes, { onConflict: 'isin', ignoreDuplicates: true });
        if (error) throw new Error('mf_scheme insert: ' + error.message);
        log.push(`Created ${newSchemes.length} new MF schemes`);
      }

      // 4) equity holding snapshots — one per (account, isin) where account is known
      const eqInserts = [];
      let skippedEq = 0;
      for (const e of diff.equities) {
        if (e.change === 'MISSING') continue;
        if (!e.account_id) { skippedEq++; continue; }
        eqInserts.push({
          statement_date: statementDate,
          demat_account_id: e.account_id,
          isin: e.isin,
          quantity: e.quantity,
          free_balance: e.quantity,
          market_price: e.market_price,
          market_value: e.market_value,
          source: 'ECAS',
        });
      }
      if (eqInserts.length) {
        const { error } = await sb.from('holding_snapshot').upsert(eqInserts, {
          onConflict: 'statement_date,demat_account_id,isin',
        });
        if (error) throw new Error('holding_snapshot: ' + error.message);
        log.push(`Wrote ${eqInserts.length} equity snapshot rows${skippedEq ? ` (skipped ${skippedEq} — no matching demat account)` : ''}`);
      }

      // 5) MF snapshots
      const mfInserts = [];
      let skippedMf = 0;
      for (const m of diff.mfs) {
        if (m.change === 'MISSING') continue;
        if (!m.folio_id) { skippedMf++; continue; }
        mfInserts.push({
          statement_date: statementDate,
          mf_folio_id: m.folio_id,
          isin: m.isin,
          units: m.units,
          avg_cost_per_unit: m.avg_cost_per_unit,
          total_cost: m.total_cost,
          nav: m.nav,
          current_value: m.current_value,
          unrealised_pnl: m.unrealised_pnl,
          source: 'ECAS',
        });
      }
      if (mfInserts.length) {
        const { error } = await sb.from('mf_holding_snapshot').upsert(mfInserts, {
          onConflict: 'statement_date,mf_folio_id,isin',
        });
        if (error) throw new Error('mf_holding_snapshot: ' + error.message);
        log.push(`Wrote ${mfInserts.length} MF snapshot rows${skippedMf ? ` (skipped ${skippedMf} — no matching folio)` : ''}`);
      }

      // 6) Portfolio value history — insert every row in trend that isn't already there
      if (p.portfolio_value_trend?.length) {
        const rows = p.portfolio_value_trend.map((t) => ({
          investor_id: investorId,
          month_end: t.month_end,
          total_value: t.total_value,
          change_amount: t.change_amount,
          change_pct: t.change_pct,
          source: 'ECAS',
        }));
        const { error } = await sb.from('portfolio_value_history').upsert(rows, {
          onConflict: 'investor_id,month_end', ignoreDuplicates: true,
        });
        if (error) throw new Error('portfolio_value_history: ' + error.message);
        log.push(`Merged ${rows.length} portfolio value history rows`);
      }

      // 7) Also update purchase_price for MF holdings — the eCAS gives fresh avg cost per unit
      // (For SIPs, this changes month to month.) This is applied via holding_tracker.
      const mfTrackerUpdates = [];
      for (const m of diff.mfs) {
        if (m.change === 'MISSING') continue;
        if (!m.folio_id) continue;
        mfTrackerUpdates.push({
          folio_id: m.folio_id, isin: m.isin,
          purchase_price: m.avg_cost_per_unit, total_cost: m.total_cost,
        });
      }
      // We can't upsert holding_tracker by (folio, isin) directly through PostgREST easily —
      // this stays for a future round.

      setApplyLog(log);
      setStatus('done');
    } catch (e) {
      log.push(`ERROR: ${e.message || e}`);
      setApplyLog(log);
      setError(String(e.message || e));
      setStatus('error');
    }
  }

  function resetAll() {
    setFile(null); setPassword(''); setParsed(null); setDiff(null); setApplyLog([]);
    setStatus('idle'); setError(null);
  }

  const p = parsed?.parsed;

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">Upload<small>Add a new eCAS to update holdings</small></div>
          <div className="spacer" />
          <InvestorPicker />
          <Link className="btn btn-sm" href="/">← Dashboard</Link>
        </div>
      </header>

      <main className="wrap">
        {status === 'done' && (
          <div className="card" style={{ marginTop: 20, borderColor: 'var(--good)' }}>
            <p className="card-title" style={{ color: 'var(--good-ink)' }}>Applied</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{applyLog.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <Link className="btn btn-primary" href="/">Back to dashboard</Link>
              <button className="btn" onClick={resetAll}>Upload another</button>
            </div>
          </div>
        )}

        {status !== 'done' && (
          <div className="card" style={{ marginTop: 20 }}>
            <p className="card-title">1. Pick the file</p>
            <div className="f2">
              <div className="frow">
                <label>Investor</label>
                <select className="field" value={investorId} onChange={(e) => setInvestorId(e.target.value)}>
                  {investors.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                </select>
              </div>
              <div className="frow">
                <label>Document type</label>
                <select className="field" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>
            <div className="f2">
              <div className="frow">
                <label>PDF file</label>
                <input className="field" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
              <div className="frow">
                <label>Password (usually your PAN)</label>
                <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button className="btn btn-primary" onClick={onParse} disabled={status === 'parsing' || !file}>
                {status === 'parsing' ? 'Parsing…' : 'Parse and preview'}
              </button>
              {parsed && <button className="btn" onClick={resetAll} disabled={status === 'applying'}>Reset</button>}
            </div>
            {error && <div className="note err" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        )}

        {p && diff && status !== 'done' && (
          <>
            <div className="card" style={{ marginTop: 16 }}>
              <p className="card-title">2. Review what was found</p>
              <p className="card-sub">Statement date: <strong>{shortDate(p.statement_date) || 'not detected'}</strong>
              {' · '}Portfolio value: <strong>{p.total_value ? inr(p.total_value, { decimals: 0 }) : '—'}</strong>
              {' · '}Pages: {parsed.page_count}</p>

              <div className="grid g4" style={{ marginTop: 4 }}>
                <div className="card"><p className="tile-label">Equity rows</p><p className="tile-value">{diff.equities.filter((e) => e.change !== 'MISSING').length}</p><p className="tile-delta">{diff.equities.filter((e) => e.change === 'NEW').length} new · {diff.equities.filter((e) => e.change === 'QTY').length} qty change</p></div>
                <div className="card"><p className="tile-label">MF rows</p><p className="tile-value">{diff.mfs.filter((m) => m.change !== 'MISSING').length}</p><p className="tile-delta">{diff.mfs.filter((m) => m.change === 'NEW').length} new · {diff.mfs.filter((m) => m.change === 'UNITS').length} units change</p></div>
                <div className="card"><p className="tile-label">Missing from PDF</p><p className="tile-value">{diff.equities.filter((e) => e.change === 'MISSING').length + diff.mfs.filter((m) => m.change === 'MISSING').length}</p><p className="tile-delta">Not written — investigate manually</p></div>
                <div className="card"><p className="tile-label">Trend rows</p><p className="tile-value">{p.portfolio_value_trend?.length || 0}</p><p className="tile-delta">Merged into portfolio_value_history</p></div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <p className="card-title">Equity changes</p>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Change</th><th>Instrument</th><th>Broker</th><th className="num">Prev qty</th><th className="num">New qty</th><th className="num">Prev price</th><th className="num">New price</th><th className="num">New value</th></tr></thead>
                  <tbody>
                    {diff.equities.map((e, i) => (
                      <tr key={i}>
                        <td><ChangeChip c={e.change} /></td>
                        <td><div className="strong">{e.company_name || e.isin}</div><div className="sub">{e.isin}{!e.hasSecurity && ' · will be created'}</div></td>
                        <td className="sub">{e.dp_name || `${e.dp_id}/${e.client_id}`}{!e.hasAccount && <div className="sub" style={{ color: 'var(--critical)' }}>account missing</div>}</td>
                        <td className="num">{e.prev_quantity != null ? qty(e.prev_quantity) : '—'}</td>
                        <td className="num strong">{qty(e.quantity)}</td>
                        <td className="num">{e.prev_price != null ? num(e.prev_price) : '—'}</td>
                        <td className="num">{e.market_price != null ? num(e.market_price) : '—'}</td>
                        <td className="num">{inr(e.market_value, { decimals: 0 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <p className="card-title">Mutual fund changes</p>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Change</th><th>Scheme</th><th>Folio</th><th className="num">Prev units</th><th className="num">New units</th><th className="num">Δ units</th><th className="num">NAV</th><th className="num">Value</th><th className="num">Unrealised</th></tr></thead>
                  <tbody>
                    {diff.mfs.map((m, i) => {
                      const delta = m.prev_units != null ? Number(m.units) - Number(m.prev_units) : null;
                      return (
                        <tr key={i}>
                          <td><ChangeChip c={m.change} /></td>
                          <td><div className="strong">{m.description || m.isin}</div><div className="sub">{m.isin}{!m.hasScheme && ' · will be created'}</div></td>
                          <td className="sub">{m.folio_no}{!m.hasFolio && <div className="sub" style={{ color: 'var(--critical)' }}>folio missing</div>}</td>
                          <td className="num">{m.prev_units != null ? num(m.prev_units, 3) : '—'}</td>
                          <td className="num strong">{num(m.units, 3)}</td>
                          <td className={`num ${delta && delta !== 0 ? (delta > 0 ? 'pos' : 'neg') : ''}`}>{delta == null ? '—' : (delta > 0 ? '+' : '') + num(delta, 3)}</td>
                          <td className="num">{num(m.nav, 4)}</td>
                          <td className="num">{inr(m.current_value, { decimals: 0 })}</td>
                          <td className={`num ${Number(m.unrealised_pnl) >= 0 ? 'pos' : 'neg'}`}>{inr(m.unrealised_pnl, { decimals: 0 })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <p className="card-title">3. Apply</p>
              <p className="card-sub">Writes to holding_snapshot, mf_holding_snapshot, portfolio_value_history, statement_file. Rows already stored for this date are updated in place, not duplicated.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={onApply} disabled={status === 'applying' || !p.statement_date}>
                  {status === 'applying' ? 'Writing…' : `Apply for ${shortDate(p.statement_date)}`}
                </button>
                <button className="btn" onClick={() => setShowRaw((s) => !s)}>{showRaw ? 'Hide' : 'Show'} raw text</button>
              </div>
              {applyLog.length > 0 && (
                <div className="note" style={{ marginTop: 10 }}>
                  {applyLog.map((l, i) => <div key={i}>· {l}</div>)}
                </div>
              )}
            </div>

            {showRaw && (
              <div className="card" style={{ marginTop: 16 }}>
                <p className="card-title">Raw extracted text</p>
                <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: 11, background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}>{parsed.raw_text}</pre>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

function ChangeChip({ c }) {
  const map = {
    NEW:     { cls: 'chip-yes', label: 'NEW' },
    QTY:     { cls: 'chip-no',  label: 'QTY' },
    UNITS:   { cls: 'chip-no',  label: 'UNITS' },
    PRICE:   { cls: 'chip-nvm', label: 'PRICE' },
    NAV:     { cls: 'chip-nvm', label: 'NAV' },
    SAME:    { cls: 'chip-nvm', label: 'SAME' },
    MISSING: { cls: 'chip-no',  label: 'MISSING' },
  };
  const m = map[c] || map.SAME;
  return <span className={`chip ${m.cls}`}><span className="dot" />{m.label}</span>;
}
