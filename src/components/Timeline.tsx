import type { Block } from '../../shared/day';
import { fmtDur, fmtMin } from '../../shared/time';
import type { Category } from '../../shared/types';

interface Props {
  blocks: Block[];
  categories: Category[];
  /** Minute of the day to mark as "now", or null to leave the marker out. */
  nowMin: number | null;
  onPick?(block: Block): void;
  compact?: boolean;
}

interface Row {
  block: Block;
  top: number;
  height: number;
}

/** Trims the untracked stretches before and after the day's record and gives every block a height. */
function layout(blocks: Block[], compact: boolean): Row[] {
  let first = 0;
  let last = blocks.length - 1;
  while (first <= last && blocks[first].type === 'idle') first++;
  while (last >= first && blocks[last].type === 'idle') last--;

  // Height grows with duration but not one-to-one, so a three-hour block does not push
  // the rest of the day off the screen and a fifteen-minute one stays easy to tap.
  const base = compact ? 13 : 20;
  const perMin = compact ? 0.82 : 1.15;
  const floor = compact ? 24 : 34;
  const rows: Row[] = [];
  let top = 0;
  for (const block of blocks.slice(first, last + 1)) {
    const height = block.type === 'idle' ? (compact ? 30 : 44) : Math.max(floor, Math.round(base + block.dur * perMin));
    rows.push({ block, top, height });
    top += height;
  }
  return rows;
}

export function Timeline({ blocks, categories, nowMin, onPick, compact = false }: Props) {
  const rows = layout(blocks, compact);
  if (!rows.length) return null;
  const cats = new Map(categories.map((c) => [c.id, c]));
  const end = rows[rows.length - 1];
  const total = end.top + end.height;

  let nowTop: number | null = null;
  if (nowMin !== null) {
    const row = rows.find((r) => r.block.start <= nowMin && nowMin < r.block.start + r.block.dur);
    if (row) nowTop = row.top + ((nowMin - row.block.start) / row.block.dur) * row.height;
    else if (nowMin >= end.block.start + end.block.dur && nowMin - (end.block.start + end.block.dur) < 5) nowTop = total;
  }
  const nearNow = (y: number) => nowTop !== null && Math.abs(y - nowTop) < 15;
  const firstAhead = rows.find((r) => r.block.type === 'ahead');

  return (
    <ol className={`thread${compact ? ' thread-compact' : ''}`} style={{ height: total + 18 }}>
      {rows.map(({ block, top, height }) => {
        const cat = block.type === 'entry' ? cats.get(block.cat) : undefined;
        const tall = height >= (compact ? 40 : 52);
        const range = `${fmtMin(block.start)}–${fmtMin(block.start + block.dur)}`;
        const pick = onPick ? () => onPick(block) : undefined;
        return (
          <li
            key={block.start}
            className={`blk blk-${block.type}`}
            style={{ top, height, ...(cat ? { ['--c' as string]: `var(--c-${cat.color})` } : {}) }}
          >
            <time className="blk-time num" style={nearNow(top) ? { visibility: 'hidden' } : undefined}>
              {fmtMin(block.start)}
            </time>
            <span className="blk-seg" aria-hidden="true" />
            {block.type === 'entry' && (
              <button type="button" className="blk-body" onClick={pick} disabled={!pick} aria-label={`${cat?.name ?? 'Entry'}, ${range}. Change`}>
                <span className="blk-main">
                  <span className="blk-name">{cat?.name ?? 'Removed category'}</span>
                  {block.tag && <span className="blk-tag">{block.tag}</span>}
                </span>
                <span className="blk-dur num">{fmtDur(block.dur)}</span>
                {tall && <span className="blk-range num">{range}</span>}
              </button>
            )}
            {block.type === 'gap' && (
              <button type="button" className="blk-body" onClick={pick} disabled={!pick} aria-label={`Unaccounted, ${range}. Fill in`}>
                <span className="blk-main">
                  <span className="blk-name">Unaccounted</span>
                </span>
                <span className="blk-fill">{pick ? 'Fill in' : fmtDur(block.dur)}</span>
                {tall && <span className="blk-range num">{`${range} · ${fmtDur(block.dur)}`}</span>}
              </button>
            )}
            {block.type === 'ahead' && (
              <span className="blk-body blk-quiet">{block === firstAhead?.block ? `Still to come · ${fmtDur(block.dur)}` : ''}</span>
            )}
            {block.type === 'idle' && (
              <button type="button" className="blk-body blk-quiet" onClick={pick} disabled={!pick}>
                Off the clock · {fmtDur(block.dur)}
              </button>
            )}
          </li>
        );
      })}
      <li className="blk-end" style={{ top: total }}>
        <time className="blk-time num" style={nearNow(total) ? { visibility: 'hidden' } : undefined}>
          {fmtMin(end.block.start + end.block.dur)}
        </time>
      </li>
      {nowTop !== null && nowMin !== null && (
        <li className="now" style={{ top: nowTop }} aria-label={`Now, ${fmtMin(nowMin)}`}>
          <time className="num">{fmtMin(nowMin)}</time>
          <span className="now-dot" aria-hidden="true" />
          <span className="now-line" aria-hidden="true" />
        </li>
      )}
    </ol>
  );
}
