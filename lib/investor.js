// Which investor's data the UI is showing. Options: an investor UUID, or the
// literal 'COMBINED'. Stored in localStorage so the choice sticks per browser.

const KEY = 'pf-investor';

export function readInvestor() {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function writeInvestor(v) {
  try { localStorage.setItem(KEY, v); } catch {}
}
