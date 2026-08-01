/**
 * AI Inference Gateway (S3-002)
 *
 * OpenAI-compatible API for AI agents (LangChain, AutoGPT, CrewAI).
 * Zero code change needed on their side — just point to Satelink.
 *
 * Endpoints:
 * - POST /v1/chat/completions — Chat completion
 * - POST /v1/completions — Legacy completion
 * - GET /v1/models — List available models
 *
 * Billing: $0.001 USDT per request (flat rate)
 * Backend: Groq (free tier) — 100% margin
 */

import { Router } from 'express';
import crypto from 'crypto';
import { isFounderApiKey } from '../../payments/founder_wallets.js';
import { shadowWriteRevenueLedger } from '../../ledger/shadow_ledger_write.js';

const REQUEST_COST_USDT = 0.001;

const SUPPORTED_MODELS = [
  { id: 'llama3-8b-8192', object: 'model', owned_by: 'meta', created: 1714000000 },
  { id: 'llama3-70b-8192', object: 'model', owned_by: 'meta', created: 1714000000 },
  { id: 'mixtral-8x7b-32768', object: 'model', owned_by: 'mistral', created: 1709000000 },
  { id: 'gemma-7b-it', object: 'model', owned_by: 'google', created: 1709000000 },
  { id: 'gpt-4o', object: 'model', owned_by: 'openai', created: 1699000000 },
  { id: 'gpt-3.5-turbo', object: 'model', owned_by: 'openai', created: 1677000000 },
  { id: 'satelink-default', object: 'model', owned_by: 'satelink', created: 1714000000 }
];

const MODEL_MAPPING = {
  'gpt-4o': 'llama3-70b-8192',
  'gpt-4o-mini': 'llama3-8b-8192',
  'gpt-3.5-turbo': 'llama3-8b-8192',
  'claude-3-5-sonnet': 'llama3-70b-8192',
  'claude-3-haiku': 'llama3-8b-8192',
  'llama3-8b-8192': 'llama3-8b-8192',
  'llama3-70b-8192': 'llama3-70b-8192',
  'mixtral-8x7b-32768': 'mixtral-8x7b-32768',
  'gemma-7b-it': 'gemma-7b-it',
  'satelink-default': 'llama3-8b-8192'
};

const aiGatewayStats = {
  totalRequests: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  revenueUsdt: 0,
  lastRequestAt: null
};

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function countMessageTokens(messages) {
  if (!messages || !Array.isArray(messages)) return 0;
  return messages.reduce((sum, msg) => {
    return sum + estimateTokens(msg.content || '') + 4;
  }, 0);
}

async function recordAiRevenue(db, inputTokens, outputTokens, apiKey, requestId, model) {
  if (!db || !db.query) return;

  const cost = REQUEST_COST_USDT;
  const clientId = apiKey || 'anonymous';

  try {
    const now = Math.floor(Date.now() / 1000);
    const isTestData = await isFounderApiKey(db, apiKey);
    await db.query(
      `INSERT INTO revenue_events_v2 (op_type, node_id, client_id, amount_usdt, status, request_id, created_at, is_test_data)
       VALUES ('ai_inference', $1, $2, $3, 'success', $4, $5, $6)`,
      [`ai_${model}`, clientId, cost, requestId, now, isTestData]
    );
    // M3 shadow ledger — flag-gated, isolated pool, never throws.
    shadowWriteRevenueLedger(db, { requestId, amountUsdt: cost, isTestData });

    aiGatewayStats.revenueUsdt += cost;
    aiGatewayStats.totalInputTokens += inputTokens;
    aiGatewayStats.totalOutputTokens += outputTokens;

    console.log(`[AI Gateway] Revenue: ${model} → $${cost.toFixed(6)} (flat rate)`);
  } catch (e) {
    console.error('[AI Gateway] Failed to record revenue:', e.message);
  }
}

async function validateApiKey(apiKey, db) {
  if (!apiKey) {
    return { valid: false, error: 'API key required. Use x-api-key header.' };
  }

  if (!apiKey.startsWith('sk_')) {
    return { valid: false, error: 'Invalid API key format. Must start with sk_' };
  }

  if (!db || !db.query) {
    return { valid: true, tier: 'basic' };
  }

  try {
    const result = await db.query(
      `SELECT tier, status FROM rpc_api_keys
       WHERE key_hash = encode(sha256($1::bytea), 'hex') AND status = 'active'`,
      [apiKey]
    );

    if (result.rows.length === 0) {
      return { valid: false, error: 'Invalid or inactive API key' };
    }

    return { valid: true, tier: result.rows[0].tier };
  } catch (e) {
    return { valid: true, tier: 'basic' };
  }
}

function createStubResponse(model, messages, maxTokens) {
  const requestId = `chatcmpl-satelink-${crypto.randomUUID().slice(0, 8)}`;
  const inputTokens = countMessageTokens(messages);
  const outputTokens = Math.min(maxTokens || 100, 50);

  const stubContent = `Satelink AI Gateway operational. Model: ${model}. ` +
    `Configure GROQ_API_KEY environment variable for real inference. ` +
    `This stub response demonstrates the billing system is working.`;

  return {
    response: {
      id: requestId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: stubContent
        },
        logprobs: null,
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens
      },
      system_fingerprint: 'satelink-gateway-v1'
    },
    inputTokens,
    outputTokens,
    requestId
  };
}

async function callGroqApi(model, messages, maxTokens) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const groqModel = MODEL_MAPPING[model] || 'llama3-8b-8192';

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: groqModel,
        messages: messages,
        max_tokens: maxTokens || 1000,
      }),
    });

    if (!response.ok) {
      console.error('[AI Gateway] Groq error:', response.status);
      return null;
    }

    const data = await response.json();
    const inputTokens = data.usage?.prompt_tokens || countMessageTokens(messages);
    const outputTokens = data.usage?.completion_tokens || estimateTokens(data.choices?.[0]?.message?.content);

    return {
      response: {
        id: data.id || `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
        object: 'chat.completion',
        created: data.created || Math.floor(Date.now() / 1000),
        model: model,
        choices: data.choices || [{
          index: 0,
          message: { role: 'assistant', content: '' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens
        },
        system_fingerprint: 'satelink-groq'
      },
      inputTokens,
      outputTokens,
      requestId: data.id
    };
  } catch (err) {
    console.error('[AI Gateway] Groq call failed:', err.message);
    return null;
  }
}

export function createAiGatewayRouter(db, redis) {
  const router = Router();

  router.get('/models', (req, res) => {
    res.json({
      object: 'list',
      data: SUPPORTED_MODELS
    });
  });

  router.get('/ai/status', (req, res) => {
    res.json({
      ok: true,
      status: 'operational',
      providers: {
        groq: !!process.env.GROQ_API_KEY
      },
      models: SUPPORTED_MODELS.map(m => m.id),
      pricing: {
        perRequestUsdt: REQUEST_COST_USDT,
        margin: '100%'
      },
      stats: {
        totalRequests: aiGatewayStats.totalRequests,
        totalInputTokens: aiGatewayStats.totalInputTokens,
        totalOutputTokens: aiGatewayStats.totalOutputTokens,
        revenueUsdt: aiGatewayStats.revenueUsdt.toFixed(8),
        lastRequestAt: aiGatewayStats.lastRequestAt
      }
    });
  });

  router.post('/chat/completions', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    const keyCheck = await validateApiKey(apiKey, db);

    if (!keyCheck.valid) {
      return res.status(401).json({
        error: {
          message: keyCheck.error,
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      });
    }

    const { model = 'satelink-default', messages, max_tokens = 1000, stream = false } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: {
          message: 'messages is required and must be a non-empty array',
          type: 'invalid_request_error',
          code: 'invalid_messages'
        }
      });
    }

    if (stream) {
      return res.status(400).json({
        error: {
          message: 'Streaming not yet supported. Set stream: false',
          type: 'invalid_request_error',
          code: 'streaming_not_supported'
        }
      });
    }

    aiGatewayStats.totalRequests++;
    aiGatewayStats.lastRequestAt = new Date().toISOString();

    let result = await callGroqApi(model, messages, max_tokens);

    if (!result) {
      result = createStubResponse(model, messages, max_tokens);
    }

    await recordAiRevenue(db, result.inputTokens, result.outputTokens, apiKey, result.requestId, model);

    res.json(result.response);
  });

  router.post('/completions', async (req, res) => {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    const keyCheck = await validateApiKey(apiKey, db);

    if (!keyCheck.valid) {
      return res.status(401).json({
        error: {
          message: keyCheck.error,
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      });
    }

    const { model = 'satelink-default', prompt, max_tokens = 100 } = req.body || {};

    if (!prompt) {
      return res.status(400).json({
        error: {
          message: 'prompt is required',
          type: 'invalid_request_error',
          code: 'invalid_prompt'
        }
      });
    }

    aiGatewayStats.totalRequests++;
    aiGatewayStats.lastRequestAt = new Date().toISOString();

    const messages = [{ role: 'user', content: prompt }];
    let result = await callGroqApi(model, messages, max_tokens);

    if (!result) {
      result = createStubResponse(model, messages, max_tokens);
    }

    await recordAiRevenue(db, result.inputTokens, result.outputTokens, apiKey, result.requestId, model);

    res.json({
      id: result.requestId,
      object: 'text_completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        text: result.response.choices[0].message.content,
        index: 0,
        logprobs: null,
        finish_reason: 'stop'
      }],
      usage: result.response.usage
    });
  });

  return router;
}
