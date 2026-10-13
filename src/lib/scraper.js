import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import path from 'path';

puppeteer.use(StealthPlugin());

export async function scrapeArticleWithBPC(url) {
  const extensionPath = process.env.BPC_PATH || path.resolve(process.cwd(), './extension-bpc');
  
  // Puppeteer setup with extension loaded and stealth configuration
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--lang=en-US,en;q=0.9'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for BPC to bypass and Cloudflare challenge to complete
    await new Promise(r => setTimeout(r, 4000));
    
    // Extract main image, title, and other metadata
    const articleData = await page.evaluate(() => {
      const getImg = () => {
        const ogImg = document.querySelector('meta[property="og:image"]');
        if (ogImg) return ogImg.content;
        const twitterImg = document.querySelector('meta[name="twitter:image"]');
        if (twitterImg) return twitterImg.content;
        const firstImg = document.querySelector('article img');
        return firstImg ? firstImg.src : null;
      };
      
      const getCategory = () => {
        const ogSection = document.querySelector('meta[property="article:section"]');
        if (ogSection) return ogSection.content;
        const ecoCat = document.querySelector('[data-test-id="article-header-section-link"]');
        return ecoCat ? ecoCat.innerText : 'News';
      };

      return {
        image: getImg(),
        category: getCategory(),
        html: document.documentElement.outerHTML
      };
    });

    const resolvedUrl = page.url();
    await browser.close();

    const dom = new JSDOM(articleData.html, { url: resolvedUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    const textContent = article?.textContent?.trim() || '';
    const title = article?.title?.trim() || '';
    
    // Check if intercepted by Cloudflare challenge / Turnstile bot wall
    const isCloudflareChallenge = 
      title.toLowerCase().includes('just a moment') ||
      title.toLowerCase().includes('security verification') ||
      title.toLowerCase().includes('attention required') ||
      textContent.includes('help.ft.com') ||
      textContent.includes('cf-browser-verification') ||
      textContent.includes('Cloudflare Ray ID') ||
      textContent.length < 150;

    if (isCloudflareChallenge) {
      throw new Error(`Article blocked by Cloudflare/Anti-bot challenge: "${title}" at ${resolvedUrl}`);
    }

    const wordCount = textContent.split(/\s+/).length;
    const readingTime = Math.ceil(wordCount / 200);

    return {
      title: title || 'Unknown Title',
      textContent: textContent,
      excerpt: article?.excerpt || '',
      category: articleData.category,
      image: articleData.image,
      readingTime: readingTime,
      url: resolvedUrl
    };
  } catch (err) {
    await browser.close();
    throw err;
  }
}
