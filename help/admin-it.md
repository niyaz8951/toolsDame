# IT admin

1. **Waiting for approval.** People who asked for access wait here. Approve only people you know; check the email address.
2. **Add a person.** Press **New user**, write a username, a display name and a temporary password (or press Generate). Tell the person both by voice. At the first sign-in the site asks for a new password; nothing opens before that. No email is needed. The second way, "Or add by work email", approves an email address in advance: that person signs up himself and is in at once.
3. **People.** One line per person. Press **Open** to see the account: when the person last signed in, what he can open, his details. In that window, and only there, you correct the name and work details, reset a password, switch a leaver off (he loses everything at his next click) or make someone IT admin. Another IT admin changes your own account.
4. **Site settings.** Who may ask for access (the work email domains), and the AI prompt button.
5. **Spaces.** Press **Add a space**: give it a name, an id (permanent, never used again) and its first admin. That admin then makes the tools. Each space is a tile below. Press a tile to open that space: there, and only there, you change its admins, switch it off or delete it. Press Done to close.
6. **Quotas.** How much of the database a space may use: rows in the whole space, tables in one tool, columns in one table. **Change the default** sets what every space gets. Each space is a tile with what it uses; press it to give that space limits of its own or to put it back on the default. A tile marked "Request waiting" holds a request from the space's admin: open it, change the numbers if you want to give less or more, then **Grant** or **Decline** (twice). Declining needs a note; the admin reads it.
7. **Audit.** Who did what, when. Nothing here can be changed or deleted.

## Reset a forgotten password
1. Be sure who is asking: call the person back on a number you know.
2. People, **Open** on the person, **Generate**, then **Reset password** twice.
3. Tell the person the temporary password by voice. It is shown only until you close the window, and counts for 7 days.
4. The person is signed out everywhere, signs in with it, types it once more and chooses a new password. Nothing opens before that.

## Good to know
- A full space still reads, changes and deletes; only new rows are refused. A limit below what a space already uses deletes nothing.
- A "Back to ..." button takes you to the page you came from, on the tab you left it on.
- Being IT admin does not open a department's data. To look inside a space, name yourself its admin; that is written in the audit.
- A person added here still has to prove the email address is his (the confirmation email), unless that was switched off in the sign-in service.

Site rules: `docs/BEDROCK.md`. Security rules: `docs/SECURITY.md`.
