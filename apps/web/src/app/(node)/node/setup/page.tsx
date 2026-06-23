'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@satelink/ui';
import { Button } from '@satelink/ui';
import { Badge } from '@satelink/ui';
import { Loader2, Terminal, CheckCircle, Copy, Check } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://rpc.satelink.network";
const getAuthHeaders = () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("satelink_token") : "";
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
};
const api = {
  get: async (path: string) => fetch(`${API_BASE}${path}`, { headers: getAuthHeaders() }).then(async r => ({ data: await r.json(), status: r.status, ok: r.ok })),
  post: async (path: string, body?: any) => fetch(`${API_BASE}${path}`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) }).then(async r => ({ data: await r.json(), status: r.status, ok: r.ok })),
  delete: async (path: string) => fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: getAuthHeaders() }).then(async r => ({ data: await r.json(), status: r.status, ok: r.ok }))
};



export default function NodeSetupPage() {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [setupData, setSetupData] = useState<any>(null);
    const [copied, setCopied] = useState(false);
    const [status, setStatus] = useState('pending');

    const startSetup = async () => {
        setLoading(true);
        try {
            const res = await api.post('/api/node/setup/start');
            if (res.data.ok) {
                setSetupData(res.data);
                setStep(2);
            }
        } catch (e) {
            console.error('[NodeSetup]', e);
        } finally {
            setLoading(false);
        }
    };

    // Poll for status
    useEffect(() => {
        if (step === 2 && setupData?.setup_id) {
            const interval = setInterval(async () => {
                try {
                    const res = await api.get(`/api/node/setup/${setupData.setup_id}`);
                    if (res.data.ok && res.data.status === 'paired') {
                        setStatus('paired');
                        setStep(3);
                        clearInterval(interval);
                    }
                } catch (e) { console.error('[NodeSetup:poll]', e); }
            }, 3000);
            return () => clearInterval(interval);
        }
    }, [step, setupData]);

    const copyCommand = (cmd: string) => {
        navigator.clipboard.writeText(cmd);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="max-w-2xl mx-auto py-12 px-4">
            <div className="mb-8 text-center">
                <h1 className="text-3xl font-bold tracking-tight mb-2">Connect New Node</h1>
                <p className="text-muted-foreground">Follow these steps to securely onboard your hardware.</p>
            </div>

            <div className="flex justify-center mb-8 space-x-2">
                {[1, 2, 3].map((s) => (
                    <div
                        key={s}
                        className={`w-3 h-3 rounded-full transition-colors ${step >= s ? 'bg-primary' : 'bg-muted'}`}
                    />
                ))}
            </div>

            <Card>
                {step === 1 && (
                    <>
                        <CardHeader>
                            <CardTitle>Initialize Setup</CardTitle>
                            <CardDescription>
                                We will generate a unique, time-limited pairing code for your node.
                            </CardDescription>
                        </CardHeader>
                        <CardFooter>
                            <Button onClick={startSetup} disabled={loading} className="w-full">
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Generate Pairing Code
                            </Button>
                        </CardFooter>
                    </>
                )}

                {step === 2 && setupData && (
                    <>
                        <CardHeader>
                            <CardTitle>Run Setup Command</CardTitle>
                            <CardDescription>
                                Your pairing code is active for 15 minutes.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="p-6 bg-muted/50 rounded-lg text-center">
                                <div className="text-sm text-muted-foreground mb-1">PAIRING CODE</div>
                                <div className="text-4xl font-mono font-bold tracking-widest text-primary">
                                    {setupData.pairing_code}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="text-sm font-medium">Run this on your node:</div>
                                {setupData.install_commands.map((cmd: string, i: number) => (
                                    <div key={i} className="relative group">
                                        <pre className="bg-black text-green-400 p-4 rounded-md font-mono text-sm overflow-x-auto border border-neutral-800">
                                            RES=$({cmd})
                                        </pre>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={() => copyCommand(cmd)}
                                        >
                                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center justify-center text-sm text-neutral-500 animate-pulse">
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                Waiting for node connection...
                            </div>
                        </CardContent>
                    </>
                )}

                {step === 3 && (
                    <>
                        <CardHeader className="text-center">
                            <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
                                <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
                            </div>
                            <CardTitle>Node Paired Successfully!</CardTitle>
                            <CardDescription>
                                Your node has been verified and linked to your wallet.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-md flex gap-3">
                                <CheckCircle className="h-4 w-4 text-green-500" />
                                <div className="font-semibold">Ownership Verified</div>
                                <div className="text-sm text-green-700 dark:text-green-300">
                                    Cryptographic signature confirmed. You can now manage this node in your dashboard.
                                </div>
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button className="w-full" variant="outline" onClick={() => window.location.href = '/node'}>
                                Go to Dashboard
                            </Button>
                        </CardFooter>
                    </>
                )}
            </Card>
        </div>
    );
}
