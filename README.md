# dsh-gitlab-workbench

A DeepSeek Harness plugin: one **GitLab** entry in the left sidebar opens a global workbench for several self-managed GitLab instances (built for GitLab 17.x, REST API v4).

The panel's design mockups live in the repository's `designs/` directory.

## What it does

- **Several instances** — each keeps its own URL, TLS settings and personal access token; switch in the top bar.
- **Project rail** — search and switch projects without losing the pipeline view.
- **Overview** — counters, recent pipelines, branches and commits.
- **Pipelines** — list, stage timeline, jobs, the tail of a failed job's log, retry and cancel for pipelines and jobs.
- **Merge requests and issues** — list and read-only details, with a link into GitLab.
- **Files** — browse the repository tree and read text files.

## Architecture

```
src/
  host/                 the Node half: it owns tokens and talks to GitLab
    index.ts            exports apply(); registers the /gitlab-workbench/api route
    routes.ts           the route table and the admission check
    gitlab.ts           REST v4 client over node http/https (TLS, redirects, errors)
    store.ts            instance document (~/.dsh/gitlab-workbench) + credential records
    types.ts            structural types for the runtime services it resolves
  client/               the browser half: bundled by esbuild, React external
    index.ts            esbuild entry
    plugin.ts           locale detection, sidebar entry, main panel registration
    api.ts              same-origin calls to the host routes
    i18n.ts             zh/en dictionaries
    util.ts             formatting, status vocabulary, useAsync, persisted selection
    icons.ts            the line-icon set
    ui.ts               primitives: status, buttons, empty state, error note, meta grid
    types.ts            payload shapes returned by the host
    views/              one module per screen: panel, project, overview, pipelines,
                        mergeRequests, issues, files, settings
    styles/app.css      the panel stylesheet, imported as text and injected
designs/gitlab-workbench/   the design mockups the panel follows
test/                       mock GitLab, host route checks, client smoke + e2e, preview shell
```

The host half never ships a token to the browser: the client only receives normalized instance metadata, and every GitLab call is made by `gitlab.ts`.

## Build

```powershell
npm install
npm run build          # tsc -> dist/host, esbuild -> dist/client.js
npm run typecheck
```

`build.mjs` wraps the esbuild CJS bundle in the DSH module-loader format

```js
window.__ModuleLoader__.load({ id, factory(require) { ... } })
```

with `react` left external, so the page's React instance is used.

## Install

Install this directory as a bundle (Plugins → Add plugin, or the plugin manager with this path). A new bundle needs a DSH restart before the host half is live; refreshing the page after that loads the panel.

## Tokens

Each instance uses a personal access token:

- `read_api` for the read-only views;
- `api` for pipeline and job retry/cancel.

Tokens are stored by the host credential service under `gitlab-workbench/<instance id>`. The instance list lives in `~/.dsh/gitlab-workbench/instances.json`.

## Tests

The suite runs against the bundled mock GitLab:

```powershell
node test/mock-gitlab.js 18080
npm test                 # build, host routes, client smoke, jsdom end-to-end
```

`test/preview-server.mjs` serves the built panel with a fake shell for a quick browser look.
