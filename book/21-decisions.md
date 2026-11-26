# The decisions, one by one

Each line: the question, what was chosen, and why. The full record with dates is `docs/DECISIONS.md`.

## Shape of the site
| Question | Chosen | Why |
|---|---|---|
| How many levels? | Exactly three: hub, space, tool | Deeper trees need rules for inheriting rights; three can be explained in a sentence |
| One site or one per department? | One | One sign-in, one look, one audit, one thing for IT to run |
| How is a tool named? | By its space id and its tool id together | Two departments can both have a tool called `tracker` |
| Can an id change or return? | Never | Addresses, schema names and file paths are derived from ids; a reused id could expose old data under a new name |
| Framework? | None. Plain HTML, CSS, JavaScript | No build, no packages to patch, readable by anyone, nothing loaded from outside |

## People
| Question | Chosen | Why |
|---|---|---|
| Who gets in? | Listed email domains, then approval by IT; or added by IT | Email proof alone is not enough |
| How does IT add someone? | A username with a temporary password that must be replaced; or an email approved in advance | Owner's wish for the first; the second for people with a work mailbox |
| How many sessions? | One per person, 12 hours | Simple, holds on any plan, makes a forgotten sign-in harmless |
| Delete accounts? | No, switch off | The audit and row owners must always point at someone |
| Is IT admin a master key to data? | No | Running the site and reading a department's rows are separate rights |
| May IT name itself space admin? | Yes, audited | Otherwise a one-person demo cannot start. IT may forbid it on the target |

## Access and data
| Question | Chosen | Why |
|---|---|---|
| Where are rights enforced? | In the database, in every function | A page can be edited by its user; the database cannot |
| Tables or functions exposed? | Functions only, all named `dame_*` | A finite, readable API |
| Rights in the token? | No, in tables | A change works at the next click |
| Who makes tables? | The tool's manager, from the site | No IT ticket; no SQL typed by a non-developer |
| What may a table be? | A fixed list of column kinds, five standard columns, one of three sharing rules | Every table is safe by construction |
| Row rules as policies or code? | Code in one row service | Tables appear on the fly; one tested rule beats many generated ones |
| May a column be removed? | Not yet | Removing silently destroys data; it waits for an export |
| Row history? | Not kept; each row knows who changed it last | Keeps the audit readable; can be added |

## Uploaded code
| Question | Chosen | Why |
|---|---|---|
| Trust uploads after a review? | Never trust; always seal | A review can miss things; a seal cannot be talked round |
| Network for tools? | None | It is the only way to be sure nothing leaves |
| How does a tool get data? | By asking the shell over a private line | The tool never holds the session |
| Background workers? | No | Would need loosening the policy; long work is done in steps |
| Outside libraries? | Only from the site's shelf, fingerprinted | No CDN; IT decides what code is allowed |
| Many files or one? | One page per tool, packed in the browser | Nothing to load, so the frame can forbid all loading |
| Can a version change? | Never | Makes roll back safe and "what ran that day" answerable |
| Who publishes? | The tool's manager, alone for now | A second approver is planned; the seal limits the harm meanwhile |

## Building with AI
| Question | Chosen | Why |
|---|---|---|
| Does the site call an AI? | No. The person copies a text to the approved AI | Nothing leaves the site by itself; no key to guard |
| What does the AI get? | Public rules, building blocks, the description | No data, no address, no account |
| What if the answer is wrong? | The site says what, in words, and writes the fix request | A failed first check is normal |
| Charts? | Later, as a building block of the kit | Not a second library to trust |

## The demo itself
| Question | Chosen | Why |
|---|---|---|
| Where does it run? | GitHub Pages and one Supabase project | Free, quick, enough to prove the design |
| Which keys exist in the repository? | The project address and the publishable key | Public by design; they open nothing without a session and the function checks |
| Who changes the database? | The owner, by pasting numbered files he has read | No pipeline secret; exact history |
| Other sites on the same GitHub address? | Accepted for a demo with sample data | The risk does not exist on IT's own address |
| The look? | Taken from the earlier DAME hub | Owner's wish; no code or data was taken |
