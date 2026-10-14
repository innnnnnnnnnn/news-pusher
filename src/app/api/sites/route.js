import { NextResponse } from 'next/server';
import sitesData from '@/data/sites.json';

export async function GET() {
  try {
    return NextResponse.json({
      sites: sitesData.map(s => s.name),
      siteDetails: sitesData
    });
  } catch (error) {
    console.error('Sites API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
