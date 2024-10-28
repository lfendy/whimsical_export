#!/usr/bin/env node
import { mkdir, readdir, writeFile } from 'fs/promises';
import inquirer from 'inquirer';
import puppeteer, { CDPSession, HTTPResponse, Page } from 'puppeteer';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import internal from 'stream';
import validator from 'validator';
const pptr = require('puppeteer-core');

const { DEBUG = 'false' } = process.env;

const DOWNLOAD_PATH = 'downloads';
const WHIMSICAL_BASE_URL = 'https://whimsical.com/';

const enum FileType {
  PDF = 'pdf',
  PNG = 'png',
  SVG = 'svg'
}

const puppeteerExtra = addExtra(puppeteer);
puppeteerExtra.use(StealthPlugin());

let itemsDownloaded = 0;

const init = async () => {
  const downloadPath = `${process.cwd()}/${DOWNLOAD_PATH}`;
  console.log('👋 Welcome to whimsical-exporter');
  console.log(`ℹ  All exported files will be saved in ${downloadPath}\n`);

  const { wsUrl, folderUrl, fileTypes } = await promptInputs();

  console.log('🚀 Launching browser');
  // const browser = await puppeteerExtra.launch({
  //   headless: DEBUG !== 'true',
  //   devtools: DEBUG === 'true'
  // });
  const browser = await pptr.connect({
    browserWSEndpoint: wsUrl
  })

  console.log('📄 Opening new page');
  const page = await browser.newPage();

  // await logIn(page, email, password);
  await goToWhimsical(page);
  await navigateToFolder(page, folderUrl, downloadPath, fileTypes);

  console.log(`✨ Finished exporting ${itemsDownloaded} items`);

  // if (DEBUG !== 'true') {
  //   await browser.close();
  //   process.exit();
  // }
};

const promptInputs = (): Promise<{
//  email: string;
//  password: string;
  wsUrl: string;
  folderUrl: string;
  fileTypes: FileType[];
}> => {

//  const { EMAIL, PASSWORD, FOLDER_URL, FILE_TYPES } = process.env;

  const { FOLDER_URL, FILE_TYPES } = process.env;

  return inquirer.prompt([
    {
      name: 'wsUrl',
      type: 'input',
      message: 'Your Websocket chrome debug URL (ws://127.0.0.1:9222/devtools/browser/UUID) from 127.0.0.1:9222/json/version:',
      default: WS_URL
    },
    {
      name: 'folderUrl',
      type: 'input',
      message: 'Whimsical folder URL to start export from:',
      default: FOLDER_URL,
      validate: (input: string) =>
        validator.isURL(input) && input.startsWith(WHIMSICAL_BASE_URL)
    },
    {
      name: 'fileTypes',
      type: 'checkbox',
      message: 'Select which formats to export as:',
      default: FILE_TYPES?.split(','),
      choices: [
        {
          name: 'PNG at 2x zoom (static image, shapes cannot be edited)',
          short: 'PNG',
          value: FileType.PNG
        },
        {
          name: 'PDF (landscape, shapes can be zoomed in)',
          short: 'PDF',
          value: FileType.PDF
        },
        {
          name: 'SVG (shapes can be zoomed in and edited)',
          short: 'SVG',
          value: FileType.SVG
        }
      ],
      validate: (input: string[]) => Boolean(input.length)
    }
  ]);
};


const goToWhimsical = async (
  page: Page,
): Promise<void> => {
  console.log('🔐 go to whimsical');
  // await page.goto('https://whimsical.com/CxHjmmy6Q6Y7LLLkrn3LTF', { waitUntil: 'networkidle0' });
  await page.goto('https://whimsical.com', { waitUntil: 'domcontentloaded' });

  try {
    // await page.waitForNavigation({ waitUntil: 'networkidle0' });
    await page.waitForNavigation({ waitUntil: 'load' });
  } catch {
    throw new Error(
      '❌ wtf'
    );
  }
};

const navigateToFolder = async (
  page: Page,
  folderUrl: string,
  downloadPath: string,
  fileTypes: FileType[]
): Promise<void> => {
  const folderName = getItemName(folderUrl);
  const folderPath = `${downloadPath}/${folderName}`;

  console.log(`📂 Navigating to folder: ${folderName}`);
  await goToUrlIfNeeded(page, folderUrl);

  // Scroll down to lazy load batches of 100 items
  await loadAllItems(page);

  const itemUrls = await getUrls(page);
  console.log(`🧮 Folder has ${itemUrls.length} items`);

  await createDirIfNotExists(folderPath);
  await downloadUrls(page, itemUrls, folderPath, fileTypes);
};

const loadAllItems = async (page: Page): Promise<void> => {
  let moreItems = true;
  const scrollSelector = '[data-wc="folder-content"] > div';

  while (moreItems) {
    await page.$eval(
      scrollSelector,
      wrapper => (wrapper.scrollTop = wrapper.scrollHeight)
    );

    try {
      await page.waitForResponse(
        response =>
          response.url() === 'https://whimsical.com/api/items.sync' &&
          response.status() === 200,
        { timeout: 1000 }
      );
    } catch {
      moreItems = false;
    }
  }
};

const goToUrlIfNeeded = async (
  page: Page,
  url: string
): Promise<HTTPResponse | null> => {
  if (page.url() !== url) {
    return page.goto(url, { waitUntil: 'networkidle0' });
  }

  return null;
};

const getUrls = async (page: Page): Promise<string[]> =>
  page.$$eval('[data-wc="folder-content"] a.no-user-select', items =>
    items.map(item => item.href)
  );

const createDirIfNotExists = async (path: string) => {
  try {
    await mkdir(path, { recursive: true });
  } catch {
    // Do nothing
  }
};

const downloadUrls = async (
  page: Page,
  itemUrls: string[],
  downloadPath: string,
  fileTypes: FileType[]
): Promise<void> => {
  const dirFiles = await readdir(downloadPath);

  for await (const itemUrl of itemUrls) {
    const itemName = getItemName(itemUrl);
    console.debug(`⚙️  Processing: ${itemName}`);

    if (
      dirFiles.includes(itemName) ||
      (await checkItemIsFolder(page, itemUrl))
    ) {
      await navigateToFolder(page, itemUrl, downloadPath, fileTypes);
      continue;
    }

    const pendingFileTypes = fileTypes.filter(fileType => {
      if (dirFiles.includes(`${itemName}.${fileType}`)) {
        console.log(`⏭  ${fileType.toUpperCase()} already exists, skipping`);
        return false;
      }

      return true;
    });

    if (!pendingFileTypes.length) {
      continue;
    }

    const hasCanvas = await checkItemHasCanvas(page, itemUrl);

    if (!hasCanvas) {
      console.log('🫙  Item is empty');
      continue;
    }

    try {
      for (const fileType of pendingFileTypes) {
        const itemContent = await getItemContent(page, itemUrl, fileType);
        const filePath = `${downloadPath}/${itemName}.${fileType}`;
        await writeFile(filePath, itemContent);
        console.log(`⬇️  Downloaded ${fileType.toUpperCase()}`);
      }

      itemsDownloaded++;
    } catch (err) {
      console.error(err);
      console.log('🫙  Item is empty');
    }
  }
};

const getItemName = (url: string): string => {
  const [, path] = url.split(WHIMSICAL_BASE_URL);
  return path;
};

const checkItemIsFolder = async (
  page: Page,
  itemUrl: string
): Promise<boolean> => {
  await goToUrlIfNeeded(page, itemUrl);
  const folderContent = await page.$('[data-wc="folder-content"]');
  return Boolean(folderContent);
};

const checkItemHasCanvas = async (
  page: Page,
  itemUrl: string
): Promise<boolean> => {
  await goToUrlIfNeeded(page, itemUrl);
  const boardCanvas = await page.$('[data-wc="board-canvas"]');
  return Boolean(boardCanvas);
};

const getItemContent = (
  page: Page,
  itemUrl: string,
  fileType: FileType
): Promise<string | Buffer | internal.Readable> => {
  switch (fileType) {
    case FileType.PNG:
      return getImageBlob(page, itemUrl);
    case FileType.PDF:
      return getPdfStream(page, itemUrl);
    case FileType.SVG:
      return getSvgContent(page, itemUrl);
  }
};

const getSvgContent = async (page: Page, itemUrl: string): Promise<string> => {
  await goToUrlIfNeeded(page, `${itemUrl}/svg`);
  await setBackgroundColor(page, 'svg');
  return page.content();
};

const sleep = async(ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
};

const getImageBlob = async (page: Page, itemUrl: string): Promise<Buffer> => {
  await goToUrlIfNeeded(page, itemUrl);

  // const shareButtonSelector = 'button[aria-label="Share, Export & Print"]';
  const shareButtonSelector = 'button.generic-button';
  await page.waitForSelector(shareButtonSelector);
  await clickIfEnabled(page, shareButtonSelector);

  const exportSelector =
    'xpath///button[text()="Export"]';
  await page.waitForSelector(exportSelector);
  await clickIfEnabled(page, exportSelector);

  const twoxSelector =
    'xpath///button[text()="2x"]';
  await page.waitForSelector(twoxSelector);
  await clickIfEnabled(page, twoxSelector);

  const downloadButtonSelector =
    'xpath///button[text()="Download"]';

  await page.waitForSelector(downloadButtonSelector);
  await clickIfEnabled(page, downloadButtonSelector);

  await sleep(10000);

  return Buffer.from("");


  //// Buffer frequently returns 0 bytes, not sure why
  //
  // const copyImageButtonSelector =
  //   'xpath///button[text()="Copy"]';
  // await page.waitForSelector(copyImageButtonSelector);


  // console.log("------ I found copy button")

  // await sleep(2000);

  // console.log("------ I will click copy button")

  // const imageBuffer = await clickAndWaitForImageBlob(
  //   page,
  //   copyImageButtonSelector
  // );

  // console.log("------ I got imageBuffer")

  // // await clickIfEnabled(page, shareButtonSelector);
  // return imageBuffer;
};

const clickAndWaitForImageBlob = async (
  page: Page,
  elementSelector: string
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const emitter = page.once('response', async response => {
      if (response.url().startsWith(`blob:${WHIMSICAL_BASE_URL}`)) {

        if (response.ok()) {
          resolve(response.buffer());
        } else {
          reject();
        }
      }
    });

    clickIfEnabled(page, elementSelector).catch(err => {
      emitter.removeAllListeners();
      reject(err);
    });
  });

const getPdfStream = async (
  page: Page,
  itemUrl: string
): Promise<internal.Readable> => {
  await goToUrlIfNeeded(page, itemUrl);

  // const shareButtonSelector = 'button[aria-label="Share, Export & Print"]';
  const shareButtonSelector = 'button.generic-button';
  await page.waitForSelector(shareButtonSelector);
  await clickIfEnabled(page, shareButtonSelector);

  const exportSelector =
    'xpath///button[text()="Export"]';
  await page.waitForSelector(exportSelector);
  await clickIfEnabled(page, exportSelector);

  const printButtonSelector =
    'xpath///button[text()="Print"]';
  await page.waitForSelector(printButtonSelector);
  await clickIfEnabled(page, printButtonSelector);

  await page.waitForSelector('iframe');
  const [, iframe] = page.frames();
  const frameContent = await iframe.content();
  await page.setContent(frameContent, { waitUntil: 'networkidle0' });
  await setBackgroundColor(page, 'body');

  return page.createPDFStream({ landscape: true, printBackground: true });
};

const clickIfEnabled = async (
  page: Page,
  elementSelector: string
): Promise<void> => {
  const isEnabled = await page.$eval(
    elementSelector,
    el => (el as HTMLElement).style.pointerEvents !== 'none'
  );

  if (!isEnabled) {
    throw new Error(`Element ${elementSelector} is not enabled`);
  }

  await page.click(elementSelector);
};

const setBackgroundColor = async (
  page: Page,
  elementSelector: string
): Promise<void> => {
  await page.$eval(
    elementSelector,
    el => ((el as HTMLElement).style.backgroundColor = '#f0f4f7')
  );
};

const checkItemHasSvg = async (
  page: Page,
  itemUrl: string
): Promise<boolean> => {
  const response = await goToUrlIfNeeded(page, `${itemUrl}/svg`);

  if (!response?.ok()) {
    throw new Error(response?.statusText());
  }

  const title = await page.title();
  return title === 'Not Found';
};

const setDownloadPath = (
  session: CDPSession,
  downloadPath: string
): Promise<void> =>
  session.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath
  });

const clickAndWaitForDownload = async (
  page: Page,
  session: CDPSession,
  elementSelector: string
): Promise<void> =>
  new Promise((resolve, reject) => {
    const emitter = session.on('Page.downloadProgress', download => {
      if (download.state === 'completed') {
        emitter.removeAllListeners();
        return resolve();
      } else if (download.state === 'canceled') {
        emitter.removeAllListeners();
        return reject();
      }
    });

    page.click(elementSelector);
  });

init();
