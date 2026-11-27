# Tools that save data

Some tools only calculate. Others must keep what people enter. Those save it in the site's database.

=> The page lists its tables | The site shows them | One press makes them | The tool saves rows

## How a table comes to exist
1. The page carries a small list: which tables it needs, their columns, and who shares the rows. The starter kit tells the AI to write it.
2. After the check, a **window** opens with the tables and columns the site read from the page.
3. The builder can **add more columns** there: a name, what it holds, and the choices if it is a list.
4. Nothing exists until he presses **Create in the database and go on**.
5. The site makes two copies: one for real use, one empty copy for the preview. Trying things never touches real rows.

Nobody types SQL. The site writes it, from a fixed list of column kinds, after checking every name.

## Who sees which rows
:::cards
Team | Everyone with the tool sees all rows. Who may change them depends on his level | shared
Private | Each person sees only his own rows. Not even the admin sees them | personal
Reference | Everyone reads. Only the tool's managers change | look-up
:::

One of the three is chosen per table, when the table is made.

## What every row carries by itself
- Who added it and when, who changed it last and when.
- The tool cannot set or fake these. The database writes them.

## One service for all tools
- A tool never talks to the database. It asks the site: list, get, add, change, remove.
- The site adds the person's session, and the database checks his level, the table, the columns and the values.
- A tool can only name tables of **its own** tool. Two departments can both have a table called "entries": they never meet.

## Kinds of column
Text, long text, number, date, yes or no, one of a list, a person, structured data. A field left empty on a form is saved as "no value".
