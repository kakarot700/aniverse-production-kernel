// app/api/servers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { CentralStreamRegistry } from '@/lib/streams/registry';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const targetEmbedUrl = searchParams.get('url');

    if (!targetEmbedUrl) {
      return NextResponse.json(
        { success: false, error: 'Missing active target server payload URL vector parameter string context specification.' },
        { status: 400 }
      );
    }

    const browserUserAgent = request.headers.get('user-agent') || 
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const registry = new CentralStreamRegistry();
    const resolvedStreams = await registry.resolveAllAvailableServers(targetEmbedUrl, browserUserAgent);

    if (resolvedStreams.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No video configurations found. Trying to parse proxy target links.'
      }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      hostNode: new URL(targetEmbedUrl).hostname,
      streams: resolvedStreams
    });

  } catch (error: any) {
    console.error('[API Server Registry Route Exception]: Fault on stream resolution block.', error);
    return NextResponse.json(
      { success: false, error: 'Internal pipeline fault during multi-server context extraction runtime calculation loops.' },
      { status: 500 }
    );
  }
}
