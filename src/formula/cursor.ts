// ─── Formula Cursor Engine ─── AST-aware cursor ───
import type { FormulaNode, CursorPosition } from './types';
import { findNode, findParent, findPlaceholders, nextPlaceholder } from './ast';

export class FormulaCursor {
  position: CursorPosition;
  private root: FormulaNode;

  constructor(root: FormulaNode) {
    this.root = root;
    // Khởi tạo cursor ở placeholder đầu tiên hoặc root
    const phs = findPlaceholders(root);
    if (phs.length > 0) {
      this.position = { nodeId: phs[0].id, offset: 0 };
    } else {
      this.position = { nodeId: root.id, offset: 0 };
    }
  }

  /** Cập nhật root khi AST thay đổi */
  updateRoot(root: FormulaNode) {
    this.root = root;
    // Kiểm tra cursor vẫn valid
    if (!findNode(root, this.position.nodeId)) {
      const phs = findPlaceholders(root);
      if (phs.length > 0) {
        this.position = { nodeId: phs[0].id, offset: 0 };
      } else {
        this.position = { nodeId: root.id, offset: 0 };
      }
    }
  }

  /** Di chuyển cursor sang phải */
  moveRight(): boolean {
    const node = findNode(this.root, this.position.nodeId);
    if (!node) return false;

    if (node.type === 'row' && node.children) {
      if (this.position.offset < node.children.length) {
        // Nếu child tại offset có children, đi vào
        const child = node.children[this.position.offset];
        if (child.children && child.children.length > 0) {
          const firstRow = findFirstRow(child);
          if (firstRow) {
            this.position = { nodeId: firstRow.id, offset: 0 };
            return true;
          }
        }
        this.position.offset++;
        return true;
      }
      // Hết row → đi lên parent
      return this.exitToParentRight();
    }

    if (node.meta?.isPlaceholder) {
      return this.exitToParentRight();
    }

    return false;
  }

  /** Di chuyển cursor sang trái */
  moveLeft(): boolean {
    const node = findNode(this.root, this.position.nodeId);
    if (!node) return false;

    if (node.type === 'row' && node.children) {
      if (this.position.offset > 0) {
        this.position.offset--;
        // Nếu child tại offset có children, đi vào cuối
        const child = node.children[this.position.offset];
        if (child.children && child.children.length > 0) {
          const lastRow = findLastRow(child);
          if (lastRow) {
            this.position = { nodeId: lastRow.id, offset: lastRow.children?.length || 0 };
            return true;
          }
        }
        return true;
      }
      return this.exitToParentLeft();
    }

    if (node.meta?.isPlaceholder) {
      return this.exitToParentLeft();
    }

    return false;
  }

  /** Tab: nhảy sang placeholder tiếp theo */
  tabToNext(): boolean {
    const current = findNode(this.root, this.position.nodeId);
    if (!current) return false;

    const next = nextPlaceholder(this.root, this.position.nodeId);
    if (next) {
      this.position = { nodeId: next.id, offset: 0 };
      return true;
    }
    return false;
  }

  /** Click vào node cụ thể */
  clickNode(nodeId: string) {
    const node = findNode(this.root, nodeId);
    if (node) {
      if (node.meta?.isPlaceholder) {
        this.position = { nodeId: node.id, offset: 0 };
      } else if (node.type === 'row') {
        this.position = { nodeId: node.id, offset: node.children?.length || 0 };
      } else {
        // Tìm row cha gần nhất
        const parent = findParent(this.root, nodeId);
        if (parent && parent.type === 'row' && parent.children) {
          const idx = parent.children.findIndex(c => c.id === nodeId);
          this.position = { nodeId: parent.id, offset: idx + 1 };
        }
      }
    }
  }

  /** Lấy node hiện tại đang được cursor trỏ tới */
  getCurrentNode(): FormulaNode | null {
    return findNode(this.root, this.position.nodeId);
  }

  // ─── Internal helpers ───────────────────────────────────────────────────
  private exitToParentRight(): boolean {
    const parent = findParent(this.root, this.position.nodeId);
    if (!parent) return false;

    if (parent.type === 'row') {
      const idx = (parent.children || []).findIndex(c => c.id === this.position.nodeId);
      if (idx !== -1) {
        this.position = { nodeId: parent.id, offset: idx + 1 };
        return true;
      }
    }

    // Đi lên tiếp
    const grandParent = findParent(this.root, parent.id);
    if (grandParent && grandParent.children) {
      // Tìm sibling row tiếp theo của parent
      const parentIdx = grandParent.children.findIndex(c => c.id === parent.id);
      if (parentIdx < grandParent.children.length - 1) {
        const nextSibling = grandParent.children[parentIdx + 1];
        const firstRow = findFirstRow(nextSibling);
        if (firstRow) {
          this.position = { nodeId: firstRow.id, offset: 0 };
          return true;
        }
      }
      // Hết siblings, exit grandparent
      const ggp = findParent(this.root, grandParent.id);
      if (ggp && ggp.type === 'row') {
        const idx = (ggp.children || []).findIndex(c => c.id === grandParent.id);
        this.position = { nodeId: ggp.id, offset: idx + 1 };
        return true;
      }
    }

    return false;
  }

  private exitToParentLeft(): boolean {
    const parent = findParent(this.root, this.position.nodeId);
    if (!parent) return false;

    if (parent.type === 'row') {
      const idx = (parent.children || []).findIndex(c => c.id === this.position.nodeId);
      if (idx !== -1) {
        this.position = { nodeId: parent.id, offset: idx };
        return true;
      }
    }

    const grandParent = findParent(this.root, parent.id);
    if (grandParent && grandParent.children) {
      const parentIdx = grandParent.children.findIndex(c => c.id === parent.id);
      if (parentIdx > 0) {
        const prevSibling = grandParent.children[parentIdx - 1];
        const lastRow = findLastRow(prevSibling);
        if (lastRow) {
          this.position = { nodeId: lastRow.id, offset: lastRow.children?.length || 0 };
          return true;
        }
      }
      const ggp = findParent(this.root, grandParent.id);
      if (ggp && ggp.type === 'row') {
        const idx = (ggp.children || []).findIndex(c => c.id === grandParent.id);
        this.position = { nodeId: ggp.id, offset: idx };
        return true;
      }
    }

    return false;
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────
function findFirstRow(node: FormulaNode): FormulaNode | null {
  if (node.type === 'row') return node;
  if (node.children) {
    for (const c of node.children) {
      const r = findFirstRow(c);
      if (r) return r;
    }
  }
  return null;
}

function findLastRow(node: FormulaNode): FormulaNode | null {
  if (node.type === 'row' && (!node.children || !node.children.some(c => c.type === 'row'))) {
    return node;
  }
  if (node.children) {
    for (let i = node.children.length - 1; i >= 0; i--) {
      const r = findLastRow(node.children[i]);
      if (r) return r;
    }
  }
  if (node.type === 'row') return node;
  return null;
}
