import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const EXCLUDE = [ '--headless', '--single-process', '--in-process-gpu' ];

export async function launchBrowser(extraArgs = [], { viewport = { width : 480, height : 300 } } = {}) {
  const args = chromium.args.filter(a => !EXCLUDE.some(x => a.startsWith(x)) && a !== '--headless=shell');
  return puppeteer.launch({
    args : [ ...args, ...extraArgs ],
    defaultViewport : viewport,
    executablePath : await chromium.executablePath(),
    headless : true,
    protocolTimeout : 1800000,
  });
}
