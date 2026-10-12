// Lines up two versions of a sequence, such as the blocks of a document or
// the rows of a table, as a line diff does: items that are the same are
// matched in order, and between them, old and new items pair up as changed,
// each with the one it most resembles. What pairs with nothing was added or
// removed.

export type Step<T> =
  | { kind: 'same'; before: T; after: T }
  | { kind: 'changed'; before: T; after: T }
  | { kind: 'added'; after: T }
  | { kind: 'removed'; before: T }

// How alike two items are, from 0 to 1; negative when they can't pair.
export type Similarity<T> = (before: T, after: T) => number

// Beyond this many comparisons, items are not matched but taken as
// replaced, so a huge rewrite can't stall the editor.
const maxWork = 4_000_000

// The steps from before to after, in order. Removed items come before the
// items added in their place.
export function align<T>(before: T[], after: T[], same: (a: T, b: T) => boolean, similarity: Similarity<T>): Step<T>[] {
  let start = 0
  while (start < before.length && start < after.length && same(before[start], after[start])) start++
  let endA = before.length
  let endB = after.length
  while (endA > start && endB > start && same(before[endA - 1], after[endB - 1])) endA--, endB--

  const steps: Step<T>[] = before.slice(0, start).map((b, i) => ({ kind: 'same', before: b, after: after[i] }))
  let i = start
  let j = start
  for (const [mi, mj] of matches(before.slice(start, endA), after.slice(start, endB), same)) {
    steps.push(...pair(before.slice(i, start + mi), after.slice(j, start + mj), similarity))
    if (start + mi < endA) steps.push({ kind: 'same', before: before[start + mi], after: after[start + mj] })
    i = start + mi + 1
    j = start + mj + 1
  }
  for (let k = endA; k < before.length; k++) steps.push({ kind: 'same', before: before[k], after: after[k - endA + endB] })
  return steps
}

// The indexes of the items matched as the same, by the longest common
// subsequence, ending with the lengths of both as a sentinel.
function matches<T>(before: T[], after: T[], same: (a: T, b: T) => boolean): [number, number][] {
  const end: [number, number] = [before.length, after.length]
  if (before.length * after.length > maxWork) return [end]
  // longest[i][j]: how many items of before[i..] and after[j..] match.
  const longest = table(before.length, after.length)
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      longest[i][j] = same(before[i], after[j]) ? longest[i + 1][j + 1] + 1 : Math.max(longest[i + 1][j], longest[i][j + 1])
    }
  }
  const found: [number, number][] = []
  for (let i = 0, j = 0; i < before.length && j < after.length; ) {
    if (same(before[i], after[j]) && longest[i][j] === longest[i + 1][j + 1] + 1) found.push([i++, j++])
    else if (longest[i + 1][j] >= longest[i][j + 1]) i++
    else j++
  }
  return [...found, end]
}

// Pairs the items between two matches, keeping their order: as many as
// can, as an edit tends to change blocks rather than replace them, unless
// they are much more alike paired otherwise. Ties pair early.
function pair<T>(before: T[], after: T[], similarity: Similarity<T>): Step<T>[] {
  if (before.length * after.length > maxWork) {
    return [...before.map((b): Step<T> => ({ kind: 'removed', before: b })), ...after.map((a): Step<T> => ({ kind: 'added', after: a }))]
  }
  // Every pair counts one, and more the more alike it is.
  const score = (b: T, a: T) => {
    const s = similarity(b, a)
    return s >= 0 ? 1 + s : undefined
  }
  // best[i][j]: the most the pairs of before[i..] and after[j..] can score.
  const best = table(before.length, after.length)
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      const s = score(before[i], after[j])
      best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], s === undefined ? -1 : s + best[i + 1][j + 1])
    }
  }
  const steps: Step<T>[] = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    const s = i < before.length && j < after.length ? score(before[i], after[j]) : undefined
    if (s !== undefined && s + best[i + 1][j + 1] >= Math.max(best[i + 1][j], best[i][j + 1])) {
      steps.push({ kind: 'changed', before: before[i++], after: after[j++] })
    } else if (j === after.length || (i < before.length && best[i + 1][j] >= best[i][j + 1])) {
      steps.push({ kind: 'removed', before: before[i++] })
    } else {
      steps.push({ kind: 'added', after: after[j++] })
    }
  }
  return steps
}

function table(rows: number, columns: number): number[][] {
  return Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0))
}
