// QA: mobile viewport feature check
export default async function run(page, ui) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.app-topbar', { timeout: 20000 }).catch(() => {})
  const res = { url: page.url() }
  res.viewport = page.viewportSize();
  res.innerWidth = await page.evaluate(() => window.innerWidth);
  res.title = await page.title();
  const disp = (sel) => page.evaluate((s) => {
    const e = document.querySelector(s);
    return e ? getComputedStyle(e).display : 'absent';
  }, sel);
  res.menuBtn = await disp('.mobile-menu-btn');
  res.sidebar = await disp('.sidebar');
  res.mobileNav = await disp('.mobile-nav');
  res.drawer = await disp('.mobile-drawer');
  // Open the drawer and verify all destinations render inside it.
  const menuBtn = page.locator('.mobile-menu-btn').first();
  if (await menuBtn.count()) {
    await menuBtn.click();
    await page.waitForSelector('.mobile-drawer__panel', { timeout: 5000 }).catch(() => {});
  }
  res.drawerOpen = await page.evaluate(() => !!document.querySelector('.mobile-drawer__panel'));
  res.drawerLinks = await page.evaluate(() => Array.from(document.querySelectorAll('.mobile-drawer__link')).map(a => ({ href: a.getAttribute('href'), label: a.textContent.trim() })));
  res.bodyChars = await page.evaluate(() => document.body.innerText.length);
  res.navLinks = await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="#/"]')).map(a => a.getAttribute('href')));
  return res;
}
