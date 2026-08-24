'use client';
import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { readInvestor, writeInvestor } from '@/lib/investor';

// Header dropdown: which investor's portfolio is shown. Its value changes are
// broadcast via a custom event so the whole page reloads its data.
export default function InvestorPicker() {
  const [investors, setInvestors] = useState([]);
  const [value, setValue] = useState('');

  useEffect(() => {
    getSupabase().from('investor').select('id,full_name').order('created_at').then(({ data }) => {
      const list = data ?? [];
      setInvestors(list);
      let v = readInvestor();
      if (!v || (v !== 'COMBINED' && !list.find((i) => i.id === v))) {
        v = list[0]?.id || 'COMBINED';
        writeInvestor(v);
      }
      setValue(v);
    });
  }, []);

  const onChange = (e) => {
    const v = e.target.value;
    setValue(v);
    writeInvestor(v);
    window.dispatchEvent(new CustomEvent('pf-investor-change', { detail: v }));
  };

  if (!investors.length) return null;

  return (
    <select className="field btn-sm" value={value} onChange={onChange} aria-label="Investor" style={{ padding: '4px 8px' }}>
      {investors.map((i) => (
        <option key={i.id} value={i.id}>{i.full_name}</option>
      ))}
      {investors.length > 1 && <option value="COMBINED">Combined</option>}
    </select>
  );
}
