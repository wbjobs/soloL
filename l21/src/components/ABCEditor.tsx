import { useEffect, useRef, useCallback } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Position, EditorChange, LockedSection } from '../../shared/types';
import { useCollaborationStore } from '../store/useCollaborationStore';
import { useEditorStore } from '../store/useEditorStore';
import { cn } from '../lib/utils';

const abcHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: '#6366f1' },
  { tag: tags.comment, color: '#6b7280', fontStyle: 'italic' },
  { tag: tags.number, color: '#f59e0b' },
  { tag: tags.string, color: '#10b981' },
  { tag: tags.operator, color: '#ef4444' },
  { tag: tags.bracket, color: '#64748b' },
  { tag: tags.propertyName, color: '#0ea5e9' },
  { tag: tags.bool, color: '#84cc16' },
  { tag: tags.separator, color: '#f97316' },
]);

const abcParser = StreamLanguage.define({
  name: 'abc',
  token(stream) {
    if (stream.sol()) {
      if (stream.match(/^[A-Z]:/)) return 'meta';
      if (stream.match(/^%/)) { stream.skipToEnd(); return 'comment'; }
    }
    if (stream.match(/[|][|:_\[\]]?/)) return 'separator';
    if (stream.match(/[zZxX]/)) return 'bool';
    if (stream.match(/[A-Ga-g][#,b]?['`,]*/)) return 'propertyName';
    if (stream.match(/\d+\/?\d*/)) return 'number';
    if (stream.match(/[[\]()]/)) return 'bracket';
    if (stream.match(/[<>^_=]/)) return 'operator';
    if (stream.match(/".*?"/)) return 'string';
    if (stream.match(/%.*/)) { stream.skipToEnd(); return 'comment'; }
    stream.next();
    return null;
  },
});

const abcLanguage = () => new LanguageSupport(abcParser);

const setContentEffect = StateEffect.define<string>();
const setRemoteCursorEffect = StateEffect.define<{ userId: string; position: Position; color: string; name: string }>();
const setLockedSectionsEffect = StateEffect.define<LockedSection[]>();

class RemoteCursorWidget extends WidgetType {
  constructor(readonly color: string, readonly name: string) { super(); }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.style.cssText = `border-left:2px solid ${this.color};position:relative;margin-left:-1px;`;
    const label = document.createElement('span');
    label.textContent = this.name;
    label.style.cssText = `background:${this.color};color:#fff;font-size:10px;padding:1px 4px;border-radius:3px;position:absolute;top:-16px;left:-2px;white-space:nowrap;opacity:0.9;`;
    wrap.appendChild(label);
    return wrap;
  }
  eq(other: RemoteCursorWidget) { return this.color === other.color && this.name === other.name; }
}

class LockIconWidget extends WidgetType {
  toDOM() {
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;align-items:center;margin-right:4px;opacity:0.6;';
    wrap.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    return wrap;
  }
}

interface ABCEditorProps {
  className?: string;
  onChange?: (changes: EditorChange[], content: string) => void;
  onCursorChange?: (position: Position) => void;
}

export default function ABCEditor({ className, onChange, onCursorChange }: ABCEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const throttleRef = useRef<number | null>(null);

  const { content, users, lockedSections, currentUser } = useCollaborationStore();
  const { setCursor, setSelection } = useEditorStore();

  const handleChange = useCallback((changes: EditorChange[], newContent: string) => {
    onChange?.(changes, newContent);
  }, [onChange]);

  const handleCursorChange = useCallback((position: Position) => {
    if (throttleRef.current) clearTimeout(throttleRef.current);
    throttleRef.current = window.setTimeout(() => {
      onCursorChange?.(position);
      setCursor(position);
    }, 100);
  }, [onCursorChange, setCursor]);

  const remoteCursorsField = StateField.define<DecorationSet>({
    create() { return Decoration.none; },
    update(decorations, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setRemoteCursorEffect)) {
          const { position, color, name } = effect.value;
          const doc = tr.state.doc;
          const pos = Math.min(doc.line(position.line + 1).from + position.ch, doc.length);
          const widgetDeco = Decoration.widget({ widget: new RemoteCursorWidget(color, name), side: -1 });
          decorations = decorations.update({
            filter: (_from, _to, value) => {
              const spec = value.spec as { widget?: RemoteCursorWidget };
              return !(spec.widget instanceof RemoteCursorWidget) ||
                spec.widget.color !== color ||
                spec.widget.name !== name;
            },
            add: [widgetDeco.range(pos)],
          });
        }
      }
      return tr.docChanged ? decorations.map(tr.changes) : decorations;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const lockedSectionsField = StateField.define<DecorationSet>({
    create() { return Decoration.none; },
    update(decorations, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setLockedSectionsEffect)) {
          const sections = effect.value;
          const doc = tr.state.doc;
          const newDecorations: Array<ReturnType<Decoration['range']>> = [];
          for (const section of sections) {
            const startLine = Math.max(1, Math.min(section.startLine + 1, doc.lines));
            const endLine = Math.max(1, Math.min(section.endLine + 1, doc.lines));
            for (let i = startLine; i <= endLine; i++) {
              const line = doc.line(i);
              const widgetDeco = Decoration.widget({ widget: new LockIconWidget(), side: -1 });
              const lineDeco = Decoration.line({ attributes: { style: 'background-color: rgba(239, 68, 68, 0.08); pointer-events: none;' } });
              newDecorations.push(widgetDeco.range(line.from), lineDeco.range(line.from));
            }
          }
          decorations = Decoration.set(newDecorations.sort((a, b) => a.from - b.from));
        }
      }
      return tr.docChanged ? decorations.map(tr.changes) : decorations;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  useEffect(() => {
    if (!editorRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const changes: EditorChange[] = update.changes.toJSON().map((c) => ({
          from: { line: update.startState.doc.lineAt(c.from).number - 1, ch: c.from - update.startState.doc.lineAt(c.from).from },
          to: { line: update.startState.doc.lineAt(c.to).number - 1, ch: c.to - update.startState.doc.lineAt(c.to).from },
          text: c.insert ? c.insert.split('\n') : [],
          origin: c.origin,
        }));
        handleChange(changes, update.state.doc.toString());
      }
      if (update.selectionSet) {
        const sel = update.state.selection.main;
        const position: Position = { line: update.state.doc.lineAt(sel.head).number - 1, ch: sel.head - update.state.doc.lineAt(sel.head).from };
        handleCursorChange(position);
        if (sel.anchor !== sel.head) {
          setSelection({ anchor: { line: update.state.doc.lineAt(sel.anchor).number - 1, ch: sel.anchor - update.state.doc.lineAt(sel.anchor).from }, head: position });
        } else {
          setSelection(null);
        }
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        abcLanguage(),
        syntaxHighlighting(abcHighlightStyle),
        updateListener,
        remoteCursorsField,
        lockedSectionsField,
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px', fontFamily: '"JetBrains Mono", "Fira Code", monospace' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
          '.cm-activeLine': { backgroundColor: 'rgba(99, 102, 241, 0.08)' },
          '.cm-activeLineGutter': { backgroundColor: 'rgba(99, 102, 241, 0.12)' },
          '.cm-line': { paddingLeft: '4px' },
        }),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
  }, []);

  useEffect(() => {
    if (!viewRef.current) return;
    const currentContent = viewRef.current.state.doc.toString();
    if (content !== currentContent) {
      viewRef.current.dispatch({
        effects: setContentEffect.of(content),
        changes: { from: 0, to: currentContent.length, insert: content },
      });
    }
  }, [content]);

  useEffect(() => {
    if (!viewRef.current) return;
    users.filter((u) => u.id !== currentUser?.id && u.cursor).forEach((user) => {
      if (user.cursor) {
        viewRef.current?.dispatch({
          effects: setRemoteCursorEffect.of({ userId: user.id, position: user.cursor, color: user.color, name: user.name }),
        });
      }
    });
  }, [users, currentUser]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setLockedSectionsEffect.of(lockedSections) });
  }, [lockedSections]);

  return (
    <div className={cn('h-full w-full overflow-hidden rounded-lg border border-gray-200 bg-white', className)}>
      <div ref={editorRef} className="h-full w-full" />
    </div>
  );
}
