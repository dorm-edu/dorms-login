# dorms-login

English | [한국어](./README.ko.md)

Adds a **"Sign in with DoRms"** button to a teacher-built site. Members sign in with their DoRms (https://dorms.school) account, and access rules such as *verified teachers only* or *at least N dorms* are enforced by DoRms at sign-in time. It works like adding "Sign in with Google".

## Start

1. Register the site at https://dorms.school/connect (verified DoRms teachers only). Enter the site URL and choose who may enter.
2. Copy the prompt shown there into your AI coding tool. It runs:

~~~bash
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.1.0.tar.gz detect
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.1.0.tar.gz init --client-id <site id> --site https://your-site [--require-teacher] [--min-dorms 10] [--email]
npx -y https://github.com/shinnanchanguk/dorms-login/archive/refs/tags/v0.1.0.tar.gz doctor
~~~

`init` adds six files to a Next.js App Router project and two non-secret environment variables (`DORMS_CLIENT_ID`, `DORMS_SITE_URL`). There is no client secret; PKCE and exact redirect URI matching bind the flow. Other stacks: see [docs/PROTOCOL.md](./docs/PROTOCOL.md) (standard OAuth 2.1 authorization code + PKCE with an OpenID discovery document).

## What is shared

Only what the member allowed on the consent screen: display name, avatar, teacher-verified flag, dorm count, and email only when the site enabled it and the member allowed it. Passwords and DoRms sessions never leave DoRms. Members can disconnect a site at any time.

Made by Hong Changuk (Team DoRm). [LICENSE](./LICENSE) · [SECURITY.md](./SECURITY.md)
