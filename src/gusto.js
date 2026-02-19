import { CONFIG } from '../config.js';
import { log, shortDelay, sleep, waitForStableDOM } from './utils.js';

const DATE = CONFIG.gusto.contractStartDate;
const GUSTO_BASE = 'https://app.gusto.com';
const ADD_PERSON_URL = `${GUSTO_BASE}/people/add_team_member/basics`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function typeInto(page, selector, text) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await shortDelay(15, 30);
  await page.type(selector, text, { delay: 15 });
}

async function clickSubmitButton(page) {
  log('step', '  Clicking Save and continue');
  // Find by text first (most reliable across Gusto's pages)
  const btns = await page.$$('button');
  for (const btn of btns) {
    const text = await page.evaluate(el => el.textContent.trim().toLowerCase(), btn);
    const visible = await page.evaluate(el => el.offsetParent !== null, btn);
    if (visible && text.includes('save') && text.includes('continue')) {
      await btn.click();
      await shortDelay(80, 100);
      return;
    }
  }
  // Fallback to submit button
  const submitSel = 'button[type="submit"]';
  const exists = await page.$(submitSel);
  if (exists) {
    await page.click(submitSel);
    await shortDelay(80, 100);
    return;
  }
  throw new Error('Save and continue button not found');
}

async function submitAndWaitForNav(page) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    clickSubmitButton(page),
  ]);
  await waitForStableDOM(page, 300, 8000);
  log('data', `  Navigated to: ${page.url()}`);
}

async function clickButtonByText(page, text) {
  log('step', `  Clicking button: "${text}"`);
  const lower = text.toLowerCase();
  const btns = await page.$$('button, a[role="button"], a');
  for (const btn of btns) {
    const btnText = await page.evaluate(el => el.textContent.trim().toLowerCase(), btn);
    const visible = await page.evaluate(el => el.offsetParent !== null, btn);
    if (visible && btnText.includes(lower)) {
      await btn.click();
      await shortDelay(60, 100);
      return;
    }
  }
  throw new Error(`Button "${text}" not found`);
}

async function waitForPageText(page, text, timeout = 20000) {
  log('step', `  Waiting for: "${text}"`);
  await page.waitForFunction((t) => document.body?.innerText?.includes(t), { timeout }, text);
  await shortDelay(30, 60);
}

async function waitForPageReady(page, timeout = 20000) {
  // Wait until "Loading" text disappears and a submit/continue button appears
  await page.waitForFunction(() => {
    const text = document.body?.innerText || '';
    const hasLoading = text.includes('Loading');
    const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
    const hasActionBtn = btns.some(b => {
      const t = b.textContent.toLowerCase();
      return (t.includes('save') && t.includes('continue')) || t.includes('continue') || t.includes('send');
    });
    return !hasLoading && hasActionBtn;
  }, { timeout });
  await shortDelay(50, 80);
}

/**
 * Dump current page state for debugging on failure.
 */
async function dumpPageState(page) {
  try {
    const url = page.url();
    const title = await page.evaluate(() => {
      const h1 = document.querySelector('h1, h2, h3');
      return h1?.textContent?.trim() || document.title;
    });
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
    log('data', `  Page URL: ${url}`);
    log('data', `  Page title: ${title}`);
    log('data', `  Page text preview: ${text.replace(/\n/g, ' | ').slice(0, 300)}`);
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Step 1: Navigate to Add Person basics page
// ---------------------------------------------------------------------------

export async function navigateToAddPerson(page) {
  log('step', 'Step 1: Navigating to Add Person');
  await page.goto(ADD_PERSON_URL, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.waitForSelector('input[name="firstName"]', { timeout: 10000, visible: true });
  log('ok', '  On Add Person basics form');
}

// ---------------------------------------------------------------------------
// Step 2: Fill Basics form (name, email, contractor type)
// ---------------------------------------------------------------------------

export async function fillBasicsForm(page, contractor) {
  log('step', `Step 2: Filling Basics form for ${contractor.firstName} ${contractor.lastName}`);

  // First name only (no middle name/initial)
  log('step', `  First name: "${contractor.firstName}"`);
  await typeInto(page, 'input[name="firstName"]', contractor.firstName);

  // Last name
  log('step', `  Last name: "${contractor.lastName}"`);
  await typeInto(page, 'input[name="lastName"]', contractor.lastName);

  // Worker type: Contractor (Individual)
  log('step', '  Selecting: Contractor (Individual)');
  await page.click('input[name="workerType"][value="individual_contractor"]');
  await shortDelay(30, 60);

  // Personal email
  log('step', `  Email: "${contractor.email}"`);
  await typeInto(page, 'input[name="email"]', contractor.email);

  // Submit and wait for navigation to next step
  await submitAndWaitForNav(page);
  log('ok', '  Basics form submitted');
}

// ---------------------------------------------------------------------------
// Step 3: Role page -- set contract start date
// ---------------------------------------------------------------------------

export async function fillRoleStartDate(page) {
  log('step', 'Step 3: Setting contract start date');
  await waitForPageReady(page);

  log('step', `  Date: ${DATE.month}/${DATE.day}/${DATE.year}`);

  // Gusto uses separate mm/dd/yyyy inputs with aria-labels
  const monthInput = await page.$('input[aria-label="Month (mm)"], input[placeholder="mm"]');
  const dayInput = await page.$('input[aria-label="Day (dd)"], input[placeholder="dd"]');
  const yearInput = await page.$('input[aria-label="Year (yyyy)"], input[placeholder="yyyy"]');

  if (monthInput && dayInput && yearInput) {
    log('step', '  Using separate mm/dd/yyyy fields');
    await monthInput.click({ clickCount: 3 });
    await monthInput.type(DATE.month, { delay: 15 });
    await shortDelay(15, 30);

    await dayInput.click({ clickCount: 3 });
    await dayInput.type(DATE.day, { delay: 15 });
    await shortDelay(15, 30);

    await yearInput.click({ clickCount: 3 });
    await yearInput.type(DATE.year, { delay: 15 });
  } else {
    // Fallback: single date input
    const dateInput = await page.$('input[name="startDate"], input[name*="date" i]');
    if (dateInput) {
      log('step', '  Using single startDate field');
      await dateInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await shortDelay(15, 30);
      await dateInput.type(`${DATE.month}/${DATE.day}/${DATE.year}`, { delay: 15 });
    } else {
      throw new Error('No date inputs found on role page');
    }
  }
  await shortDelay(50, 80);

  await submitAndWaitForNav(page);
  log('ok', '  Role start date submitted');
}

// ---------------------------------------------------------------------------
// Step 4: Compensation page -- select Fixed payment amounts
// ---------------------------------------------------------------------------

export async function selectCompensation(page) {
  log('step', 'Step 4: Selecting compensation type');
  await waitForPageReady(page);

  // Dump page for debugging
  const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 1000) || '');
  log('data', `  Page text: ${pageText.replace(/\n/g, ' | ').slice(0, 300)}`);

  // Look for radio/label for "Fixed"
  const fixedLabelId = await page.evaluate(() => {
    const radios = [...document.querySelectorAll('input[type="radio"]')];
    for (const r of radios) {
      const label = document.querySelector(`label[for="${r.id}"]`);
      if (label && label.textContent.toLowerCase().includes('fixed')) return r.id;
    }
    // Also check labels
    const labels = [...document.querySelectorAll('label')];
    const label = labels.find(l => l.textContent.toLowerCase().includes('fixed') && l.offsetParent !== null);
    if (label?.htmlFor) return label.htmlFor;
    return null;
  });

  if (fixedLabelId) {
    // Click the label for the radio, which triggers the radio properly
    const labelSel = `label[for="${fixedLabelId}"]`;
    await page.click(labelSel);
    await shortDelay(30, 60);
    log('ok', '  Selected Fixed payment type');
  } else {
    log('warn', '  Could not find Fixed radio, trying label click');
    await clickButtonByText(page, 'Fixed');
  }
  await shortDelay(50, 80);

  await submitAndWaitForNav(page);
  log('ok', '  Compensation submitted');
}

// ---------------------------------------------------------------------------
// Step 5: Review / Finalize page -- just submit
// ---------------------------------------------------------------------------

export async function submitReview(page) {
  log('step', 'Step 5: Review / Finalize page');
  await waitForPageReady(page);

  const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
  log('data', `  Page: ${pageText.replace(/\n/g, ' | ').slice(0, 200)}`);

  await submitAndWaitForNav(page);
  log('ok', '  Review submitted');
}

// ---------------------------------------------------------------------------
// Step 6: Onboarding page -- click Continue
// ---------------------------------------------------------------------------

export async function completeOnboarding(page) {
  log('step', 'Step 6: Onboarding page');
  await waitForPageReady(page);

  const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
  log('data', `  Page: ${pageText.replace(/\n/g, ' | ').slice(0, 200)}`);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    clickButtonByText(page, 'Continue'),
  ]);
  await waitForStableDOM(page, 300, 8000);
  log('data', `  Navigated to: ${page.url()}`);
  log('ok', '  Onboarding continued');
}

// ---------------------------------------------------------------------------
// Step 7: Contact details / documents -- Save and Continue
// ---------------------------------------------------------------------------

export async function submitContactDetails(page) {
  log('step', 'Step 7: Contact details page');
  await waitForPageReady(page);

  const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
  log('data', `  Page: ${pageText.replace(/\n/g, ' | ').slice(0, 200)}`);

  await submitAndWaitForNav(page);
  log('ok', '  Contact details submitted');
}

// ---------------------------------------------------------------------------
// Step 8: Send Invitation (final step)
// ---------------------------------------------------------------------------

export async function sendInvitation(page) {
  log('step', 'Step 8: Sending invitation');
  await waitForPageReady(page);

  const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
  log('data', `  Page: ${pageText.replace(/\n/g, ' | ').slice(0, 200)}`);

  // Could be "Send invitation" or "Send" button
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      clickButtonByText(page, 'Send invitation'),
    ]);
  } catch {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      clickButtonByText(page, 'Send'),
    ]);
  }
  await waitForStableDOM(page, 300, 8000);
  log('ok', '  Invitation sent!');
}

// ---------------------------------------------------------------------------
// Full workflow: add one contractor end-to-end
// ---------------------------------------------------------------------------

export async function addContractor(page, contractor) {
  const name = `${contractor.firstName} ${contractor.lastName}`;
  log('info', `=== Starting contractor workflow for: ${name} (row ${contractor.row}) ===`);
  const stepsCompleted = [];
  const startTime = Date.now();

  try {
    await navigateToAddPerson(page);
    stepsCompleted.push('navigate_add_person');

    await fillBasicsForm(page, contractor);
    stepsCompleted.push('basics_form');

    await fillRoleStartDate(page);
    stepsCompleted.push('role_start_date');

    await selectCompensation(page);
    stepsCompleted.push('compensation');

    await submitReview(page);
    stepsCompleted.push('review');

    await completeOnboarding(page);
    stepsCompleted.push('onboarding');

    await submitContactDetails(page);
    stepsCompleted.push('contact_details');

    await sendInvitation(page);
    stepsCompleted.push('send_invitation');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('ok', `=== Completed ${name} in ${elapsed}s (${stepsCompleted.length}/8 steps) ===`);
    return { success: true, name, stepsCompleted, errors: [] };

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('err', `=== FAILED on ${name} after ${elapsed}s at step ${stepsCompleted.length + 1}: ${error.message} ===`);
    log('err', `  Completed steps: ${stepsCompleted.join(', ')}`);
    await dumpPageState(page);
    return { success: false, name, stepsCompleted, errors: [error.message] };
  }
}
