import puppeteer from 'puppeteer';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import path from 'path';

export async function scrapeArticleWithBPC(url) {
  const extensionPath = process.env.BPC_PATH || path.resolve(process.cwd(), './extension-bpc');
  
  // Puppeteer setup with extension loaded
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox'
    ]
  });

  try {
    const page = await browser.newPage();
    
    // Set a random user agent to mimic regular browsing further (optional, BPC does this too)
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait a bit just in case BPC needs a moment to manipulate DOM/Cookies
    await new Promise(r => setTimeout(r, 3000));
    
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
    
    const textContent = article?.textContent || '';
    const wordCount = textContent.split(/\s+/).length;
    const readingTime = Math.ceil(wordCount / 200);

    return {
      title: article?.title || 'Unknown Title',
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
