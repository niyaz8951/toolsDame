# Relay: work passed between teams

A company works as a value chain: an enquiry becomes a selection, a selection becomes an order, an order becomes a unit on site. The value is made or lost at each hand-over, and no single department owns the whole road. Spaces keep departments apart. Relay is the one place where work crosses them, and the database decides who holds it at every moment.

=> Sales | Application | HQ-AES | Product team (if needed) | Factory

## How it works
:::lanes
IT | Sets up a flow: its stages in order, the team (a space) of each, and the checklist to tick before passing on
First team | Starts an item, for example "MTO query", ticks its checklist and passes it on
Next team | Finds it in its inbox, presses "Pick it up", does its part
Next team | Passes it on, answers it back, or sends it back because something is missing
First team | Gets the answer back and closes it
:::

- **Each level answers only the level that asked it.** An item always goes back the way it came, to the team that passed it on and to the very person there who did. Nobody can jump the chain.
- **A stage "if needed"** may be skipped by the team before it: HQ-AES passes straight to the Factory when the Product team has nothing to decide.
- **The checklist** is what stops "something missing" before it happens: the button to pass on stays grey until every line is ticked. Each tick is saved at once.
- **Something missing** still happens. It sends the item back with what is missing, and the count of send-backs per stage shows which hand-over needs a better checklist.

## What everyone sees
:::cards
My work | What is with me, what waits for my teams, what I started that is with others | inbox
The chain | Each flow drawn as its teams, left to right, yellow to red as in the value chain picture: open, late, the usual time, sent back | board
The item | Where it is, who has it, when it is due, the checklist, the buttons that apply, and its whole history | window
The hub | One card: "2 waiting for your teams, 1 with you" | hub
:::

## Who may do what
:::compare
Who | The database checks
Start | The team of the first stage, or IT | the caller is admin or member of that space, the space is on, the flow is on
Pick up | The team holding it | the item waits at a stage of one of his spaces
Take over | An admin of that team, or IT | someone else has it; the history names both
Tick, pass on, answer, send back, close | Only the person who picked it up | he holds it now; the checklist is done; the stages skipped may be skipped; the next team is on
Cancel | Who started it, an admin of the first team, or IT | a reason is written
Note | Everyone on the flow | the item is his to see
Set up a flow | IT only | 2 to 12 stages, a real space for each, the first and last never skipped
:::

- An IT admin acts at every stage, as he acts as admin of every space (owner, 2026-11-27). The history marks each step he does where he is not named as **(IT)**.
- Everyone named in a team of the flow sees all its items and their history. Someone on no stage sees nothing: the database refuses him the flow, the board and the item, with the same sentence whether the item exists or not.

## Built so that nothing else changes
- Relay is one database file, `db/09_relay.sql`: four tables (flows, stages, items, history) and fifteen `dame_relay_*` functions, each starting with `core.require_user()` or `core.require_it()`. It reads spaces and their people and writes only its own tables. No space, tool, table, row or right changes. Every tool works exactly as before.
- A stage is a space, so Relay adds no level and no role: Hub > Space > Tool stays.
- The history is append-only, also for the database owner (a trigger refuses change and delete). Every move is also written to the audit of the space where it happened.
- A space deleted later leaves its stage without a team: the setup page says so and only IT can act there. Relay never stops a space from being deleted.
- While items are open, a flow's stages can be renamed and its checklists changed, but not added, removed, moved or given to another team. A flow is never deleted, only switched off: nothing new starts, open items still finish.
- Limits: 5,000 open items per flow, 1,000 lines of history per item, 10 checklist lines per stage.

## The examples
The setup page offers four flows of a company like Daikin. The window picks the space whose name fits each stage; IT checks every choice before saving.
- **MTO query** (chiller, AHU, FCU): Sales > Application > HQ-AES > Product team (if needed) > Factory.
- **MTS query** (DX, VRV): Sales > Application > HQ-AES.
- **Order to delivery**: Sales > Finance > Product team > Factory > Service.
- **Spare parts request**: Service > Spare Parts > Finance (if needed) > Spare Parts.

## Not in this version
- Parallel stages (Product team **and** Factory at the same time): today one team holds an item at a time.
- Files attached to an item: a link or a reference in the text instead.
- Email when something arrives: the hub card and the inbox show it. IT can add mail on its own servers.
