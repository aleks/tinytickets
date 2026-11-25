# Static documentation website

This directory contains a separate website for TinyTickets documentation.
It does not replace the Go application or its embedded React frontend.
It does not connect to a running TinyTickets instance.

## Build

Use Node **22.13+**. No package installation is required. The builder uses only
Node's standard library.

```sh
npm --prefix site run build
```

Publish the **contents of `site/dist/`**. This directory contains complete HTML
pages, local CSS, an SVG icon, and the 19 existing demo screenshots. The build
copies images from `site/screenshots/`; it does not change them or the demo database.
Keep `site/screenshots/` in the checkout used for the build. These source images
belong to the documentation site. Published pages use copies in `assets/screenshots/`.

`site/dist/` is ignored by Git. It is generated, not an authoring directory.
The builder replaces only an output directory with its generated-output marker.
If a different `site/dist/` already exists, move it before building.

## Preview

```sh
npm --prefix site run dev
```

Open **http://127.0.0.1:4173**. Use `PORT=4174 npm --prefix site run preview` to
select another port after building. The preview binds to loopback. It does not
start, stop, or proxy the application on port 8080.

## Check

```sh
npm --prefix site run check
```

This command builds the site and runs Node tests. Tests check local links, section
targets, image metadata, exact image copies, navigation state, deterministic
output, output ownership, and the static preview server.

The repository-level `make check` includes these checks and the site browser
checks alongside the application checks. Use the separate commands below when
you work only on this documentation site.

Browser checks use the repository's existing Playwright development dependency:

```sh
npm --prefix web ci
npm --prefix web exec -- playwright install chromium
npm --prefix site run check
npm --prefix site run test:browser
```

The browser checks start their own static servers on dynamic loopback ports.
They test every page at the root and at `/tinytickets/`, in both light and dark
mode. Viewports include desktop and 320/390-pixel mobile widths. Checks cover
keyboard navigation, images, and horizontal overflow. They do not connect to
the application database or start a Go server. Set `SITE_SCREENSHOTS` to an output
directory to save visual-review captures. Do not commit generated test captures.

## Publish on GitHub Pages

The target URL is **https://aleks.github.io/tinytickets/**. The workflow is
prepared in `.github/workflows/documentation.yml`. No deployment occurs until
the workflow is pushed and GitHub Pages is configured.

When you are ready to publish:

1. In the `aleks/tinytickets` repository, open **Settings → Pages**.
2. Select **GitHub Actions** as the source. Do not set a custom domain.
3. Merge and push the website sources and workflow to `main`.
4. Open **Actions → Publish documentation** and inspect the run.
5. Open the target URL after the deploy job succeeds.

Later pushes to `main` publish changes to `site/**` or the workflow. You can also
select **Run workflow** on `main` to publish without a source change. A manual run
on another branch builds and checks the site but cannot deploy it. If required,
review the `github-pages` environment's deployment protection rules.

The build job needs only Node.js. It runs the site checks and uploads only
`site/dist/`. It does not publish the repository root, application files, or a
local database. A separate deploy job receives Pages and OIDC write permissions;
the build job has read-only repository access. Action versions are pinned to
commit hashes. No personal token, application server, or database is required.
The workflow follows the official
[static Pages workflow](https://github.com/actions/starter-workflows/blob/main/pages/static.yml).

All page and asset paths are relative. The same output works at a domain root or
a GitHub project subpath. No base URL, server-side rendering, SPA fallback, API,
CDN, web fonts, analytics, or client-side JavaScript is required.

Do not add a `CNAME` file for this project URL. The existing browser checks verify
all pages and assets under `/tinytickets/`. They run locally and in `make check`;
the deployment workflow runs the dependency-free site checks only.

## Publish on another static host

Use these settings when the host builds from the repository:

| Setting           | Value                         |
| ----------------- | ----------------------------- |
| Working directory | Repository root               |
| Build command     | `npm --prefix site run build` |
| Publish directory | `site/dist`                   |
| Node version      | 22.13 or later                |

For a manual upload, build locally and upload the contents of `site/dist/`.
Keep the relative directory structure. Do not enable an SPA redirect rule.

This publishes documentation only. TinyTickets itself needs its Go server and
SQLite database. Do not expose that application without an appropriate security
boundary.

## Edit content and design

The Connect section has a REST API reference (`api.html`), an MCP capability
reference (`mcp.html`), and the coding-agent workflow guide (`agents.html`).
Keep routes and tool fields consistent with the backend and `docs/reference.md`.

- Edit `content.mjs` for page text and navigation.
- Edit `assets/style.css` for layout, responsive rules, and system dark mode.
- Edit `build.mjs` for the shared page template.
- The shared logo and favicon come from `web/public/paper-trail.svg`.
  The build copies this canonical asset; CSS masks apply each site's accent color
  without a background tile or rotation. Functional ticket icons are separate from
  the logo asset.
- Keep screenshots and their capture manifest in `site/screenshots/`.
- Rebuild and run the checks after changes.

The writing uses short sentences, active voice, direct procedures, and consistent
technical terms. It follows ASD-STE100 principles. This is a writing target, not
a claim of formal vocabulary validation or certified compliance.

The design is a documentation layout: sidebar navigation, local section links,
tables, code examples, and captioned screenshots. There is no marketing banner,
pricing section, tracking, or nonfunctional search control.
