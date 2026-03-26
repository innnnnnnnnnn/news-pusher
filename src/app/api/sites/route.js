import path from 'path';
import fs from 'fs';
import vm from 'vm';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const extensionPath = process.env.BPC_PATH || path.resolve(process.cwd(), './extension-bpc');
    const sitesPath = path.join(extensionPath, 'sites.js');
    const content = fs.readFileSync(sitesPath, 'utf8');
    
    // Create a sandbox to run the script with mock chrome API
    const sandbox = {
      chrome: {
        runtime: {
          getManifest: () => ({ key: 'mock-key' })
        }
      },
      browser: undefined,
    };
    vm.createContext(sandbox);
    
    // Evaluate the sites.js script
    vm.runInContext(content, sandbox);
    
    const sites = sandbox.defaultSites || {};
    // Extract site names and info
    const siteList = Object.keys(sites).filter(name => !name.startsWith('* ') && !name.startsWith('Show ') && !name.startsWith('Enable ') && !name.startsWith('Check '));
    siteList.sort();
    
    return NextResponse.json({ sites: siteList });
  } catch (error) {
    console.error('Sites API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
