/**
 * OpenAI Plugin Manifest (S3-005)
 *
 * Provides OpenAI plugin manifest and OpenAPI spec for AI ecosystem integration.
 *
 * Endpoints:
 * - GET /.well-known/ai-plugin.json — OpenAI plugin manifest
 * - GET /openapi.json — OpenAPI 3.0 specification
 */

import { Router } from 'express';

const PLUGIN_MANIFEST = {
  schema_version: 'v1',
  name_for_human: 'Satelink RPC',
  name_for_model: 'satelink_rpc',
  description_for_human: 'Execute blockchain RPC calls via Satelink DePIN network. Query Ethereum, Polygon, Arbitrum, and more. Pay-per-call via x402 (USDC on Base). After a small free allowance the endpoint returns a machine-payable HTTP 402; x402 v2 clients settle it automatically — no account needed.',
  description_for_model: 'Use this plugin to execute JSON-RPC calls on multiple blockchains. Supports eth_blockNumber, eth_getBalance, eth_call, eth_getTransactionByHash, eth_getLogs, and all standard Ethereum JSON-RPC methods. Available chains: ethereum, polygon, arbitrum, base, polygon-amoy. Pay-per-call via x402 (USDC on Base). After a small free allowance the endpoint returns a machine-payable HTTP 402; x402 v2 clients settle it automatically — no account needed.',
  auth: {
    type: 'user_http',
    authorization_type: 'bearer'
  },
  api: {
    type: 'openapi',
    url: 'https://rpc.satelink.network/openapi.json'
  },
  logo_url: 'https://satelink.network/logo.png',
  contact_email: 'satelinknetwork@gmail.com',
  legal_info_url: 'https://satelink.network/terms'
};

const OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'Satelink RPC Gateway',
    description: 'Decentralized RPC infrastructure for blockchain applications and AI agents',
    version: '1.0.0',
    contact: {
      email: 'satelinknetwork@gmail.com',
      url: 'https://satelink.network'
    }
  },
  servers: [
    {
      url: 'https://rpc.satelink.network',
      description: 'Production'
    }
  ],
  paths: {
    '/rpc/{chain}': {
      post: {
        operationId: 'executeRpc',
        summary: 'Execute JSON-RPC call',
        description: 'Execute a JSON-RPC call on the specified blockchain',
        parameters: [
          {
            name: 'chain',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              enum: ['ethereum', 'polygon', 'arbitrum', 'base', 'polygon-amoy']
            },
            description: 'Blockchain to query'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['jsonrpc', 'method', 'id'],
                properties: {
                  jsonrpc: { type: 'string', example: '2.0' },
                  method: {
                    type: 'string',
                    description: 'JSON-RPC method',
                    example: 'eth_blockNumber'
                  },
                  params: {
                    type: 'array',
                    items: {},
                    description: 'Method parameters',
                    example: []
                  },
                  id: { type: 'integer', example: 1 }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Successful RPC response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jsonrpc: { type: 'string' },
                    id: { type: 'integer' },
                    result: { description: 'RPC result (varies by method)' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/v1/chat/completions': {
      post: {
        operationId: 'chatCompletion',
        summary: 'OpenAI-compatible chat completion',
        description: 'Generate chat completions using AI models',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['model', 'messages'],
                properties: {
                  model: {
                    type: 'string',
                    enum: ['gpt-4o', 'gpt-3.5-turbo', 'satelink-default'],
                    example: 'gpt-4o'
                  },
                  messages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                        content: { type: 'string' }
                      }
                    }
                  },
                  max_tokens: { type: 'integer', default: 1000 },
                  stream: { type: 'boolean', default: false }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Chat completion response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    object: { type: 'string', example: 'chat.completion' },
                    model: { type: 'string' },
                    choices: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          message: {
                            type: 'object',
                            properties: {
                              role: { type: 'string' },
                              content: { type: 'string' }
                            }
                          },
                          finish_reason: { type: 'string' }
                        }
                      }
                    },
                    usage: {
                      type: 'object',
                      properties: {
                        prompt_tokens: { type: 'integer' },
                        completion_tokens: { type: 'integer' },
                        total_tokens: { type: 'integer' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/v1/models': {
      get: {
        operationId: 'listModels',
        summary: 'List available models',
        responses: {
          '200': {
            description: 'List of models',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    object: { type: 'string', example: 'list' },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          object: { type: 'string' },
                          owned_by: { type: 'string' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/rpc/mev': {
      post: {
        operationId: 'submitMevTransaction',
        summary: 'Submit private MEV transaction',
        description: 'Submit transaction to MEV-protected relay (not broadcast to public mempool)',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['jsonrpc', 'method', 'params'],
                properties: {
                  jsonrpc: { type: 'string', example: '2.0' },
                  method: {
                    type: 'string',
                    enum: ['eth_sendRawTransaction', 'eth_sendBundle'],
                    example: 'eth_sendRawTransaction'
                  },
                  params: { type: 'array' },
                  id: { type: 'integer' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Transaction submitted' }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key'
      }
    }
  }
};

export function createPluginManifestRouter() {
  const router = Router();

  router.get('/ai-plugin.json', (req, res) => {
    res.json(PLUGIN_MANIFEST);
  });

  return router;
}

export function createOpenApiRouter() {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(OPENAPI_SPEC);
  });

  return router;
}
