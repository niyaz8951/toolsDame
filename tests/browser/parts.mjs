// What it is for: the admin pages show one part at a time (tabs) and fold rarely used things under
// a "More" button. A person presses the tab, or the fold, before he uses what is in it. follow()
// makes every test do the same: before an action on an element, it presses the tab and opens the
// fold the element sits in, exactly as a person would, and only then acts.
// Must not change: it presses the page's own buttons; it never un-hides anything by script.
async function reveal(page, selector) {
  if (typeof selector !== 'string') { return; }
  try {
    for (let i = 0; i < 3; i += 1) {
      const todo = await page.locator(selector).first().evaluate((node) => {
        const fold = node.closest('details:not([open])');
        if (fold && !node.closest('summary')) { fold.setAttribute('data-follow', '1'); return 'fold'; }
        const card = node.closest('.hub-part-off');
        return card ? 'part:' + card.dataset.part : '';
      });
      if (!todo) { return; }
      if (todo === 'fold') {
        const s = page.locator('details[data-follow="1"] > summary').first();
        await page.evaluate(() => { const d = document.querySelector('details[data-follow="1"]'); const c = d && d.closest('.hub-part-off'); return c ? c.dataset.part : ''; })
          .then(async (part) => { if (part) { await page.locator('#part-' + part).click(); } });
        await s.click();
        await page.evaluate(() => { const d = document.querySelector('details[data-follow="1"]'); if (d) { d.removeAttribute('data-follow'); } });
      } else {
        await page.locator('#part-' + todo.slice(5)).click();
      }
    }
  } catch (e) { /* not in the page (yet): the action itself reports it */ }
}

const ACTS = ['click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck', 'selectOption', 'setInputFiles', 'hover', 'focus'];

function followPage(page) {
  for (const name of ACTS) {
    const real = page[name].bind(page);
    page[name] = async (selector, ...rest) => { await reveal(page, selector); return real(selector, ...rest); };
  }
  const wait = page.waitForSelector.bind(page);
  page.waitForSelector = async (selector, options) => {
    if (!options || !options.state || options.state === 'visible') { await reveal(page, selector); }
    return wait(selector, options);
  };
  page.part = (selector) => reveal(page, selector);
  return page;
}

export function follow(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const ctx = await newContext(...args);
    const newPage = ctx.newPage.bind(ctx);
    ctx.newPage = async () => followPage(await newPage());
    return ctx;
  };
  return browser;
}
