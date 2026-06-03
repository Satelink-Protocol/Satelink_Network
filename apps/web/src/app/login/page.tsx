"use client";




import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { ethers } from 'ethers';
import { Wallet, ShieldCheck, Loader2, AlertTriangle, ArrowLeft } from 'lucide-react';

function LoginContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, login } = useAuth();
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState<'connect' | 'signing' | 'verifying'>('connect');
    const [error, setError] = useState<string | null>(null);
    const isDev = process.env.NODE_ENV === 'development';

    // If already logged in, redirect to dashboard
    useEffect(() => {
        if (user) {
            const redirect = searchParams.get('redirect');
            if (redirect) {
                router.push(redirect);
            } else {
                // Role-based redirect handled by login() in useAuth
            }
        }
    }, [user, router, searchParams]);

    // ── Production: Wallet Signature Login ──
    // Flow: POST /auth/challenge → sign message → POST /auth/verify
    const handleWalletLogin = async () => {
        setLoading(true);
        setError(null);
        setStep('connect');

        if (typeof window === 'undefined' || !(window as any).ethereum) {
            setError('No wallet detected. Install MetaMask or another EVM wallet.');
            setLoading(false);
            return;
        }

        try {
            const provider = new ethers.providers.Web3Provider((window as any).ethereum);
            const accounts = await provider.send("eth_requestAccounts", []);
            const address = accounts[0];
            if (!address) throw new Error('No account selected');

            // Step 1: Request challenge nonce from canonical auth endpoint
            setStep('signing');
            const challengeRes = await api.post('/auth/challenge', { address });
            if (!challengeRes.data?.ok) throw new Error(challengeRes.data?.error || 'Failed to get challenge');

            const { nonce, message: serverMessage } = challengeRes.data;

            // Step 2: Sign the message
            const message = serverMessage || `Welcome to Satelink!\n\nSign this nonce to authenticate: ${nonce}\n\nAddress: ${address}`;
            const signer = await provider.getSigner();
            const signature = await signer.signMessage(message);

            // Step 3: Verify signature and get JWT
            setStep('verifying');
            const verifyRes = await api.post('/auth/verify', {
                address,
                signature,
                message,
                device_info: {
                    device_public_id: `web-${Date.now()}`,
                    user_agent: navigator.userAgent,
                }
            });

            if (!verifyRes.data?.ok) {
                throw new Error(verifyRes.data?.error || 'Authentication failed');
            }

            // Extract token — unified auth returns tokens.accessToken
            const token = verifyRes.data.tokens?.accessToken || verifyRes.data.token;
            if (!token) throw new Error('No token received');

            const redirect = searchParams.get('redirect') || undefined;
            await login(token, redirect);
            toast.success('Wallet connected successfully');
        } catch (err: any) {
            const msg = err?.code === 'ACTION_REJECTED'
                ? 'Signature rejected by user'
                : (err?.response?.data?.error || err.message || 'Login failed');
            setError(msg);
            toast.error(msg);
            setStep('connect');
        } finally {
            setLoading(false);
        }
    };

    // ── Dev-only: Role-based Test Login ──
    const handleDevLogin = async (role: string, wallet: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.post('/__test/auth/login', { wallet, role });
            const token = res.data?.tokens?.accessToken || res.data?.token;
            if (token) {
                const redirect = searchParams.get('redirect') || undefined;
                await login(token, redirect);
                toast.success(`Dev login as ${role}`);
            } else {
                throw new Error('No token received');
            }
        } catch (err: any) {
            setError(err.message || 'Dev login failed');
            setLoading(false);
        }
    };

    const stepLabels = {
        connect: 'Connect Wallet',
        signing: 'Sign Message...',
        verifying: 'Verifying...',
    };

    return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full p-8 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
                {/* Back to landing */}
                <button
                    onClick={() => router.push('/')}
                    className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors mb-6"
                >
                    <ArrowLeft className="w-3 h-3" />
                    Back to Satelink
                </button>

                <div className="text-center mb-10">
                    <div className="w-16 h-16 bg-white rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.2)]">
                        <div className="w-8 h-8 bg-black rounded-lg transform rotate-45"></div>
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome to Satelink</h1>
                    <p className="text-white/50 text-sm">Connect your wallet to access the network.</p>
                </div>

                {error && (
                    <div className="mb-6 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                <div className="space-y-4">
                    {/* Step indicator */}
                    {loading && (
                        <div className="flex items-center justify-center gap-3 py-2">
                            <div className="flex gap-1.5">
                                {['connect', 'signing', 'verifying'].map((s, i) => (
                                    <div
                                        key={s}
                                        className={`w-2 h-2 rounded-full transition-all ${
                                            s === step ? 'bg-white scale-125' :
                                            ['connect', 'signing', 'verifying'].indexOf(step) > i ? 'bg-white/60' : 'bg-white/15'
                                        }`}
                                    />
                                ))}
                            </div>
                            <span className="text-xs text-white/40">{stepLabels[step]}</span>
                        </div>
                    )}

                    {/* Primary: Wallet Login */}
                    <button
                        onClick={handleWalletLogin}
                        disabled={loading}
                        className="w-full py-3.5 rounded-xl bg-white text-black font-semibold hover:bg-white/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Wallet className="w-4 h-4" />
                        )}
                        {loading ? stepLabels[step] : 'Connect Wallet'}
                    </button>

                    <div className="flex items-center gap-2 text-xs text-white/30 px-2">
                        <ShieldCheck className="w-3 h-3" />
                        <span>Sign a message to prove ownership. No gas fees.</span>
                    </div>

                    {/* Dev-only: Test Role Buttons */}
                    {isDev && (
                        <div className="border-t border-white/10 pt-4 mt-4">
                            <p className="text-xs text-yellow-400/60 text-center mb-3 font-mono">DEV MODE — Test Logins</p>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { role: 'admin_super', wallet: '0xadmin_super', label: 'Admin' },
                                    { role: 'node_operator', wallet: '0xnode_op_1', label: 'Node Op' },
                                    { role: 'builder', wallet: '0xbuilder_1', label: 'Builder' },
                                    { role: 'distributor_lco', wallet: '0xdist_1', label: 'Distributor' },
                                    { role: 'enterprise', wallet: '0xent_1', label: 'Enterprise' },
                                    { role: 'user', wallet: '0xuser_1', label: 'User' },
                                ].map(({ role, wallet, label }) => (
                                    <button
                                        key={role}
                                        onClick={() => handleDevLogin(role, wallet)}
                                        disabled={loading}
                                        className="py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-all text-xs font-medium text-white/60 disabled:opacity-50"
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-black flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-white/50" />
            </div>
        }>
            <LoginContent />
        </Suspense>
    );
}
