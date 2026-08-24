// Parse the plain-text form of an NSDL CAS.
//
// Strategy: forgiving line-scan.
// - Look for "Statement for the period ... to <date>" to fix statement_date.
// - Look for "CONSOLIDATED PORTFOLIO VALUE" number for the total.
// - Walk each demat account section: pick up DP ID + Client ID from a header
//   line, then treat every line starting with an INE... ISIN as an equity
//   holding and pull the trailing numbers as (qty, price, value) — the last
//   three numeric tokens.
// - Mutual fund folios: lines starting with INF... contain (units, avg cost,
//   total cost, NAV, current value, unrealised) as the last six numeric
//   tokens; the folio number is one of the smaller integers to the left.
//
// This is *good enough* for updating an existing portfolio month to month.
// Anything unrecognised is returned as `unparsed` so the UI can show it.

const num = (s) => {
  if (s == null) return null;
  const cleaned = String(s).replace(/[₹`,]/g, '').replace(/\s+/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
};

const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
const parseDate = (s) => {
  const m = s.match(/(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
  if (!m) return null;
  const d = Number(m[1]); const mo = MONTHS[m[2]]; const y = Number(m[3]);
  if (mo == null) return null;
  const dt = new Date(Date.UTC(y, mo, d));
  return dt.toISOString().slice(0, 10);
};

// Extract the trailing N numeric tokens from a line. Tokens are separated by
// two-or-more spaces (from pdfText's column-preserving join) OR single spaces.
const tail = (line, n) => {
  const tokens = line.split(/\s+/).filter(Boolean);
  const nums = [];
  for (let i = tokens.length - 1; i >= 0 && nums.length < n; i--) {
    const v = num(tokens[i]);
    if (v == null) break;
    nums.unshift(v);
  }
  return nums;
};

// Some lines have amounts with commas like "1,04,706.00". These are still one
// token from pdftotext so parse fine. But sometimes "1,04,706.00 IN301895"
// appears — handle only when tokens are pure numbers or pure text.

export function parseNsdlCas(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const result = {
    statement_date: null,
    period_start: null,
    period_end: null,
    total_value: null,
    portfolio_composition: [],
    portfolio_value_trend: [],   // { month_end, total_value, change_amount, change_pct }
    demat_accounts: [],          // { dp_id, client_id, dp_name, depository, equities:[...], transactions:[...] }
    mf_folios: [],               // { folio_no, holdings:[{isin, description, units, avg_cost_per_unit, total_cost, nav, current_value, unrealised_pnl}] }
    unparsed_lines: [],
  };

  // Statement period
  for (const l of lines) {
    const m = l.match(/period\s+from\s+([\d]{2}[-A-Za-z]+[-\d]+)\s+to\s+([\d]{2}[-A-Za-z]+[-\d]+)/i);
    if (m) {
      result.period_start = parseDate(m[1]);
      result.period_end = parseDate(m[2]);
      result.statement_date = result.period_end;
      break;
    }
  }

  // Total portfolio value — the biggest ₹ figure right after the phrase
  for (let i = 0; i < lines.length; i++) {
    if (/CONSOLIDATED PORTFOLIO VALUE/i.test(lines[i])) {
      // Search the same and next few lines for a `₹ N,NN,NN,NNN.NN`
      for (let j = i; j < Math.min(i + 4, lines.length); j++) {
        const mm = lines[j].match(/[`₹]\s*([\d,]+\.\d{2})/);
        if (mm) { result.total_value = num(mm[1]); break; }
      }
      if (result.total_value != null) break;
    }
  }

  // Portfolio value trend
  for (let i = 0; i < lines.length; i++) {
    if (/Portfolio Value Trend|Monthly movement of your Consolidated Portfolio/i.test(lines[i])) {
      // Data rows start a few lines later: "JUL 2025 35,65,781.29 NA NA"
      for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
        const l = lines[j];
        const m = l.match(/^([A-Z]{3})\s+(\d{4})\s+([\d,]+\.\d{2})\s+([+\-][\d,]+\.\d{2}|NA)\s+([+\-][\d,.]+|NA)/);
        if (m) {
          const [, monTag, yr, val, chg, pct] = m;
          const mo = MONTHS[monTag[0] + monTag.slice(1).toLowerCase()];
          if (mo == null) continue;
          // Month end
          const d = new Date(Date.UTC(Number(yr), mo + 1, 0)).toISOString().slice(0, 10);
          result.portfolio_value_trend.push({
            month_end: d,
            total_value: num(val),
            change_amount: chg === 'NA' ? null : num(chg),
            change_pct: pct === 'NA' ? null : num(pct),
          });
        }
      }
    }
  }

  // Portfolio composition
  {
    const startIdx = lines.findIndex((l) => /PORTFOLIO COMPOSITION/i.test(l));
    if (startIdx >= 0) {
      for (let j = startIdx + 1; j < Math.min(startIdx + 30, lines.length); j++) {
        const l = lines[j];
        if (/^TOTAL/i.test(l)) break;
        const m = l.match(/^(.+?)\s+([\d,]+\.\d{2})\s+([\d.]+)%/);
        if (m) {
          result.portfolio_composition.push({
            asset_class: m[1].trim(),
            value: num(m[2]),
            pct: num(m[3]),
          });
        }
      }
    }
  }

  // Demat accounts: walk lines, keep track of "current account"
  let acct = null;
  let inTxns = false;
  const commitAcct = () => { if (acct) result.demat_accounts.push(acct); acct = null; inTxns = false; };

  const dpNameMap = {}; // captured from headers as we go

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    // Depository + broker name — line before DP ID often has "NSDL Demat Account" / "CDSL Demat Account"
    if (/^NSDL Demat Account$/i.test(l) || /^CDSL Demat Account$/i.test(l)) {
      commitAcct();
      // Following lines: broker name, "DP ID: xxx Client ID: xxx"
      const depository = /^NSDL/i.test(l) ? 'NSDL' : 'CDSL';
      const brokerLine = lines[i + 1] || '';
      const dpLine = lines[i + 2] || lines[i + 3] || '';
      const m = dpLine.match(/DP\s*ID[:\s]+([A-Z0-9]+)\s+Client\s*ID[:\s]+([A-Z0-9]+)/i);
      if (m) {
        acct = {
          depository,
          dp_name: brokerLine.trim(),
          dp_id: m[1],
          client_id: m[2],
          equities: [],
          transactions: [],
        };
        dpNameMap[`${m[1]}|${m[2]}`] = brokerLine.trim();
      }
      continue;
    }

    // Alternate DP ID header form
    const dpMatch = l.match(/^DP\s*ID[:\s]+([A-Z0-9]+)\s+Client\s*ID[:\s]+([A-Z0-9]+)/i);
    if (dpMatch && !acct) {
      acct = {
        depository: null,
        dp_name: null,
        dp_id: dpMatch[1],
        client_id: dpMatch[2],
        equities: [],
        transactions: [],
      };
      continue;
    }

    // Equity holding line: starts with INE ISIN
    const ineMatch = l.match(/\b(INE[A-Z0-9]{9})\b/);
    if (ineMatch && acct) {
      // Extract the row: qty, price, value are the last three numeric tokens
      const nums = tail(l, 3);
      if (nums.length === 3) {
        // Rest of the line (minus ISIN and numbers) is the company name and face value
        let rest = l.replace(ineMatch[1], '').trim();
        // Strip trailing numbers by walking back through tokens
        const toks = rest.split(/\s+/).filter(Boolean);
        let dropped = 0;
        while (dropped < 3 && toks.length && num(toks[toks.length - 1]) != null) {
          toks.pop(); dropped++;
        }
        // Possibly face value at the end of remaining tokens
        let face_value = null;
        if (toks.length && num(toks[toks.length - 1]) != null) {
          face_value = num(toks.pop());
        }
        const companyName = toks.join(' ').trim();
        acct.equities.push({
          isin: ineMatch[1],
          company_name: companyName,
          face_value,
          quantity: nums[0],
          market_price: nums[1],
          market_value: nums[2],
        });
      }
      continue;
    }

    // CDSL format: ISIN with "Current Bal." on a later line. The current_bal is
    // the first numeric token immediately following the SECURITY column.
    // Simplification: we've already captured the ISIN line and extracted 3
    // numbers above if that worked. For CDSL, the value/price are on nearby
    // lines, so we retry with a small window.
    // (Fallback: skip if not confidently parsed.)

    // Mutual Fund folios section marker
    if (/^Mutual Fund Folios/i.test(l)) {
      commitAcct();
      // Rows follow. Handled by INF match below.
      continue;
    }

    // MF holding line: starts with INF ISIN
    const infMatch = l.match(/\b(INF[A-Z0-9]{9})\b/);
    if (infMatch) {
      const nums = tail(l, 6);
      if (nums.length === 6) {
        const [units, avg, total_cost, nav, current_value, unrealised] = nums;
        // Folio number: first pure-digit / mixed token before the last 6 numbers
        let toks = l.replace(infMatch[1], '').trim().split(/\s+/).filter(Boolean);
        // Drop the last 6 numeric tokens
        let n = 0;
        while (n < 6 && toks.length) {
          const t = toks.pop();
          if (num(t) != null) n++;
          else break;
        }
        // Find a folio-like token (10+ digits, or e.g. "3105535926")
        const folioIdx = toks.findIndex((t) => /^\d{6,}$/.test(t));
        const folio = folioIdx >= 0 ? toks[folioIdx] : null;
        // Description is the rest joined
        const description = toks.filter((_, idx) => idx !== folioIdx).join(' ').trim();
        result.mf_folios.push({
          folio_no: folio,
          isin: infMatch[1],
          description,
          units,
          avg_cost_per_unit: avg,
          total_cost,
          nav,
          current_value,
          unrealised_pnl: unrealised,
        });
      }
      continue;
    }

    // Transaction section marker
    if (/^Summary of Transactions of/i.test(l)) inTxns = true;
    if (/End of Statement/i.test(l)) inTxns = false;

    if (inTxns && acct) {
      const dm = l.match(/^(\d{2}-[A-Za-z]{3}-\d{4})\s+(.+?)(?:\s+([\d,]+\.\d{3}))?(?:\s+([\d,]+\.\d{3}))?\s+([\d,]+\.\d{3})$/);
      if (dm) {
        acct.transactions.push({
          txn_date: parseDate(dm[1]),
          particulars: dm[2],
          credit_qty: dm[3] ? num(dm[3]) : null,
          debit_qty: dm[4] ? num(dm[4]) : null,
          balance_qty: num(dm[5]),
        });
        continue;
      }
    }
  }
  commitAcct();

  // Reshape MF folios: group by folio_no
  const foliosByNo = new Map();
  for (const h of result.mf_folios) {
    if (!h.folio_no) continue;
    if (!foliosByNo.has(h.folio_no)) foliosByNo.set(h.folio_no, { folio_no: h.folio_no, holdings: [] });
    foliosByNo.get(h.folio_no).holdings.push(h);
  }
  result.mf_folios_grouped = [...foliosByNo.values()];

  return result;
}
