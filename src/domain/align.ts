/**
 * Pure layout helpers for the "整列" (alignment) ribbon.
 *
 * Each function takes a list of nodes (cards) with their current positions
 * and sizes, and returns the proposed new positions. Callers convert these
 * deltas into a bulk-move command for Undo.
 */

export interface AlignNodeInput {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlignAxis = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter';

export function alignNodes(
  nodes: AlignNodeInput[],
  axis: AlignAxis
): Array<{ id: string; x: number; y: number }> {
  if (nodes.length === 0) return [];
  const lefts = nodes.map((n) => n.x);
  const rights = nodes.map((n) => n.x + n.width);
  const tops = nodes.map((n) => n.y);
  const bottoms = nodes.map((n) => n.y + n.height);
  switch (axis) {
    case 'left': {
      const target = Math.min(...lefts);
      return nodes.map((n) => ({ id: n.id, x: target, y: n.y }));
    }
    case 'right': {
      const target = Math.max(...rights);
      return nodes.map((n) => ({ id: n.id, x: target - n.width, y: n.y }));
    }
    case 'top': {
      const target = Math.min(...tops);
      return nodes.map((n) => ({ id: n.id, x: n.x, y: target }));
    }
    case 'bottom': {
      const target = Math.max(...bottoms);
      return nodes.map((n) => ({ id: n.id, x: n.x, y: target - n.height }));
    }
    case 'hcenter': {
      // Align horizontal centers of each node to the group's average center.
      const centers = nodes.map((n) => n.x + n.width / 2);
      const target = centers.reduce((a, b) => a + b, 0) / centers.length;
      return nodes.map((n) => ({ id: n.id, x: target - n.width / 2, y: n.y }));
    }
    case 'vcenter': {
      const centers = nodes.map((n) => n.y + n.height / 2);
      const target = centers.reduce((a, b) => a + b, 0) / centers.length;
      return nodes.map((n) => ({ id: n.id, x: n.x, y: target - n.height / 2 }));
    }
  }
}

/**
 * Distribute nodes so the gaps BETWEEN consecutive nodes are equal (B3 style).
 * Works well for nodes of varying widths/heights (e.g. groups).
 *
 *   span      = (rightmost edge) - (leftmost edge)
 *   sizeSum   = sum of widths/heights
 *   gap       = (span - sizeSum) / (n - 1)
 *   xᵢ        = x₀ + Σ(w₀..wᵢ₋₁) + gap × i
 *
 * If sizes overflow the span (gap goes negative), output may overlap; that
 * is the user's fault for selecting too wide nodes in too narrow a span.
 */
export function distributeNodes(
  nodes: AlignNodeInput[],
  direction: 'horizontal' | 'vertical'
): Array<{ id: string; x: number; y: number }> {
  if (nodes.length < 2) return nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  if (direction === 'horizontal') {
    const sorted = nodes.slice().sort((a, b) => a.x - b.x);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const spanEdge = last.x + last.width - first.x;
    const sizeSum = sorted.reduce((s, n) => s + n.width, 0);
    const gap = (spanEdge - sizeSum) / (sorted.length - 1);
    const out: Array<{ id: string; x: number; y: number }> = [];
    let cursor = first.x;
    for (const n of sorted) {
      out.push({ id: n.id, x: cursor, y: n.y });
      cursor += n.width + gap;
    }
    return out;
  }
  const sorted = nodes.slice().sort((a, b) => a.y - b.y);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const spanEdge = last.y + last.height - first.y;
  const sizeSum = sorted.reduce((s, n) => s + n.height, 0);
  const gap = (spanEdge - sizeSum) / (sorted.length - 1);
  const out: Array<{ id: string; x: number; y: number }> = [];
  let cursor = first.y;
  for (const n of sorted) {
    out.push({ id: n.id, x: n.x, y: cursor });
    cursor += n.height + gap;
  }
  return out;
}

/**
 * Arrange nodes into a grid with the specified number of rows (or columns).
 * Nodes are placed left-to-right, top-to-bottom in the order given (caller
 * typically sorts by code beforehand).
 *
 * Cell sizing modes (default = "variable"):
 *   - "uniform":  every cell = max(width) × max(height)
 *   - "variable": each column's width = max(width) of nodes in that column;
 *                 each row's height = max(height) of nodes in that row.
 *                 (C2 — more space-efficient when node sizes vary widely)
 */
export function arrangeInGrid(
  nodes: AlignNodeInput[],
  mode: { kind: 'rows'; count: number } | { kind: 'cols'; count: number },
  options: {
    gap?: number;
    baseX?: number;
    baseY?: number;
    cellMode?: 'uniform' | 'variable';
  } = {}
): Array<{ id: string; x: number; y: number }> {
  if (nodes.length === 0) return [];
  const gap = options.gap ?? 20;
  const baseX = options.baseX ?? Math.min(...nodes.map((n) => n.x));
  const baseY = options.baseY ?? Math.min(...nodes.map((n) => n.y));
  const cellMode = options.cellMode ?? 'variable';

  let rows: number;
  let cols: number;
  if (mode.kind === 'rows') {
    rows = Math.max(1, mode.count);
    cols = Math.ceil(nodes.length / rows);
  } else {
    cols = Math.max(1, mode.count);
    rows = Math.ceil(nodes.length / cols);
  }

  // Assign nodes to cells in reading order
  const cells = nodes.map((node, i) => ({
    node,
    row: Math.floor(i / cols),
    col: i % cols,
  }));

  if (cellMode === 'uniform') {
    const cellW = Math.max(...nodes.map((n) => n.width));
    const cellH = Math.max(...nodes.map((n) => n.height));
    return cells.map((c) => ({
      id: c.node.id,
      x: baseX + c.col * (cellW + gap),
      y: baseY + c.row * (cellH + gap),
    }));
  }

  // Variable per-row / per-column sizing (C2)
  const colWidths: number[] = new Array(cols).fill(0);
  const rowHeights: number[] = new Array(rows).fill(0);
  for (const c of cells) {
    colWidths[c.col] = Math.max(colWidths[c.col], c.node.width);
    rowHeights[c.row] = Math.max(rowHeights[c.row], c.node.height);
  }
  // Cumulative offsets including gaps
  const colOffsets: number[] = [0];
  for (let i = 0; i < cols; i++) {
    colOffsets.push(colOffsets[i] + colWidths[i] + gap);
  }
  const rowOffsets: number[] = [0];
  for (let i = 0; i < rows; i++) {
    rowOffsets.push(rowOffsets[i] + rowHeights[i] + gap);
  }
  return cells.map((c) => ({
    id: c.node.id,
    x: baseX + colOffsets[c.col],
    y: baseY + rowOffsets[c.row],
  }));
}
