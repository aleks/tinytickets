import { useId, useMemo, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, GitBranch, Minus, Plus, X } from 'lucide-react'
import {
  buildDependencyMap,
  dependencyChain,
  nodeHeight,
  nodeWidth,
  type MapWorkspace,
} from './dependencyGraph'
import './dependency-map.css'
import { statusMetadata } from '../../shared/status'

export function DependencyMap({ projectID, data }: { projectID: number; data: MapWorkspace }) {
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const [focusChain, setFocusChain] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [expandExternal, setExpandExternal] = useState(false)
  const [hideDone, setHideDone] = useState(false)
  const [zoom, setZoom] = useState(1)
  const viewport = useRef<HTMLDivElement>(null)
  const markerID = useId().replace(/:/g, '')
  const selected = data.tickets.find((t) => t.id === selectedID)
  const graph = useMemo(
    () =>
      buildDependencyMap(data, projectID, {
        includeArchived,
        expandExternal,
        hideDone,
        focusID: focusChain && selected ? selected.id : undefined,
      }),
    [data, projectID, includeArchived, expandExternal, hideDone, focusChain, selected],
  )
  const nodeByID = new Map(graph.nodes.map((n) => [n.ticket.id, n]))
  const chain = useMemo(
    () => (selected ? dependencyChain(selected.id, data.links) : null),
    [selected, data.links],
  )
  const blockers = selected
    ? data.links
        .filter((l) => l.blocked_id === selected.id)
        .map((l) => data.tickets.find((t) => t.id === l.blocker_id))
        .filter((t) => t !== undefined)
    : []
  const dependents = selected
    ? data.links
        .filter((l) => l.blocker_id === selected.id)
        .map((l) => data.tickets.find((t) => t.id === l.blocked_id))
        .filter((t) => t !== undefined)
    : []
  const readyCount = graph.nodes.filter((n) => n.ready).length

  return (
    <section className="dependency-map" aria-labelledby="dependency-map-heading">
      <div className="dependency-intro">
        <div>
          <h2 id="dependency-map-heading">
            <GitBranch size={17} />
            Dependency map
          </h2>
          <p>
            Arrows point from blocker to dependent. Select a ticket to trace its chain; open its
            page to edit dependencies.
          </p>
        </div>
        <span className="dependency-counts" role="status">
          {graph.nodes.length} tickets · {graph.links.length} links · {readyCount} ready in view
        </span>
      </div>
      <div className="dependency-controls">
        <div className="dependency-filters">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
            />
            Hide done tickets
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Include archived epics
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={expandExternal}
              onChange={(e) => setExpandExternal(e.target.checked)}
            />
            Expand external chains
          </label>
        </div>
        <div className="dependency-zoom" role="group" aria-label="Map zoom">
          <button
            className="text-button"
            onClick={() => {
              if (viewport.current)
                setZoom(
                  Math.max(0.25, Math.min(1.5, (viewport.current.clientWidth - 2) / graph.width)),
                )
            }}
          >
            Fit width
          </button>
          <button
            className="icon-button"
            aria-label="Zoom out"
            disabled={zoom <= 0.25}
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
          >
            <Minus size={15} />
          </button>
          <button className="text-button" aria-label="Reset map zoom" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="icon-button"
            aria-label="Zoom in"
            disabled={zoom >= 1.5}
            onClick={() => setZoom((z) => Math.min(1.5, z + 0.25))}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
      <div className="dependency-legend">
        <span className="map-legend-ready">Ready to start</span>
        <span>Blocked = unfinished blockers</span>
        <span className="map-legend-done">Done / satisfied arrows muted</span>
        <span>Dashed cards = linked context</span>
        <span>
          Blocker <ArrowRight size={13} />
          Dependent
        </span>
      </div>
      {graph.contextCount > 0 && (
        <p className="dependency-notice">
          {graph.contextCount} linked context {graph.contextCount === 1 ? 'ticket' : 'tickets'}{' '}
          included from other projects or hidden archives. Readiness always checks all blockers,
          even when filters hide them. Expand external chains to see connections beyond the project
          boundary.
        </p>
      )}
      {graph.archivedLocal > 0 && !includeArchived && (
        <p className="dependency-notice">
          Archived project tickets are hidden unless needed as linked context. Use Include archived
          epics to show all {graph.archivedLocal}.
        </p>
      )}
      {hideDone && (
        <p className="dependency-notice">
          Done tickets and their arrows are hidden. This filter does not change readiness.
        </p>
      )}
      {graph.cyclic && (
        <p className="form-error" role="alert">
          Some dependencies contain a cycle. All tickets remain accessible, but the map cannot fully
          order this graph. Correct the links in the ticket editor.
        </p>
      )}
      <div className="dependency-layout">
        <div className="dependency-canvas-column">
          {selected && (
            <div className="dependency-focus-bar">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={focusChain}
                  onChange={(e) => setFocusChain(e.target.checked)}
                />
                Show only TT-{selected.id}'s chain
              </label>
              <button
                className="text-button"
                onClick={() => {
                  setSelectedID(null)
                  setFocusChain(false)
                }}
              >
                <X size={13} />
                Clear selection
              </button>
            </div>
          )}
          {!graph.nodes.length ? (
            <div className="dependency-empty">
              <GitBranch size={24} />
              <h3>{graph.totalLocal ? 'No tickets match these filters' : 'No tickets yet'}</h3>
              <p>
                {graph.totalLocal
                  ? 'Clear the chain focus or adjust the filters to see more tickets.'
                  : 'Create tickets and link them in the ticket editor to build a dependency map.'}
              </p>
            </div>
          ) : (
            <>
              {!graph.links.length && (
                <p className="dependency-notice">
                  No dependency arrows in this view. Independent tickets are shown too; add links in
                  the ticket editor to connect them.
                </p>
              )}
              <div
                ref={viewport}
                className="dependency-scroll"
                tabIndex={0}
                role="region"
                aria-label="Ticket dependency graph"
                aria-describedby="dependency-scroll-help"
              >
                <div
                  style={{ width: graph.width * zoom, height: graph.height * zoom }}
                  className="dependency-scaled-space"
                >
                  <div
                    className="dependency-canvas"
                    style={{
                      width: graph.width,
                      height: graph.height,
                      transform: `scale(${zoom})`,
                    }}
                  >
                    <svg
                      className="dependency-arrows"
                      width={graph.width}
                      height={graph.height}
                      aria-hidden="true"
                    >
                      <defs>
                        {['pending', 'satisfied', 'highlight'].map((kind) => (
                          <marker
                            key={kind}
                            id={`${markerID}-${kind}`}
                            markerWidth="8"
                            markerHeight="8"
                            refX="7"
                            refY="4"
                            orient="auto"
                            markerUnits="userSpaceOnUse"
                          >
                            <path d="M0,0 L8,4 L0,8 Z" className={`map-arrowhead-${kind}`} />
                          </marker>
                        ))}
                      </defs>
                      {graph.links.map((link) => {
                        const source = nodeByID.get(link.blocker_id)!,
                          target = nodeByID.get(link.blocked_id)!
                        const highlighted =
                          chain?.has(link.blocker_id) && chain.has(link.blocked_id)
                        const kind = highlighted
                          ? 'highlight'
                          : source.ticket.status === 'done'
                            ? 'satisfied'
                            : 'pending'
                        const x1 = source.x + nodeWidth,
                          y1 = source.y + nodeHeight * link.sourcePort,
                          x2 = target.x - 2,
                          y2 = target.y + nodeHeight * link.targetPort
                        const bend = Math.max(36, (x2 - x1) / 2)
                        const path =
                          link.railY === undefined
                            ? `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`
                            : `M${x1},${y1} H${x1 + 20 + (link.sourceIndex % 6) * 8} V${link.railY} H${x2 - 20 - (link.targetIndex % 6) * 8} V${y2} H${x2}`
                        return (
                          <path
                            key={`${link.blocker_id}-${link.blocked_id}`}
                            data-blocker={link.blocker_id}
                            data-dependent={link.blocked_id}
                            d={path}
                            className={`map-edge map-edge-${kind} ${chain && !highlighted ? 'map-edge-dimmed' : ''}`}
                            markerEnd={`url(#${markerID}-${kind})`}
                          />
                        )
                      })}
                    </svg>
                    {graph.nodes.map((node) => {
                      const t = node.ticket,
                        Icon = statusMetadata[t.status].icon
                      const state = node.ready ? 'ready' : node.blocked ? 'blocked' : t.status
                      return (
                        <div
                          key={t.id}
                          className={`map-node ${node.context ? 'map-node-context' : ''} ${t.status === 'done' ? 'map-node-done' : ''} ${node.ready ? 'map-node-ready' : ''} ${chain && !chain.has(t.id) ? 'map-node-dimmed' : ''} ${selectedID === t.id ? 'map-node-selected' : ''}`}
                          style={{
                            left: node.x,
                            top: node.y,
                            width: nodeWidth,
                            height: nodeHeight,
                          }}
                          data-ticket-id={t.id}
                          data-state={state}
                        >
                          <button
                            className="map-node-select"
                            aria-pressed={selectedID === t.id}
                            aria-label={`Select TT-${t.id}: ${t.title}`}
                            onClick={() => setSelectedID(t.id)}
                          >
                            <span className="map-node-top">
                              <span className="ticket-id">TT-{t.id}</span>
                              <span className="map-node-status">
                                <Icon size={12} />
                                {statusMetadata[t.status].label}
                              </span>
                            </span>
                            <strong className="map-node-title" title={t.title}>
                              {t.title}
                            </strong>
                            <span
                              className="map-node-epic"
                              title={`${node.projectName} / ${node.epic.title}`}
                            >
                              {node.external ? `${node.projectName} / ` : ''}
                              {node.epic.title}
                            </span>
                            <span className="map-node-badges">
                              {node.ready && (
                                <span className="map-ready-badge">Ready to start</span>
                              )}
                              {node.blocked && <span>Blocked by {node.unfinishedBlockers}</span>}
                              {node.epic.archived ? (
                                <span>Archived epic</span>
                              ) : (
                                node.epic.completed && <span>Epic completed</span>
                              )}
                              {node.external && <span>External</span>}
                              {node.outsideLinks > 0 && (
                                <span title="Connections outside the current view">
                                  +{node.outsideLinks} outside view
                                </span>
                              )}
                            </span>
                          </button>
                          <a
                            className="map-node-open"
                            href={`#ticket/${t.id}`}
                            aria-label={`Open TT-${t.id}`}
                            title="Open full ticket"
                          >
                            <ArrowUpRight size={14} />
                          </a>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
              <p className="dependency-help" id="dependency-scroll-help">
                Scroll to explore; use zoom controls for larger maps. Tab to a ticket and press
                Enter to trace its chain. Ready to start is a live snapshot, not a reservation.
              </p>
              <section
                className="dependency-line-guide"
                aria-label="How to read the dependency map"
              >
                <h3>How to read the map</h3>
                <p>Arrows always point from the blocker to the ticket it blocks.</p>
                <dl>
                  <div>
                    <dt>
                      <span className="map-style-sample map-style-pending" aria-hidden="true" />
                      Dotted lines
                    </dt>
                    <dd>The blocking ticket is not Done yet, so the dependency is unresolved.</dd>
                  </div>
                  <div>
                    <dt>
                      <span className="map-style-sample map-style-satisfied" aria-hidden="true" />
                      Solid, muted lines
                    </dt>
                    <dd>The blocking ticket is Done, so the dependency is satisfied.</dd>
                  </div>
                  <div>
                    <dt>
                      <span className="map-style-sample map-style-highlight" aria-hidden="true" />
                      Accent-colored lines
                    </dt>
                    <dd>
                      The selected ticket's chain is highlighted. This overrides the normal line
                      styling.
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <span className="map-style-sample map-style-context" aria-hidden="true" />
                      Dashed card borders
                    </dt>
                    <dd>Linked context from another project or a hidden archived epic.</dd>
                  </div>
                </dl>
              </section>
            </>
          )}
        </div>
        {selected && (
          <aside className="dependency-selection" aria-label="Selected dependency ticket">
            <div className="section-heading">
              <h3>TT-{selected.id}</h3>
              <a className="text-button" href={`#ticket/${selected.id}`}>
                Open ticket
                <ArrowUpRight size={13} />
              </a>
            </div>
            <p className="dependency-selected-title">{selected.title}</p>
            <p className="muted">
              {statusMetadata[selected.status].label}
              {!nodeByID.has(selected.id) ? ' · Hidden by current filters' : ''}
            </p>
            {(['Blocked by', 'Blocks'] as const).map((label, i) => (
              <div className="dependency-relations" key={label}>
                <h4>
                  {label} <span className="count">{(i === 0 ? blockers : dependents).length}</span>
                </h4>
                <ul>
                  {(i === 0 ? blockers : dependents).map((t) => (
                    <li key={t.id}>
                      <a href={`#ticket/${t.id}`}>
                        <span className="ticket-id">TT-{t.id}</span>
                        {t.title}
                      </a>
                      <span>
                        {statusMetadata[t.status].label}
                        {i === 0 ? (t.status === 'done' ? ' · Satisfied' : ' · Unfinished') : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {!(i === 0 ? blockers : dependents).length && <p className="muted">None</p>}
              </div>
            ))}
          </aside>
        )}
      </div>
    </section>
  )
}
