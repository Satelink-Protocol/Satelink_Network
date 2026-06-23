"use client";
import React, { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@satelink/ui';
import { Badge } from '@satelink/ui';
import { toast } from 'sonner';
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


export default function BuilderKeysPage() {
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<number | null>(null);

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const res = await api.get('/builder-api/keys');
      if (res.data?.ok) setKeys(res.data.keys || []);
    } catch {
      toast.error('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }

  const copyToClipboard = (text: string, label = 'Copied') => {
    navigator.clipboard.writeText(text).then(() => toast.success(label));
  };

  const handleRevoke = async (id: number) => {
    setRevoking(id);
    try {
      await api.delete(`/builder-api/keys/${id}`);
      toast.success('API key revoked');
      setKeys(prev => prev.map(k => k.id === id ? { ...k, status: 'revoked' } : k));
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  };

  const handleCreate = async () => {
    if (!newKeyName.trim()) { toast.error('Enter a key name'); return; }
    setCreating(true);
    try {
      const res = await api.post('/builder-api/keys', { name: newKeyName.trim() });
      if (res.data?.ok) {
        setCreatedKey(res.data.key);
        setKeys(prev => [...prev, {
          id: res.data.id || Date.now(),
          name: res.data.name,
          prefix: res.data.prefix,
          status: 'active',
          created_at: Date.now(),
        }]);
        setNewKeyName('');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">API Keys</h1>
          <p className="text-sm text-zinc-500 mt-1">Manage your builder API credentials</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreatedKey(null); }}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
        >
          + New Key
        </button>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <Card className="bg-zinc-900/80 border-zinc-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-zinc-300">
              {createdKey ? 'Key Created — Copy Now' : 'Create New API Key'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {createdKey ? (
              <>
                <p className="text-xs text-amber-400">This key will only be shown once. Copy it now.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-zinc-800 text-emerald-400 px-3 py-2 rounded font-mono break-all">
                    {createdKey}
                  </code>
                  <button
                    onClick={() => copyToClipboard(createdKey, 'Key copied!')}
                    className="px-3 py-2 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors shrink-0"
                  >
                    Copy
                  </button>
                </div>
                <button
                  onClick={() => { setShowCreate(false); setCreatedKey(null); }}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Done
                </button>
              </>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Key name (e.g. Production)"
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  className="flex-1 text-sm bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 rounded px-3 py-2 focus:outline-none focus:border-zinc-500"
                />
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="px-4 py-2 text-sm font-medium rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition-colors"
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-3 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {loading && <p className="text-zinc-500 text-sm">Loading...</p>}

      {!loading && (
        <Card className="bg-zinc-900/80 border-zinc-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-zinc-300">Your Keys</CardTitle>
          </CardHeader>
          <CardContent>
            {keys.length === 0 && (
              <p className="text-zinc-500 text-sm py-4 text-center">No API keys yet. Create one to get started.</p>
            )}
            <div className="divide-y divide-zinc-800/60">
              {keys.map((k: any) => (
                <div key={k.id} className="flex items-center justify-between py-3 gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-200">{k.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="text-xs text-zinc-400 font-mono">{k.prefix}</code>
                      <button
                        onClick={() => copyToClipboard(k.prefix, 'Prefix copied')}
                        className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                      >
                        copy
                      </button>
                    </div>
                    <p className="text-xs text-zinc-600 mt-0.5">
                      Created {new Date(k.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={`text-[10px] ${k.status === 'active' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-zinc-700/50 text-zinc-500 border-zinc-600/30'}`}>
                      {k.status}
                    </Badge>
                    {k.status === 'active' && (
                      <button
                        onClick={() => handleRevoke(k.id)}
                        disabled={revoking === k.id}
                        className="px-2 py-1 text-xs rounded bg-red-900/40 hover:bg-red-800/60 text-red-400 disabled:opacity-50 transition-colors"
                      >
                        {revoking === k.id ? '…' : 'Revoke'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
