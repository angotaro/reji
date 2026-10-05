// Network + token configuration. Everything here is public data; no API keys.
//
// JPYC (electronic payment instrument issued by JPYC Inc.) uses the same
// contract address on every supported chain, mainnet and testnet.
// Source: https://github.com/jpycoin (official org README) and JPYC's
// pre-contract disclosure. Double-check before going live.

export const APP = {
  name: 'Reji',
  version: '0.1.2',
};

export const JPYC = {
  symbol: 'JPYC',
  name: 'JPY Coin',
  decimals: 18,
  address: '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29',
  site: 'https://jpyc.co.jp',
  faucet: 'https://faucet.jpyc.co.jp',
};

// rpc: free, key-less public endpoints. The pool in rpc.js scores them and spreads load; order is only the starting preference.
// Add your own (e.g. a free-tier Alchemy/Infura URL) in Settings > Advanced.
// confirmations: blocks to wait before a sale is marked "confirmed".
export const CHAINS = {
  137: {
    id: 137, name: 'Polygon', native: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpc: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org', 'https://1rpc.io/matic', 'https://polygon-rpc.com', 'https://polygon.gateway.tenderly.co'],
    explorer: 'https://polygonscan.com', blockTime: 2, confirmations: 5, poll: 3000, testnet: false, testPair: 80002,
  },
  43114: {
    id: 43114, name: 'Avalanche', fullName: 'Avalanche C-Chain', native: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    rpc: ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org', 'https://1rpc.io/avax/c'],
    explorer: 'https://snowtrace.io', blockTime: 2, confirmations: 1, poll: 3000, testnet: false, testPair: 43113,
  },
  1: {
    id: 1, name: 'Ethereum', native: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth', 'https://mainnet.gateway.tenderly.co'],
    explorer: 'https://etherscan.io', blockTime: 12, confirmations: 3, poll: 6000, testnet: false, testPair: 11155111,
  },
  8217: {
    id: 8217, name: 'Kaia', native: { name: 'KAIA', symbol: 'KAIA', decimals: 18 },
    rpc: ['https://public-en.node.kaia.io', 'https://klaytn.drpc.org', 'https://1rpc.io/klay', 'https://kaia.blockpi.network/v1/rpc/public'],
    explorer: 'https://kaiascan.io', blockTime: 1, confirmations: 1, poll: 3000, testnet: false, testPair: 1001,
  },
  // ---- testnets (free test JPYC: https://faucet.jpyc.co.jp) ----
  80002: {
    id: 80002, name: 'Polygon Amoy', native: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpc: ['https://rpc-amoy.polygon.technology', 'https://polygon-amoy-bor-rpc.publicnode.com', 'https://polygon-amoy.drpc.org'],
    explorer: 'https://amoy.polygonscan.com', blockTime: 2, confirmations: 3, poll: 3000, testnet: true,
  },
  43113: {
    id: 43113, name: 'Avalanche Fuji', native: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    rpc: ['https://api.avax-test.network/ext/bc/C/rpc', 'https://avalanche-fuji-c-chain-rpc.publicnode.com', 'https://avalanche-fuji.drpc.org'],
    explorer: 'https://testnet.snowtrace.io', blockTime: 2, confirmations: 1, poll: 3000, testnet: true,
  },
  11155111: {
    id: 11155111, name: 'Sepolia', native: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpc: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.drpc.org', 'https://1rpc.io/sepolia'],
    explorer: 'https://sepolia.etherscan.io', blockTime: 12, confirmations: 2, poll: 6000, testnet: true,
  },
  1001: {
    id: 1001, name: 'Kaia Kairos', native: { name: 'KAIA', symbol: 'KAIA', decimals: 18 },
    rpc: ['https://public-en-kairos.node.kaia.io'],
    explorer: 'https://kairos.kaiascan.io', blockTime: 1, confirmations: 1, poll: 3000, testnet: true,
  },
};

export const MAINNET_IDS = [137, 43114, 1, 8217];

/** Map a mainnet id to the chain actually used for the chosen network mode. */
export const resolveChain = (mainnetId, network) =>
  network === 'testnet' ? CHAINS[mainnetId]?.testPair ?? mainnetId : mainnetId;

export const chainName = (id) => CHAINS[id]?.name ?? `Chain ${id}`;
export const explorerTx = (id, hash) => `${CHAINS[id]?.explorer}/tx/${hash}`;
export const explorerAddress = (id, addr) => `${CHAINS[id]?.explorer}/address/${addr}`;
export const explorerToken = (id, holder) =>
  `${CHAINS[id]?.explorer}/token/${JPYC.address}${holder ? `?a=${holder}` : ''}`;

/** Parameters for wallet_addEthereumChain */
export function addChainParams(id) {
  const c = CHAINS[id];
  return {
    chainId: '0x' + id.toString(16),
    chainName: c.fullName || c.name,
    nativeCurrency: c.native,
    rpcUrls: [c.rpc[0]],
    blockExplorerUrls: [c.explorer],
  };
}

export const TIP_PRESETS = [100, 300, 500, 1000];
export const LIMITS = {
  maxYen: 10_000_000, // per sale sanity cap
  suffixMax: 999_999, // unique wei suffix range (invisible: < 0.000000000001 JPYC)
  tipMark: 8_888_888, // wei added to every tip (末広がりの8): outside the sale range, so a tip can never look like a sale
  tipMin: 10,
  tipMax: 50_000,
  maxItems: 200,
};
