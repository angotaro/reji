// Optional private RPC providers. The owner signs up on the provider's site
// (free plans exist), then pastes either the full endpoint URL or just the API
// key; for key-only providers the URLs below are built and each is tested
// (chain id, logs) before it is used, so a wrong guess is simply dropped.
export const PROVIDERS = [
  {
    id: 'drpc', name: 'dRPC', site: 'https://drpc.org/',
    tpl: {
      137: ['https://lb.drpc.live/polygon/{k}'], 1: ['https://lb.drpc.live/ethereum/{k}'], 43114: ['https://lb.drpc.live/avalanche/{k}'],
      8217: ['https://lb.drpc.live/klaytn/{k}', 'https://lb.drpc.live/kaia/{k}'], 80002: ['https://lb.drpc.live/polygon-amoy/{k}'],
      11155111: ['https://lb.drpc.live/sepolia/{k}'], 43113: ['https://lb.drpc.live/avalanche-fuji/{k}'],
    },
  },
  {
    id: 'alchemy', name: 'Alchemy', site: 'https://www.alchemy.com/',
    tpl: {
      137: ['https://polygon-mainnet.g.alchemy.com/v2/{k}'], 1: ['https://eth-mainnet.g.alchemy.com/v2/{k}'], 43114: ['https://avax-mainnet.g.alchemy.com/v2/{k}'],
      80002: ['https://polygon-amoy.g.alchemy.com/v2/{k}'], 11155111: ['https://eth-sepolia.g.alchemy.com/v2/{k}'], 43113: ['https://avax-fuji.g.alchemy.com/v2/{k}'],
    },
  },
  {
    id: 'infura', name: 'Infura', site: 'https://www.infura.io/',
    tpl: {
      137: ['https://polygon-mainnet.infura.io/v3/{k}'], 1: ['https://mainnet.infura.io/v3/{k}'], 43114: ['https://avalanche-mainnet.infura.io/v3/{k}'],
      80002: ['https://polygon-amoy.infura.io/v3/{k}'], 11155111: ['https://sepolia.infura.io/v3/{k}'], 43113: ['https://avalanche-fuji.infura.io/v3/{k}'],
    },
  },
  { id: 'other', name: '', site: '', tpl: null }, // QuickNode, Ankr, Chainstack…: paste the full URL
];

export const isApiKey = (s) => /^[A-Za-z0-9_-]{16,120}$/.test(String(s || '').trim());

/** Candidate [chainId, url] pairs for a pasted key. */
export function candidates(providerId, key) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p?.tpl || !isApiKey(key)) return [];
  return Object.entries(p.tpl).flatMap(([id, urls]) => urls.map((u) => [Number(id), u.replace('{k}', encodeURIComponent(key.trim()))]));
}
