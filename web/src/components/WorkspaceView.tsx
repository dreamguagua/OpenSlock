/** Agent workspace tab: real file tree (served by the daemon over the control-plane)
 *  + a read-only file viewer. Folders lazy-load their children on expand. Path is
 *  confined to the agent sandbox server-side; offline/unassigned agents show a notice. */

import { useEffect, useState, useCallback } from "react";
import { FolderClosed, FolderOpen, FileText, RefreshCw, Copy, ChevronRight, ChevronDown } from "lucide-react";
import { api } from "../api.js";
import type { FsEntry, FsFile } from "../types.js";

export function WorkspaceTab(props: { handle: string }) {
  const [root, setRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [children, setChildren] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<FsFile | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);

  const loadDir = useCallback(async (path: string) => {
    const res = await api.agentFiles(props.handle, path);
    setChildren((c) => ({ ...c, [path]: res.entries }));
    return res;
  }, [props.handle]);

  const reload = useCallback(() => {
    setExpanded(new Set()); setSelected(null); setFile(null); setError(null);
    api.agentFiles(props.handle, "")
      .then((res) => { setRoot(res.root); setChildren({ "": res.entries }); })
      .catch((e) => { setChildren({}); setError((e as Error).message); });
  }, [props.handle]);

  useEffect(() => { setRoot(null); reload(); }, [reload]);

  const toggle = async (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) { next.delete(path); setExpanded(next); return; }
    next.add(path); setExpanded(next);
    if (!children[path]) { try { await loadDir(path); } catch { /* leave collapsed-empty */ } }
  };

  const openFile = async (path: string) => {
    setSelected(path); setFile(null); setFileErr(null);
    try { setFile(await api.agentFile(props.handle, path)); }
    catch (e) { setFileErr((e as Error).message); }
  };

  if (error) {
    return (
      <div className="workspace" data-testid="agent-workspace">
        <div className="ws-empty"><FolderClosed size={28} /><div>{error}</div>
          <div className="fake">Workspace files are read from the agent's computer via its daemon.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace ws-split" data-testid="agent-workspace">
      <div className="ws-tree-pane">
        <div className="ws-pathbar">
          <code>{root ?? "loading…"}</code>
          <button className="nb-btn" title="Refresh" data-testid="ws-refresh" onClick={reload}><RefreshCw size={13} /></button>
        </div>
        <div className="ws-tree" data-testid="ws-tree">
          <TreeLevel
            path="" entries={children[""] ?? null}
            depth={0} expanded={expanded} children={children} selected={selected}
            onToggle={toggle} onOpen={openFile}
          />
        </div>
      </div>
      <div className="ws-viewer" data-testid="ws-viewer">
        {!selected && <div className="ws-empty"><FileText size={26} /><div>Select a file to view</div></div>}
        {selected && fileErr && <div className="ws-empty"><FileText size={26} /><div>{fileErr}</div></div>}
        {selected && file && (
          <>
            <div className="ws-file-head"><code>{file.path}</code>
              <span className="grow" />
              <span className="fake">{file.size} bytes{file.truncated ? " · truncated" : ""}</span>
              <button className="nb-btn" title="Copy" onClick={() => void navigator.clipboard?.writeText(file.content).catch(() => {})}><Copy size={13} /></button>
            </div>
            <pre className="ws-file-body" data-testid="ws-file-content">{file.content}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function TreeLevel(props: {
  path: string;
  entries: FsEntry[] | null;
  depth: number;
  expanded: Set<string>;
  children: Record<string, FsEntry[]>;
  selected: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  if (props.entries === null) {
    return props.depth === 0 ? <div className="fake" style={{ padding: 8 }}>loading…</div> : null;
  }
  if (props.entries.length === 0) {
    return props.depth === 0 ? <div className="fake" style={{ padding: 8 }}>Empty workspace</div> : null;
  }
  return (
    <>
      {props.entries.map((e) => {
        const full = props.path ? `${props.path}/${e.name}` : e.name;
        const pad = { paddingLeft: 8 + props.depth * 16 };
        if (e.type === "dir") {
          const open = props.expanded.has(full);
          return (
            <div key={full}>
              <div className="ws-row" data-testid="ws-dir" style={pad} onClick={() => props.onToggle(full)}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {open ? <FolderOpen size={15} /> : <FolderClosed size={15} />}
                <span className="ws-name">{e.name}</span>
              </div>
              {open && (
                <TreeLevel
                  path={full} entries={props.children[full] ?? null}
                  depth={props.depth + 1} expanded={props.expanded} children={props.children}
                  selected={props.selected} onToggle={props.onToggle} onOpen={props.onOpen}
                />
              )}
            </div>
          );
        }
        return (
          <div
            key={full}
            className={`ws-row file ${props.selected === full ? "active" : ""}`}
            data-testid="ws-file" style={pad} onClick={() => props.onOpen(full)}
          >
            <span style={{ width: 13 }} />
            <FileText size={15} />
            <span className="ws-name">{e.name}</span>
          </div>
        );
      })}
    </>
  );
}
