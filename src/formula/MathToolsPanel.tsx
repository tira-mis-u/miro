// Responsive, independently collapsible palette for KaTeX symbols and editable structures.
import * as React from 'react';
import { Calculator, ChevronDown } from 'lucide-react';
import { MATH_STRUCTURE_CATALOG, type MathStructureDefinition, type MathToolCategory } from './catalog';
import { SYMBOL_GROUPS } from './symbols';
import { parseTelex } from './parser';
import { renderFormulaToHTML, renderLatexToHTML } from './renderer';
import type { StructuredGridDraft, StructuredGridDelimiter } from './structuredGrid';
import {
  hasPopulatedCellsOutsideDimensions,
  MAX_GRID_DIMENSION,
  normalizeStructuredGrid,
  resizeStructuredGrid,
  updateStructuredGridCell,
  STRUCTURED_GRID_DELIMITERS,
} from './structuredGrid';
import { DEFAULT_PALETTE_EXPANDED, isPaletteSectionExpanded, togglePaletteSection, type PaletteExpandedSections } from './paletteState';
import './formula.css';

const STRUCTURE_CATEGORIES: { value: MathToolCategory; label: string }[] = [
  { value: 'structures', label: 'Structures' },
  { value: 'functions', label: 'Functions' },
  { value: 'trigonometry', label: 'Trigonometry' },
  { value: 'geometry', label: 'Geometry' },
  { value: 'calculus', label: 'Calculus & analysis' },
];

function makeEmptyGrid(): StructuredGridDraft {
  return { delimiter: 'none', cells: [['', ''], ['', '']] };
}

// Palette expressions use one cached KaTeX renderer; templates use true TeX display style.
type PalettePreviewKind = 'symbol' | 'structure' | 'delimiter';
const previewCache = new Map<string, string>();
function getPalettePreview(source: string, kind: PalettePreviewKind = 'structure'): string {
  const key = source.trim();
  const cacheKey = `${kind}:${key}`;
  const cached = previewCache.get(cacheKey);
  if (cached) return cached;
  const fontSize = kind === 'structure' ? 16 : kind === 'symbol' ? 16 : 15;
  const mathStyle = kind === 'structure' ? 'display' : 'text';
  const html = renderFormulaToHTML(parseTelex(key || '\\,'), fontSize, { mathStyle });
  previewCache.set(cacheKey, html);
  return html;
}

function getRawLatexPreview(source: string): string {
  const key = `raw:${source.trim()}`;
  const cached = previewCache.get(key);
  if (cached) return cached;
  const html = renderLatexToHTML(source, 16);
  previewCache.set(key, html);
  return html;
}

interface MathToolsPanelProps {
  onInsertSymbol: (symbol: string) => void;
  onInsertStructure: (type: string) => void;
  onLoadStructuredGrid: () => StructuredGridDraft | null;
  onInsertStructuredGrid: (draft: StructuredGridDraft) => void;
  zoom?: number;
  width?: number;
  maxHeight?: number;
  initialExpandedSections?: PaletteExpandedSections;
}

interface CollapsibleSectionProps {
  id: string;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function CollapsibleSection({ id, title, expanded, onToggle, children }: CollapsibleSectionProps) {
  const panelId = `math-tools-content-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  return (
    <section className="math-tools-section" aria-label={title}>
      <button type="button" className="math-tools-section-toggle" aria-expanded={expanded}
        aria-controls={panelId} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`} onClick={onToggle}>
        <span>{title}</span>
        <ChevronDown size={13} aria-hidden="true" className={expanded ? 'is-expanded' : ''} />
      </button>
      <div id={panelId} className="math-tools-section-content" hidden={!expanded}>
        {expanded ? children : null}
      </div>
    </section>
  );
}

interface StructureButtonProps { item: MathStructureDefinition; onInsert: (id: string) => void }
const StructurePaletteButton = React.memo(function StructurePaletteButton({ item, onInsert }: StructureButtonProps) {
  return (
    <button type="button" className="math-tool-btn structure"
      data-palette-id={item.id} title={item.label} aria-label={`Insert ${item.label}`}
      onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
      onClick={event => { event.stopPropagation(); onInsert(item.id); }}>
      <span className="struct-preview" aria-hidden="true" dangerouslySetInnerHTML={{ __html: getPalettePreview(item.previewSource ?? item.insertion, 'structure') }} />
      <span className="struct-label">{item.label}</span>
    </button>
  );
});

interface SymbolButtonProps { glyph: string; name: string; source?: string; onInsert: (source: string) => void }
const SymbolPaletteButton = React.memo(function SymbolPaletteButton({ glyph, name, source, onInsert }: SymbolButtonProps) {
  const insertion = source ?? glyph;
  return (
    <button type="button" className="math-tool-btn symbol" data-symbol-name={name} title={`Insert ${name}`} aria-label={`Insert ${name}`}
      onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
      onClick={event => { event.stopPropagation(); onInsert(insertion); }}>
      <span className="symbol-preview" aria-hidden="true" dangerouslySetInnerHTML={{ __html: getPalettePreview(insertion, 'symbol') }} />
      <span className="symbol-label">{name}</span>
    </button>
  );
});

interface DelimiterButtonProps {
  option: { value: StructuredGridDelimiter; label: string; preview: string; previewLatex?: string };
  selected: boolean;
  disabled?: boolean;
  onSelect: (value: StructuredGridDelimiter) => void;
}
const DelimiterPaletteButton = React.memo(function DelimiterPaletteButton({ option, selected, disabled = false, onSelect }: DelimiterButtonProps) {
  return (
    <button type="button" className="structured-grid-delimiter" aria-pressed={selected} disabled={disabled}
      title={disabled ? 'Cases use a fixed left brace' : option.label} aria-label={`Use ${option.label.toLowerCase()}`}
      onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
      onClick={event => { event.stopPropagation(); onSelect(option.value); }}>
      <span className="structured-grid-delimiter-preview" aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: option.previewLatex ? getRawLatexPreview(option.previewLatex) : getPalettePreview(option.preview, 'delimiter') }} />
      <span className="structured-grid-delimiter-label">{option.label}</span>
    </button>
  );
});

function MathToolsPanel({
  onInsertSymbol, onInsertStructure, onLoadStructuredGrid, onInsertStructuredGrid, zoom = 1, width = 400, maxHeight,
  initialExpandedSections = DEFAULT_PALETTE_EXPANDED,
}: MathToolsPanelProps) {
  const [pos, setPos] = React.useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const [gridStage, setGridStage] = React.useState<'configure' | 'edit'>('configure');
  const [gridDraft, setGridDraft] = React.useState<StructuredGridDraft>(makeEmptyGrid);
  const [loadedGrid, setLoadedGrid] = React.useState(false);
  const [isReconfiguring, setIsReconfiguring] = React.useState(false);
  const [rowCount, setRowCount] = React.useState('2');
  const [columnCount, setColumnCount] = React.useState('2');
  const [dimensionError, setDimensionError] = React.useState('');
  const [pendingReconfiguration, setPendingReconfiguration] = React.useState<{ rows: number; columns: number } | null>(null);
  const [gridMessage, setGridMessage] = React.useState('');
  const [expandedSections, setExpandedSections] = React.useState<PaletteExpandedSections>(initialExpandedSections);
  const lastMouse = React.useRef({ x: 0, y: 0 });
  const panelRef = React.useRef<HTMLDivElement>(null);
  const gridCellRefs = React.useRef(new Map<string, HTMLTextAreaElement>());
  const activeGridCell = React.useRef({ row: 0, column: 0 });
  const pendingGridCellFocus = React.useRef<{ row: number; column: number } | null>(null);

  const toggleSection = (id: string) => setExpandedSections(current => togglePaletteSection(current, id));
  const isExpanded = (id: string) => isPaletteSectionExpanded(expandedSections, id);

  const onHeaderMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
    lastMouse.current = { x: event.clientX, y: event.clientY };
  };

  React.useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!isDragging) return;
      let dx = event.clientX - lastMouse.current.x;
      let dy = event.clientY - lastMouse.current.y;
      const panelRect = panelRef.current?.getBoundingClientRect();
      const workspaceRect = panelRef.current?.closest('.canvas-workspace')?.getBoundingClientRect();
      if (panelRect && workspaceRect) {
        const minX = workspaceRect.left + 8 - panelRect.left;
        const maxX = workspaceRect.right - 8 - panelRect.right;
        const minY = workspaceRect.top + 8 - panelRect.top;
        const maxY = workspaceRect.bottom - 8 - panelRect.bottom;
        dx = Math.max(minX, Math.min(dx, maxX));
        dy = Math.max(minY, Math.min(dy, maxY));
      }
      setPos(current => ({ x: current.x + dx / zoom, y: current.y + dy / zoom }));
      lastMouse.current = { x: event.clientX, y: event.clientY };
    };
    const onMouseUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, zoom]);

  React.useLayoutEffect(() => {
    const target = pendingGridCellFocus.current;
    if (!target) return;
    pendingGridCellFocus.current = null;
    const element = gridCellRefs.current.get(`${target.row}:${target.column}`);
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    activeGridCell.current = target;
  }, [gridDraft]);

  const updateCell = (rowIndex: number, columnIndex: number, value: string) => {
    setGridDraft(current => updateStructuredGridCell(current, rowIndex, columnIndex, value));
  };

  const parseDimension = (value: string): number | null => {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_GRID_DIMENSION ? parsed : null;
  };

  const applyGridDimensions = (rows: number, columns: number) => {
    const wasReconfiguring = isReconfiguring;
    const next = resizeStructuredGrid(wasReconfiguring ? gridDraft : null, rows, columns);
    pendingGridCellFocus.current = { row: 0, column: 0 };
    setGridDraft(next);
    setGridStage('edit');
    setIsReconfiguring(false);
    setPendingReconfiguration(null);
    setDimensionError('');
    setGridMessage(wasReconfiguring ? 'Grid reconfigured; overlapping cell contents were preserved.' : 'Grid created. Edit each cell independently.');
  };

  const createGrid = () => {
    const rows = parseDimension(rowCount);
    const columns = parseDimension(columnCount);
    if (rows === null || columns === null) {
      setDimensionError(`Enter whole-number row and column counts from 1 to ${MAX_GRID_DIMENSION}.`);
      return;
    }

    if (isReconfiguring && hasPopulatedCellsOutsideDimensions(gridDraft, rows, columns)) {
      setPendingReconfiguration({ rows, columns });
      return;
    }
    applyGridDimensions(rows, columns);
  };

  const confirmReconfiguration = () => {
    if (pendingReconfiguration) applyGridDimensions(pendingReconfiguration.rows, pendingReconfiguration.columns);
  };

  const cancelReconfiguration = () => {
    setPendingReconfiguration(null);
    setGridStage('edit');
    setIsReconfiguring(false);
    setDimensionError('');
    setGridMessage('Reconfiguration cancelled. The existing grid and all cell contents are unchanged.');
  };

  const beginReconfigure = () => {
    setRowCount(String(gridDraft.cells.length));
    setColumnCount(String(gridDraft.cells[0]?.length ?? 1));
    setDimensionError('');
    setIsReconfiguring(true);
    setGridStage('configure');
  };

  const loadSelectedGrid = () => {
    const selected = onLoadStructuredGrid();
    if (!selected) {
      setGridMessage('Place the cursor inside a structured grid to edit it.');
      return;
    }
    const next = normalizeStructuredGrid(selected);
    pendingGridCellFocus.current = { row: 0, column: 0 };
    setGridDraft(next);
    setRowCount(String(next.cells.length));
    setColumnCount(String(next.cells[0]?.length ?? 1));
    setGridStage('edit');
    setIsReconfiguring(false);
    setLoadedGrid(true);
    setGridMessage('Loaded selected grid. Edit cells independently or reconfigure its dimensions.');
  };

  const insertGrid = () => {
    onInsertStructuredGrid(normalizeStructuredGrid(gridDraft));
    setLoadedGrid(false);
    setGridMessage('Structured expression inserted.');
  };

  const panelSection = (id: string, title: string, children: React.ReactNode) => (
    <CollapsibleSection key={id} id={id} title={title} expanded={isExpanded(id)} onToggle={() => toggleSection(id)}>
      {children}
    </CollapsibleSection>
  );

  return (
    <div ref={panelRef} className="math-tools-panel" role="group" aria-label="Formula symbols and structures" tabIndex={-1}
      style={{ width, maxHeight, position: 'relative', transform: `translate(${pos.x}px, ${pos.y}px)` }}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}>
      <div className="math-tools-header" onMouseDown={onHeaderMouseDown}>
        <Calculator size={14} className="icon" aria-hidden="true" />
        <span className="title">Math Tools</span>
      </div>

      <div className="math-tools-body">
        {panelSection('structured-expression', 'Structured expression', (
          <div className="structured-grid-tool">
            {gridStage === 'configure' ? (
              <div className="structured-grid-configure" aria-label="Structured expression dimensions">
                <div className="structured-grid-size-fields">
                  <label htmlFor="structured-grid-row-count">Row count
                    <input id="structured-grid-row-count" aria-label="Row count" type="number" inputMode="numeric"
                      min={1} max={MAX_GRID_DIMENSION} step={1} value={rowCount}
                      onChange={event => { setRowCount(event.currentTarget.value); setDimensionError(''); }} />
                  </label>
                  <label htmlFor="structured-grid-column-count">Column count
                    <input id="structured-grid-column-count" aria-label="Column count" type="number" inputMode="numeric"
                      min={1} max={MAX_GRID_DIMENSION} step={1} value={columnCount}
                      onChange={event => { setColumnCount(event.currentTarget.value); setDimensionError(''); }} />
                  </label>
                </div>
                <button type="button" className="structured-grid-create" aria-label="Create structured expression"
                  onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
                  onClick={event => { event.stopPropagation(); createGrid(); }}>Create</button>
                {dimensionError && <div className="structured-grid-validation" role="alert">{dimensionError}</div>}
                {pendingReconfiguration && (
                  <div className="structured-grid-confirmation" role="alertdialog" aria-labelledby="structured-grid-confirm-title"
                    aria-describedby="structured-grid-confirm-description">
                    <strong id="structured-grid-confirm-title">Discard populated cells?</strong>
                    <p id="structured-grid-confirm-description">
                      Reducing to {pendingReconfiguration.rows} × {pendingReconfiguration.columns} will discard populated cells outside the new dimensions.
                    </p>
                    <div className="structured-grid-confirm-actions">
                      <button type="button" aria-label="Cancel reconfiguration" onClick={cancelReconfiguration}>Cancel</button>
                      <button type="button" className="primary" aria-label="Confirm discarding cells" onClick={confirmReconfiguration}>Discard cells &amp; create</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="structured-grid-editor">
                <div className="structured-grid-delimiters" role="group" aria-label="Structured expression delimiter">
                  {STRUCTURED_GRID_DELIMITERS.map(option => (
                    <DelimiterPaletteButton key={option.value} option={option} selected={gridDraft.delimiter === option.value}
                      onSelect={value => setGridDraft(current => ({ ...current, delimiter: value }))} />
                  ))}
                </div>
                <div className="structured-grid-cells" role="group" aria-label="Editable structured expression cells"
                  style={{ gridTemplateColumns: `repeat(${gridDraft.cells[0]?.length ?? 1}, minmax(54px, 1fr))` }}>
                  {gridDraft.cells.map((row, rowIndex) => row.map((cell, columnIndex) => {
                    const key = `${rowIndex}:${columnIndex}`;
                    return (
                      <textarea key={key} ref={element => {
                        if (element) gridCellRefs.current.set(key, element);
                        else gridCellRefs.current.delete(key);
                      }} rows={Math.min(4, Math.max(1, (cell.match(/\n/g)?.length ?? 0) + 1))}
                        aria-label={`Cell row ${rowIndex + 1}, column ${columnIndex + 1}`}
                        value={cell === '□' ? '' : cell} placeholder={`r${rowIndex + 1}c${columnIndex + 1}`}
                        onFocus={() => { activeGridCell.current = { row: rowIndex, column: columnIndex }; }}
                        onChange={event => updateCell(rowIndex, columnIndex, event.currentTarget.value)}
                        onMouseDown={event => event.stopPropagation()} />
                    );
                  }))}
                </div>
                <button type="button" className="structured-grid-reconfigure" aria-label="Reconfigure structured expression"
                  onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
                  onClick={event => { event.stopPropagation(); beginReconfigure(); }}>Reconfigure</button>
                <div className="structured-grid-editor-actions">
                  <button type="button" aria-label="Load selected grid"
                    onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
                    onClick={event => { event.stopPropagation(); loadSelectedGrid(); }}>Load selected grid</button>
                  <button type="button" className="primary" aria-label={loadedGrid ? 'Update selected grid' : 'Insert structured expression'}
                    onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
                    onClick={event => { event.stopPropagation(); insertGrid(); }}>{loadedGrid ? 'Update selected grid' : 'Insert grid'}</button>
                </div>
                {gridMessage && <div className="structured-grid-message" role="status" aria-live="polite">{gridMessage}</div>}
              </div>
            )}
          </div>
        ))}

        {STRUCTURE_CATEGORIES.map(({ value, label }) => panelSection(value, label, (
          <div className="math-tools-grid structures">
            {MATH_STRUCTURE_CATALOG.filter(item => item.category === value).map(item => (
              <StructurePaletteButton key={item.id} item={item} onInsert={onInsertStructure} />
            ))}
          </div>
        )))}

        {Object.entries(SYMBOL_GROUPS).map(([groupName, symbols]) => panelSection(`symbols-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          groupName === 'OPERATORS' ? 'Arithmetic & comparison' : groupName.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()), (
            <div className="math-tools-grid">
              {symbols.map(([glyph, name, source]) => (
                <SymbolPaletteButton key={`${glyph}-${name}`} glyph={glyph} name={name} source={source} onInsert={onInsertSymbol} />
              ))}
            </div>
          ))) }
      </div>

      <div className="math-tools-footer">
        Previews never change source. Select a card to insert or replace. Grids: create → edit cells → reconfigure.
      </div>
    </div>
  );
}

export default React.memo(MathToolsPanel);
