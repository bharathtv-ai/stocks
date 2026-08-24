'use client';
import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { qty, inr, shortDate } from '@/lib/format';
import FlagChip from './FlagChip';

const ACQ = ['BUY','IPO','FPO','OFS','RIGHTS','BONUS','SPLIT','DEMERGER','MERGER','ESOP','GIFT','INHERITANCE','BUYBACK_ENTITLEMENT','SIP','LUMPSUM','SWITCH_IN','IDCW_REINVEST','TRANSFER_IN','OTHER'];
const SOURCES = ['BROKER_TAX_PL','CONTRACT_NOTE','AMC_STATEMENT','CAMS_KFIN_CAS','BANK_STATEMENT','MANUAL_RECALL','ECAS','OTHER'];

const s = (v) => (v === null || v === undefined ? '' : String(v));

export default function EditDrawer({ row, onClose, onSaved }) {
  const [f, setF] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!row) return;
    setErr(null);
    const sb = getSupabase();
    sb.from('holding_tracker').select('*').eq('id', row.id).single().then(({ data, error }) => {
      if (error) { setErr(error.message); return; }
      setF({
        purchase_date: s(data.purchase_date),
        purchase_price: s(data.purchase_price),
        total_cost: s(data.total_cost),
        acquisition_type: s(data.acquisition_type) || 'BUY',
        exchange: s(data.exchange),
        contract_note_no: s(data.contract_note_no),
        brokerage: s(data.brokerage),
        stt: s(data.stt),
        exchange_txn_charges: s(data.exchange_txn_charges),
        stamp_duty: s(data.stamp_duty),
        gst: s(data.gst),
        other_charges: s(data.other_charges),
        fmv_31jan2018: s(data.fmv_31jan2018),
        source: s(data.source),
        notes: s(data.notes),
      });
    });
  }, [row]);

  if (!row) return null;

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const numOrNull = (v) => (v === '' || v === null ? null : Number(v));
  const txtOrNull = (v) => (v === '' ? null : v);

  const save = async () => {
    setSaving(true); setErr(null);
    const payload = {
      purchase_date: txtOrNull(f.purchase_date),
      purchase_price: numOrNull(f.purchase_price),
      total_cost: numOrNull(f.total_cost),
      acquisition_type: f.acquisition_type || 'BUY',
      exchange: txtOrNull(f.exchange),
      contract_note_no: txtOrNull(f.contract_note_no),
      brokerage: numOrNull(f.brokerage) ?? 0,
      stt: numOrNull(f.stt) ?? 0,
      exchange_txn_charges: numOrNull(f.exchange_txn_charges) ?? 0,
      stamp_duty: numOrNull(f.stamp_duty) ?? 0,
      gst: numOrNull(f.gst) ?? 0,
      other_charges: numOrNull(f.other_charges) ?? 0,
      fmv_31jan2018: numOrNull(f.fmv_31jan2018),
      source: txtOrNull(f.source),
      notes: txtOrNull(f.notes),
    };
    const { error } = await getSupabase().from('holding_tracker').update(payload).eq('id', row.id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  const showFmv = f.purchase_date && f.purchase_date <= '2018-01-31';

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`Edit ${row.instrument_name}`}>
        <h2>{row.instrument_name}</h2>
        <p className="isin">{row.isin} · {row.held_at} · {qty(row.quantity)} {row.bucket === 'EQUITY' ? 'shares' : 'units'}</p>

        <div className="note">
          Changing the purchase date or price flips its flag to <strong>Actual</strong> automatically —
          you never set the flag yourself. Currently: date <FlagChip flag={row.purchase_date_flag} />
          {' '}price <FlagChip flag={row.purchase_price_flag} />
        </div>

        <div className="f2">
          <div className="frow">
            <label htmlFor="pd">Purchase date</label>
            <input id="pd" className="field" type="date" value={f.purchase_date || ''} onChange={set('purchase_date')} />
          </div>
          <div className="frow">
            <label htmlFor="pp">Price per {row.bucket === 'EQUITY' ? 'share' : 'unit'} (₹)</label>
            <input id="pp" className="field" type="number" step="0.0001" value={f.purchase_price || ''} onChange={set('purchase_price')} />
          </div>
        </div>
        <p className="hint">Seeded placeholder was {shortDate(row.purchase_date)}. Leave total cost blank to use quantity × price.</p>

        <div className="f2">
          <div className="frow">
            <label htmlFor="tc">Total cost (₹)</label>
            <input id="tc" className="field" type="number" step="0.01" value={f.total_cost || ''} onChange={set('total_cost')} />
          </div>
          <div className="frow">
            <label htmlFor="at">How acquired</label>
            <select id="at" className="field" value={f.acquisition_type || 'BUY'} onChange={set('acquisition_type')}>
              {ACQ.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div className="f2">
          <div className="frow">
            <label htmlFor="ex">Exchange</label>
            <select id="ex" className="field" value={f.exchange || ''} onChange={set('exchange')}>
              <option value="">—</option><option value="NSE">NSE</option><option value="BSE">BSE</option>
            </select>
          </div>
          <div className="frow">
            <label htmlFor="cn">Contract note no.</label>
            <input id="cn" className="field" value={f.contract_note_no || ''} onChange={set('contract_note_no')} />
          </div>
        </div>

        <p className="card-title" style={{ marginTop: 4 }}>Charges (added to cost of acquisition)</p>
        <div className="f2">
          <div className="frow"><label htmlFor="br">Brokerage</label><input id="br" className="field" type="number" step="0.01" value={f.brokerage || ''} onChange={set('brokerage')} /></div>
          <div className="frow"><label htmlFor="st">STT</label><input id="st" className="field" type="number" step="0.01" value={f.stt || ''} onChange={set('stt')} /></div>
        </div>
        <div className="f2">
          <div className="frow"><label htmlFor="et">Exchange txn charges</label><input id="et" className="field" type="number" step="0.01" value={f.exchange_txn_charges || ''} onChange={set('exchange_txn_charges')} /></div>
          <div className="frow"><label htmlFor="sd">Stamp duty</label><input id="sd" className="field" type="number" step="0.01" value={f.stamp_duty || ''} onChange={set('stamp_duty')} /></div>
        </div>
        <div className="f2">
          <div className="frow"><label htmlFor="gs">GST</label><input id="gs" className="field" type="number" step="0.01" value={f.gst || ''} onChange={set('gst')} /></div>
          <div className="frow"><label htmlFor="oc">Other</label><input id="oc" className="field" type="number" step="0.01" value={f.other_charges || ''} onChange={set('other_charges')} /></div>
        </div>

        {showFmv && (
          <div className="frow">
            <label htmlFor="fm">FMV on 31-Jan-2018 (₹) — Sec 112A grandfathering</label>
            <input id="fm" className="field" type="number" step="0.0001" value={f.fmv_31jan2018 || ''} onChange={set('fmv_31jan2018')} />
          </div>
        )}

        <div className="frow">
          <label htmlFor="sr">Where this came from</label>
          <select id="sr" className="field" value={f.source || ''} onChange={set('source')}>
            <option value="">—</option>
            {SOURCES.map((x) => <option key={x} value={x}>{x.replaceAll('_', ' ')}</option>)}
          </select>
        </div>

        <div className="frow">
          <label htmlFor="nt">Notes</label>
          <textarea id="nt" className="field" rows={3} value={f.notes || ''} onChange={set('notes')} />
        </div>

        {err && <div className="note err">{err}</div>}

        <div className="drawer-actions">
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </aside>
    </>
  );
}
