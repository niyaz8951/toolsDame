# Identity and sessions, in detail

Contract 1: one person is one account id. Tools have no logins, no passwords and no user lists.

## Where an account lives
- The **sign-in service** (Supabase Auth) knows the account: email, hashed password, and issues tokens. It knows nothing about roles.
- The **core** knows the person: `core.profiles` with `id` (the same id as in the sign-in service), `email`, `name`, `status` (`pending`, `active`, `disabled`), `is_it`, `username`, `must_change`, and the work details (`job_title`, `department`, `office`, `phone`, `staff_no`) and when the password was last chosen.
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
9. The browser calls `dame_password_done(temporary password)`. The database compares the hash now stored in the sign-in service with `temp_hash`, and checks the temporary password it was given against `temp_hash`. Only if the stored password differs and the temporary one is right, `must_change` is cleared. A temporary password older than 7 days is refused.
10. Until then `core.require_user()` answers `must_change` to every function. Typing the hub's address changes nothing: the database refuses.

**Why the database checks the hash itself:** a page could simply claim "I changed it". The database trusts nothing the page says.

## A person's own account
- `account.html` calls `dame_account_get()`: name, sign-in, staff number, role, work details, the spaces and tools he can open with his level, his last ten sign-ins (from the audit). The function takes no user id, so there is nothing to tamper with.
- `dame_account_set(job title, department, office, phone)` changes his work details only. Text is tidied (no control characters, single spaces, cut to length); a phone may hold digits, spaces and `+ ( ) . / -`. The audit names the fields, not the values.
- Name, username and staff number are IT's: `dame_user_details_set`. A changed name is in the audit with old and new.

## Changing the password
1. The page asks for the password he has now and makes a real sign-in with it, which it closes at once and never uses. Wrong: nothing happens.
2. The new password goes to the sign-in service (`PUT /auth/v1/user`).
3. `dame_password_changed()`: the database compares a fingerprint of the stored hash (`pw_mark`) with the one it kept. Only if it differs it writes the date and `user.password_changed`.
4. He stays signed in; the session rule does not change.

## Reset by IT, step by step
1. IT admin page, People, Open, Generate, Reset password (two presses). `dame_user_password_reset(person, temporary password)`: `core.require_it()`, not himself, only an active account, the same rule for the temporary password as for a new account.
2. The database writes the new hash into `auth.users`, sets `must_change`, keeps the hash in `temp_hash` with who and when, ends his sessions in `core.sessions` and removes his rows in the sign-in service's `auth.sessions`.
3. The audit gets `user.password_reset` with both names. The password is nowhere in it.
4. From here it is the new-user path: sign in with the temporary password, choose a new one, `dame_password_done(temporary password)`.

**Why the temporary password is asked again at the end:** a reset is often asked because someone else may know the password. That someone may still hold a sign-in for up to an hour. He could set a password of his own in the sign-in service and sign in with it. He still gets nothing: the database wants the temporary password, which only IT and the person know.

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
- A forgotten password always needs IT (by voice). There is no reset by email: accounts with a username have none.
- An IT admin can reset anyone's password, another IT admin's too, and could then sign in as that person. It is in the audit with both names, the person's own password stops working, and he is told who did it at his next sign-in. Company sign-in removes the path: IT sets no passwords there.
- The rule for a person's own password (12 characters, mixed) is checked by the page and by the sign-in service's minimum length. The database never sees a password, so it cannot check one.
- `dame_user_create` and `dame_user_password_reset` write into the sign-in service's own tables. That is a demo shortcut and the part most tied to Supabase.
