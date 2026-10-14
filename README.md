# dorms-login

English | [한국어](./README.ko.md)

Add a **Sign in with DoRms** button to a teacher-built site. Teachers register an application at [DoRms Connect](https://dorms.school/connect), choose who may enter, and paste the generated prompt into their coding assistant.

## Install

```sh
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.4.0.tar.gz detect
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.4.0.tar.gz init --client-id '<site id>' --site 'https://example.com'
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.4.0.tar.gz doctor
```

Automatic installation supports Node.js 22+, TypeScript, Next.js 15+ App Router, and sites served from the root of an HTTPS origin. Subpaths/basePath, Pages Router, JavaScript-only projects and browser-only apps need a manual integration using [the HTTP contract](./docs/PROTOCOL.md). Generated `app/` and `src/app/` projects are production-build tested against Next.js 15.5.26. Other framework versions need their own build and integration checks.

`init` adds six integration files, an installation manifest `.dorms-login.json`, `jose`, and the public environment variables `DORMS_CLIENT_ID` and `DORMS_SITE_URL`. Set the same environment variables on your host. No client secret is used. Existing files are preserved.

## Protect pages and data

Render `DormsLoginButton` on your login page. Use `await requireDormsUser({ next: "/dashboard" })` in protected server-rendered pages. **Also call `getDormsUser()` before reading or writing protected data in every API route and server action.** A login button or page guard alone does not secure a data endpoint. Keep resource ownership checks as well.

Every `getDormsUser()`, `requireDormsUser()` and `refreshDormsUser()` call verifies the ID token and checks current permission with DoRms. Do not cache authorization across requests or fall back to old claims if DoRms is unavailable. Disconnection, site suspension and policy changes take effect on the next protected request, including requests made with an already issued token.

`getDormsUser()` and `refreshDormsUser()` return `null` for a missing, expired or legacy session. They throw `DormsAuthError` for denied access (`reason: "access_denied"`, `status: 403`) or an unavailable provider (`reason: "temporarily_unavailable"`, `status: 503`). API handlers must return the corresponding error before accessing data. `requireDormsUser()` starts login only when authentication is needed; denial and outages go to a stable explanation page, without a redirect loop.

Email scope is obtained from the current provider configuration at login. Default policy is enforced by DoRms, not copied into the application. Explicit additional restrictions remain available through `requireDormsUser({ requireTeacher: true, minDorms: 10 })`. Use the stable member `id` for identity, never email. See [the Korean guide](./README.ko.md) for working page, logout and API examples.

## Upgrade existing sites

```sh
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.4.0.tar.gz upgrade
```

Only unmodified files recorded in the manifest are replaced automatically. Customized or legacy v0.1.0 files remain untouched; new reference files and diffs are written to `.dorms-login/review/`, and the command exits with code `1`. Merge the changes, run type/build checks and actual login/revocation tests, then run `upgrade --accept-reviewed` to record the review. This does not overwrite custom files, and future upgrades continue to preserve them. Publishing a new tool version does not update already installed sites by itself.

DoRms never sends passwords or its own session cookies to your site. Members consent to profile data and optional email. This package implements authorization code + PKCE and a documented core OIDC login flow, not every OIDC feature or universal compatibility with every client library.

[SECURITY.md](./SECURITY.md) · [HTTP contract](./docs/PROTOCOL.md) · [MIT license](./LICENSE)

## Optional Doreumi outfit (v0.4.0)

Show the member's Doreumi as dressed on DoRms (equipped items and three colors), and optionally play Doreumi motions. Turn on "도름이 착장도 받기" for the site on dorms.school/connect, then run `upgrade --doreumi` (or `init --doreumi`). Call `getDormsDoreumi()` on the server; it returns `null` unless the member allowed the outfit. Item files are served through `/api/auth/dorms/doreumi/items/<id>` so the DoRms token never reaches the browser. Use outfits only to show that member's own Doreumi. Doreumi (character, model, motions) is by AinT, CC BY-NC 4.0; keep the attribution visible. See [PROTOCOL.md](./docs/PROTOCOL.md#도름이-착장-선택-기능-v040).

## Optional donations (v0.3.0)

Let people sign in to your app with DoRms and give each other DoRms there. First, the site owner clicks **도름네이션 설치 프롬프트 복사** (copy donation installation prompt) on the app's card at [DoRms Connect](https://dorms.school/connect). This automatically submits the application and sends a message to Hong Changuk in the owner's name. Copying the login prompt or running the CLI installation alone does not submit an application.

Give that prompt to your coding assistant. Run `upgrade --donations` for an existing installation, or add `--donations` to `init`. Default login installation and scopes are unchanged. Site administrator approval and one-time member consent are required before sending. Each transfer decreases the sender's cumulative DoRms and increases the recipient's, affecting rankings. Received amounts count toward weekly and monthly rankings; sent amounts count toward the cheer captain ranking. Recipients can also spend the DoRms in the shop. The limit is 3 DoRms per member per KST calendar day across all apps. This accounting is handled by the provider, so sites that already installed donations get it without reinstalling.

See [the copy-paste AI prompt](USE-WITH-AI.md#도름네이션도-붙이기) and [the donation protocol](docs/PROTOCOL.md#도름네이션-선택-기능-v030). Production credentials stay in host-only Secure HttpOnly cookies. Modified integration files are preserved for review during upgrades.
