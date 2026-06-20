/**
 * Minimal wagmi config for the deposit page wallet-connect.
 * Polygon mainnet only (chainId 137), injected connector (MetaMask / browser
 * wallets) — no WalletConnect projectId, no RainbowKit. wagmi + viem are already
 * project dependencies; nothing new installed.
 */
import { createConfig, http } from 'wagmi';
import { polygon } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

export const wagmiConfig = createConfig({
  chains: [polygon],
  connectors: [injected()],
  transports: {
    [polygon.id]: http(),
  },
  ssr: true,
});
