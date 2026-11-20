# Intersectionist Party website

The public site and membership software for [The Intersectionist Party](https://intersectionist-party.davidtcheng.chatgpt.site/). The site publishes the party's [GPT disclosure](https://intersectionist-party.davidtcheng.chatgpt.site/#gpt-disclosure). This repository contains the site and membership system. GPT-based survey tools or analysis pipelines are outside its current scope.

## Build

Run `node scripts/build.mjs` from the repository root with Node.js 22 or later. There are no package dependencies. The build writes `dist/server/index.js`, a Cloudflare Worker module.

- `public/` contains the homepage and assets.
- `worker/` contains page templates, routes, and email authentication.
- `drizzle/` contains the D1 schema migrations. Apply them in numerical order to a new database and bind it to the Worker as `DB`.

## Configure email sign-in

| Runtime variable | Value |
| --- | --- |
| `ORGANIZER_EMAIL` | The verified email address allowed to use the organizer page at `/organize`. |
| `MEMBERSHIP_SITE_ORIGIN` | The full HTTPS origin of your deployment. Set this for a fork so sign-in and unsubscribe links point to your site. |
| `MEMBERSHIP_EMAIL_FROM` | The sender address on a verified Resend domain. |
| `RESEND_API_KEY` | A sending key. Set this as a runtime secret. |
| `MEMBERSHIP_RATE_SECRET` | A randomly generated secret for hashing sign-in rate-limit identifiers. Set this as a runtime secret. |

A standalone build uses email sign-in. On Sites, members can join with a free ChatGPT account. The app reads identity headers supplied by the authenticated Sites gateway when the build includes an installation-specific `.openai/hosting.json`. Only supply that manifest when deploying through the Sites gateway that strips caller-supplied identity headers. Keep the manifest and secret values out of commits to this repository.

## License

The software is available under the [MIT License](LICENSE). The included homepage image and party overview are provided as site assets. Please keep live member records and credentials out of issues, pull requests, and forks.
