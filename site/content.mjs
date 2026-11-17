export const repository = 'https://github.com/aleks/tinytickets'

export const navigation = [
  { label: 'Start', pages: ['index', 'start'] },
  { label: 'Use TinyTickets', pages: ['work', 'tickets', 'dependencies', 'progress', 'safety'] },
  { label: 'Connect', pages: ['agents'] },
  { label: 'Reference', pages: ['screenshots'] },
]

export function createPages({ figure, code, gallery }) {
  return [
    {
      slug: 'index',
      title: 'Overview',
      group: 'Start',
      description:
        'Learn what TinyTickets does. Inspect its boards, work logs, dependency maps, and recorded execution history.',
      lead: 'TinyTickets is a local ticket system for people and coding agents. Use it to organize work, record decisions, and prepare reviews.',
      sections: [
        {
          id: 'purpose',
          title: 'What TinyTickets does',
          html: `
          <p>One Go program serves the application, a REST API, and a Model Context Protocol (MCP) server. SQLite stores the data.</p>
          <p>Create a project. Group its work into epics. Add tickets to each epic. Use the board to inspect status and dependencies.</p>
          ${figure('03-project-board.png', 'A project board with Todo, In progress, Ready for review, and Done columns.', 'The project board shows status, blocked work, and current-column timers.')}`,
        },
        {
          id: 'start',
          title: 'Choose a starting point',
          html: `
          <ol>
            <li><a href="start.html">Run TinyTickets</a> on your computer.</li>
            <li><a href="work.html">Create a project and tickets</a> for your work.</li>
            <li><a href="agents.html">Connect a coding agent</a> if you want it to track work.</li>
          </ol>
          <div class="notice"><p>This website is documentation. It does not run the ticket application or connect to your database.</p></div>`,
        },
        {
          id: 'features',
          title: 'Feature reference',
          html: `
          <div class="table-scroll"><table><caption>Main application features</caption><thead><tr><th scope="col">Area</th><th scope="col">Use it to</th></tr></thead><tbody>
            <tr><th scope="row"><a href="work.html">Projects and boards</a></th><td>Group tickets and inspect work across four status columns.</td></tr>
            <tr><th scope="row"><a href="tickets.html">Ticket pages and logs</a></th><td>Keep the specification, notes, and review context together.</td></tr>
            <tr><th scope="row"><a href="dependencies.html">Dependency maps</a></th><td>Find blockers and trace work across projects.</td></tr>
            <tr><th scope="row"><a href="progress.html">Execution insights</a></th><td>Inspect recorded work time, review time, and completions.</td></tr>
            <tr><th scope="row"><a href="agents.html">Agent access</a></th><td>Use MCP to claim work and add progress notes.</td></tr>
            <tr><th scope="row"><a href="safety.html">Archives and deletion</a></th><td>Preserve completed work or confirm its permanent removal.</td></tr>
          </tbody></table></div>`,
        },
        {
          id: 'limits',
          title: 'Scope and limits',
          html: `
          <ul><li>The application has no built-in user authentication.</li><li>A claim starts a ticket. It does not assign an owner or lock the ticket.</li><li>Execution time is recorded status time. It is not a measure of effort.</li><li>Archive work to retain its history. Deletion has no undo.</li></ul>
          <p>The screenshots use fictional projects and notes. Their activity was recorded through the application with real timestamps. <a href="screenshots.html">Inspect the screenshots</a>.</p>`,
        },
      ],
    },
    {
      slug: 'start',
      title: 'Run TinyTickets',
      group: 'Start',
      description:
        'Build and run TinyTickets locally. Find the database and understand the local network boundary.',
      lead: 'Build the program, start it, and open the local application. Node.js is not required when you use the checked-in frontend.',
      sections: [
        {
          id: 'requirements',
          title: 'Check the requirements',
          html: `
          <ul><li>Install Go 1.26 or later.</li><li>Install Git to obtain the source.</li><li>Use a current web browser.</li></ul>
          <p>The program uses SQLite without CGO. It does not require a separate database server.</p>`,
        },
        {
          id: 'build',
          title: 'Build the program',
          html: `
          <ol><li>Get the source.</li><li>Open the repository directory.</li><li>Build the program.</li></ol>
          ${code('git clone https://github.com/aleks/tinytickets.git\ncd tinytickets\ngo build -o tinytickets .')}
          <p>The Go compiler reads the checked-in frontend files. Install Node.js only if you need to change those files.</p>`,
        },
        {
          id: 'run',
          title: 'Start the application',
          html: `
          ${code('./tinytickets')}
          <p>Open <code>http://127.0.0.1:8080</code> in your browser.</p>
          <p>To select an address and database, use:</p>
          ${code('./tinytickets --addr 127.0.0.1:8080 --db /absolute/path/to/tickets.db')}
          <p>Use <code>./tinytickets --help</code> to inspect the available options.</p>`,
        },
        {
          id: 'data',
          title: 'Keep the data safe',
          html: `
          <p>The default database is <code>~/.tinytickets/tinytickets.db</code>. Changes persist in that database.</p>
          <p>For a backup of a running database, use the SQLite backup command. Do not copy only the database file while write-ahead logging is active.</p>
          <p>You can also stop all processes that use the database. Then copy the database file.</p>
          <div class="notice warning"><p><strong>Keep the application on a trusted network.</strong> TinyTickets has no built-in authentication. Use an authenticated reverse proxy if remote access is required.</p></div>`,
        },
        {
          id: 'next',
          title: 'Create the first project',
          html: `
          <p>Select <strong>New project</strong>. Give the project a short name. Then create an epic and add a ticket.</p>
          <p>Continue with <a href="work.html">Projects and boards</a>. For build commands and API details, use the <a href="${repository}/blob/main/README.md">repository reference</a>.</p>`,
        },
      ],
    },
    {
      slug: 'work',
      title: 'Projects and boards',
      group: 'Use TinyTickets',
      description:
        'Understand projects, epics, ticket status, board filters, and current-column timers.',
      lead: 'A project contains epics. An epic contains tickets. Each ticket describes one unit of work.',
      sections: [
        {
          id: 'hierarchy',
          title: 'Organize the work',
          html: `
          <ol><li>Create a project for a product or work area.</li><li>Create an epic for a related group of tasks.</li><li>Create a ticket for each task.</li></ol>
          <p>Every epic must belong to a project. Every ticket must belong to an epic.</p>
          ${figure('02-projects.png', 'Three project cards with the number of visible epics.', 'Use the Projects page to open a project. Archived epics are not included in these visible counts.')}`,
        },
        {
          id: 'status',
          title: 'Use the four status columns',
          html: `
          <div class="table-scroll"><table><caption>Ticket status</caption><thead><tr><th scope="col">Status</th><th scope="col">Meaning</th></tr></thead><tbody>
            <tr><th scope="row">Todo</th><td>The ticket has not started, or it was returned to the queue.</td></tr>
            <tr><th scope="row">In progress</th><td>Work is in progress.</td></tr>
            <tr><th scope="row">Ready for review</th><td>The work is available for a reviewer.</td></tr>
            <tr><th scope="row">Done</th><td>The work is complete.</td></tr>
          </tbody></table></div>
          <p>Drag a card to change its status. You can also change status on the ticket page.</p>
          <p>Dependencies provide information. Ordinary status changes do not enforce dependency readiness.</p>`,
        },
        {
          id: 'views',
          title: 'Select a board scope',
          html: `
          <ul><li>The overview shows work from active epics across projects.</li><li>A project board shows its unarchived epics and tickets.</li><li>An epic board shows tickets from that epic.</li></ul>
          <p>Completed epics are hidden from the overview. They remain available on their project page. Use search to narrow the displayed work.</p>
          ${figure('05-epic-board.png', 'A board that shows only tickets in the Workspace experience epic.', 'An epic board reduces the displayed scope without moving tickets.')}`,
        },
        {
          id: 'timers',
          title: 'Read the card timer',
          html: `
          <p>In progress and Ready for review cards show time in the <strong>current column</strong>. A move to another column resets that counter.</p>
          <p>Editing a title does not reset the counter. Reloading the page does not reset it. Todo and Done cards have no timer.</p>
          <p>If the column start time is unknown, the application shows that timing is unavailable. It does not infer a start from the last edit.</p>`,
        },
        {
          id: 'appearance',
          title: 'Change the application appearance',
          html: `
          <p>Use the theme control at the bottom of the application sidebar to select light or dark mode. Select <strong>Choose accent color</strong> to change the accent.</p>
          <p>On a narrow screen, open the navigation to reach these controls. Appearance preferences stay in the browser. They do not change the application database.</p>
          ${figure('17-appearance-controls-dark.png', 'The application in dark mode with its accent-color choices open.', 'Application appearance controls. This documentation website follows your system theme.')}`,
        },
      ],
    },
    {
      slug: 'tickets',
      title: 'Tickets and reviews',
      group: 'Use TinyTickets',
      description:
        'Use rich ticket descriptions, append-only work logs, and structured review handoffs.',
      lead: 'Keep the task specification in the description. Add progress and review context to the work log.',
      sections: [
        {
          id: 'description',
          title: 'Write the specification',
          html: `
          <p>Open a ticket from the board. Select its title in the editor to open the full ticket page.</p>
          <p>Descriptions support Markdown, tables, task lists, and Mermaid diagrams. The details panel shows status, epic, timestamps, and dependencies.</p>
          ${figure('06-ticket-markdown-mermaid.png', 'A ticket page with a checklist, sequence diagram, table, details panel, and work log.', 'The full ticket page keeps the specification and recorded updates together.')}`,
        },
        {
          id: 'notes',
          title: 'Add a work note',
          html: `
          <ol><li>Open <strong>Add an update</strong> on the ticket page.</li><li>Select <strong>Work note</strong>.</li><li>Record progress, a decision, a blocker, or a verification result.</li><li>Select <strong>Add log entry</strong>.</li></ol>
          <p>Entries are append-only. To correct an entry, add another entry. A note does not change ticket status or reset its timer.</p>
          <p>An author label is informational. It does not verify a person's identity.</p>`,
        },
        {
          id: 'handoff',
          title: 'Prepare a review handoff',
          html: `
          <p>Select <strong>Review handoff</strong> as the update type. Supply a summary and verification results. Add references and review notes if they are useful.</p>
          <p>Saving the handoff adds an entry and moves the ticket to Ready for review in one operation.</p>
          <p>A handoff does not approve the work. If the ticket is already in review, another handoff does not reset its review timer.</p>
          ${figure('07-work-log-review-handoff.png', 'A work note followed by a review handoff with verification, references, and review notes.', 'The handoff preserves the earlier note. This example describes fictional verification work.')}`,
        },
        {
          id: 'changes',
          title: 'Keep the review record',
          html: `
          <p>If review requires more work, return the ticket to In progress. Add the reason to the log.</p>
          <p>The current-column timer restarts. Execution history retains the earlier work and review intervals.</p>
          <p>When work is complete and verified, move the ticket to Done. Use the <a href="progress.html">Progress page</a> to inspect the recorded intervals.</p>`,
        },
      ],
    },
    {
      slug: 'dependencies',
      title: 'Dependencies',
      group: 'Use TinyTickets',
      description:
        'Inspect blockers, ready tickets, dependency chains, and context from other projects or archives.',
      lead: 'A dependency link points from a blocking ticket to the ticket that it blocks. Use the map to inspect the chain.',
      sections: [
        {
          id: 'links',
          title: 'Connect related tickets',
          html: `
          <p>Add a dependency in the ticket editor. One ticket can block several tickets. A ticket can also depend on several blockers.</p>
          <p>The server rejects dependency cycles. Links can cross epic and project boundaries.</p>
          ${figure('08-dependency-map.png', 'A left-to-right graph with completed prerequisites, active blockers, ready work, and external context.', 'Arrows point from blocker to dependent. The legend explains the line styles.')}`,
        },
        {
          id: 'ready',
          title: 'Identify ready work',
          html: `
          <p>A ticket is ready to start only when all these conditions are true:</p>
          <ul><li>Its status is Todo.</li><li>Its epic is unfinished and unarchived.</li><li>Every blocking ticket is Done.</li></ul>
          <p>Completing or archiving a blocker's epic does not satisfy the dependency. The blocking ticket must be Done.</p>
          <p>A blocked badge can also appear on active work if an unfinished blocker exists.</p>`,
        },
        {
          id: 'chain',
          title: 'Inspect a dependency chain',
          html: `
          <ol><li>Open the project's <strong>Dependencies</strong> tab.</li><li>Select a ticket.</li><li>Read its blockers and dependents in the details panel.</li><li>Use the chain filter to hide unrelated tickets.</li></ol>
          <p>Use Fit width, zoom, and scrolling to inspect large maps. Keyboard users can focus a ticket and press Enter.</p>
          ${figure('09-dependency-chain-dark.png', 'A selected launch ticket with its highlighted prerequisite chain and blocker panel.', 'The selected chain includes a platform ticket from another project.')}`,
        },
        {
          id: 'context',
          title: 'Keep hidden blockers visible',
          html: `
          <p>Directly linked tickets from other projects or hidden archives appear as dashed context cards.</p>
          <p>Use <strong>Expand external chains</strong> to inspect more connected work. Use <strong>Include archived epics</strong> to show otherwise hidden local archive tickets.</p>
          <p>Hide done tickets removes those cards and arrows from the view. It does not change readiness calculations.</p>`,
        },
      ],
    },
    {
      slug: 'progress',
      title: 'Execution insights',
      group: 'Use TinyTickets',
      description:
        'Read observed work and review intervals, completion metrics, and the limits of execution history.',
      lead: 'Open a project and select Progress. The page shows recorded execution, not a schedule or an estimate of effort.',
      sections: [
        {
          id: 'metrics',
          title: 'Read the summary metrics',
          html: `
          <ul><li><strong>Completed tickets:</strong> completed tickets compared with all project tickets.</li><li><strong>Active tickets:</strong> tickets In progress or Ready for review.</li><li><strong>Blocked tickets:</strong> unfinished tickets with unfinished blockers.</li><li><strong>Median completion time:</strong> sampled elapsed time from a known work start to completion.</li><li><strong>Observed work / review:</strong> summed recorded time in those columns.</li><li><strong>Oldest active ticket:</strong> elapsed time since a known lifecycle start, among active tickets with full history.</li></ul>
          <p>Parallel tickets overlap in time. Their sum is not project wall-clock time or agent effort.</p>
          ${figure('10-execution-insights.png', 'Summary metrics, a ticket execution timeline, not-started tickets, and daily completion counts.', 'The demo records real intervals over minutes. It does not contain backdated days of activity.')}`,
        },
        {
          id: 'timeline',
          title: 'Inspect the execution timeline',
          html: `
          <p>Expand an epic to inspect its tickets. Use the range control to change the displayed time span.</p>
          <p>The timeline retains repeated work and review intervals. An ongoing interval continues until the ticket changes status.</p>
          <p>The timeline is not a plan. It shows recorded status changes.</p>`,
        },
        {
          id: 'history',
          title: 'Distinguish missing history from zero time',
          html: `
          <p>A legacy ticket can have incomplete history. Unknown start times remain unavailable and are excluded from start-dependent samples.</p>
          <p>New Todo tickets appear under Not started. Tickets without usable recorded execution appear under Timing unavailable.</p>
          <p>Recorded completions count a ticket once at its first observed completion. A later reopen does not create another first completion.</p>`,
        },
        {
          id: 'archives',
          title: 'Understand the project scope',
          html: `
          <p>Archived epics are hidden from timeline rows. They remain in aggregate metrics and recorded completion counts.</p>
          <p>Moving work changes its current project membership. Deleting work removes its contribution to reports.</p>
          <p>For exact sample and timing rules, use the <a href="${repository}/blob/main/README.md#history-and-metric-definitions">metric reference</a>.</p>`,
        },
      ],
    },
    {
      slug: 'agents',
      title: 'Connect a coding agent',
      group: 'Connect',
      description:
        'Connect through MCP and use atomic claims, work notes, and review handoffs without treating a claim as ownership.',
      lead: 'Model Context Protocol (MCP) lets an agent read and update the same workspace that you inspect in the browser.',
      sections: [
        {
          id: 'transport',
          title: 'Choose a connection',
          html: `
          <p>For a local client, use the stdio transport. The client starts the TinyTickets process.</p>
          ${code('/absolute/path/to/tinytickets --mcp-stdio --db /absolute/path/to/tickets.db')}
          <p>For an HTTP client, start TinyTickets normally. Connect the client to <code>http://127.0.0.1:8080/mcp</code>.</p>
          <p>Use the same database path for HTTP and stdio processes if they must share work.</p>
          <div class="notice warning"><p>A cloud agent cannot reach your computer through its own loopback address. Connect only trusted clients. TinyTickets has no built-in authentication.</p></div>`,
        },
        {
          id: 'workflow',
          title: 'Give the agent a work procedure',
          html: `
          <ol><li>Read the workspace with <code>get_workspace</code>.</li><li>Find or create the project, epic, and Todo ticket.</li><li>Use <code>claim_ticket</code> or <code>claim_next_ticket</code> before starting.</li><li>Use <code>add_work_log</code> for progress and decisions.</li><li>Use <code>create_review_handoff</code> when work is ready for review.</li><li>Record verification before marking work Done.</li></ol>
          <p>Keep the specification in the description. Put progress notes and verification results in the log.</p>
          <p>Configure repository instructions as well as the connection. MCP access alone does not make an agent follow this procedure.</p>`,
        },
        {
          id: 'claims',
          title: 'Use claims correctly',
          html: `
          <p><code>get_ready_tickets</code> is a planning read. It does not reserve work.</p>
          <p>A claim checks readiness and starts a ticket in one transaction. Two competing claims cannot both start the same Todo ticket.</p>
          <p>A claim does not assign an owner, create a lease, or lock later updates. Ordinary edits remain possible.</p>
          <p>If a claim fails, refresh the workspace and choose again. Do not bypass the failure with an ordinary status update.</p>`,
        },
        {
          id: 'guides',
          title: 'Use the client setup guides',
          html: `
          <p>The repository contains setup guides for OpenCode, Claude Code, Codex, and Cursor. It also contains policy and skill templates.</p>
          <ul><li><a href="${repository}/blob/main/docs/README.md">Client setup index</a></li><li><a href="${repository}/blob/main/docs/setup-for-agents.md">Setup procedure for agents</a></li><li><a href="${repository}/blob/main/docs/templates/repository-policy.md">Repository policy template</a></li></ul>
          <p>Do not overwrite existing client settings. Review the proposed settings before you apply them.</p>`,
        },
      ],
    },
    {
      slug: 'safety',
      title: 'Archive or delete work',
      group: 'Use TinyTickets',
      description:
        'Preserve completed work through archives, or confirm the permanent scope of a cascading delete.',
      lead: 'Archive work when you need to retain it. Delete work only when permanent removal is intended.',
      sections: [
        {
          id: 'archive',
          title: 'Archive a completed epic',
          html: `
          <ol><li>Complete the epic.</li><li>Open the epic page.</li><li>Select <strong>Archive epic</strong>.</li></ol>
          <p>Archiving preserves tickets, links, status history, and work logs. Direct epic and ticket links remain available.</p>
          <p>Use <strong>Show archived epics</strong> beside the project Epics heading to include archived cards in that list. Open an epic page to unarchive it.</p>
          <p>Unarchiving retains the completed state. Unarchive the epic before reopening it.</p>
          ${figure('13-project-archives-toggle.png', 'Archived and active epic cards in one project list with the archive toggle beside the heading.', 'The project toggle changes the epic list. It does not add archived tickets to the board.')}`,
        },
        {
          id: 'delete',
          title: 'Review the deletion scope',
          html: `
          <p>The deletion modal shows the resource name and aggregate impact. It does not list each child resource.</p>
          <p>Empty projects, empty epics, and tickets do not require force. Nonempty parents require an explicit <strong>Force delete</strong> selection.</p>
          <ul><li>Deleting a project can remove all its epics and tickets.</li><li>Deleting an epic can remove all its tickets.</li><li>Deleting tickets also removes their logs, handoffs, status history, and dependency links.</li></ul>
          <p>Completed and archived descendants are included. Linked tickets outside the selected hierarchy survive. Links to deleted tickets are removed. This can make some tickets ready.</p>
          ${figure('16-safe-force-delete.png', 'A project deletion modal with descendant counts, an external-link warning, and an explicit force checkbox.', 'This screenshot shows the confirmation only. No demo content was deleted.')}
          <div class="notice warning"><p><strong>Deletion has no undo.</strong> Deleted work no longer contributes to execution reports.</p></div>`,
        },
        {
          id: 'changes',
          title: 'Confirm a changed scope again',
          html: `
          <p>The server supplies a confirmation token with the preview. It checks that token inside the deletion transaction.</p>
          <p>If the scope changed, the server deletes nothing. The modal refreshes the preview and clears Force delete. Review the new impact before you confirm again.</p>
          <p>If a response is interrupted, do not assume the deletion failed. Refresh the state before another attempt. The application does not retry the write automatically.</p>`,
        },
        {
          id: 'api',
          title: 'Use the same safeguards with an agent',
          html: `
          <p>Call <code>get_deletion_preview</code> first. Nonempty parents require <code>force: true</code> and the reviewed <code>confirmation_token</code>.</p>
          <p>Force defaults to false. A preview does not grant permission to delete. An agent must not silently replace a stale token and retry.</p>
          <p>Use the <a href="${repository}/blob/main/README.md#deletion-previews-and-force-confirmation">deletion API reference</a> for request fields and error behavior.</p>`,
        },
      ],
    },
    {
      slug: 'screenshots',
      title: 'Screenshot reference',
      group: 'Reference',
      description:
        'Inspect real TinyTickets screenshots of boards, logs, dependencies, execution reports, archives, editors, and mobile views.',
      lead: 'These images show the application with three fictional projects. Select an image to open the original PNG.',
      sections: [
        {
          id: 'context',
          title: 'Understand the example data',
          html: `
          <p>The demo contains 7 epics, 24 tickets, and 20 dependency links. It includes 37 log entries and 8 review handoffs.</p>
          <p>The application recorded real status transitions during demo preparation. The timeline covers minutes, not invented days of activity.</p>
          <p>People, specifications, and verification narratives are fictional. The images do not claim real delivery results.</p>`,
        },
        {
          id: 'boards',
          title: 'Projects and boards',
          html: gallery([
            [
              '01-workspace-overview.png',
              'Workspace overview',
              'Active work across the three projects.',
            ],
            ['02-projects.png', 'Projects', 'Project cards and visible epic counts.'],
            ['03-project-board.png', 'Project board', 'All four statuses, blockers, and timers.'],
            ['04-platform-board-dark.png', 'Dark project board', 'The dark Slate appearance.'],
            ['05-epic-board.png', 'Epic board', 'Work scoped to one epic.'],
          ]),
        },
        {
          id: 'records',
          title: 'Tickets and records',
          html: gallery([
            [
              '06-ticket-markdown-mermaid.png',
              'Full ticket',
              'Rich content, details, and chronological notes.',
            ],
            [
              '07-work-log-review-handoff.png',
              'Work log and handoff',
              'Summary, verification, references, and review notes.',
            ],
            ['15-ticket-editor.png', 'Ticket editor', 'Fields and dependency controls.'],
          ]),
        },
        {
          id: 'execution',
          title: 'Dependencies and execution',
          html: gallery([
            ['08-dependency-map.png', 'Dependency map', 'Ready work and unresolved blockers.'],
            [
              '09-dependency-chain-dark.png',
              'Selected dependency chain',
              'Cross-project prerequisites and the details panel.',
            ],
            [
              '10-execution-insights.png',
              'Execution insights',
              'Observed intervals and completion counts.',
            ],
            [
              '11-platform-progress-dark.png',
              'Dark progress view',
              'Platform work and review timing.',
            ],
          ]),
        },
        {
          id: 'controls',
          title: 'Archives and controls',
          html: gallery([
            ['12-epics-and-archives.png', 'Epics and archives', 'The global epic listing.'],
            [
              '13-project-archives-toggle.png',
              'Project archive toggle',
              'Archived cards in the combined list.',
            ],
            ['14-archived-epic.png', 'Archived epic', 'Preserved work and restoration controls.'],
            [
              '16-safe-force-delete.png',
              'Deletion preview',
              'An impact preview; no deletion was submitted.',
            ],
            ['17-appearance-controls-dark.png', 'Appearance controls', 'Theme and accent choices.'],
          ]),
        },
        {
          id: 'mobile',
          title: 'Mobile views',
          html: gallery([
            ['18-mobile-ticket.png', 'Mobile ticket', 'Stacked rich content, log, and details.'],
            ['19-mobile-review-dark.png', 'Mobile review', 'A handoff in dark mode.'],
          ]),
        },
      ],
    },
  ]
}
