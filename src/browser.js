import puppeteer from 'puppeteer-core';
import { CONFIG } from '../config.js';
import { log } from './utils.js';

export async function connectBrowser() {
  log('info', `Connecting to Chrome at ${CONFIG.cdpUrl} ...`);
  const browser = await puppeteer.connect({ browserURL: CONFIG.cdpUrl, defaultViewport: null });
  log('ok', 'Connected to Chrome');
  return browser;
}

export async function findTab(browser, urlFragment) {
  const pages = await browser.pages();
  log('info', `Found ${pages.length} open tabs, searching for "${urlFragment}" ...`);
  for (const page of pages) {
    const url = page.url();
    if (url.includes(urlFragment)) {
      log('ok', `Matched tab: ${url.slice(0, 100)}...`);
      return page;
    }
  }
  throw new Error(`No tab found matching "${urlFragment}". Make sure the tab is open in Chrome.`);
}

export async function findSheetsTab(browser) {
  return findTab(browser, CONFIG.sheets.urlFragment);
}

export async function findGustoTab(browser) {
  return findTab(browser, CONFIG.gusto.urlFragment);
}

export async function bringToFront(page) {
  await page.bringToFront();
}
