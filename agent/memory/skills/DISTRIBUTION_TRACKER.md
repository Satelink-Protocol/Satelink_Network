# DISTRIBUTION TRACKER — Machine Discovery Channels

## Active PRs (check weekly)
- DefiLlama Chainlist #2824: https://github.com/DefiLlama/chainlist/pull/2824
- ethereum-lists/chains #8410: https://github.com/ethereum-lists/chains/pull/8410

## Check PR status (weekly task for ECONOMY_COMMANDER):
  curl -s https://api.github.com/repos/DefiLlama/chainlist/pulls/2824 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['state'], d.get('merged_at','not merged'))"
  curl -s https://api.github.com/repos/ethereum-lists/chains/pulls/8410 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['state'], d.get('merged_at','not merged'))"

## Machine Discovery Channels to target (future tasks):
- dRPC alternative RPC list
- Ankr partner program
- Alchemy ecosystem grants
- Polygon developer grants program
- DePIN-specific aggregators

## When a PR merges:
Create EVT-REV: revenue.distribution_milestone → log the channel as active
