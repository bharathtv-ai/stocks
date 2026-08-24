'use client';
const LABEL = { YES: 'Actual', NO: 'Assumed', NVM: 'NVM' };
export default function FlagChip({ flag }) {
  const f = flag || 'NO';
  return (
    <span className={`chip chip-${f.toLowerCase()}`} title={
      f === 'YES' ? 'You entered the real value'
      : f === 'NO' ? 'Placeholder — still worth chasing'
      : 'Placeholder aged past the one-month window'
    }>
      <span className="dot" />{LABEL[f]}
    </span>
  );
}
