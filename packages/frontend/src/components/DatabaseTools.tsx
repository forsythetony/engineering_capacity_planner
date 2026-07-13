import { useRef, useState } from 'react';
import * as api from '../data/api';

interface DatabaseToolsProps {
  /** True when a live backend is connected; the tools are disabled otherwise. */
  editable: boolean;
  /** Re-fetch the dataset after a successful import so the views recompute. */
  onReload: () => Promise<void>;
}

type Status = { tone: 'ok' | 'error'; text: string } | null;

/** Does a dropped/selected file look like a SQLite database? */
function looksLikeDb(file: File): boolean {
  return /\.(db|sqlite|sqlite3)$/i.test(file.name) || file.type === 'application/octet-stream';
}

/**
 * Configuration tab: local-database maintenance. Take a timestamped snapshot of
 * the live SQLite file, or drag-and-drop a `.db` to restore it (which snapshots
 * the current data first, so a mistaken import is always recoverable).
 */
export function DatabaseTools({ editable, onReload }: DatabaseToolsProps) {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const disabled = !editable || busy;

  const snapshot = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const { file } = await api.snapshotDb();
      setStatus({ tone: 'ok', text: `Snapshot saved as ${file}` });
    } catch (e) {
      setStatus({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    if (!looksLikeDb(file)) {
      setStatus({ tone: 'error', text: `${file.name} doesn't look like a .db file.` });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const { summary, backup } = await api.importDb(file);
      const backupNote = backup ? ` Previous data backed up as ${backup}.` : '';
      setStatus({
        tone: 'ok',
        text: `Imported ${file.name}: ${summary.workItems} work items across ${summary.epics} epic(s).${backupNote}`,
      });
      await onReload();
    } catch (e) {
      setStatus({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) void importFile(file);
  };

  return (
    <section className="panel" data-testid="db-tools">
      <div className="section-title">
        <h2>Database</h2>
        <span className="hint">Snapshot the local database, or import one to restore.</span>
      </div>

      <div className="db-tools-row">
        <button
          type="button"
          className="btn"
          disabled={disabled}
          data-testid="db-snapshot"
          onClick={() => void snapshot()}
        >
          {busy ? 'Working…' : 'Take snapshot'}
        </button>
        <span className="hint">
          Copies the current database to a timestamped <code>*-snapshot-*.db</code> beside it.
        </span>
      </div>

      <div
        className={`db-dropzone${dragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
        data-testid="db-dropzone"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="db-dropzone-icon" aria-hidden>
          ⤓
        </span>
        <span className="db-dropzone-text">
          {dragging ? 'Drop to import' : 'Drag a .db file here, or click to browse'}
        </span>
        <span className="db-dropzone-note">
          Replaces all current data — the existing database is snapshotted first.
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".db,.sqlite,.sqlite3,application/octet-stream"
          className="db-file-input"
          data-testid="db-file-input"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {status && (
        <div
          className={status.tone === 'error' ? 'config-error' : 'db-tools-status'}
          data-testid="db-tools-status"
        >
          {status.tone === 'error' ? '⚠ ' : '✓ '}
          {status.text}
        </div>
      )}

      {!editable && (
        <div className="hint">Connect the backend to snapshot or import the database.</div>
      )}
    </section>
  );
}
