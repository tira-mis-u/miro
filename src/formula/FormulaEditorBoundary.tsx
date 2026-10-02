import * as React from 'react';

interface FormulaEditorBoundaryProps {
  sourceRef: React.RefObject<string>;
  getLastValidPreview: () => string;
  onSourceChange: (source: string) => void;
  onCommit: (source: string, preview: string) => void;
  children: React.ReactNode;
}

interface FormulaEditorBoundaryState {
  hasError: boolean;
  source: string;
}

export default class FormulaEditorBoundary extends React.Component<FormulaEditorBoundaryProps, FormulaEditorBoundaryState> {
  state: FormulaEditorBoundaryState = { hasError: false, source: this.props.sourceRef.current };

  static getDerivedStateFromError(): Partial<FormulaEditorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Formula editor failed; source remains in the board document.', error, info.componentStack);
    this.setState({ source: this.props.sourceRef.current });
  }

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    const change = (source: string) => {
      this.setState({ source });
      this.props.onSourceChange(source);
    };
    return (
      <section role="alert" aria-label="Formula editor recovered" style={{ width: 'min(820px, calc(100vw - 32px))', padding: 18,
        color: '#0f172a', background: '#fff', border: '1px solid #fca5a5', borderRadius: 14,
        boxShadow: '0 18px 54px rgba(15, 23, 42, .22)', font: '14px/1.5 Inter, Segoe UI, sans-serif' }}>
        <strong>Formula preview failed locally</strong>
        <p style={{ margin: '6px 0 12px', color: '#475569' }}>Your LaTeX source is still available. You can edit it here or finish editing without changing it.</p>
        <textarea aria-label="LaTeX source recovery" value={this.state.source} onChange={event => change(event.target.value)}
          style={{ boxSizing: 'border-box', width: '100%', minHeight: 150, resize: 'vertical', padding: 10,
            border: '1px solid #cbd5e1', borderRadius: 8, font: '13px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => this.setState({ hasError: false })} style={{ padding: '8px 11px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }}>Retry editor</button>
          <button type="button" onClick={() => this.props.onCommit(this.state.source, this.props.getLastValidPreview())}
            style={{ padding: '8px 11px', border: '1px solid #1d4ed8', borderRadius: 8, background: '#2563eb', color: '#fff', fontWeight: 700 }}>Finish editing</button>
        </div>
      </section>
    );
  }
}
