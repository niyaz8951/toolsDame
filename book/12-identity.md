# Identity and sessions, in detail

Contract 1: one person is one account id. Tools have no logins, no passwords and no user lists.

## Where an account lives
- The **sign-in service** (Supabase Auth) knows the account: email, hashed password, and issues tokens. It knows nothing about roles.
- The **core** knows the person: `core.profiles` with `id` (the same id as in the sign-in service), `email`, `name`, `status` (`pending`, `active`, `disabled`), `is_it`, and since file 009 `username`, `must_change`.
- A valid token alone opens nothing. Every function first asks the core who this is.

## The three ways an account is made
| Way | Who starts it | What happens | Status at first sign-in |
|---|---|---|---|
| New user | IT admin, IT admin page | `dame_user_create(username, name, temporary password)` writes the account into the sign-in service and the profile into the core | Active, but `must_change`: everything is refused until the password is replaced |
| Add by work email | IT admin | `dame_user_add(email, name)` stores the address in `core.invites`. The person signs up himself | Active at once |
| Request access | The person | He signs up; `dame_request_access()` makes a profile | Pending until an IT admin approves |

## New user, step by step
1. The IT admin page calls `dame_user_create`. First line: `core.require_it()`.
2. The database checks the username (`^[a-z0-9][a-z0-9._-]{2,29}$`) and the temporary password (10 to 72 characters with a small letter, a capital and a digit).
3. It hashes the password with the database's own `crypt` function (bcrypt) and writes one row into `auth.users` and one into `auth.identities`, under the inner address `<username>@users.dame.internal`, marked as confirmed.
4. It writes the profile: active, `must_change = true`, and the hash again in `temp_hash`.
5. The audit gets `user.created` with the username and who made it. The password is nowhere in the audit.
6. The person signs in with username and temporary password. The start page adds the inner domain to a name without "@".
7. `dame_request_access()` answers `must_change: true`; the start page shows "Choose your own password".
8. The browser sends the new password to the sign-in service (`PUT /auth/v1/user`), which refuses re-using the same password.
9. The browser calls `dame_password_done()`. The database compares the hash now stored in the sign-in service with `temp_hash`. Only if it differs, `must_change` is cleared.
10. Until then `core.require_user()` answers `must_change` to every function. Typing the hub's address changes nothing: the database refuses.

**Why the database checks the hash itself:** a page could simply claim "I changed it". The database trusts nothing the page says.

## Sessions
- The sign-in service puts a `session_id` in every token. `core.require_login()` writes it into `core.sessions` the first time it sees it, and that first sight is what the audit records as `user.signed_in`.
- A session is honoured only if: it belongs to this account, it is not ended, it is the **newest** session of this account, and it was first seen less than 12 hours ago.
- So signing in on a second device ends the first one at its next click. Sign-out and "switch off" end the session at once.
- Beside the session, a browser tab keeps only the addresses of the site's pages it visited (`dame.trail`, gone when the tab closes), so a Back button can return to the page before.
- The browser keeps the tokens in its storage for the site (`dame.session`) and renews the short-lived access token with the refresh token until the 12 hours are over.

## What every function asks, in order
`signed_out` (no valid token) > `session_ended` (older session, ended, or past 12 hours) > `no_profile` > `pending` > `disabled` > `must_change` > then the role or level for this action (`not_allowed`).

Each answer is a short code plus a sentence for the person. Pages react to the code; the sentence is shown as it is.

## Why this way
- **Approval by a person** because email proof alone would let in anyone with a matching address.
- **One session** because it is the simplest rule that makes "I left my laptop signed in" harmless after the next sign-in, and it holds on any plan of the sign-in service.
- **Accounts are never deleted**, only switched off, so the audit and the "who added this row" columns always point at someone.

## Considered and not done
- **Passwords set by IT and kept**: rejected. A temporary password that must be replaced is the most IT ever knows.
- **Creating accounts with the service's admin key**: that key would have to live somewhere. Rejected: no secret key exists anywhere in this project.
- **Turning email confirmation off to make sign-up smoother**: rejected. The domain rule and "add by email" both rely on the address being proven.

## Limits, said plainly
- Email and password are a stand-in. There is no second factor in the demo.
- The sign-in service itself still honours an older session; only our functions refuse it. Since nothing else is reachable, that is enough here.
- An account made with a username has no email: a forgotten password needs IT, and there is no reset button for IT yet.
- `dame_user_create` writes into the sign-in service's own tables. That is a demo shortcut and the part most tied to Supabase.
