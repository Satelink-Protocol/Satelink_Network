'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
} from '@satelink/ui';

const RPC_ENDPOINT = 'https://rpc.satelink.network';

export default function MachinePage() {
  const [copied, setCopied] = useState(false);

  const copyEndpoint = async () => {
    try {
      await navigator.clipboard.writeText(RPC_ENDPOINT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable (insecure context); fail quietly.
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Machine Access</CardTitle>
          <p className="text-sm text-muted-foreground">
            Autonomous agent billing and M2M API consumption.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Machine identity management is coming. Your autonomous systems can
            already use{' '}
            <span className="font-mono text-foreground">rpc.satelink.network</span>{' '}
            — billing is tracked per API key.
          </p>

          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3">
            <code className="flex-1 truncate font-mono text-sm text-foreground">
              {RPC_ENDPOINT}
            </code>
            <Button size="sm" variant="outline" onClick={copyEndpoint}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <Button asChild className="w-full">
            <Link href="/satelink/os/keys">Get API Key</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
