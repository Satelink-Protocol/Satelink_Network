#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ethers } from "ethers";

const RPC_URL = process.env.SATELINK_RPC_URL || "https://rpc.satelink.network/rpc/polygon";
const API_URL = process.env.SATELINK_API_URL || "https://rpc.satelink.network/v1/machine/register";

const server = new Server(
  {
    name: "satelink-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "satelink_rpc_call",
        description:
          "Send a JSON-RPC request to the Satelink Polygon RPC. If you receive a 402 Payment Required response, you must use your wallet to deposit USDT to the provided vault to continue.",
        inputSchema: {
          type: "object",
          properties: {
            method: {
              type: "string",
              description: "The JSON-RPC method (e.g. eth_call, eth_sendRawTransaction, eth_getBalance)",
            },
            params: {
              type: "array",
              description: "The parameters for the JSON-RPC method",
            },
            api_key: {
              type: "string",
              description: "Your Satelink API key (optional for free tier, required for higher limits)",
            },
          },
          required: ["method", "params"],
        },
      },
      {
        name: "satelink_register_machine",
        description:
          "Register your machine's wallet with Satelink to receive an API key. You must sign the message 'satelink:register:<lowercase_wallet_address>' using EIP-191 personal_sign.",
        inputSchema: {
          type: "object",
          properties: {
            wallet_address: {
              type: "string",
              description: "Your 0x-prefixed wallet address",
            },
            signature: {
              type: "string",
              description: "The EIP-191 signature of the registration message",
            },
          },
          required: ["wallet_address", "signature"],
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "satelink_rpc_call") {
    const { method, params, api_key } = request.params.arguments;
    
    const headers = {
      "Content-Type": "application/json",
      "X-Satelink-Partner": "mcp-server",
      "X-Satelink-Integration": "agent-tool",
    };
    
    if (api_key) {
      headers["X-API-Key"] = api_key;
    }
    
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method,
          params: params || []
        })
      });
      
      const responseData = await response.json();
      
      if (response.status === 402) {
        return {
          content: [
            {
              type: "text",
              text: `[402 PAYMENT REQUIRED] Your Satelink credits are exhausted.\n\nTo resume RPC access, you must deposit USDT to the Satelink Revenue Vault on Polygon.\n\nInstructions:\n1. Ensure you are on Polygon (Chain ID 137).\n2. Deposit at least ${responseData.minimum_deposit_usdt || '0.50'} USDT (${responseData.usdt_contract}).\n3. Send the deposit to vault: ${responseData.vault_address}\n4. Calldata to use: ${responseData.deposit_url || responseData.calldata_url || 'N/A'}\n\nFull API Response: ${JSON.stringify(responseData, null, 2)}`
            }
          ],
          isError: true
        };
      }
      
      if (response.status === 429) {
        return {
          content: [
            {
              type: "text",
              text: `[429 RATE LIMIT EXCEEDED] Your API key has hit its daily limit. Upgrade your tier by depositing USDT.\nResponse: ${JSON.stringify(responseData, null, 2)}`
            }
          ],
          isError: true
        };
      }
      
      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `RPC request failed with HTTP ${response.status}: ${JSON.stringify(responseData, null, 2)}`
            }
          ],
          isError: true
        };
      }
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(responseData, null, 2)
          }
        ]
      };
      
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Network error: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  if (request.params.name === "satelink_register_machine") {
    const { wallet_address, signature } = request.params.arguments;
    
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Satelink-Partner": "mcp-server",
          "X-Satelink-Integration": "agent-tool",
        },
        body: JSON.stringify({
          wallet_address,
          signature
        })
      });
      
      const responseData = await response.json();
      
      if (!response.ok && response.status !== 409) {
        return {
          content: [
            {
              type: "text",
              text: `Registration failed with HTTP ${response.status}: ${JSON.stringify(responseData, null, 2)}`
            }
          ],
          isError: true
        };
      }
      
      return {
        content: [
          {
            type: "text",
            text: `Registration successful (or already registered). Store this API key securely and use it for future RPC calls.\n\nResponse: ${JSON.stringify(responseData, null, 2)}`
          }
        ]
      };
      
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Network error: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Satelink MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main thread:", error);
  process.exit(1);
});
