import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pdfUrl = searchParams.get('url');

    if (!pdfUrl) {
      return NextResponse.json({ error: 'PDF URL is required' }, { status: 400 });
    }

    // Fetch the PDF from Firebase Storage
    const response = await fetch(pdfUrl);
    
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch PDF' }, { status: response.status });
    }

    const pdfBuffer = await response.arrayBuffer();

    // Return the PDF with proper headers
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': pdfBuffer.byteLength.toString(),
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('Error proxying PDF:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
