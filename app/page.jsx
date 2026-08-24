'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import { readInvestor } from '@/lib/investor';
import { inr, inrCompact, qty, num, shortDate } from '@/lib/format';
import TrendChart from '@/components/TrendChart';
import EditDrawer from '@/components/EditDrawer';
import FlagChip from '@/components/FlagChip';
import InvestorPicker from '@/components/InvestorPicker';

const TABS = ['Overview', 'Positions', 'Holdings', 'Accounts'];

function useTheme() {
  const [theme, setTheme] = useState('system');
  useEffect(() => {
    let t = 'system';
    try { t = localStorage.getItem('pf-theme') || 'system'; } catch {}
    setTheme(t);
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, []);
  const cycle = () => {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
    try { localStorage.setItem('pf-theme', next); } catch {}
    if (next === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
  };
  return [theme, cycle];
}

// A tiny helper so a caller like `.eq_if(condition, col, val)` becomes a no-op
// when the condition is false. Lets one code path handle both single-investor
// and Combined mode without branching.
function scope(q, investorId, col = 'investor_id') {
  if (investorId && investorId !== 'COMBINED') return q.eq(col, investorId);
  return q;
}

export default function Page() {
  const [theme, cycleTheme] = useTheme();
  const [tab, setTab] = useState('Overview');
  const [investorId, setInvestorId] = useState(null); // null = not yet resolved
  const [investors, setInvestors] = useState([]);
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [editing, setEditing] = useState(null);

  const [fBucket, setFBucket] = useState('ALL');
  const [fFlag, setFFlag] = useState('ALL');
  const [q, setQ] = useState('');

  // Bootstrap: load investor list, pick initial
  useEffect(() => {
    const sb = getSupabase();
    sb.from('investor').select('id,full_name').order('created_at').then(({ data }) => {
      const list = data ?? [];
      setInvestors(list);
      const stored = readInvestor();
      const initial = stored && (stored === 'COMBINED' || list.find((i) => i.id === stored))
        ? stored : (list[0]?.id || null);
      setInvestorId(initial);
    });
    const onChange = (e) => setInvestorId(e.detail);
    window.addEventListener('pf-investor-change', onChange);
    return () => window.removeEventListener('pf-investor-change', onChange);
  }, []);

  const load = useCallback(async () => {
    if (!investorId) return;
    const sb = getSupabase();
    setLoadErr(null);
    const [tracker, history, composition, accounts, eq, mf] = await Promise.all([
      scope(sb.from('v_holding_tracker').select('*'), investorId),
      scope(sb.from('portfolio_value_history').select('*').order('month_end'), investorId),
      scope(sb.from('portfolio_composition').select('*').order('value', { ascending: false }), investorId),
      scope(sb.from('demat_account').select('*').order('dp_name'), investorId),
      scope(sb.from('v_current_holdings').select('*'), investorId),
      scope(sb.from('v_current_mf_holdings').select('*'), investorId),
    ]);
    const bad = [tracker, history, composition, accounts, eq, mf].find((r) => r.error);
    if (bad) { setLoadErr(bad.error.message); return; }
    // Combined mode: portfolio_value_history has one row per (investor, month).
    // Sum across investors before charting.
    let historyRows = history.data ?? [];
    if (investorId === 'COMBINED' && historyRows.length) {
      const byMonth = new Map();
      for (const r of historyRows) {
        const cur = byMonth.get(r.month_end) || { month_end: r.month_end, total_value: 0, change_amount: 0, change_pct: null };
        cur.total_value += Number(r.total_value || 0);
        cur.change_amount += Number(r.change_amount || 0);
        byMonth.set(r.month_end, cur);
      }
      const sorted = [...byMonth.values()].sort((a, b) => a.month_end.localeCompare(b.month_end));
      // Recompute change_pct from consecutive totals
      for (let i = 0; i < sorted.length; i++) {
        if (i === 0) { sorted[i].change_amount = null; sorted[i].change_pct = null; }
        else {
          const prev = sorted[i - 1].total_value;
          sorted[i].change_amount = sorted[i].total_value - prev;
          sorted[i].change_pct = prev ? (sorted[i].total_value - prev) / prev * 100 : null;
        }
      }
      historyRows = sorted;
    }
    // Combined portfolio composition: sum by asset_class across investors
    let compositionRows = (composition.data ?? []).filter((c) => Number(c.value) > 0);
    if (investorId === 'COMBINED' && compositionRows.length) {
      const byClass = new Map();
      for (const r of compositionRows) {
        const cur = byClass.get(r.asset_class) || { asset_class: r.asset_class, value: 0, pct: 0 };
        cur.value += Number(r.value);
        byClass.set(r.asset_class, cur);
      }
      const total = [...byClass.values()].reduce((a, r) => a + r.value, 0);
      compositionRows = [...byClass.values()].map((r) => ({ ...r, pct: total ? r.value / total * 100 : 0 }))
        .sort((a, b) => b.value - a.value);
    }
    setData({
      tracker: tracker.data ?? [],
      history: historyRows,
      composition: compositionRows,
      accounts: accounts.data ?? [],
      eq: eq.data ?? [],
      mf: mf.data ?? [],
    });
  }, [investorId]);

  useEffect(() => { load(); }, [load]);

  const t = data?.tracker ?? [];
  const totalValue = t.reduce((a, r) => a + Number(r.market_value || 0), 0);
  const eqValue = t.filter((r) => r.bucket === 'EQUITY').reduce((a, r) => a + Number(r.market_value || 0), 0);
  const mfValue = t.filter((r) => r.bucket === 'MUTUAL_FUND').reduce((a, r) => a + Number(r.market_value || 0), 0);
  const knownCost = t.filter((r) => Number(r.cost_basis) > 0).reduce((a, r) => a + Number(r.cost_basis), 0);
  const knownVal = t.filter((r) => Number(r.cost_basis) > 0).reduce((a, r) => a + Number(r.market_value || 0), 0);
  const unrealised = knownVal - knownCost;
  const placeholders = t.filter((r) => r.purchase_date_flag !== 'YES').length;
  const minDays = t.filter((r) => r.purchase_date_flag === 'NO')
    .reduce((m, r) => Math.min(m, Number(r.days_left_to_confirm_date ?? 999)), 999);
  const latest = data?.history?.[data.history.length - 1];

  const filtered = t
    .filter((r) => fBucket === 'ALL' || r.bucket === fBucket)
    .filter((r) => fFlag === 'ALL' || r.purchase_date_flag === fFlag)
    .filter((r) => {
      const needle = q.trim().toLowerCase();
      return !needle || r.instrument_name.toLowerCase().includes(needle) || (r.isin || '').toLowerCase().includes(needle);
    })
    .sort((a, b) => Number(b.market_value || 0) - Number(a.market_value || 0));

  const themeLabel = theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark';
  const investorLabel = investorId === 'COMBINED'
    ? 'Combined portfolio'
    : investors.find((i) => i.id === investorId)?.full_name || '';

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">Portfolio Tracker<small>{investorLabel} · NSDL eCAS · as on 31 Jul 2026</small></div>
          <div className="spacer" />
          <InvestorPicker />
          <Link className="btn btn-sm" href="/upload">Upload eCAS</Link>
          <button className="btn btn-sm" onClick={cycleTheme} title="Light / dark / follow system">{themeLabel}</button>
          <button className="btn btn-sm" onClick={load}>Refresh</button>
        </div>
      </header>

      <main className="wrap">
        <nav className="tabs" role="tablist">
          {TABS.map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} className="tab" onClick={() => setTab(x)}>{x}</button>
          ))}
        </nav>

        {loadErr && <div className="card err" style={{ marginBottom: 16 }}>Could not load data: {loadErr}</div>}
        {!data && !loadErr && <div className="empty">Loading portfolio…</div>}
        {data && t.length === 0 && (
          <div className="card"><p className="empty">No holdings yet for {investorLabel}. <Link href="/upload">Upload an eCAS</Link> to get started.</p></div>
        )}

        {data && t.length > 0 && tab === 'Overview' && (
          <>
            <div className="card">
              <p className="hero-label">Total portfolio value</p>
              <p className="hero-value">{inr(totalValue, { decimals: 0 })}</p>
              <p className="hero-meta">
                {latest && latest.change_pct != null && (
                  <span className={Number(latest.change_pct) >= 0 ? 'pos' : 'neg'}>
                    {Number(latest.change_pct) >= 0 ? '▲' : '▼'} {inr(Math.abs(Number(latest.change_amount)), { decimals: 0 })} ({Math.abs(Number(latest.change_pct)).toFixed(2)}%)
                  </span>
                )}{latest && ' vs last month · '}{t.length} positions across {data.accounts.length} demat accounts and {data.mf.length} fund holdings
              </p>
            </div>

            <div className="grid g4" style={{ marginTop: 16 }}>
              <div className="card">
                <p className="tile-label">Equities</p>
                <p className="tile-value">{inrCompact(eqValue)}</p>
                <p className="tile-delta">{t.filter((r) => r.bucket === 'EQUITY').length} scrips · {totalValue ? ((eqValue / totalValue) * 100).toFixed(1) : '0.0'}% of portfolio</p>
              </div>
              <div className="card">
                <p className="tile-label">Mutual funds</p>
                <p className="tile-value">{inrCompact(mfValue)}</p>
                <p className="tile-delta">{t.filter((r) => r.bucket === 'MUTUAL_FUND').length} schemes · {totalValue ? ((mfValue / totalValue) * 100).toFixed(1) : '0.0'}% of portfolio</p>
              </div>
              <div className="card">
                <p className="tile-label">Unrealised gain</p>
                <p className={`tile-value ${unrealised >= 0 ? 'pos' : 'neg'}`}>{inrCompact(unrealised)}</p>
                <p className="tile-delta">on {inrCompact(knownCost)} of known cost — equities excluded until you enter their cost</p>
              </div>
              <div className="card">
                <p className="tile-label">Placeholder dates left</p>
                <p className="tile-value">{placeholders}</p>
                <p className="tile-delta">{placeholders === 0 ? 'every date confirmed' : minDays < 999 ? `${minDays} days before they turn NVM` : 'past the one-month window'}</p>
              </div>
            </div>

            <div className="grid g2" style={{ marginTop: 16 }}>
              <div className="card">
                <p className="card-title">Portfolio value</p>
                <p className="card-sub">Month end, latest 13 months</p>
                <TrendChart data={data.history} />
              </div>

              <div className="card">
                <p className="card-title">Asset mix</p>
                <p className="card-sub">As reported on the eCAS</p>
                <div style={{ display: 'flex', gap: 2, height: 12, borderRadius: 999, overflow: 'hidden', margin: '4px 0 16px' }}>
                  {data.composition.map((c, i) => (
                    <div key={c.asset_class} style={{ width: `${c.pct}%`, background: i === 0 ? 'var(--series-1)' : 'var(--series-2)' }} />
                  ))}
                </div>
                {data.composition.map((c, i) => (
                  <div key={c.asset_class} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span className="dot" style={{ background: i === 0 ? 'var(--series-1)' : 'var(--series-2)', width: 9, height: 9 }} />
                    <span style={{ flex: 1 }}>{c.asset_class.replace(/\s*\([A-Z]+\)$/, '')}</span>
                    <span className="num strong">{inrCompact(c.value)}</span>
                    <span className="sub num" style={{ width: 52 }}>{Number(c.pct).toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {data && t.length > 0 && tab === 'Positions' && (
          <>
            <div className="filters">
              <input className="field" placeholder="Search name or ISIN" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
              <select className="field" value={fBucket} onChange={(e) => setFBucket(e.target.value)}>
                <option value="ALL">All assets</option><option value="EQUITY">Equity</option><option value="MUTUAL_FUND">Mutual funds</option>
              </select>
              <select className="field" value={fFlag} onChange={(e) => setFFlag(e.target.value)}>
                <option value="ALL">Any date flag</option><option value="NO">Assumed (NO)</option>
                <option value="YES">Actual (YES)</option><option value="NVM">NVM</option>
              </select>
              <span className="sub">{filtered.length} of {t.length}</span>
            </div>

            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Instrument</th><th>Held at</th><th className="num">Qty</th>
                    <th>Purchase date</th><th className="num">Price</th><th className="num">Cost</th>
                    <th className="num">Market value</th><th className="num">Unrealised</th><th>If sold today</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => setEditing(r)}>
                      <td>
                        <div className="strong">{r.instrument_name}</div>
                        <div className="sub">{r.isin}{r.symbol ? ` · ${r.symbol}` : ''}{r.is_listed === false ? ' · unlisted' : ''}</div>
                      </td>
                      <td className="sub">{r.held_at}</td>
                      <td className="num">{qty(r.quantity)}</td>
                      <td>
                        <div>{shortDate(r.purchase_date)}</div>
                        <div style={{ marginTop: 3 }}><FlagChip flag={r.purchase_date_flag} /></div>
                      </td>
                      <td className="num">{r.purchase_price ? num(r.purchase_price, 2) : '—'}</td>
                      <td className="num">{Number(r.cost_basis) > 0 ? inr(r.cost_basis, { decimals: 0 }) : '—'}</td>
                      <td className="num strong">{inr(r.market_value, { decimals: 0 })}</td>
                      <td className={`num ${Number(r.cost_basis) > 0 ? (Number(r.unrealised_gain) >= 0 ? 'pos' : 'neg') : ''}`}>
                        {Number(r.cost_basis) > 0 ? inr(r.unrealised_gain, { decimals: 0 }) : '—'}
                      </td>
                      <td>
                        <div>{r.gain_type_if_sold_today}</div>
                        {r.tax_calc_reliability !== 'RELIABLE' && <div className="sub">from placeholder</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && <div className="empty">Nothing matches those filters.</div>}
            </div>
            <p className="sub" style={{ marginTop: 10 }}>Click any row to enter the real purchase date and price.</p>
          </>
        )}

        {data && t.length > 0 && tab === 'Holdings' && (
          <>
            <div className="card">
              <p className="card-title">Equity shares</p>
              <p className="card-sub">{data.eq.length} scrips</p>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Company</th><th>Broker</th><th className="num">Shares</th><th className="num">Price</th><th className="num">Value</th></tr></thead>
                  <tbody>
                    {[...data.eq].sort((a, b) => b.market_value - a.market_value).map((r) => (
                      <tr key={`${r.isin}-${r.dp_id}-${r.client_id}`}>
                        <td><div className="strong">{r.company_name}</div><div className="sub">{r.isin}{r.symbol ? ` · ${r.symbol}` : ' · unlisted'}</div></td>
                        <td className="sub">{r.broker}</td>
                        <td className="num">{qty(r.quantity)}</td>
                        <td className="num">{num(r.market_price)}{r.price_is_face_value && <span className="sub"> (FV)</span>}</td>
                        <td className="num strong">{inr(r.market_value, { decimals: 0 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <p className="card-title">Mutual funds</p>
              <p className="card-sub">{data.mf.length} scheme holdings across {new Set(data.mf.map((m) => m.folio_no)).size} folios</p>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Scheme</th><th>Folio</th><th className="num">Units</th><th className="num">Avg cost</th><th className="num">NAV</th><th className="num">Value</th><th className="num">Unrealised</th></tr></thead>
                  <tbody>
                    {[...data.mf].sort((a, b) => b.current_value - a.current_value).map((r) => (
                      <tr key={`${r.isin}-${r.folio_no}`}>
                        <td><div className="strong">{r.scheme_name}</div><div className="sub">{r.amc}{r.category ? ` · ${r.category}` : ''}</div></td>
                        <td className="sub">{r.folio_no}</td>
                        <td className="num">{num(r.units, 3)}</td>
                        <td className="num">{num(r.avg_cost_per_unit, 4)}</td>
                        <td className="num">{num(r.nav, 4)}</td>
                        <td className="num strong">{inr(r.current_value, { decimals: 0 })}</td>
                        <td className={`num ${Number(r.unrealised_pnl) >= 0 ? 'pos' : 'neg'}`}>
                          {inr(r.unrealised_pnl, { decimals: 0 })}<div className="sub">{Number(r.unrealised_pct).toFixed(1)}%</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {data && t.length > 0 && tab === 'Accounts' && (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Broker / DP</th><th>Depository</th><th>DP ID</th><th>Client ID</th><th>Nominee</th><th>Linked bank</th><th className="num">Value</th></tr></thead>
              <tbody>
                {data.accounts.map((a) => {
                  const v = data.eq.filter((e) => e.dp_id === a.dp_id && e.client_id === a.client_id)
                    .reduce((s, e) => s + Number(e.market_value), 0);
                  return (
                    <tr key={a.id}>
                      <td className="strong">{a.dp_name}</td>
                      <td>{a.depository}</td>
                      <td className="sub">{a.dp_id}</td>
                      <td className="sub">{a.client_id}</td>
                      <td className="sub">{a.nominee_status || '—'}</td>
                      <td className="sub">{a.linked_bank || '—'}</td>
                      <td className="num strong">{inr(v, { decimals: 0 })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {editing && (
        <EditDrawer
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}
